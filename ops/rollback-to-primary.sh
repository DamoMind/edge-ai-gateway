#!/usr/bin/env bash
set -euo pipefail

PRIMARY_URL="${1:-${EDGE_AI_GATEWAY_PRIMARY_URL:-}}"
OUT_FILE="${EDGE_AI_GATEWAY_ACTIVE_FILE:-/data/damo/edge-ai-gateway/ops/active-endpoint.env}"

if [[ -z "${PRIMARY_URL}" ]]; then
  echo "Usage: EDGE_AI_GATEWAY_PRIMARY_URL=<url> $0 [primary_url]" >&2
  exit 2
fi

mkdir -p "$(dirname "${OUT_FILE}")"
cat > "${OUT_FILE}" <<EOF
EDGE_AI_GATEWAY_URL=${PRIMARY_URL}
EOF

echo "Rolled back to primary: ${PRIMARY_URL}"
echo "Active endpoint file: ${OUT_FILE}"