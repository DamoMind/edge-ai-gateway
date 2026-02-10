/**
 * Azure AI Foundry Provider
 * 
 * @description Provider for Azure AI Foundry (Model Catalog)
 * Supports both OpenAI-compatible and Anthropic Claude models
 * @see https://ai.azure.com/
 */

import { BaseProvider } from './base';
import type { AzureFoundryConfig, ChatCompletionRequest, ChatCompletionResponse, FinishReason } from '../types';
import { AIGatewayErrorCode } from '../types';

/** Anthropic message format */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string }>;
}

/** Anthropic API response */
interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AzureFoundryProvider extends BaseProvider {
  readonly name = 'azure-foundry';
  readonly supportsStreaming = true;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(config: AzureFoundryConfig) {
    super(config);

    if (!config.endpoint) {
      throw this.createError('Azure Foundry endpoint is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }
    if (!config.apiKey) {
      throw this.createError('Azure Foundry API key is required', 400, null, AIGatewayErrorCode.CONFIG_ERROR);
    }

    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || 'gpt-4o';
  }

  /**
   * Check if model is a Claude model
   */
  private isClaudeModel(model: string): boolean {
    return model.toLowerCase().startsWith('claude');
  }

  /**
   * Models that require max_completion_tokens instead of max_tokens
   */
  private usesMaxCompletionTokens(model: string): boolean {
    const m = model.toLowerCase();
    return m.startsWith('gpt-5') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4');
  }

  /**
   * Convert OpenAI messages to Anthropic format
   */
  private convertToAnthropicMessages(messages: ChatCompletionRequest['messages']): AnthropicMessage[] {
    return messages
      .filter(m => m.role !== 'system' && m.role !== 'tool')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
  }

  /**
   * Extract system prompt from messages
   */
  private getSystemPrompt(messages: ChatCompletionRequest['messages']): string | undefined {
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
      return typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content);
    }
    return undefined;
  }

  /**
   * Map Anthropic stop_reason to OpenAI finish_reason
   */
  private mapAnthropicStopReason(stopReason: string): FinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      default:
        return 'stop';
    }
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  private convertAnthropicToOpenAI(response: AnthropicResponse): ChatCompletionResponse {
    return {
      id: response.id,
      object: 'chat.completion',
      created: this.getTimestamp(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content.map(c => c.text).join(''),
          },
          finish_reason: this.mapAnthropicStopReason(response.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  /**
   * Build request body for OpenAI-compatible models
   */
  private buildOpenAIBody(request: ChatCompletionRequest, model: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream,
    };

    // Handle max_tokens vs max_completion_tokens
    if (request.max_tokens !== undefined) {
      if (this.usesMaxCompletionTokens(model)) {
        body.max_completion_tokens = request.max_tokens;
      } else {
        body.max_tokens = request.max_tokens;
      }
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;

    return body;
  }

  /**
   * Build request body for Anthropic Claude models
   */
  private buildClaudeBody(request: ChatCompletionRequest, model: string, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: this.convertToAnthropicMessages(request.messages),
      max_tokens: request.max_tokens || 4096,
      stream,
    };

    const systemPrompt = this.getSystemPrompt(request.messages);
    if (systemPrompt) body.system = systemPrompt;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.top_p !== undefined) body.top_p = request.top_p;

    return body;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model || this.defaultModel;

    // Route Claude models to Anthropic endpoint
    if (this.isClaudeModel(model)) {
      return this.chatClaude(request, model);
    }

    // OpenAI-compatible models
    const url = `${this.endpoint}/models/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildOpenAIBody(request, model, false)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry error: ${errorText}`, response.status, errorText);
    }

    return await response.json() as ChatCompletionResponse;
  }

  private async chatClaude(request: ChatCompletionRequest, model: string): Promise<ChatCompletionResponse> {
    const url = `${this.endpoint}/anthropic/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildClaudeBody(request, model, false)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry (Claude) error: ${errorText}`, response.status, errorText);
    }

    const anthropicResponse = await response.json() as AnthropicResponse;
    return this.convertAnthropicToOpenAI(anthropicResponse);
  }

  /**
   * Stream chat completions
   */
  async chatStream(request: ChatCompletionRequest): Promise<ReadableStream> {
    const model = request.model || this.defaultModel;

    // Route Claude models to Anthropic endpoint with streaming
    if (this.isClaudeModel(model)) {
      return this.chatStreamClaude(request, model);
    }

    const url = `${this.endpoint}/models/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildOpenAIBody(request, model, true)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body for streaming', 500, null, AIGatewayErrorCode.PROVIDER_ERROR);
    }

    return response.body;
  }

  private async chatStreamClaude(request: ChatCompletionRequest, model: string): Promise<ReadableStream> {
    const url = `${this.endpoint}/anthropic/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildClaudeBody(request, model, true)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw this.createError(`Azure AI Foundry (Claude) error: ${errorText}`, response.status, errorText);
    }

    if (!response.body) {
      throw this.createError('No response body for streaming', 500, null, AIGatewayErrorCode.PROVIDER_ERROR);
    }

    // Transform Anthropic SSE to OpenAI SSE format
    return this.transformAnthropicStream(response.body, model);
  }

  /**
   * Transform Anthropic SSE stream to OpenAI SSE format
   */
  private transformAnthropicStream(anthropicStream: ReadableStream, model: string): ReadableStream {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const self = this;
    let buffer = '';

    return new ReadableStream({
      async start(controller) {
        const reader = anthropicStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const event = JSON.parse(data);
                  const timestamp = self.getTimestamp();

                  // Handle content_block_delta events
                  if (event.type === 'content_block_delta' && event.delta?.text) {
                    const chunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: timestamp,
                      model,
                      choices: [{
                        index: 0,
                        delta: { content: event.delta.text },
                        finish_reason: null,
                      }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }

                  // Handle message_stop event
                  if (event.type === 'message_stop') {
                    const chunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: 'chat.completion.chunk',
                      created: timestamp,
                      model,
                      choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'stop',
                      }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }
}
