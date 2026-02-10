/**
 * Edge AI Gateway - Deployable Cloudflare Worker
 *
 * Secure AI API proxy with API keys stored in Cloudflare environment variables.
 * Supports Azure OpenAI, Azure AI Foundry, OpenAI, and Cloudflare AI.
 */

import {
  createProvider,
  AIGatewayError,
  AIGatewayErrorCode,
  type AnyProviderConfig,
  type ChatCompletionRequest,
} from '../src';

import {
  getClientEnv,
  getEndpoint,
  inferModelSource,
  safeExtractChatUsage,
  safeParseChatRequestModel,
  type UsageEvent,
} from './metrics';

// ============================================================================
// Types
// ============================================================================

export interface Env {
  // General config
  AI_PROVIDER: 'azure' | 'azure-foundry' | 'openai' | 'cloudflare' | 'vertex';

  // Metrics (Cloudflare Analytics Engine)
  AE?: AnalyticsEngineDataset;

  // Query AE from Worker via SQL API
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;

  // Optional: require x-client-id header (otherwise allow unknown)
  REQUIRE_CLIENT_ID?: string;

  // Azure OpenAI
  AZURE_ENDPOINT?: string;
  AZURE_API_KEY?: string;
  AZURE_DEPLOYMENT?: string;
  AZURE_API_VERSION?: string;

  // Azure TTS (cognitiveservices)
  AZURE_TTS_ENDPOINT?: string;
  AZURE_TTS_API_KEY?: string;
  AZURE_TTS_API_VERSION?: string;

  // Azure AI Foundry
  AZURE_FOUNDRY_ENDPOINT?: string;
  AZURE_FOUNDRY_API_KEY?: string;
  AZURE_FOUNDRY_MODEL?: string;

  // OpenAI
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_ORGANIZATION?: string;

  // Cloudflare AI
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_MODEL?: string;

  // Google Vertex AI / Gemini
  GCP_PROJECT_ID?: string;
  GCP_REGION?: string;
  GCP_SERVICE_ACCOUNT_JSON?: string;
  GEMINI_API_KEY?: string;
  VERTEX_API_KEY?: string;  // Vertex AI API Key (alternative to Service Account)
  VERTEX_DEFAULT_MODEL?: string;

  // Optional: Client API key for authentication
  CLIENT_API_KEY?: string;

  // Optional: Allowed origins for CORS
  ALLOWED_ORIGINS?: string;
}

interface TTSRequest {
  model?: string;
  input: string;
  voice: string;
  response_format?: string;
}

interface EmbeddingsRequest {
  model?: string;
  input: string | string[];
}

