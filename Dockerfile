FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY dashboard ./dashboard
COPY src ./src

RUN bun install --frozen-lockfile
RUN bun run build

FROM caddy:2-alpine

ARG CODEX_VERSION=latest

RUN apk add --no-cache \
      bash \
      ca-certificates \
      git \
      github-cli \
      nodejs \
      npm \
      openssh-client \
    && npm install -g "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force

COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY --from=build /app/dashboard/dist ./dashboard/dist
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/codex-control-plane-entrypoint

RUN chmod +x /usr/local/bin/codex-control-plane-entrypoint \
    && mkdir -p /app/.data

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/codex-control-plane-entrypoint"]
