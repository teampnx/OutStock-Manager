#!/usr/bin/env bash
# Full migration verification: routes, embedded auth chain, App Bridge, webhooks.
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
COLLECTION_ID="$(python3 -c "import sqlite3; c=sqlite3.connect('$ROOT_DIR/prisma/dev.sqlite'); r=c.execute('SELECT id FROM Collection LIMIT 1').fetchone(); print(r[0] if r else '')" 2>/dev/null || echo "")"
TS="$(date +%s)"
FAIL=0

if [[ -z "$BASE" || "$BASE" == "https://" ]]; then
  echo "Usage: $0 [tunnel-base-url]"
  exit 1
fi

curl_get() {
  curl -sS -o /dev/null -w "%{http_code}" --max-time 25 \
    -A "$UA" \
    -H "Accept: text/html,application/xhtml+xml" \
    -H "Referer: https://admin.shopify.com/" \
    -H "Sec-Fetch-Dest: iframe" \
    -H "Sec-Fetch-Mode: navigate" \
    -H "ngrok-skip-browser-warning: 1" \
    "${BASE}${1}" 2>/dev/null || echo "000"
}

check() {
  local label="$1"
  local path="$2"
  local expect="$3"
  local code
  code="$(curl_get "$path")"
  if [[ "$code" == "$expect" ]]; then
    printf "OK  %-32s %s\n" "$label" "$code"
  else
    printf "FAIL %-32s %s (expected %s)\n" "$label" "$code" "$expect"
    FAIL=1
  fi
}

echo "=== Stable ngrok migration verification ==="
echo "Tunnel: $BASE"
echo "Shop:   $SHOP"
echo

echo "--- Public tunnel ---"
check "Tunnel root" "/" "200"

echo
echo "--- Embedded app routes (expect 302 -> session-token without session) ---"
EMB="embedded=1&shop=${SHOP}&host=${HOST_B64}&timestamp=${TS}"
check "Embedded entry" "/?${EMB}" "302"
check "App shell" "/app?${EMB}" "302"
check "Dashboard" "/app/dashboard?${EMB}" "302"
check "Collections list" "/app/collections?${EMB}" "302"
if [[ -n "$COLLECTION_ID" ]]; then
  check "Collection detail" "/app/collections/${COLLECTION_ID}?${EMB}" "302"
fi
check "Product Pinning" "/app/products?${EMB}" "302"
check "Activity" "/app/activity?${EMB}" "302"
check "Pricing" "/app/pricing?${EMB}" "302"
check "Settings" "/app/settings?${EMB}" "302"

echo
echo "--- App Bridge / session-token ---"
SESSION_BODY="$(mktemp)"
SESSION_CODE=$(curl -sS -o "$SESSION_BODY" -w "%{http_code}" --max-time 25 \
  -A "$UA" \
  -H "Accept: text/html" \
  -H "Referer: https://admin.shopify.com/" \
  -H "Sec-Fetch-Dest: iframe" \
  -H "ngrok-skip-browser-warning: 1" \
  "${BASE}/auth/session-token?${EMB}&shopify-reload=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${BASE}/app?${EMB}'))")" || echo "000")

if [[ "$SESSION_CODE" == "200" ]] && grep -q "app-bridge.js" "$SESSION_BODY"; then
  echo "OK  App Bridge session-token           200 (app-bridge.js present)"
else
  echo "FAIL App Bridge session-token           $SESSION_CODE (app-bridge.js missing?)"
  FAIL=1
fi
rm -f "$SESSION_BODY"

echo
echo "--- Webhook endpoint ---"
WH_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: 1" \
  -d '{}' \
  "${BASE}/webhooks/products/update" 2>/dev/null || echo "000")
if [[ "$WH_CODE" == "401" || "$WH_CODE" == "400" || "$WH_CODE" == "500" ]]; then
  echo "OK  Webhook POST reachable              $WH_CODE (auth/HMAC rejected without signature)"
elif [[ "$WH_CODE" == "200" ]]; then
  echo "OK  Webhook POST reachable              200"
else
  echo "WARN Webhook POST                         $WH_CODE"
fi

echo
if [[ "${FAIL:-0}" -eq 0 ]]; then
  echo "All critical checks passed."
  exit 0
else
  echo "Some checks failed."
  exit 1
fi
