/**
 * Base Provider Interface
 * 
 * @description Abstract base class for AI providers.
 * All providers must implement the AIProvider interface.
 */

import type { ChatCompletionRequest, ChatCompletionResponse, AnyProviderConfig, ProviderType } from '../types';
import { AIGatewayError, AIGatewayErrorCode } from '../types';

/**
 * Common interface for all AI providers
 */
export interface AIProvider {
  /** Provider name identifier */
  readonly name: string;
  
  /**
   * Send a chat completion request
   * @param request - Chat completion request parameters
   * @returns Chat completion response
   * @throws {AIGatewayError} On provider errors
   */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  
  /**
   * Send a streaming chat completion request
   * @param request - Chat completion request parameters
   * @returns ReadableStream of SSE events
   * @throws {AIGatewayError} On provider errors or if streaming not supported
   */
  chatStream?(request: ChatCompletionRequest): Promise<ReadableStream>;
  
  /**
   * Check if this provider supports streaming
   */
  readonly supportsStreaming: boolean;
}

/**
 * Abstract base class for AI providers
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string;
  abstract readonly supportsStreaming: boolean;
  protected readonly config: AnyProviderConfig;

  constructor(config: AnyProviderConfig) {
    this.config = config;
  }

  abstract chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Create a standardized error with provider context
   */
  protected createError(
    message: string,
    status?: number,
    raw?: unknown,
    code?: AIGatewayErrorCode
  ): AIGatewayError {
    // Determine error code from status if not provided
    const errorCode = code ?? this.statusToErrorCode(status);
    
    return new AIGatewayError(message, {
      status,
      code: errorCode,
      provider: this.name as ProviderType,
      raw,
    });
  }

  /**
   * Map HTTP status to error code
   */
  private statusToErrorCode(status?: number): AIGatewayErrorCode {
    if (!status) return AIGatewayErrorCode.UNKNOWN_ERROR;
    
    if (status === 401 || status === 403) return AIGatewayErrorCode.AUTHENTICATION_ERROR;
    if (status === 429) return AIGatewayErrorCode.RATE_LIMIT_ERROR;
    if (status === 400) return AIGatewayErrorCode.INVALID_REQUEST;
    if (status >= 500) return AIGatewayErrorCode.PROVIDER_ERROR;
    
    return AIGatewayErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Generate a unique chat completion ID
   */
  protected generateId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get current timestamp in seconds
   */
  protected getTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }
}
