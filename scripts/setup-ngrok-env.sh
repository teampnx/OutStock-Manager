#!/usr/bin/env bash
# One-time interactive setup for dev/ngrok.env
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/dev/ngrok.env"
EXAMPLE="$ROOT_DIR/dev/ngrok.env.example"

if [[ -f "$ENV_FILE" ]]; then
  echo "dev/ngrok.env already exists at $ENV_FILE"
  echo "Delete it first if you want to reconfigure."
  exit 0
fi

echo "=== OutStock Manager — ngrok stable tunnel setup ==="
echo
echo "Before continuing, complete these steps in your browser:"
echo "  1. Sign up:  https://dashboard.ngrok.com/signup"
echo "  2. Copy authtoken: https://dashboard.ngrok.com/get-started/your-authtoken"
echo "  3. Create a free static domain: https://dashboard.ngrok.com/domains"
echo "     (pick any available *.ngrok-free.app name — it never changes)"
echo

read -r -p "Paste your ngrok authtoken: " NGROK_AUTHTOKEN
read -r -p "Static domain [turmoil-stingily-spinach.ngrok-free.dev]: " NGROK_DOMAIN
NGROK_DOMAIN="${NGROK_DOMAIN:-turmoil-stingily-spinach.ngrok-free.dev}"

NGROK_DOMAIN="${NGROK_DOMAIN#https://}"
NGROK_DOMAIN="${NGROK_DOMAIN%%/*}"

if [[ -z "$NGROK_AUTHTOKEN" || -z "$NGROK_DOMAIN" ]]; then
  echo "Both values are required."
  exit 1
fi

mkdir -p "$ROOT_DIR/dev"
cat > "$ENV_FILE" <<EOF
NGROK_AUTHTOKEN=${NGROK_AUTHTOKEN}
NGROK_DOMAIN=${NGROK_DOMAIN}
SHOPIFY_TUNNEL_PORT=3458
EOF

chmod 600 "$ENV_FILE"

echo
echo "Wrote $ENV_FILE"
echo
echo "Configuring ngrok CLI..."
NGROK_AUTHTOKEN="$NGROK_AUTHTOKEN" ngrok config add-authtoken "$NGROK_AUTHTOKEN"

echo
echo "Done. Start stable dev with:"
echo "  npm run dev"
