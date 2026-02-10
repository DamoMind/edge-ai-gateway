/**
 * Google Vertex AI Provider
 * 
 * @description Provider for Google Vertex AI and Gemini models
 * Supports both Vertex AI (with Service Account) and Gemini API (with API Key)
 */

import { BaseProvider } from './base';
import type { ChatCompletionRequest, ChatCompletionResponse, Message } from '../types';
import { AIGatewayErrorCode } from '../types';

export interface VertexConfig {
  type: 'vertex';
  /** GCP Project ID */
  projectId: string;
  /** GCP Region (default: us-central1) */
  region?: string;
  /** Service Account JSON (stringified) for Vertex AI */
  serviceAccountJson?: string;
  /** Gemini API Key (fallback) */
  geminiApiKey?: string;
  /** Default model */
  defaultModel?: string;
}

interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates?: {
    content: {
      role: string;
      parts: { text: string }[];
    };
    finishReason: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class VertexProvider extends BaseProvider {
  readonly name = 'vertex';
  readonly supportsStreaming = true;

  private readonly projectId: string;
  private readonly region: string;
  private readonly serviceAccountJson?: string;
  private readonly geminiApiKey?: string;
  private readonly defaultModel: string;
  
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(config: VertexConfig) {
    super(config);
    
    if (!config.projectId && !config.geminiApiKey) {
      throw this.createError('Vertex AI requires projectId or geminiApiKey', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    
    this.projectId = config.projectId;
    this.region = config.region || 'us-central1';
    this.serviceAccountJson = config.serviceAccountJson;
    this.geminiApiKey = config.geminiApiKey;
    this.defaultModel = config.defaultModel || 'gemini-2.0-flash';
  }

  /**
   * Convert OpenAI-style messages to Gemini format
   */
  private convertMessages(messages: Message[]): GeminiMessage[] {
    return messages
      .filter(m => m.role !== 'system') // Handle system separately
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
      }));
  }

  /**
   * Extract system instruction from messages
   */
  private getSystemInstruction(messages: Message[]): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system');
    return systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content)) : undefined;
  }

  /**
   * Generate JWT from Service Account credentials
   */
  private async generateJWT(): Promise<string> {
    if (!this.serviceAccountJson) {
      throw this.createError('Service Account JSON required for Vertex AI', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }

    const sa = JSON.parse(this.serviceAccountJson);
    const now = Math.floor(Date.now() / 1000);
    
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/cloud-platform'
    };

    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signInput = `${headerB64}.${payloadB64}`;

    // Import private key
    const pemContents = sa.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(signInput)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    return `${signInput}.${signatureB64}`;
  }

  /**
   * Get access token (with caching)
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    const jwt = await this.generateJWT();
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!response.ok) {
      const error = await response.text();
      throw this.createError(`Token exchange failed: ${error}`, response.status, error);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
    
    return this.accessToken;
  }

  /**
   * Build Vertex AI endpoint URL
   */
  private buildVertexUrl(model: string, stream: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    return `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}:${action}`;
  }

  /**
   * Build Gemini API endpoint URL (fallback)
   */
  private buildGeminiUrl(model: string, stream: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${this.geminiApiKey}`;
  }

  /**
   * Build request body in Gemini format
   */
  private buildRequestBody(request: ChatCompletionRequest): string {
    const body: Record<string, unknown> = {
      contents: this.convertMessages(request.messages),
    };

    const systemInstruction = this.getSystemInstruction(request.messages);
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (request.max_tokens || request.temperature !== undefined || request.top_p !== undefined) {
      body.generationConfig = {};
      if (request.max_tokens) (body.generationConfig as Record<string, unknown>).maxOutputTokens = request.max_tokens;
      if (request.temperature !== undefined) (body.generationConfig as Record<string, unknown>).temperature = request.temperature;
      if (request.top_p !== undefined) (body.generationConfig as Record<string, unknown>).topP = request.top_p;
    }

    return JSON.stringify(body);
  }

  /**
   * Convert Gemini response to OpenAI format
   */
  private convertResponse(geminiResponse: GeminiResponse, model: string): ChatCompletionResponse {
    const content = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = geminiResponse.usageMetadata;

    return {
      id: this.generateId(),
      object: 'chat.completion',
      created: this.getTimestamp(),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      }],
      usage: usage ? {
        prompt_tokens: usage.promptTokenCount,
        completion_tokens: usage.candidatesTokenCount,
        total_tokens: usage.totalTokenCount,
      } : undefined,
    };
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.defaultModel;
    
    let url: string;
    let headers: Record<string, string>;

    // Currently only support Gemini API (JWT signing for Vertex AI needs debugging)
    // TODO: Fix JWT signing for Vertex AI Service Account authentication
    if (this.geminiApiKey) {
      url = this.buildGeminiUrl(model, false);
      headers = { 'Content-Type': 'application/json' };
    } else if (this.serviceAccountJson && this.projectId) {
      // Service Account JWT signing - temporarily disabled due to Workers compatibility issues
      throw this.createError(
        'Vertex AI with Service Account requires GEMINI_API_KEY as fallback (JWT signing disabled). ' +
        'Use Gemini API key or call Vertex AI directly from server.',
        501, null, AIGatewayErrorCode.CONFIG_ERROR
      );
    } else {
      throw this.createError('No valid credentials configured (need geminiApiKey)', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.buildRequestBody(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Gemini API error: ${errorText}`, response.status, errorText);
    }

    const geminiResponse = await response.json() as GeminiResponse;
    return this.convertResponse(geminiResponse, model);
  }

  /**
   * Stream chat completions
   */
  async chatStream(request: ChatCompletionRequest): Promise<ReadableStream> {
    const model = request.model || this.defaultModel;
    
    let url: string;
    let headers: Record<string, string>;

    if (this.serviceAccountJson && this.projectId) {
      const accessToken = await this.getAccessToken();
      url = this.buildVertexUrl(model, true) + '?alt=sse';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      };
    } else if (this.geminiApiKey) {
      url = this.buildGeminiUrl(model, true) + '&alt=sse';
      headers = { 'Content-Type': 'application/json' };
    } else {
      throw this.createError('No valid credentials configured', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.buildRequestBody(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Vertex/Gemini streaming error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body for streaming', 500, null, AIGatewayErrorCode.PROVIDER_ERROR);
    }

    // Transform Gemini SSE to OpenAI SSE format
    const transformer = new TransformStream({
      transform: (chunk, controller) => {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as GeminiResponse;
              const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
              
              if (content) {
                const openaiChunk = {
                  id: this.generateId(),
                  object: 'chat.completion.chunk',
                  created: this.getTimestamp(),
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
              // Skip malformed data
            }
          }
        }
      },
    });

    return response.body.pipeThrough(transformer);
  }
}