interface TTSProviderConfig {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Build CORS headers based on request origin and allowed origins
 */
function getCorsHeaders(origin: string | null, allowedOrigins?: string): HeadersInit {
  let allowOrigin = '*';
  
  if (allowedOrigins) {
    const origins = allowedOrigins.split(',').map(o => o.trim());
    allowOrigin = origins.includes(origin || '') ? origin! : origins[0];
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Create a JSON error response
 */
function errorResponse(
  message: string,
  status: number,
  corsHeaders: HeadersInit
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function writeUsageEvent(env: Env, event: UsageEvent): Promise<void> {
  try {
    env.AE?.writeDataPoint({
      blobs: [
        event.client,
        event.env,
        event.endpoint,
        event.model,
        event.model_source,
      ],
      doubles: [
        event.tokens_in,
        event.tokens_out,
        event.latency_ms,
        event.status,
        event.ts,
      ],
    });
  } catch {
    // best-effort: never break user traffic because of metrics
  }
}

/**
 * Create a JSON success response
 */
function jsonResponse(data: unknown, corsHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Create a streaming response
 */
function streamResponse(stream: ReadableStream, corsHeaders: HeadersInit): Response {
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Create provider configuration from environment variables
 */
function createProviderConfig(env: Env): AnyProviderConfig {
  switch (env.AI_PROVIDER) {
    case 'azure':
      if (!env.AZURE_ENDPOINT || !env.AZURE_API_KEY) {
        throw new AIGatewayError('Azure endpoint and API key are required', {
          status: 500,
          code: AIGatewayErrorCode.CONFIG_ERROR,
        });
      }
      return {
        type: 'azure',
        endpoint: env.AZURE_ENDPOINT,
        apiKey: env.AZURE_API_KEY,
        deployment: env.AZURE_DEPLOYMENT || 'gpt-4o',
        apiVersion: env.AZURE_API_VERSION || '2024-02-15-preview',
      };

    case 'azure-foundry':
      if (!env.AZURE_FOUNDRY_ENDPOINT || !env.AZURE_FOUNDRY_API_KEY) {
        throw new AIGatewayError('Azure Foundry endpoint and API key are required', {
          status: 500,
          code: AIGatewayErrorCode.CONFIG_ERROR,
        });
      }
      return {
        type: 'azure-foundry',
        endpoint: env.AZURE_FOUNDRY_ENDPOINT,
        apiKey: env.AZURE_FOUNDRY_API_KEY,
        model: env.AZURE_FOUNDRY_MODEL || 'gpt-4o',
      };

    case 'openai':
      if (!env.OPENAI_API_KEY) {
        throw new AIGatewayError('OpenAI API key is required', {
          status: 500,
          code: AIGatewayErrorCode.CONFIG_ERROR,
        });
      }
      return {
        type: 'openai',
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        organization: env.OPENAI_ORGANIZATION,
      };

    case 'cloudflare':
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        throw new AIGatewayError('Cloudflare account ID and API token are required', {
          status: 500,
          code: AIGatewayErrorCode.CONFIG_ERROR,
        });
      }
      return {
        type: 'cloudflare',
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_API_TOKEN,
        model: env.CF_MODEL,
      };

    case 'vertex':
      if (!env.GCP_PROJECT_ID && !env.GEMINI_API_KEY) {
        throw new AIGatewayError('GCP project ID or Gemini API key is required', {
          status: 500,
          code: AIGatewayErrorCode.CONFIG_ERROR,
        });
      }
      return {
        type: 'vertex',
        projectId: env.GCP_PROJECT_ID || '',
        region: env.GCP_REGION || 'us-central1',
        serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON,
        geminiApiKey: env.GEMINI_API_KEY,
        defaultModel: env.VERTEX_DEFAULT_MODEL || 'gemini-2.0-flash',
      };

    default:
      throw new AIGatewayError(`Unknown provider: ${env.AI_PROVIDER}`, {
        status: 400,
        code: AIGatewayErrorCode.CONFIG_ERROR,
      });
  }
}

// ============================================================================
// TTS Handling
// ============================================================================

/**
 * Get TTS provider configuration based on available environment variables
 */
function getTTSConfig(body: TTSRequest, env: Env): TTSProviderConfig | null {
  const defaultFormat = body.response_format || 'mp3';

  // Priority 1: Azure TTS (cognitiveservices endpoint)
  const ttsApiKey = env.AZURE_TTS_API_KEY || env.AZURE_API_KEY;
  if (env.AZURE_TTS_ENDPOINT && ttsApiKey) {
    const deployment = body.model || 'gpt-4o-mini-tts';
    const apiVersion = env.AZURE_TTS_API_VERSION || '2025-03-01-preview';
    return {
      url: `${env.AZURE_TTS_ENDPOINT}/openai/deployments/${deployment}/audio/speech?api-version=${apiVersion}`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ttsApiKey}`,
      },
      body: {
        model: deployment,
        input: body.input,
        voice: body.voice,
        response_format: defaultFormat,
      },
    };
  }

  // Priority 2: Azure AI Foundry
  if (env.AZURE_FOUNDRY_ENDPOINT && env.AZURE_FOUNDRY_API_KEY) {
    return {
      url: `${env.AZURE_FOUNDRY_ENDPOINT}/models/audio/speech`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.AZURE_FOUNDRY_API_KEY}`,
      },
      body: {
        model: body.model || 'gpt-4o-mini-tts',
        input: body.input,
        voice: body.voice,
        response_format: defaultFormat,
      },
    };
  }

  // Priority 3: Azure OpenAI Service
  if (env.AZURE_ENDPOINT && env.AZURE_API_KEY) {
    const deployment = body.model?.replace('gpt-4o-mini-', '') || 'tts';
    const apiVersion = env.AZURE_API_VERSION || '2024-02-15-preview';
    return {
      url: `${env.AZURE_ENDPOINT}/openai/deployments/${deployment}/audio/speech?api-version=${apiVersion}`,
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.AZURE_API_KEY,
      },
      body: {
        input: body.input,
        voice: body.voice,
        response_format: defaultFormat,
      },
    };
  }

  // Priority 4: OpenAI
  if (env.OPENAI_API_KEY) {
    const baseUrl = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    return {
      url: `${baseUrl}/audio/speech`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: {
        model: body.model || 'tts-1',
        input: body.input,
        voice: body.voice,
        response_format: defaultFormat,
      },
    };
  }

  return null;
}

/**
 * Handle TTS request with unified error handling
 */
async function handleTTS(
  request: Request,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  let body: TTSRequest;
  
  try {
    body = await request.json() as TTSRequest;
  } catch {
    return errorResponse('Invalid JSON body', 400, corsHeaders);
  }

  // Validate required fields
  if (!body.input || !body.voice) {
    return errorResponse('Missing required fields: input, voice', 400, corsHeaders);
  }

  const config = getTTSConfig(body, env);
  if (!config) {
    return errorResponse('No TTS provider configured', 500, corsHeaders);
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(config.body),
    });

    if (!response.ok) {
      const errText = await response.text();
      return errorResponse(`TTS error: ${errText}`, response.status, corsHeaders);
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TTS request failed';
    return errorResponse(message, 500, corsHeaders);
  }
}

// ============================================================================
// Embeddings Handling
// ============================================================================

function validateEmbeddingsRequest(body: unknown): body is EmbeddingsRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;
  const input = req.input;
  if (typeof input === 'string') return input.length > 0;
  if (Array.isArray(input)) return input.length > 0 && input.every((x) => typeof x === 'string');
  return false;
}

