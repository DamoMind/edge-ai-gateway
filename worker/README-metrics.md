# Metrics / Usage (Analytics Engine)

## Event schema
We write **one event per request** to Cloudflare Analytics Engine.

### blobs
Order:
1. `client` (from `x-client-id`, default `unknown`)
2. `env` (from `x-env`, default `unknown`)
3. `endpoint` (`/v1/chat/completions` | `/v1/audio/speech`)
4. `model` (final model used, best-effort)
5. `model_source` (`default` | `override` | `fallback`)

### doubles
Order:
1. `tokens_in`
2. `tokens_out`
3. `latency_ms`
4. `status`
5. `ts` (epoch ms)

## Config
- Add an Analytics Engine binding named `AE` (or rename in code)
- Optional: enforce client id header
  - `REQUIRE_CLIENT_ID=true`

## Notes
- Streaming responses currently record tokens as 0 (latency + request counted).
- Metrics write is best-effort; it will never break traffic.
