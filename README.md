# edge-ai-gateway

Lightweight AI provider abstraction layer for edge deployment (Cloudflare Workers).

## Features

- 🚀 **Edge-first**: Designed for Cloudflare Workers and edge runtime
- 🔌 **Multi-provider**: Support Azure OpenAI, OpenAI, Cloudflare AI
- 📦 **Lightweight**: Zero dependencies, uses native `fetch`
- 🔄 **Unified API**: OpenAI-compatible interface across all providers
- 🖼️ **Vision Ready**: Support for image/vision models

## Installation

```bash
npm install edge-ai-gateway
```

## Quick Start

```typescript
import { createProvider, type AzureConfig } from 'edge-ai-gateway';

// Azure OpenAI
const provider = createProvider({
  type: 'azure',
  endpoint: 'https://your-resource.openai.azure.com',
  apiKey: 'your-api-key',
  deployment: 'gpt-4o',
});

const response = await provider.chat({
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
  max_tokens: 100,
});

console.log(response.choices[0].message.content);
```

## Providers

### Azure OpenAI

```typescript
import { AzureProvider } from 'edge-ai-gateway';

const azure = new AzureProvider({
  type: 'azure',
  endpoint: 'https://your-resource.openai.azure.com',
  apiKey: 'your-api-key',
  deployment: 'gpt-4o',
  apiVersion: '2024-02-15-preview', // optional
});
```

### OpenAI

```typescript
import { OpenAIProvider } from 'edge-ai-gateway';

const openai = new OpenAIProvider({
  type: 'openai',
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1', // optional
  organization: 'org-...', // optional
});
```

### Cloudflare Workers AI

```typescript
import { CloudflareProvider } from 'edge-ai-gateway';

const cf = new CloudflareProvider({
  type: 'cloudflare',
  accountId: 'your-account-id',
  apiToken: 'your-api-token',
  model: '@cf/meta/llama-3.1-8b-instruct', // optional
});
```

## Vision Support

```typescript
const response = await provider.chat({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/jpeg;base64,...',
            detail: 'high'
          }
        }
      ]
    }
  ],
  max_tokens: 500,
});
```

## Cloudflare Workers Example

```typescript
// worker.ts
import { createProvider, type AzureConfig } from 'edge-ai-gateway';

export interface Env {
  AZURE_ENDPOINT: string;
  AZURE_API_KEY: string;
  AZURE_DEPLOYMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const provider = createProvider({
      type: 'azure',
      endpoint: env.AZURE_ENDPOINT,
      apiKey: env.AZURE_API_KEY,
      deployment: env.AZURE_DEPLOYMENT,
    });

    const body = await request.json();
    const response = await provider.chat(body);

    return Response.json(response);
  },
};
```

## API Reference

### `createProvider(config)`

Factory function to create a provider instance.

### `AIProvider` Interface

```typescript
interface AIProvider {
  readonly name: string;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}
```

### `ChatCompletionRequest`

```typescript
interface ChatCompletionRequest {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}
```

### `ChatCompletionResponse`

OpenAI-compatible response format.

## License

Apache-2.0