async function handleEmbeddings(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, corsHeaders);
  }

  if (!validateEmbeddingsRequest(body)) {
    return errorResponse('Invalid request: input is required', 400, corsHeaders);
  }

  const req = body as EmbeddingsRequest;
  const model = req.model || 'text-embedding-3-small';
  const input = Array.isArray(req.input) ? req.input : [req.input];

  // Prefer Azure OpenAI embeddings if configured
  if (env.AZURE_ENDPOINT && env.AZURE_API_KEY) {
    const deployment = model; // user passes deployment name
    const apiVersion = env.AZURE_API_VERSION || '2024-02-15-preview';
    const url = `${env.AZURE_ENDPOINT}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': env.AZURE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });

    const text = await r.text();
    if (!r.ok) {
      return errorResponse(`Embeddings provider error: ${text}`, 500, corsHeaders);
    }

    return new Response(text, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Fallback: Azure Foundry has an OpenAI-compatible embeddings endpoint at /openai/deployments/<model>/embeddings
  if (env.AZURE_FOUNDRY_ENDPOINT && env.AZURE_FOUNDRY_API_KEY) {
    const foundryUrl = `${env.AZURE_FOUNDRY_ENDPOINT}/openai/deployments/${model}/embeddings?api-version=2024-10-21`;
    const r = await fetch(foundryUrl, {
      method: 'POST',
      headers: {
        'api-key': env.AZURE_FOUNDRY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });

    const text = await r.text();
    if (!r.ok) {
      return errorResponse(`Embeddings provider error: ${text}`, 500, corsHeaders);
    }

    return new Response(text, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return errorResponse('Embeddings not configured (AZURE_ENDPOINT/AZURE_API_KEY or AZURE_FOUNDRY_ENDPOINT/AZURE_FOUNDRY_API_KEY required)', 500, corsHeaders);
}

// ============================================================================
// Chat Completion Handling
// ============================================================================

/**
 * Validate chat completion request body
 */
function validateChatRequest(body: unknown): body is ChatCompletionRequest {
  if (!body || typeof body !== 'object') return false;
  const req = body as Record<string, unknown>;
  
  if (!Array.isArray(req.messages) || req.messages.length === 0) return false;
  
  return req.messages.every((msg: unknown) => {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, unknown>;
    return typeof m.role === 'string' && (typeof m.content === 'string' || Array.isArray(m.content));
  });
}

/**
 * Parse model prefix and return provider type + actual model name
 * Supports: gemini/model, vertex/model, azure/model, foundry/model, openai/model
 */
function parseModelPrefix(model: string | undefined): { provider: string | null; model: string } {
  if (!model) return { provider: null, model: '' };
  
  const prefixMatch = model.match(/^(gemini|vertex|azure|foundry|openai|cloudflare|vertex-claude|anthropic)\/(.*)/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase();
    const actualModel = prefixMatch[2];
    // Map prefixes to provider types
    const providerMap: Record<string, string> = {
      'gemini': 'gemini-direct', // Use direct Gemini API call
      'vertex': 'gemini-direct',
      'azure': 'azure-foundry',
      'foundry': 'azure-foundry',
      'openai': 'openai',
      'cloudflare': 'cloudflare',
      'vertex-claude': 'vertex-anthropic', // Anthropic on Vertex AI
      'anthropic': 'vertex-anthropic',
    };
    return { provider: providerMap[prefix] || null, model: actualModel };
  }
  return { provider: null, model };
}

// ============================================================================
// Vertex AI / Gemini Direct Implementation
// ============================================================================

/** Base64 URL encode (JWT standard) */
function base64UrlEncode(data: string | ArrayBuffer): string {
  let base64: string;
  if (typeof data === 'string') {
    base64 = btoa(data);
  } else {
    base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Parse PEM private key to raw bytes */
function parsePemPrivateKey(pem: string): Uint8Array {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/[\r\n\s]/g, '');
  const binaryString = atob(pemContents);
  return Uint8Array.from(binaryString, c => c.charCodeAt(0));
}

/** Generate signed JWT for Google OAuth */
async function generateGoogleJWT(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform'
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signInput = `${headerB64}.${payloadB64}`;

  // Import private key for signing
  const keyData = parsePemPrivateKey(serviceAccount.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signInput)
  );

  const signatureB64 = base64UrlEncode(signature);
  return `${signInput}.${signatureB64}`;
}

/** Token cache */
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

/** Get Google access token (with caching) */
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  // Return cached token if valid (with 5 min buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 300000) {
    return cachedAccessToken;
  }

  const sa = JSON.parse(serviceAccountJson);
  const jwt = await generateGoogleJWT(sa);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  
  return cachedAccessToken;
}

/** Convert OpenAI messages to Gemini format */
function toGeminiMessages(messages: Array<{ role: string; content: string | unknown[] }>) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }));
}

/** Call Vertex AI directly with Service Account auth */
async function callVertexAI(
  model: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  projectId: string,
  region: string,
  serviceAccountJson: string,
  corsHeaders: HeadersInit,
  vertexApiKey?: string
): Promise<Response> {
  try {
    const geminiMessages = toGeminiMessages(messages);
    const systemMsg = messages.find(m => m.role === 'system');
    
    const body: Record<string, unknown> = { contents: geminiMessages };
    if (systemMsg) {
      body.systemInstruction = { 
        parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }] 
      };
    }

    // Use API Key if available, otherwise use OAuth2
    let url: string;
    let headers: Record<string, string>;
    
    if (vertexApiKey) {
      // API Key authentication (simpler, faster)
      url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent?key=${vertexApiKey}`;
      headers = { 'Content-Type': 'application/json' };
    } else {
      // OAuth2 authentication (Service Account)
      const accessToken = await getGoogleAccessToken(serviceAccountJson);
      url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return errorResponse(`Vertex AI error: ${errorText}`, response.status, corsHeaders);
    }

    const geminiResponse = await response.json() as {
      candidates?: { content: { parts: { text: string }[] } }[];
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };

    // Convert to OpenAI format
    const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: geminiResponse.usageMetadata ? {
        prompt_tokens: geminiResponse.usageMetadata.promptTokenCount,
        completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount,
        total_tokens: geminiResponse.usageMetadata.totalTokenCount,
      } : undefined,
    };

    return jsonResponse(openaiResponse, corsHeaders);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Vertex AI call failed';
    return errorResponse(`Vertex AI error: ${msg}`, 500, corsHeaders);
  }
}

