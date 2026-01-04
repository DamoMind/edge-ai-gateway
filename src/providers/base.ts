/**
 * Base Provider Interface
 */

import type { ChatCompletionRequest, ChatCompletionResponse, AnyProviderConfig } from '../types';

export interface AIProvider {
  readonly name: string;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string;
  protected config: AnyProviderConfig;

  constructor(config: AnyProviderConfig) {
    this.config = config;
  }

  abstract chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  protected createError(message: string, status?: number, raw?: unknown): Error {
    const error = new Error(message) as Error & { status?: number; provider?: string; raw?: unknown };
    error.status = status;
    error.provider = this.name;
    error.raw = raw;
    return error;
  }

  protected generateId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
