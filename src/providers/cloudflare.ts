/**
 * Cloudflare Workers AI Provider
 * 
 * @description Provider for Cloudflare Workers AI
 * @see https://developers.cloudflare.com/workers-ai/
 */

import { BaseProvider } from './base';
import type { CloudflareConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';
import { AIGatewayErrorCode } from '../types';

/** Response format from Cloudflare AI API */
interface CloudflareAIResponse {
  result?: {
    response?: string;
  };
  success: boolean;
  errors: Array<{ message: string; code?: number }>;
  messages?: Array<{ message: string }>;
}

export class CloudflareProvider extends BaseProvider {
  readonly name = 'cloudflare';
  readonly supportsStreaming = false; // TODO: Add streaming support
  
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly defaultModel: string;

  constructor(config: CloudflareConfig) {
    super(config);
    
    if (!config.accountId) {
      throw this.createError('Cloudflare account ID is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    if (!config.apiToken) {
      throw this.createError('Cloudflare API token is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    
    this.accountId = config.accountId;
    this.apiToken = config.apiToken;
    this.defaultModel = config.model || '@cf/meta/llama-3.1-8b-instruct';
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.defaultModel;
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`;

    const body: Record<string, unknown> = {
      messages: request.messages,
    };
    
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Cloudflare AI error: ${errorText}`, response.status, errorText);
    }

    const data = await response.json() as CloudflareAIResponse;

    if (!data.success) {
      const errorMessages = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
      throw this.createError(
        `Cloudflare AI error: ${errorMessages}`,
        400,
        data,
        AIGatewayErrorCode.PROVIDER_ERROR
      );
    }

    // Validate response content exists
    const content = data.result?.response;
    if (content === undefined || content === null) {
      throw this.createError(
        'Cloudflare AI returned empty response',
        500,
        data,
        AIGatewayErrorCode.PROVIDER_ERROR
      );
    }

    // Convert Cloudflare response to OpenAI format
    return {
      id: this.generateId(),
      object: 'chat.completion',
      created: this.getTimestamp(),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
    };
  }
}
