#!/usr/bin/env bash
set -euo pipefail

BACKUP_URL="${1:-${EDGE_AI_GATEWAY_BACKUP_URL:-}}"
OUT_FILE="${EDGE_AI_GATEWAY_ACTIVE_FILE:-/data/damo/edge-ai-gateway/ops/active-endpoint.env}"

if [[ -z "${BACKUP_URL}" ]]; then
  echo "Usage: EDGE_AI_GATEWAY_BACKUP_URL=<url> $0 [backup_url]" >&2
  exit 2
fi

mkdir -p "$(dirname "${OUT_FILE}")"
cat > "${OUT_FILE}" <<EOF
EDGE_AI_GATEWAY_URL=${BACKUP_URL}
EOF

echo "Switched to backup: ${BACKUP_URL}"
echo "Active endpoint file: ${OUT_FILE}"