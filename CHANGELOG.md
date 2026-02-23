# Changelog

All notable changes to edge-ai-gateway will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive JSDoc documentation for all providers and core modules
- CHANGELOG.md to track version history
- Enhanced package.json scripts for common development tasks

### Changed
- Improved code documentation and inline comments

### Fixed
- (none)

## [0.1.0] - 2024-01-25

### Added
- Initial release
- Multi-provider support: Azure OpenAI, Azure AI Foundry, OpenAI, Cloudflare Workers AI, Vertex AI
- Streaming support with Server-Sent Events (SSE)
- OpenAI-compatible unified API interface
- Full TypeScript support with comprehensive type definitions
- Structured error handling with AIGatewayError
- Vision/multimodal support for image inputs
- Deployable Cloudflare Worker with secure API key management
- Metrics and monitoring support (worker)

### Provider Features
- **Azure OpenAI**: Full deployment support with streaming
- **Azure AI Foundry**: Unified interface for GPT and Claude models
- **OpenAI**: Direct API and compatible endpoints
- **Cloudflare Workers AI**: Native edge AI integration
- **Vertex AI**: Google Cloud Platform AI support

### Documentation
- Comprehensive README with examples
- Provider-specific configuration guides
- Error handling documentation
- Worker deployment guide
- Metrics documentation

[Unreleased]: https://github.com/yourusername/edge-ai-gateway/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/edge-ai-gateway/releases/tag/v0.1.0
