/**
 * Azure OpenAI Provider
 */

import { BaseProvider } from './base';
import type { AzureConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';

export class AzureProvider extends BaseProvider {
  readonly name = 'azure';
  private endpoint: string;
  private apiKey: string;
  private deployment: string;
  private apiVersion: string;

  constructor(config: AzureConfig) {
    super(config);
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.deployment = config.deployment;
    this.apiVersion = config.apiVersion || '2024-02-15-preview';
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure OpenAI error: ${errorText}`, response.status, errorText);
    }

    const data = await response.json() as ChatCompletionResponse;
    return data;
  }
}
