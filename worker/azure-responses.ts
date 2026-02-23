/**
 * Worker-local Azure Responses proxy
 *
 * Implements POST /v1/responses (OpenAI Responses-like) by forwarding to
 * Azure Cognitive Services Responses endpoint:
 *   POST {AZURE_ENDPOINT}/openai/responses?api-version=...
 */

export interface EnvForAzureResponses {
  /** Base Azure endpoint (e.g. https://...services.ai.azure.com) */
  AZURE_ENDPOINT?: string;
  /** Optional: full responses URL (overrides AZURE_ENDPOINT when set) */
  AZURE_RESPONSES_ENDPOINT?: string;
  AZURE_API_KEY?: string;
  AZURE_API_VERSION?: string;
}

export type ResponsesRequestBody = {
  model: string;
  /** Azure Responses expects `input`, but some clients may send `messages` (chat-style). */
  input?: unknown;
  /** OpenAI Chat-style messages; we will convert to `input` when present. */
  messages?: Array<{ role: string; content: any }>;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  /** Allow extra fields without type errors. */
  [key: string]: any;
};

export type StandardResponsesResponse = {
  id: string;
  object: 'response';
  created: number;
  model: string;
  output_text: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  raw?: unknown;
};

function extractOutputText(resp: any): string {
  if (resp && typeof resp.output_text === 'string') return resp.output_text;
  const texts: string[] = [];
  for (const item of resp?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === 'string') texts.push(c.text);
    }
  }
  return texts.join('');
}

function coerceMessagesToInput(messages: any): unknown {
  // Azure Responses accepts `input` as string or structured content.
  // Safest conversion: join user/assistant/tool content into a plain text transcript.
  if (!Array.isArray(messages)) return undefined;
  const parts: string[] = [];
  for (const m of messages) {
    const role = typeof m?.role === 'string' ? m.role : 'unknown';
    const c = m?.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      // content parts (e.g. [{type:'text', text:'...'}])
      text = c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('');
    } else if (c && typeof c === 'object' && typeof c.text === 'string') {
      text = c.text;
    } else {
      try { text = JSON.stringify(c); } catch { text = String(c); }
    }
    parts.push(`${role}: ${text}`);
  }
  return parts.join('\n');
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function handleAzureResponsesRoute(
  request: Request,
  env: EnvForAzureResponses,
  corsHeaders: HeadersInit
): Promise<Response> {
  let body: ResponsesRequestBody;
  try {
    body = await request.json() as ResponsesRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Lightweight request logging (avoid dumping full contents).
  // eslint-disable-next-line no-console
  console.log('[azure-responses] incoming', {
    hasInput: body?.input !== undefined,
    hasMessages: Array.isArray((body as any)?.messages),
    model: body?.model,
    keys: body && typeof body === 'object' ? Object.keys(body).slice(0, 20) : [],
  });

  if (!body?.model) {
    return new Response(JSON.stringify({ error: 'model is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!env.AZURE_API_KEY) {
    return new Response(JSON.stringify({ error: 'AZURE_API_KEY is required' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Prefer explicit responses endpoint when provided.
  // This enables routing to Azure Foundry-style Responses endpoint:
  //   https://...services.ai.azure.com/openai/responses
  const apiVersion = env.AZURE_API_VERSION || '2025-03-01-preview';
  const base = (env.AZURE_RESPONSES_ENDPOINT || env.AZURE_ENDPOINT || '').replace(/\/$/, '');
  if (!base) {
    return new Response(JSON.stringify({ error: 'AZURE_ENDPOINT (or AZURE_RESPONSES_ENDPOINT) is required' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = base.includes('/openai/responses')
    ? `${base}${base.includes('?') ? '&' : '?'}api-version=${apiVersion}`
    : `${base}/openai/responses?api-version=${apiVersion}`;

  // Normalize OpenClaw/client payload:
  // - Azure requires `input`. If client sends `messages`, convert -> `input`.
  const normalized: any = { ...body };
  if (normalized.input === undefined && Array.isArray(normalized.messages)) {
    normalized.input = coerceMessagesToInput(normalized.messages);
  }
  delete normalized.messages;

  if (normalized.input === undefined) {
    return new Response(JSON.stringify({ error: 'input (or messages) is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Strip provider prefix from model name (e.g., "azure/gpt-5.2-codex" -> "gpt-5.2-codex")
  const cleanModel = normalized.model.replace(/^(azure|gateway|openai)\//, '');
  
  // 参数转换：OpenAI → Azure Responses API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const azureBody: any = { ...normalized, model: cleanModel };
  
  // max_tokens → max_output_tokens
  if (azureBody.max_tokens && !azureBody.max_output_tokens) {
    azureBody.max_output_tokens = azureBody.max_tokens;
    delete azureBody.max_tokens;
  }
  
  // 移除 Azure Responses API 不支持的参数
  const unsupportedParams = ['stream', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'user', 'n'];
  for (const p of unsupportedParams) {
    if (p in azureBody) delete azureBody[p];
  }

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.AZURE_API_KEY,
    },
    body: JSON.stringify(azureBody),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    // eslint-disable-next-line no-console
    console.log('[azure-responses] upstream error', { status: upstream.status, bodySnippet: text.slice(0, 500) });
    return new Response(JSON.stringify({ error: `Azure Responses API error: ${text}` }), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const raw = safeJsonParse(text);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Azure Responses API returned non-JSON', body: text.slice(0, 1000) }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const out: StandardResponsesResponse = {
    id: raw.id || `resp_${Date.now()}`,
    object: 'response',
    created: typeof raw.created === 'number' ? raw.created : (typeof raw.created_at === 'number' ? raw.created_at : Math.floor(Date.now() / 1000)),
    model: raw.model || body.model,
    output_text: extractOutputText(raw),
    usage: raw.usage,
    raw,
  };

  return new Response(JSON.stringify(out), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
