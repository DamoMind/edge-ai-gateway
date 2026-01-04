/**
 * OpenAI Provider
 */

import { BaseProvider } from './base';
import type { OpenAIConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private organization?: string;

  constructor(config: OpenAIConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.organization = config.organization;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: request.model || 'gpt-4o',
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`OpenAI error: ${errorText}`, response.status, errorText);
    }

    const data = await response.json() as ChatCompletionResponse;
    return data;
  }
}
