#!/bin/sh
set -eu

: "${PORT:=8787}"
: "${CADDY_AUTH_USERNAME:=admin}"

if [ -z "${CADDY_AUTH_PASSWORD_HASH:-}" ]; then
  if [ -z "${CADDY_AUTH_PASSWORD:-}" ]; then
    echo "CADDY_AUTH_PASSWORD or CADDY_AUTH_PASSWORD_HASH is required" >&2
    exit 1
  fi
  CADDY_AUTH_PASSWORD_HASH="$(caddy hash-password --plaintext "${CADDY_AUTH_PASSWORD}")"
fi

export PORT CADDY_AUTH_USERNAME CADDY_AUTH_PASSWORD_HASH

git config --global --add safe.directory '*' >/dev/null 2>&1 || true

if [ -n "${GIT_USER_NAME:-}" ]; then
  git config --global user.name "${GIT_USER_NAME}"
fi
if [ -n "${GIT_USER_EMAIL:-}" ]; then
  git config --global user.email "${GIT_USER_EMAIL}"
fi

if gh auth status >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

bun src/server.ts &
APP_PID=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

shutdown() {
  trap - INT TERM
  kill -TERM "${APP_PID}" "${CADDY_PID}" 2>/dev/null || true
  wait "${APP_PID}" 2>/dev/null || true
  wait "${CADDY_PID}" 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM

while kill -0 "${APP_PID}" 2>/dev/null && kill -0 "${CADDY_PID}" 2>/dev/null; do
  sleep 1
done

STATUS=0
if ! kill -0 "${APP_PID}" 2>/dev/null; then
  wait "${APP_PID}" || STATUS=$?
fi
if ! kill -0 "${CADDY_PID}" 2>/dev/null; then
  wait "${CADDY_PID}" || STATUS=$?
fi

kill -TERM "${APP_PID}" "${CADDY_PID}" 2>/dev/null || true
wait "${APP_PID}" 2>/dev/null || true
wait "${CADDY_PID}" 2>/dev/null || true

exit "${STATUS}"
