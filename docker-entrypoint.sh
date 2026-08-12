#!/bin/sh
set -eu

: "${CADDY_AUTH_USERNAME:=admin}"
: "${CORE_URL:=http://host.docker.internal:8787}"

if [ -z "${CADDY_AUTH_PASSWORD_HASH:-}" ]; then
  if [ -z "${CADDY_AUTH_PASSWORD:-}" ]; then
    echo "CADDY_AUTH_PASSWORD or CADDY_AUTH_PASSWORD_HASH is required" >&2
    exit 1
  fi
  CADDY_AUTH_PASSWORD_HASH="$(caddy hash-password --plaintext "${CADDY_AUTH_PASSWORD}")"
fi

export CADDY_AUTH_USERNAME CADDY_AUTH_PASSWORD_HASH CORE_URL

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
