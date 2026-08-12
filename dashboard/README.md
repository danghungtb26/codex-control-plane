# Dashboard

Local read-only dashboard for Codex Control Plane.

## Single-port runtime

The control plane now exposes one HTTP origin for everything:

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

```bash
bun run dev
```

This runs the control plane in watch mode plus Vite `build --watch`. The browser still uses only:

```text
http://127.0.0.1:8788/
```

There is intentionally no second Vite HTTP port. Dashboard assets rebuild automatically; refresh the browser after frontend edits.

## Cloudflare Tunnel + Access

A future/public setup only needs one tunnel route:

```text
codex.example.com -> http://127.0.0.1:8788
```

Recommended Access layout:

1. Protect `codex.example.com/*` with a Cloudflare Access Allow policy for trusted users.
2. Create a more-specific Access application for `codex.example.com/github/webhook` with a Bypass policy so GitHub can deliver webhook requests without an interactive login.
3. Keep `GITHUB_WEBHOOK_SECRET` enabled. The control plane still validates `X-Hub-Signature-256` on every webhook request, so the Access bypass does not bypass GitHub webhook authentication.
4. Do not add other Bypass paths. `/api/*`, `/send`, `/interrupt`, `/bindings`, `/notifications/test`, and the dashboard should stay behind Access.

For a small/private setup, Cloudflare account membership or email one-time PIN are the quickest user-auth options. No application auth env is required.

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

The dashboard is intentionally read-only in V1. Existing `/send` and `/interrupt` admin APIs remain available on the same origin.
