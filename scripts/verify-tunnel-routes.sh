#!/usr/bin/env bash
# Verify embedded app routes return expected HTTP statuses through the stable tunnel.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/dev/ngrok.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

BASE="${1:-https://${NGROK_DOMAIN:-}}"
SHOP="${SHOPIFY_DEV_STORE:-outstock-test-lionlx2x.myshopify.com}"
HOST_B64="$(python3 -c "import base64; print(base64.b64encode(b'admin.shopify.com/store/outstock-test-lionlx2x').decode())")"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
TS="$(date +%s)"
EMB="embedded=1&shop=${SHOP}&host=${HOST_B64}&timestamp=${TS}"
COLLECTION_ID="$(sqlite3 "$ROOT_DIR/prisma/dev.sqlite" "SELECT id FROM Collection LIMIT 1;" 2>/dev/null || echo "")"

if [[ -z "$BASE" || "$BASE" == "https://" ]]; then
  echo "Usage: $0 [tunnel-base-url]"
  echo "Or set NGROK_DOMAIN in dev/ngrok.env"
  exit 1
fi

check() {
  local label="$1"
  local path="$2"
  local expect="$3"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 \
    -A "$UA" \
    -H "Accept: text/html" \
    -H "Referer: https://admin.shopify.com/" \
    -H "Sec-Fetch-Dest: iframe" \
    -H "ngrok-skip-browser-warning: 1" \
    "${BASE}${path}" || echo "000")
  if [[ "$code" == "$expect" ]]; then
    printf "OK  %-28s %s -> %s\n" "$label" "$path" "$code"
  else
    printf "FAIL %-28s %s -> %s (expected %s)\n" "$label" "$path" "$code" "$expect"
    FAIL=1
  fi
}

FAIL=0
echo "Tunnel: $BASE"
echo

check "Root (landing)" "/" "200"
check "Embedded entry" "/?${EMB}" "302"
check "App shell" "/app?${EMB}" "302"
check "Dashboard" "/app/dashboard?${EMB}" "302"
check "Collections" "/app/collections?${EMB}" "302"
if [[ -n "$COLLECTION_ID" ]]; then
  check "Collection detail" "/app/collections/${COLLECTION_ID}?${EMB}" "302"
fi
check "Product Pinning" "/app/products?${EMB}" "302"
check "Activity" "/app/activity?${EMB}" "302"
check "Pricing" "/app/pricing?${EMB}" "302"
check "Settings" "/app/settings?${EMB}" "302"

echo
if [[ "${FAIL:-0}" -eq 0 ]]; then
  echo "All route checks passed."
else
  echo "Some checks failed — is shopify app dev running?"
  exit 1
fi
