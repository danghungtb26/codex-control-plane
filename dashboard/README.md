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
- Dashboard lifecycle/new-turn transcript events are appended to `.data/task-events.jsonl`.
- When a task is opened, the control plane also asks Codex App Server for persisted thread history with `thread/read(includeTurns: true)` and merges it with dashboard-local events.
- Historical user messages, agent messages, commands and file/tool activity can therefore be shown for threads that existed before the dashboard was installed.
- Codex `reasoning` items are deliberately excluded from dashboard history and realtime persistence.
- If persisted Codex history is unavailable (for example an unsupported paginated/unmaterialized thread or a history-read timeout), the dashboard falls back to the locally persisted events instead of failing the task view.
- Agent text deltas are broadcast live over SSE and are not written token-by-token; the completed agent message is persisted instead.

## API

```text
GET /api/tasks
GET /api/tasks/:threadId/events
GET /api/events                  # Server-Sent Events
```

The dashboard is intentionally read-only in V1. Existing `/send` and `/interrupt` admin APIs remain separate.
