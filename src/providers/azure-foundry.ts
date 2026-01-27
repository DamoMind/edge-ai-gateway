/**
 * Azure AI Foundry Provider
 * Supports the new Azure AI Foundry endpoint format with streaming
 */

import { BaseProvider } from './base';
import type { AzureFoundryConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';

export class AzureFoundryProvider extends BaseProvider {
  readonly name = 'azure-foundry';
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor(config: AzureFoundryConfig) {
    super(config);
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o';
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.endpoint}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry error: ${errorText}`, response.status, errorText);
    }

    const data = await response.json() as ChatCompletionResponse;
    return data;
  }

  /**
   * Stream chat completions
   */
  async chatStream(request: ChatCompletionRequest): Promise<ReadableStream> {
    const url = `${this.endpoint}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body', 500, null);
    }

    return response.body;
  }
}
