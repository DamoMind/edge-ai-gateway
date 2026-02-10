/**
 * Edge AI Gateway - Core Types
 * 
 * @description Core type definitions for the Edge AI Gateway.
 * Supports OpenAI-compatible APIs across multiple providers.
 */

/** Supported AI provider types */
export type ProviderType = 'azure' | 'azure-foundry' | 'openai' | 'cloudflare' | 'vertex' | 'custom';

/** Supported message roles in chat completions */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Possible finish reasons for chat completions */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | null;

/**
 * A message in a chat completion request/response
 */
export interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  /** Tool call ID (for tool role messages) */
  tool_call_id?: string;
  /** Name of the function/tool */
  name?: string;
}

/**
 * Content part for multimodal messages
 */
export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * Request for chat completion
 */
export interface ChatCompletionRequest {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Response from chat completion
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: Usage;
}

/**
 * A choice in a chat completion response
 */
export interface ChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
  };
  finish_reason: FinishReason;
}

/**
 * Token usage statistics
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ProviderConfig {
  type: ProviderType;
}

export interface AzureConfig extends ProviderConfig {
  type: 'azure';
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
}

export interface AzureFoundryConfig extends ProviderConfig {
  type: 'azure-foundry';
  endpoint: string;
  apiKey: string;
  model?: string;
}

export interface OpenAIConfig extends ProviderConfig {
  type: 'openai';
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export interface CloudflareConfig extends ProviderConfig {
  type: 'cloudflare';
  accountId: string;
  apiToken: string;
  model?: string;
}

export interface CustomConfig extends ProviderConfig {
  type: 'custom';
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface VertexConfig extends ProviderConfig {
  type: 'vertex';
  /** GCP Project ID */
  projectId: string;
  /** GCP Region (default: us-central1) */
  region?: string;
  /** Service Account JSON (stringified) for Vertex AI */
  serviceAccountJson?: string;
  /** Gemini API Key (fallback) */
  geminiApiKey?: string;
  /** Default model */
  defaultModel?: string;
}

export type AnyProviderConfig = AzureConfig | AzureFoundryConfig | OpenAIConfig | CloudflareConfig | VertexConfig | CustomConfig;

/**
 * Error codes for AI Gateway errors
 */
export enum AIGatewayErrorCode {
  /** Invalid request parameters */
  INVALID_REQUEST = 'INVALID_REQUEST',
  /** Authentication failed */
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  /** Rate limit exceeded */
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  /** Provider API error */
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  /** Network or timeout error */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Configuration error */
  CONFIG_ERROR = 'CONFIG_ERROR',
  /** Unknown error */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Custom error class for AI Gateway errors
 */
export class AIGatewayError extends Error {
  /** HTTP status code */
  readonly status: number;
  /** Error code */
  readonly code: AIGatewayErrorCode;
  /** Provider that threw the error */
  readonly provider?: ProviderType;
  /** Raw error response from provider */
  readonly raw?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: AIGatewayErrorCode;
      provider?: ProviderType;
      raw?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'AIGatewayError';
    this.status = options.status ?? 500;
    this.code = options.code ?? AIGatewayErrorCode.UNKNOWN_ERROR;
    this.provider = options.provider;
    this.raw = options.raw;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AIGatewayError);
    }
  }

  /** Convert to JSON-serializable object */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      provider: this.provider,
    };
  }
}
