# Dashboard

Local read-only dashboard for Codex Control Plane.

## Production runtime

The built dashboard, dashboard APIs, GitHub webhook and admin APIs share one production origin:

```text
http://127.0.0.1:8788/
├── /                         dashboard
├── /api/*                    dashboard API + SSE
├── /github/webhook           GitHub webhook
├── /send                     local/admin send API
├── /interrupt                interrupt API
├── /bindings                 binding API
└── /notifications/test       Discord test API
```

Set the canonical port with:

```env
PORT=8788
```

`ADMIN_PORT` and `WEBHOOK_PORT` are legacy fallbacks only when `PORT` is not set.

## Production-style local run

```bash
bun install
bun run build
bun run start
```

Open:

```text
http://127.0.0.1:8788/
```

## Development

Use the normal Vite development server for HMR and proxy dashboard API requests to the control plane.

Terminal 1:

```bash
bun run dev
```

Control plane:

```text
http://127.0.0.1:8788
```

Terminal 2:

```bash
bun run dashboard:dev
```

Vite dashboard:

```text
http://127.0.0.1:5173
```

Vite proxies `/api/*` to `http://127.0.0.1:8788`, including the SSE endpoint.

## Cloudflare Tunnel and auth

A production/public deployment can still use one tunnel route:

```text
codex.example.com -> http://127.0.0.1:8788
```

The GitHub webhook is then:

```text
https://codex.example.com/github/webhook
```

This project does not prescribe a Cloudflare Access Bypass policy. If Cloudflare Access is applied to the entire hostname, GitHub webhook requests will also be challenged by Access and will not reach the origin normally. Keep gateway authentication as a deployment concern until the desired webhook/auth ingress layout is chosen.

`GITHUB_WEBHOOK_SECRET` remains mandatory and the control plane validates `X-Hub-Signature-256` on every GitHub webhook request.

## Data

- Durable Issue/PR/thread mappings still come from `.data/bindings.json` and GitHub binding markers.
- Dashboard lifecycle/new-turn transcript events are appended to `.data/task-events.jsonl`.
- When a task is opened, the control plane also asks Codex App Server for persisted thread history with `thread/read(includeTurns: true)` and merges it with dashboard-local events.
- Historical user messages, agent messages, commands and file/tool activity can therefore be shown for threads that existed before the dashboard was installed.
- Codex `reasoning` items are deliberately excluded from dashboard history and realtime persistence.
- If persisted Codex history is unavailable, the dashboard falls back to locally persisted events instead of failing the task view.
- Agent text deltas are broadcast live over SSE and are not written token-by-token; the completed agent message is persisted instead.

## API

```text
GET /api/tasks
GET /api/tasks/:threadId/events
GET /api/events                  # Server-Sent Events
```

The dashboard is intentionally read-only in V1. Existing `/send` and `/interrupt` admin APIs remain available on the production origin.
