/**
 * OpenAI Provider
 * 
 * @description Provider for OpenAI API and compatible endpoints
 * @see https://platform.openai.com/docs/api-reference
 */

import { BaseProvider } from './base';
import type { OpenAIConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';
import { AIGatewayErrorCode } from '../types';

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';
  readonly supportsStreaming = true;
  
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organization?: string;
  private readonly defaultModel: string;

  constructor(config: OpenAIConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw this.createError('OpenAI API key is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.organization = config.organization;
    this.defaultModel = 'gpt-4o';
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    return headers;
  }

  /**
   * Build request body
   */
  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: request.messages,
      stream,
    };

    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;

    return JSON.stringify(body);
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, false),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`OpenAI error: ${errorText}`, response.status, errorText);
    }

    return await response.json() as ChatCompletionResponse;
  }

  /**
   * Stream chat completions
   */
  async chatStream(request: ChatCompletionRequest): Promise<ReadableStream> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: this.buildRequestBody(request, true),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`OpenAI error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body for streaming', 500, null, AIGatewayErrorCode.PROVIDER_ERROR);
    }

    return response.body;
  }
}
