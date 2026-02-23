# Contributing to Edge AI Gateway

Thank you for your interest in contributing to Edge AI Gateway! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- Wrangler CLI (for worker development)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/edge-ai-gateway.git
cd edge-ai-gateway

# Install dependencies
npm install

# Run type checking
npm run typecheck

# Build the library
npm run build
```

## Project Structure

```
edge-ai-gateway/
├── src/                  # Core library code
│   ├── index.ts         # Main exports
│   ├── types.ts         # Type definitions
│   └── providers/       # Provider implementations
│       ├── base.ts      # Base provider interface
│       ├── azure.ts     # Azure OpenAI
│       ├── azure-foundry.ts
│       ├── openai.ts
│       ├── cloudflare.ts
│       └── vertex.ts
├── worker/              # Deployable Cloudflare Worker
│   ├── worker.ts        # Worker implementation
│   ├── metrics.ts       # Usage tracking
│   └── wrangler.toml    # Worker configuration
├── dist/                # Built library (generated)
└── README.md            # Documentation
```

## Development Workflow

### 1. Making Changes

```bash
# Start development mode (auto-rebuild on file changes)
npm run dev

# Run type checking
npm run typecheck

# Run linter
npm run lint
```

### 2. Testing Your Changes

```bash
# Build the library
npm run build

# Test locally with a simple script
node test-script.js
```

### 3. Worker Development

```bash
# Start local development server
npm run worker:dev

# Deploy to Cloudflare (requires wrangler login)
npm run worker:deploy

# View worker logs
npm run worker:tail
```

## Code Style

### TypeScript Guidelines
- Use TypeScript strict mode
- Provide complete type definitions
- Avoid `any` types (use `unknown` instead)
- Use JSDoc comments for public APIs

### Documentation
- All public APIs must have JSDoc comments
- Include `@param`, `@returns`, `@throws` tags
- Provide usage examples where helpful
- Keep descriptions concise and clear

### Example:
```typescript
/**
 * Send a chat completion request
 * 
 * @param request - Chat completion request parameters
 * @returns Promise resolving to chat completion response
 * @throws {AIGatewayError} On provider errors or configuration issues
 */
async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  // Implementation
}
```

## Adding a New Provider

1. Create a new file in `src/providers/<provider-name>.ts`
2. Extend `BaseProvider` and implement the `AIProvider` interface
3. Add configuration type to `src/types.ts`
4. Export the provider in `src/providers/index.ts`
5. Add factory case in `src/index.ts` `createProvider()`
6. Update documentation in `README.md`

### Provider Template:
```typescript
import { BaseProvider } from './base';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

export interface MyProviderConfig {
  type: 'my-provider';
  apiKey: string;
  // ... other config
}

export class MyProvider extends BaseProvider {
  readonly name = 'my-provider';
  readonly supportsStreaming = true; // or false

  constructor(config: MyProviderConfig) {
    super(config);
    // Initialize provider-specific fields
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Implementation
  }

  async chatStream?(request: ChatCompletionRequest): Promise<ReadableStream> {
    // Optional: streaming implementation
  }
}
```

## Error Handling

- Use `AIGatewayError` for all provider errors
- Map HTTP status codes to appropriate error codes
- Include provider context in errors
- Preserve raw error responses when helpful

```typescript
throw this.createError(
  'Authentication failed',
  401,
  rawError,
  AIGatewayErrorCode.AUTHENTICATION_ERROR
);
```

## Submitting Changes

### Before Submitting
- [ ] Run `npm run check` (typecheck + lint)
- [ ] Build successfully with `npm run build`
- [ ] Update CHANGELOG.md with your changes
- [ ] Update README.md if adding features
- [ ] Add JSDoc comments to new public APIs

### Pull Request Process
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Message Format
```
<type>: <short summary>

<optional detailed description>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Maintenance tasks

## Questions?

If you have questions or need help:
- Open an issue on GitHub
- Check existing issues and discussions
- Review the documentation

Thank you for contributing! 🙏
