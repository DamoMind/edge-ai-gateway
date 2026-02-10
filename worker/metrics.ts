import type { ChatCompletionRequest } from '../src';

export type ModelSource = 'default' | 'override' | 'fallback';

export interface UsageEvent {
  client: string;
  env: string;
  endpoint: string;
  model: string;
  model_source: ModelSource;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  status: number;
  ts: number; // epoch ms
}

export interface UsageContext {
  client: string;
  env: string;
  endpoint: string;
  requestedModel?: string;
}

export function getClientEnv(request: Request): { client: string; env: string } {
  const client = request.headers.get('x-client-id')?.trim() || 'unknown';
  const env = request.headers.get('x-env')?.trim() || 'unknown';
  return { client, env };
}

export function getEndpoint(pathname: string): string {
  // Keep low cardinality: only key endpoints
  if (pathname.includes('/audio/speech')) return '/v1/audio/speech';
  return '/v1/chat/completions';
}

export function inferModelSource(requestBodyModel: string | undefined, finalModel: string, didFallback: boolean): ModelSource {
  if (didFallback) return 'fallback';
  if (requestBodyModel && requestBodyModel.trim().length > 0 && requestBodyModel.trim() !== finalModel) return 'override';
  if (requestBodyModel && requestBodyModel.trim().length > 0) return 'override';
  return 'default';
}

export function safeExtractChatUsage(resJson: any): { tokens_in: number; tokens_out: number } {
  const usage = resJson?.usage;
  const tokens_in = Number(usage?.prompt_tokens ?? 0) || 0;
  const tokens_out = Number(usage?.completion_tokens ?? 0) || 0;
  return { tokens_in, tokens_out };
}

export function safeParseChatRequestModel(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as ChatCompletionRequest).model;
  return typeof m === 'string' ? m : undefined;
}
