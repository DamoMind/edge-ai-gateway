#!/usr/bin/env bash
set -euo pipefail

URL="${1:-${EDGE_AI_GATEWAY_URL:-}}"
MODEL="${MODEL:-gpt-5.2-codex}"
CLIENT_API_KEY="${CLIENT_API_KEY:-}"

if [[ -z "${URL}" ]]; then
  echo "Usage: EDGE_AI_GATEWAY_URL=<url> CLIENT_API_KEY=<key> $0" >&2
  exit 2
fi

TMP="/tmp/edge-ai-gateway-healthcheck.json"
AUTH_HEADER=()
if [[ -n "${CLIENT_API_KEY}" ]]; then
  AUTH_HEADER=( -H "Authorization: Bearer ${CLIENT_API_KEY}" )
fi

CODE=$(curl -sS -o "${TMP}" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  "${URL%/}/v1/chat/completions" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":1}")

if [[ "${CODE}" != "200" ]]; then
  echo "Healthcheck failed: HTTP ${CODE}" >&2
  cat "${TMP}" >&2 || true
  exit 1
fi

if ! grep -q '"choices"' "${TMP}"; then
  echo "Healthcheck failed: missing choices" >&2
  cat "${TMP}" >&2 || true
  exit 1
fi

echo "OK ${URL}"