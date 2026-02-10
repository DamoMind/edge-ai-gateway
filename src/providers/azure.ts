/**
 * Azure OpenAI Provider
 * 
 * @description Provider for Azure OpenAI Service (deployed models)
 * @see https://learn.microsoft.com/en-us/azure/ai-services/openai/
 */

import { BaseProvider } from './base';
import type { AzureConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types';
import { AIGatewayErrorCode } from '../types';

export class AzureProvider extends BaseProvider {
  readonly name = 'azure';
  readonly supportsStreaming = true;
  
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly deployment: string;
  private readonly apiVersion: string;

  constructor(config: AzureConfig) {
    super(config);
    
    if (!config.endpoint) {
      throw this.createError('Azure endpoint is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    if (!config.apiKey) {
      throw this.createError('Azure API key is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    if (!config.deployment) {
      throw this.createError('Azure deployment is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.deployment = config.deployment;
    this.apiVersion = config.apiVersion || '2024-02-15-preview';
  }

  /**
   * Build the API URL for chat completions
   */
  private buildUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  /**
   * Build request body, filtering out undefined values
   */
  private buildRequestBody(request: ChatCompletionRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      messages: request.messages,
      stream,
    };
    
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
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
        'api-key': this.apiKey,
      },
      body: this.buildRequestBody(request, false),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure OpenAI error: ${errorText}`, response.status, errorText);
    }

    return await response.json() as ChatCompletionResponse;
  }

  /**
   * Stream chat completions
   */
  async chatStream(request: ChatCompletionRequest): Promise<ReadableStream> {
    const url = this.buildUrl();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: this.buildRequestBody(request, true),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure OpenAI error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body for streaming', 500, null, AIGatewayErrorCode.PROVIDER_ERROR);
    }

    return response.body;
  }
}
