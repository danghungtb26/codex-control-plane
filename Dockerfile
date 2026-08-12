FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY dashboard ./dashboard

RUN bun install --frozen-lockfile
RUN bun run dashboard:build

FROM caddy:2-alpine

COPY --from=build /app/dashboard/dist /srv/dashboard
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/dashboard-entrypoint

RUN chmod +x /usr/local/bin/dashboard-entrypoint

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/dashboard-entrypoint"]
