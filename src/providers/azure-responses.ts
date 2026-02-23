/**
 * Azure OpenAI Responses API Provider
 *
 * @description Provider for Azure OpenAI Responses API (preview).
 * Used for models that require the Responses API (e.g. Codex).
 */

import { BaseProvider } from './base';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';
import { AIGatewayErrorCode } from '../types';

export interface AzureResponsesConfig {
  type: 'azure-responses';
  endpoint: string;
  apiKey: string;
  /** Azure API version for responses endpoint */
  apiVersion?: string;
}

// Minimal subset of Azure/OpenAI Responses API we care about
interface AzureResponsesRequest {
  model: string;
  input: string | Array<{ role: string; content: string }>; // keep simple
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
}

type AzureResponsesResponse = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

function buildResponsesUrl(endpoint: string, apiVersion: string): string {
  // Accept either a base endpoint (https://{resource}.azure.com) or a full responses URL.
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    // Fallback for endpoints missing protocol.
    url = new URL(`https://${endpoint}`);
  }

  const path = url.pathname.replace(/\/$/, '');
  if (!path.includes('/openai/responses')) {
    url.pathname = `${path}/openai/responses`;
  }

  if (!url.searchParams.has('api-version')) {
    url.searchParams.set('api-version', apiVersion);
  }

  return url.toString();
}

function messagesToInput(messages: Array<{ role: string; content: any }>): string {
  // Preserve system content as prefix; Responses API supports rich input but we keep it as a string.
  const parts: string[] = [];
  for (const m of messages) {
    const role = m.role || 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (role === 'system') {
      parts.push(`System: ${content}`);
    } else if (role === 'assistant') {
      parts.push(`Assistant: ${content}`);
    } else {
      parts.push(`User: ${content}`);
    }
  }
  return parts.join('\n');
}

function extractOutputText(resp: AzureResponsesResponse): string {
  if (typeof resp.output_text === 'string') return resp.output_text;

  // Try to extract from any output item with content[*].text
  const texts: string[] = [];
  for (const item of resp.output || []) {
    for (const c of item?.content || []) {
      if (!c) continue;
      if (typeof c.text === 'string') texts.push(c.text);
    }
  }
  if (texts.length) return texts.join('');

  return '';
}

export class AzureResponsesProvider extends BaseProvider {
  readonly name = 'azure-responses';
  readonly supportsStreaming = false;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;

  constructor(config: AzureResponsesConfig) {
    super(config as any);

    if (!config.endpoint) {
      throw this.createError('Azure endpoint is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    if (!config.apiKey) {
      throw this.createError('Azure API key is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }

    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.apiVersion = config.apiVersion || '2025-03-01-preview';
  }

  private buildUrl(): string {
    return buildResponsesUrl(this.endpoint, this.apiVersion);
  }

  private buildRequestBody(request: ChatCompletionRequest): string {
    const model = request.model;
    if (!model) {
      throw this.createError('model is required', 400, null, AIGatewayErrorCode.INVALID_REQUEST);
    }

    const body: AzureResponsesRequest = {
      model,
      input: messagesToInput(request.messages as any),
    };

    // Map max_tokens -> max_output_tokens
    if (request.max_tokens !== undefined) body.max_output_tokens = request.max_tokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;

    return JSON.stringify(body);
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = this.buildUrl();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Azure Cognitive Services supports either `api-key` or `Authorization: Bearer`
        'api-key': this.apiKey,
      },
      body: this.buildRequestBody(request),
    });

    const text = await response.text();
    if (!response.ok) {
      throw this.createError(`Azure Responses API error: ${text}`, response.status, text);
    }

    const data = JSON.parse(text) as AzureResponsesResponse;

    const content = extractOutputText(data);
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    const created = typeof data.created === 'number' ? data.created : (typeof (data as any).created_at === 'number' ? (data as any).created_at : Math.floor(Date.now() / 1000));
    const id = data.id || `resp_${Date.now()}`;
    const model = data.model || request.model || 'unknown';

    const out: ChatCompletionResponse = {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: content || '' },
          finish_reason: 'stop',
        },
      ],
      usage:
        typeof inputTokens === 'number' && typeof outputTokens === 'number'
          ? {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens:
                typeof data.usage?.total_tokens === 'number'
                  ? data.usage.total_tokens
                  : inputTokens + outputTokens,
            }
          : undefined,
    };

    return out;
  }
}
