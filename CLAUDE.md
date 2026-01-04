# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build       # Build with tsup (CJS + ESM + types)
npm run dev         # Watch mode for development
npm run typecheck   # TypeScript type checking
npm run lint        # ESLint (requires eslint config to be added)
```

## Architecture

This is a lightweight TypeScript library for edge deployment (Cloudflare Workers) that provides a unified interface for multiple AI providers.

### Core Components

- **`src/types.ts`** - Core TypeScript types: `ChatCompletionRequest`, `ChatCompletionResponse`, provider configs
- **`src/providers/base.ts`** - `AIProvider` interface and `BaseProvider` abstract class that all providers extend
- **`src/providers/`** - Provider implementations (Azure, OpenAI, Cloudflare)
- **`src/index.ts`** - Main entry point with `createProvider()` factory function

### Provider Pattern

All providers extend `BaseProvider` and implement the `AIProvider` interface:
```typescript
interface AIProvider {
  readonly name: string;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}
```

Providers normalize their responses to OpenAI-compatible format. The Cloudflare provider transforms native responses; Azure and OpenAI providers pass through.

### Adding a New Provider

1. Create `src/providers/{name}.ts` extending `BaseProvider`
2. Implement `chat()` method returning OpenAI-compatible response
3. Add config interface to `src/types.ts`
4. Export from `src/providers/index.ts`
5. Add case to `createProvider()` in `src/index.ts`

## Constraints

- Zero dependencies - uses native `fetch` only
- Must work in Cloudflare Workers edge runtime
- No Node.js-specific APIs