/** Call Gemini API directly (fallback when no Service Account) */
async function callGeminiAPI(
  model: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  apiKey: string,
  corsHeaders: HeadersInit
): Promise<Response> {
  const geminiMessages = toGeminiMessages(messages);
  const systemMsg = messages.find(m => m.role === 'system');
  
  const body: Record<string, unknown> = { contents: geminiMessages };
  if (systemMsg) {
    body.systemInstruction = { 
      parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }] 
    };
  }

  // Use aiplatform API for better model support (including Gemini 3)
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return errorResponse(`Gemini API error: ${errorText}`, response.status, corsHeaders);
  }

  const geminiResponse = await response.json() as {
    candidates?: { content: { parts: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
  };

  const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const openaiResponse = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: geminiResponse.usageMetadata ? {
      prompt_tokens: geminiResponse.usageMetadata.promptTokenCount,
      completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount,
      total_tokens: geminiResponse.usageMetadata.totalTokenCount,
    } : undefined,
  };

  return jsonResponse(openaiResponse, corsHeaders);
}

/** Call Vertex AI with streaming (SSE format) */
async function callVertexAIStreaming(
  model: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  projectId: string,
  region: string,
  serviceAccountJson: string,
  corsHeaders: HeadersInit,
  vertexApiKey?: string
): Promise<Response> {
  try {
    const geminiMessages = toGeminiMessages(messages);
    const systemMsg = messages.find(m => m.role === 'system');
    
    const body: Record<string, unknown> = { contents: geminiMessages };
    if (systemMsg) {
      body.systemInstruction = { 
        parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }] 
      };
    }

    let url: string;
    let headers: Record<string, string>;
    
    if (vertexApiKey) {
      url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${vertexApiKey}`;
      headers = { 'Content-Type': 'application/json' };
    } else {
      const accessToken = await getGoogleAccessToken(serviceAccountJson);
      url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return errorResponse(`Vertex AI streaming error: ${errorText}`, response.status, corsHeaders);
    }

    if (!response.body) {
      return errorResponse('No response body for streaming', 500, corsHeaders);
    }

    // Transform Gemini SSE to OpenAI SSE format with buffer for cross-packet handling
    let buffer = '';
    const transformer = new TransformStream({
      transform: (chunk, controller) => {
        const text = new TextDecoder().decode(chunk);
        buffer += text;
        
        // Process complete lines only
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            
            try {
              const data = JSON.parse(jsonStr) as {
                candidates?: { content: { parts: { text: string }[] } }[];
              };
              const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              
              if (content) {
                const openaiChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{
                    index: 0,
                    delta: { content },
                    finish_reason: null,
                  }],
                };
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              }
            } catch {
              // Skip malformed data - could be partial JSON
            }
          }
        }
      },
      flush: (controller) => {
        // Process any remaining buffer content
        if (buffer.trim() && buffer.startsWith('data: ')) {
          const jsonStr = buffer.slice(6).trim();
          try {
            const data = JSON.parse(jsonStr) as {
              candidates?: { content: { parts: { text: string }[] } }[];
            };
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (content) {
              const openaiChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: { content },
                  finish_reason: null,
                }],
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
            }
          } catch {
            // Ignore
          }
        }
        // Send [DONE] signal
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      },
    });

    return streamResponse(response.body.pipeThrough(transformer), corsHeaders);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Vertex AI streaming failed';
    return errorResponse(`Vertex AI streaming error: ${msg}`, 500, corsHeaders);
  }
}

/** Call Gemini API with streaming (SSE format) */
async function callGeminiAPIStreaming(
  model: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  apiKey: string,
  corsHeaders: HeadersInit
): Promise<Response> {
  const geminiMessages = toGeminiMessages(messages);
  const systemMsg = messages.find(m => m.role === 'system');
  
  const body: Record<string, unknown> = { contents: geminiMessages };
  if (systemMsg) {
    body.systemInstruction = { 
      parts: [{ text: typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content) }] 
    };
  }

  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return errorResponse(`Gemini API streaming error: ${errorText}`, response.status, corsHeaders);
  }

  if (!response.body) {
    return errorResponse('No response body for streaming', 500, corsHeaders);
  }

  // Transform Gemini SSE to OpenAI SSE format with buffer for cross-packet handling
  let buffer = '';
  const transformer = new TransformStream({
    transform: (chunk, controller) => {
      const text = new TextDecoder().decode(chunk);
      buffer += text;
      
      // Process complete lines only
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          
          try {
            const data = JSON.parse(jsonStr) as {
              candidates?: { content: { parts: { text: string }[] } }[];
            };
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            
            if (content) {
              const openaiChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: { content },
                  finish_reason: null,
                }],
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
            }
          } catch {
            // Skip malformed data - could be partial JSON
          }
        }
      }
    },
    flush: (controller) => {
      // Process any remaining buffer content
      if (buffer.trim() && buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6).trim();
        try {
          const data = JSON.parse(jsonStr) as {
            candidates?: { content: { parts: { text: string }[] } }[];
          };
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (content) {
            const openaiChunk = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: { content },
                finish_reason: null,
              }],
            };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
          }
        } catch {
          // Ignore
        }
      }
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    },
  });

  return streamResponse(response.body.pipeThrough(transformer), corsHeaders);
}

/** Call Anthropic on Vertex AI (Claude models via GCP) */
async function callVertexAnthropic(
  model: string,
  messages: Array<{ role: string; content: string | unknown[] }>,
  projectId: string,
  region: string,
  serviceAccountJson: string,
  corsHeaders: HeadersInit,
  maxTokens?: number
): Promise<Response> {
  try {
    // Get OAuth2 access token
    const accessToken = await getGoogleAccessToken(serviceAccountJson);
    
    // Extract system message if present
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');
    
    // Convert to Anthropic Messages format
    const anthropicMessages = chatMessages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));
    
    // Build request body (Anthropic Messages API format)
    const body: Record<string, unknown> = {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: maxTokens || 8192,
      messages: anthropicMessages,
    };
    
    if (systemMsg) {
      body.system = typeof systemMsg.content === 'string' 
        ? systemMsg.content 
        : JSON.stringify(systemMsg.content);
    }
    
    // Vertex AI Anthropic endpoint
    // For 'global' region: https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/anthropic/models/{MODEL}:rawPredict
    // For specific regions: https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/publishers/anthropic/models/{MODEL}:rawPredict
    const url = region === 'global'
      ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/anthropic/models/${model}:rawPredict`
      : `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return errorResponse(`Vertex Anthropic error: ${errorText}`, response.status, corsHeaders);
    }

    const anthropicResponse = await response.json() as {
      content?: { type: string; text: string }[];
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };

    // Convert to OpenAI format
    const content = anthropicResponse.content?.[0]?.text || '';
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' : 'stop',
      }],
      usage: anthropicResponse.usage ? {
        prompt_tokens: anthropicResponse.usage.input_tokens,
        completion_tokens: anthropicResponse.usage.output_tokens,
        total_tokens: (anthropicResponse.usage.input_tokens || 0) + (anthropicResponse.usage.output_tokens || 0),
      } : undefined,
    };

    return jsonResponse(openaiResponse, corsHeaders);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Vertex Anthropic call failed';
    return errorResponse(`Vertex Anthropic error: ${msg}`, 500, corsHeaders);
  }
}

/**
 * Create provider config for a specific provider type (used for prefix routing)
 */
function createProviderConfigForType(providerType: string, env: Env): AnyProviderConfig | null {
  switch (providerType) {
    case 'vertex':
      if (!env.GCP_PROJECT_ID && !env.GEMINI_API_KEY) return null;
      return {
        type: 'vertex',
        projectId: env.GCP_PROJECT_ID || '',
        region: env.GCP_REGION || 'us-central1',
        serviceAccountJson: env.GCP_SERVICE_ACCOUNT_JSON,
        geminiApiKey: env.GEMINI_API_KEY,
        defaultModel: env.VERTEX_DEFAULT_MODEL || 'gemini-2.0-flash',
      };
    case 'azure-foundry':
      if (!env.AZURE_FOUNDRY_ENDPOINT || !env.AZURE_FOUNDRY_API_KEY) return null;
      return {
        type: 'azure-foundry',
        endpoint: env.AZURE_FOUNDRY_ENDPOINT,
        apiKey: env.AZURE_FOUNDRY_API_KEY,
        model: env.AZURE_FOUNDRY_MODEL || 'gpt-4o',
      };
    case 'openai':
      if (!env.OPENAI_API_KEY) return null;
      return {
        type: 'openai',
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        organization: env.OPENAI_ORGANIZATION,
      };
    case 'cloudflare':
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
      return {
        type: 'cloudflare',
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_API_TOKEN,
        model: env.CF_MODEL,
      };
    default:
      return null;
  }
}

/**
 * Handle chat completion request
 */
async function handleChat(
  request: Request,
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  const t0 = Date.now();
  const { client, env: reqEnv } = getClientEnv(request);
  const endpoint = getEndpoint(new URL(request.url).pathname);
  const requireClientId = (env.REQUIRE_CLIENT_ID || '').toLowerCase() === 'true';
  if (requireClientId && client === 'unknown') {
    return errorResponse('Missing x-client-id', 400, corsHeaders);
  }
  // Validate provider configuration
  if (!env.AI_PROVIDER) {
    return errorResponse('AI_PROVIDER environment variable is required', 500, corsHeaders);
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, corsHeaders);
  }

  const requestedModel = safeParseChatRequestModel(body);

  if (!validateChatRequest(body)) {
    return errorResponse('Invalid request: messages array is required', 400, corsHeaders);
  }

  // Check for model prefix routing (e.g., "gemini/gemini-2.0-flash" or "azure/gpt-4o")
  const chatBody = body as ChatCompletionRequest;
  const { provider: prefixProvider, model: actualModel } = parseModelPrefix(chatBody.model);
  
  // Handle Gemini/Vertex direct calls
  if (prefixProvider === 'gemini-direct') {
    const isStreaming = chatBody.stream === true;
    
    // Prefer Vertex AI (uses GCP credits) with API Key or Service Account
    if (env.GCP_PROJECT_ID && (env.VERTEX_API_KEY || env.GCP_SERVICE_ACCOUNT_JSON)) {
      if (isStreaming) {
        return callVertexAIStreaming(
          actualModel, 
          chatBody.messages, 
          env.GCP_PROJECT_ID, 
          env.GCP_REGION || 'us-central1',
          env.GCP_SERVICE_ACCOUNT_JSON || '', 
          corsHeaders,
          env.VERTEX_API_KEY
        );
      }
      return callVertexAI(
        actualModel, 
        chatBody.messages, 
        env.GCP_PROJECT_ID, 
        env.GCP_REGION || 'us-central1',
        env.GCP_SERVICE_ACCOUNT_JSON || '', 
        corsHeaders,
        env.VERTEX_API_KEY
      );
    }
    // Fallback to Gemini API
    if (env.GEMINI_API_KEY) {
      if (isStreaming) {
        return callGeminiAPIStreaming(actualModel, chatBody.messages, env.GEMINI_API_KEY, corsHeaders);
      }
      return callGeminiAPI(actualModel, chatBody.messages, env.GEMINI_API_KEY, corsHeaders);
    }
    return errorResponse('GCP_PROJECT_ID + (VERTEX_API_KEY or GCP_SERVICE_ACCOUNT_JSON) required for gemini/ prefix', 400, corsHeaders);
  }
  
  // Handle Anthropic on Vertex AI (Claude models via GCP)
  if (prefixProvider === 'vertex-anthropic') {
    if (!env.GCP_PROJECT_ID || !env.GCP_SERVICE_ACCOUNT_JSON) {
      return errorResponse('GCP_PROJECT_ID + GCP_SERVICE_ACCOUNT_JSON required for vertex-claude/ or anthropic/ prefix', 400, corsHeaders);
    }
    // Anthropic on Vertex - use 'global' region as per user's working code
    return callVertexAnthropic(
      actualModel,
      chatBody.messages,
      env.GCP_PROJECT_ID,
      'global', // User's working code uses region="global"
      env.GCP_SERVICE_ACCOUNT_JSON,
      corsHeaders,
      chatBody.max_tokens
    );
  }
  
  let config: AnyProviderConfig;
  
  try {
    if (prefixProvider) {
      // Use prefix-specified provider
      const prefixConfig = createProviderConfigForType(prefixProvider, env);
      if (!prefixConfig) {
        return errorResponse(`Provider '${prefixProvider}' is not configured`, 400, corsHeaders);
      }
      config = prefixConfig;
      // Update model in request to use actual model name (without prefix)
      chatBody.model = actualModel;
    } else {
      // Use default provider
      config = createProviderConfig(env);
    }
  } catch (configError) {
    const msg = configError instanceof Error ? configError.message : 'Config error';
    return errorResponse(`Provider config error: ${msg}`, 500, corsHeaders);
  }
  
  let provider;
  try {
    provider = createProvider(config);
  } catch (providerError) {
    const msg = providerError instanceof Error ? providerError.message : 'Provider creation error';
    return errorResponse(`Provider creation error: ${msg}`, 500, corsHeaders);
  }

  // Handle streaming if requested and supported
  // NOTE: streaming token usage is not available reliably; we still record request + latency.
  if (chatBody.stream && provider.supportsStreaming && provider.chatStream) {
    const stream = await provider.chatStream(chatBody);
    const latency_ms = Date.now() - t0;
    const finalModel = chatBody.model || config.type; // best-effort
    const model_source = inferModelSource(requestedModel, finalModel, false);
    writeUsageEvent(env, {
      client,
      env: reqEnv,
      endpoint,
      model: finalModel,
      model_source,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms,
      status: 200,
      ts: Date.now(),
    });
    return streamResponse(stream, corsHeaders);
  }

  // Non-streaming response
  try {
    const response = await provider.chat(chatBody);
    const latency_ms = Date.now() - t0;
    const { tokens_in, tokens_out } = safeExtractChatUsage(response);
    const finalModel = response?.model || chatBody.model || config.type;
    const model_source = inferModelSource(requestedModel, finalModel, false);

    writeUsageEvent(env, {
      client,
      env: reqEnv,
      endpoint,
      model: finalModel,
      model_source,
      tokens_in,
      tokens_out,
      latency_ms,
      status: 200,
      ts: Date.now(),
    });

    return jsonResponse(response, corsHeaders);
  } catch (err) {
    const latency_ms = Date.now() - t0;
    const finalModel = chatBody.model || config.type;
    const model_source = inferModelSource(requestedModel, finalModel, false);

    writeUsageEvent(env, {
      client,
      env: reqEnv,
      endpoint,
      model: finalModel,
      model_source,
      tokens_in: 0,
      tokens_out: 0,
      latency_ms,
      status: 500,
      ts: Date.now(),
    });

    throw err;
  }
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Check if request is authenticated
 */
function isAuthenticated(request: Request, url: URL, env: Env): boolean {
  // No API key configured = allow all
  if (!env.CLIENT_API_KEY) return true;

  // Service Bindings bypass authentication
  const cfWorker = request.headers.get('cf-worker');
  const isInternal = url.hostname === 'internal';
  if (cfWorker || isInternal) return true;

  // Check Authorization header
  const authHeader = request.headers.get('Authorization');
  return authHeader === `Bearer ${env.CLIENT_API_KEY}`;
}

// ============================================================================
// Main Handler
// ============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGINS);
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Admin endpoints
    if (request.method === 'GET' && url.pathname === '/admin/models') {
      // Reuse CLIENT_API_KEY as admin auth
      if (env.CLIENT_API_KEY) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.CLIENT_API_KEY}`) {
          return errorResponse('Unauthorized', 401, corsHeaders);
        }
      }

      // If AE not bound, return empty
      if (!env.AE) {
        return jsonResponse({ ok: true, data: [], note: 'AE binding not configured' }, corsHeaders);
      }

      // Optional filters
      const qClient = url.searchParams.get('client');
      const qEnv = url.searchParams.get('env');
      const qModel = url.searchParams.get('model');
      const sinceMs = Number(url.searchParams.get('since_ms') || '') || (Date.now() - 24 * 3600 * 1000);

      const where: string[] = [`timestamp >= toDateTime(${sinceMs} / 1000)`];
      if (qClient) where.push(`blob1 = '${qClient.replace(/'/g, "''")}'`);
      if (qEnv) where.push(`blob2 = '${qEnv.replace(/'/g, "''")}'`);
      if (qModel) where.push(`blob4 = '${qModel.replace(/'/g, "''")}'`);

      // blobs: 1 client, 2 env, 3 endpoint, 4 model, 5 model_source
      // doubles: 1 tokens_in, 2 tokens_out, 3 latency_ms, 4 status, 5 ts
      const query = `
        SELECT
          blob1 AS client,
          blob2 AS env,
          blob4 AS model,
          SUM(_sample_interval) AS requests,
          SUM(_sample_interval * double1) AS tokens_in,
          SUM(_sample_interval * double2) AS tokens_out,
          SUM(_sample_interval * (double1 + double2)) AS tokens_total,
          SUM(_sample_interval * double4) AS status_sum,
          AVG(double3) AS latency_avg,
          SUM(_sample_interval) AS override_requests,
          SUM(_sample_interval) AS fallback_requests
        FROM edge_ai_gateway_usage
        WHERE ${where.join(' AND ')}
        GROUP BY client, env, model
        ORDER BY tokens_total DESC
        LIMIT 200
      `;

      // Query AE via SQL API (Worker runtime bindings don't support querying)
      if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
        return errorResponse('Missing CF_ACCOUNT_ID/CF_API_TOKEN for AE query', 500, corsHeaders);
      }

      const api = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
      const qRes = await fetch(api, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
        },
        body: query,
      });

      if (!qRes.ok) {
        const t = await qRes.text();
        return errorResponse(`AE query failed: ${t}`, 500, corsHeaders);
      }

      const res = await qRes.json() as { data?: unknown };
      return jsonResponse({ ok: true, since_ms: sinceMs, data: res.data || [] }, corsHeaders);
    }

    // Only accept POST requests (non-admin)
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405, corsHeaders);
    }

    // Check authentication
    if (!isAuthenticated(request, url, env)) {
      return errorResponse('Unauthorized', 401, corsHeaders);
    }

    try {
      // Route based on path
      const path = url.pathname;
      
      if (path === '/v1/audio/speech' || path.endsWith('/audio/speech')) {
        return handleTTS(request, env, corsHeaders);
      }

      if (path === '/v1/embeddings' || path.endsWith('/embeddings')) {
        return handleEmbeddings(request, env, corsHeaders);
      }

      // Default: chat completion
      return handleChat(request, env, corsHeaders);
      
    } catch (error) {
      console.error('Worker error:', error);

      // Handle AIGatewayError with proper status
      if (error instanceof AIGatewayError) {
        return errorResponse(error.message, error.status, corsHeaders);
      }

      // Generic error handling
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('Unauthorized') ? 401
        : message.includes('not found') ? 404
        : 500;

      return errorResponse(message, status, corsHeaders);
    }
  },
};
