/**
 * Cloudflare Workers AI Provider
 */

import { BaseProvider } from './base';
import type { CloudflareConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';

interface CloudflareAIResponse {
  result: {
    response: string;
  };
  success: boolean;
  errors: Array<{ message: string }>;
}

export class CloudflareProvider extends BaseProvider {
  readonly name = 'cloudflare';
  private accountId: string;
  private apiToken: string;
  private model: string;

  constructor(config: CloudflareConfig) {
    super(config);
    this.accountId = config.accountId;
    this.apiToken = config.apiToken;
    this.model = config.model || '@cf/meta/llama-3.1-8b-instruct';
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.model;
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${model}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Cloudflare AI error: ${errorText}`, response.status, errorText);
    }

    const data = await response.json() as CloudflareAIResponse;

    if (!data.success) {
      throw this.createError(
        `Cloudflare AI error: ${data.errors.map(e => e.message).join(', ')}`,
        400,
        data
      );
    }

    // Convert Cloudflare response to OpenAI format
    return {
      id: this.generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: data.result.response,
          },
          finish_reason: 'stop',
        },
      ],
    };
  }
}
