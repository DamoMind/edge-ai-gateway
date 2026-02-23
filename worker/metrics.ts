/**
 * Metrics and Usage Tracking Utilities
 * 
 * @description Helper functions for tracking API usage and performance metrics
 * using Cloudflare Analytics Engine. Supports low-cardinality tracking of
 * client IDs, environments, endpoints, models, and token usage.
 */

import type { ChatCompletionRequest } from '../src';

/**
 * Indicates how the model was selected for a request
 * 
 * - `default`: Used provider's default model (no override)
 * - `override`: Client explicitly requested a specific model
 * - `fallback`: Fell back to alternative model (e.g., after error)
 */
export type ModelSource = 'default' | 'override' | 'fallback';

/**
 * A usage event record for Analytics Engine
 * 
 * Tracks per-request metrics including token usage, latency, and client context.
 */
export interface UsageEvent {
  /** Client identifier (from x-client-id header or 'unknown') */
  client: string;
  /** Environment (from x-env header or 'unknown') */
  env: string;
  /** Normalized endpoint path (e.g., '/v1/chat/completions') */
  endpoint: string;
  /** Model name used for this request */
  model: string;
  /** How the model was selected */
  model_source: ModelSource;
  /** Input tokens consumed */
  tokens_in: number;
  /** Output tokens generated */
  tokens_out: number;
  /** Request latency in milliseconds */
  latency_ms: number;
  /** HTTP status code */
  status: number;
  /** Timestamp in epoch milliseconds */
  ts: number;
}

/**
 * Context extracted from a request for usage tracking
 */
export interface UsageContext {
  /** Client identifier */
  client: string;
  /** Environment name */
  env: string;
  /** Normalized endpoint path */
  endpoint: string;
  /** Model requested in request body (if any) */
  requestedModel?: string;
}

/**
 * Extract client and environment identifiers from request headers
 * 
 * @param request - Incoming HTTP request
 * @returns Object with client and env (defaults to 'unknown' if not present)
 */
export function getClientEnv(request: Request): { client: string; env: string } {
  const client = request.headers.get('x-client-id')?.trim() || 'unknown';
  const env = request.headers.get('x-env')?.trim() || 'unknown';
  return { client, env };
}

/**
 * Normalize URL pathname to a low-cardinality endpoint identifier
 * 
 * @param pathname - Request URL pathname
 * @returns Normalized endpoint path (e.g., '/v1/chat/completions')
 */
export function getEndpoint(pathname: string): string {
  // Keep low cardinality: only key endpoints
  if (pathname.includes('/audio/speech')) return '/v1/audio/speech';
  return '/v1/chat/completions';
}

/**
 * Determine how the model was selected for this request
 * 
 * @param requestBodyModel - Model name from request body (if any)
 * @param finalModel - Actual model used
 * @param didFallback - Whether we fell back to a different model
 * @returns Model source indicator
 */
export function inferModelSource(requestBodyModel: string | undefined, finalModel: string, didFallback: boolean): ModelSource {
  if (didFallback) return 'fallback';
  if (requestBodyModel && requestBodyModel.trim().length > 0 && requestBodyModel.trim() !== finalModel) return 'override';
  if (requestBodyModel && requestBodyModel.trim().length > 0) return 'override';
  return 'default';
}

/**
 * Safely extract token usage from a chat completion response
 * 
 * @param resJson - Raw response JSON (may be malformed)
 * @returns Object with tokens_in and tokens_out (defaults to 0 if not present)
 */
export function safeExtractChatUsage(resJson: any): { tokens_in: number; tokens_out: number } {
  const usage = resJson?.usage;
  const tokens_in = Number(usage?.prompt_tokens ?? 0) || 0;
  const tokens_out = Number(usage?.completion_tokens ?? 0) || 0;
  return { tokens_in, tokens_out };
}

/**
 * Safely parse the model field from a request body
 * 
 * @param body - Raw request body (may be any type)
 * @returns Model string if present, undefined otherwise
 */
export function safeParseChatRequestModel(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as ChatCompletionRequest).model;
  return typeof m === 'string' ? m : undefined;
}
