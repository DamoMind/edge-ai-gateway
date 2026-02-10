# edge-ai-gateway

Lightweight AI provider abstraction layer for edge deployment (Cloudflare Workers).

## Features

- 🚀 **Edge-first**: Designed for Cloudflare Workers and edge runtime
- 🔌 **Multi-provider**: Support Azure OpenAI, Azure AI Foundry, OpenAI, Cloudflare AI
- 🌊 **Streaming**: Full streaming support with SSE for real-time responses
- 📦 **Lightweight**: Zero dependencies, uses native `fetch`
- 🔄 **Unified API**: OpenAI-compatible interface across all providers
- 🖼️ **Vision Ready**: Support for image/vision models
- 🔐 **Type-safe**: Full TypeScript support with comprehensive error handling
- 🚢 **Deployable Worker**: Ready-to-deploy Cloudflare Worker with secure API key management

## Quick Deploy (Cloudflare Worker)

Want a secure AI proxy without exposing API keys? Use our deployable worker:

```bash
cd worker
wrangler login
wrangler secret put AZURE_API_KEY  # Store API key securely
wrangler deploy
```

See [worker/README.md](./worker/README.md) for full deployment guide.

## Installation

```bash
npm install edge-ai-gateway
```

## Quick Start

```typescript
import { createProvider } from 'edge-ai-gateway';

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

// Streaming support
if (azure.supportsStreaming) {
  const stream = await azure.chatStream({
    messages: [{ role: 'user', content: 'Tell me a story' }],
  });
  // Process SSE stream...
}
```

### Azure AI Foundry

Supports both OpenAI-compatible models and Claude models via unified interface:

```typescript
import { AzureFoundryProvider } from 'edge-ai-gateway';

const foundry = new AzureFoundryProvider({
  type: 'azure-foundry',
  endpoint: 'https://your-foundry.services.ai.azure.com',
  apiKey: 'your-api-key',
  model: 'gpt-4o', // or 'claude-sonnet-4-5'
});

// Claude models are automatically routed to Anthropic endpoint
const response = await foundry.chat({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Hello Claude!' }],
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

## Streaming

All providers that support streaming expose a `chatStream` method:

```typescript
const provider = createProvider({ /* config */ });

if (provider.supportsStreaming && provider.chatStream) {
  const stream = await provider.chatStream({
    messages: [{ role: 'user', content: 'Write a poem' }],
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    // Process SSE chunk (data: {...}\n\n format)
    console.log(chunk);
  }
}
```

## Error Handling

The library provides a structured error class for better error handling:

```typescript
import { AIGatewayError, AIGatewayErrorCode } from 'edge-ai-gateway';

try {
  const response = await provider.chat({ messages: [] });
} catch (error) {
  if (error instanceof AIGatewayError) {
    console.log(error.status);   // HTTP status code
    console.log(error.code);     // AIGatewayErrorCode enum
    console.log(error.provider); // 'azure' | 'openai' | etc.
    console.log(error.raw);      // Raw error from provider
    
    // Error codes
    switch (error.code) {
      case AIGatewayErrorCode.AUTHENTICATION_ERROR:
        // Handle auth error
        break;
      case AIGatewayErrorCode.RATE_LIMIT_ERROR:
        // Handle rate limit
        break;
      case AIGatewayErrorCode.CONFIG_ERROR:
        // Handle configuration error
        break;
    }
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Invalid request parameters |
| `AUTHENTICATION_ERROR` | Authentication failed (401, 403) |
| `RATE_LIMIT_ERROR` | Rate limit exceeded (429) |
| `PROVIDER_ERROR` | Provider API error (5xx) |
| `NETWORK_ERROR` | Network or timeout error |
| `CONFIG_ERROR` | Configuration error |
| `UNKNOWN_ERROR` | Unknown error |

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
import { createProvider, AIGatewayError } from 'edge-ai-gateway';

export interface Env {
  AZURE_ENDPOINT: string;
  AZURE_API_KEY: string;
  AZURE_DEPLOYMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const provider = createProvider({
        type: 'azure',
        endpoint: env.AZURE_ENDPOINT,
        apiKey: env.AZURE_API_KEY,
        deployment: env.AZURE_DEPLOYMENT,
      });

      const body = await request.json();
      
      // Handle streaming
      if (body.stream && provider.supportsStreaming) {
        const stream = await provider.chatStream!(body);
        return new Response(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      const response = await provider.chat(body);
      return Response.json(response);
      
    } catch (error) {
      if (error instanceof AIGatewayError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }
  },
};
```

## API Reference

### `createProvider(config)`

Factory function to create a provider instance.

```typescript
function createProvider(config: AnyProviderConfig): AIProvider;
```

### `AIProvider` Interface

```typescript
interface AIProvider {
  readonly name: string;
  readonly supportsStreaming: boolean;
  
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatStream?(request: ChatCompletionRequest): Promise<ReadableStream>;
}
```

### Types

```typescript
// Message roles
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// Finish reasons
type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | null;

// Request
interface ChatCompletionRequest {
  messages: Message[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  timeout?: number;
}

// Response (OpenAI-compatible)
interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: Usage;
}
```

## License

Apache-2.0
