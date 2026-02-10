/**
 * Edge AI Gateway
 * 
 * @description Lightweight AI provider abstraction layer for edge deployment.
 * Provides a unified interface for multiple AI providers including Azure OpenAI,
 * Azure AI Foundry, OpenAI, and Cloudflare Workers AI.
 * 
 * @example
 * ```typescript
 * import { createProvider } from 'edge-ai-gateway';
 * 
 * const provider = createProvider({
 *   type: 'openai',
 *   apiKey: 'sk-...',
 * });
 * 
 * const response = await provider.chat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */

// Types
export type {
  ProviderType,
  MessageRole,
  FinishReason,
  Message,
  ContentPart,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatChoice,
  Usage,
  ProviderConfig,
  AzureConfig,
  AzureFoundryConfig,
  OpenAIConfig,
  CloudflareConfig,
  VertexConfig,
  CustomConfig,
  AnyProviderConfig,
} from './types';

// Error handling
export { AIGatewayError, AIGatewayErrorCode } from './types';

// Providers
export {
  AIProvider,
  BaseProvider,
  AzureProvider,
  AzureFoundryProvider,
  OpenAIProvider,
  CloudflareProvider,
  VertexProvider,
} from './providers';

// Factory function
import type { AnyProviderConfig } from './types';
import type { AIProvider } from './providers';
import { AzureProvider } from './providers/azure';
import { AzureFoundryProvider } from './providers/azure-foundry';
import { OpenAIProvider } from './providers/openai';
import { CloudflareProvider } from './providers/cloudflare';
import { VertexProvider } from './providers/vertex';

/**
 * Create a provider instance from configuration
 */
export function createProvider(config: AnyProviderConfig): AIProvider {
  switch (config.type) {
    case 'azure':
      return new AzureProvider(config);
    case 'azure-foundry':
      return new AzureFoundryProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'cloudflare':
      return new CloudflareProvider(config);
    case 'vertex':
      return new VertexProvider(config);
    case 'custom':
      throw new Error('Custom provider requires manual implementation');
    default:
      throw new Error(`Unknown provider type: ${(config as AnyProviderConfig).type}`);
  }
}
