#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/dev/ngrok.env"
PORT="${SHOPIFY_TUNNEL_PORT:-3458}"
STORE="${SHOPIFY_DEV_STORE:-outstock-test-lionlx2x.myshopify.com}"
NGROK_LOG="/tmp/outstock-ngrok.log"
DEV_LOG="/tmp/outstock-dev-stable.log"
NGROK_PID_FILE="/tmp/outstock-ngrok.pid"
DEV_PID_FILE="/tmp/outstock-dev.pid"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  red "Missing $ENV_FILE — copy dev/ngrok.env.example and add your authtoken."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${NGROK_AUTHTOKEN:-}" || "$NGROK_AUTHTOKEN" == "your_ngrok_authtoken_here" ]]; then
  red "Set NGROK_AUTHTOKEN in dev/ngrok.env"
  exit 1
fi

if [[ -z "${NGROK_DOMAIN:-}" ]]; then
  red "Set NGROK_DOMAIN in dev/ngrok.env"
  exit 1
fi

NGROK_DOMAIN="${NGROK_DOMAIN#https://}"
NGROK_DOMAIN="${NGROK_DOMAIN%%/*}"
TUNNEL_URL="https://${NGROK_DOMAIN}"

if ! command -v ngrok >/dev/null 2>&1; then
  red "ngrok is not installed. Install with: brew install ngrok"
  exit 1
fi

export NGROK_AUTHTOKEN
ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null 2>&1 || true

yellow "Stopping old dev/tunnel processes..."
pkill -f "shopify app dev" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "ngrok http" 2>/dev/null || true
sleep 2

yellow "Starting ngrok: ${TUNNEL_URL} -> localhost:${PORT}"
: > "$NGROK_LOG"
nohup ngrok http "$PORT" --url "$TUNNEL_URL" >> "$NGROK_LOG" 2>&1 &
echo $! > "$NGROK_PID_FILE"

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4040/api/tunnels" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

yellow "Starting shopify app dev..."
: > "$DEV_LOG"
nohup shopify app dev \
  --store "$STORE" \
  --skip-dependencies-installation \
  --tunnel-url="${TUNNEL_URL}:${PORT}" \
  >> "$DEV_LOG" 2>&1 &
echo $! > "$DEV_PID_FILE"

for i in $(seq 1 90); do
  if grep -q "Using URL: ${TUNNEL_URL}" "$DEV_LOG" 2>/dev/null && grep -q "Ready" "$DEV_LOG" 2>/dev/null; then
    break
  fi
  sleep 2
done

if ! grep -q "Using URL: ${TUNNEL_URL}" "$DEV_LOG" 2>/dev/null; then
  red "Shopify dev did not start. Tail of log:"
  tail -20 "$DEV_LOG" || true
  exit 1
fi

green "Stable tunnel URL: $TUNNEL_URL"
green "Shopify CLI proxy port: $PORT"
LOCAL_URL="$(grep -o 'http://localhost:[0-9]\+' "$DEV_LOG" | tail -1 || true)"
if [[ -n "$LOCAL_URL" ]]; then
  green "Vite local URL: $LOCAL_URL"
fi
yellow "Tip: Open $TUNNEL_URL once in Chrome and click Visit to bypass ngrok interstitial in Admin iframes."
echo
yellow "Logs: $DEV_LOG (shopify)  $NGROK_LOG (ngrok)"
yellow "Press Ctrl+C to stop both processes, or run: pkill -f 'ngrok http'; pkill -f 'shopify app dev'"
echo

tail -f "$DEV_LOG"
