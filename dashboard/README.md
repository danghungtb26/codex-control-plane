# Dashboard

Local read-only dashboard for Codex Control Plane.

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

The admin server serves `dashboard/dist` and the dashboard APIs on the same port.

## Development

Terminal 1:

```bash
bun run dev
```

Terminal 2:

```bash
bun run dashboard:dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/api/*` to the control plane on port `8788`.

## Data

- Durable Issue/PR/thread mappings still come from `.data/bindings.json` and GitHub binding markers.
- Dashboard transcript/lifecycle events are appended to `.data/task-events.jsonl`.
- Agent text deltas are broadcast live over SSE and are not written token-by-token; the completed agent message is persisted instead.
- Existing bindings created before the dashboard is installed appear in the task list as `idle`, but their old Codex transcript is not backfilled. New turns are persisted from this version forward.

## API

```text
GET /api/tasks
GET /api/tasks/:threadId/events
GET /api/events                  # Server-Sent Events
```

The dashboard is intentionally read-only in V1. Existing `/send` and `/interrupt` admin APIs remain separate.
