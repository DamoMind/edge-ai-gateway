/**
 * Edge AI Gateway - Core Types
 */

export type ProviderType = 'azure' | 'openai' | 'cloudflare' | 'custom';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface ChatCompletionRequest {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: Usage;
}

export interface ChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

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

export type AnyProviderConfig = AzureConfig | OpenAIConfig | CloudflareConfig | CustomConfig;

export interface AIGatewayError extends Error {
  status?: number;
  provider?: ProviderType;
  raw?: unknown;
}
