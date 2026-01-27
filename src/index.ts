/**
 * Edge AI Gateway
 * Lightweight AI provider abstraction for edge deployment
 */

// Types
export type {
  ProviderType,
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
  CustomConfig,
  AnyProviderConfig,
  AIGatewayError,
} from './types';

// Providers
export {
  AIProvider,
  BaseProvider,
  AzureProvider,
  AzureFoundryProvider,
  OpenAIProvider,
  CloudflareProvider,
} from './providers';

// Factory function
import type { AnyProviderConfig } from './types';
import type { AIProvider } from './providers';
import { AzureProvider } from './providers/azure';
import { AzureFoundryProvider } from './providers/azure-foundry';
import { OpenAIProvider } from './providers/openai';
import { CloudflareProvider } from './providers/cloudflare';

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
    case 'custom':
      throw new Error('Custom provider requires manual implementation');
    default:
      throw new Error(`Unknown provider type: ${(config as AnyProviderConfig).type}`);
  }
}
