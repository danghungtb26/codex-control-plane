# Codex Control Plane

A Bun-native local control plane that keeps one durable Codex conversation from GitHub Issue implementation through PR review/fix turns, with a realtime React dashboard and Discord lifecycle notifications.

## Command protocol

Normal GitHub Issue/PR/review comments do **not** trigger Codex work. Trusted senders must use an explicit command prefix.

```text
/codex:implement     Issue only: implement, test, commit, push, create/update PR
/codex:fix-comment   PR only: fix authorized review feedback, test, commit, push
/codex:summary       Issue/PR: read-only status/report
/codex:create-pr     Issue: retry/recover PR creation for the existing thread
```

Core rules:

- A new Issue implementation gets a durable Codex thread.
- PR fixes resume the original implementation thread rather than creating a new conversation.
- GitHub hidden comments are the durable thread registry; `.data/bindings.json` is the local cache.
- Codex owns the normal GitHub completion report; the control plane only posts a fallback when no valid receipt is returned.
- `CODEX_AUTO_APPROVE=true` means `danger-full-access` with no approval prompts.

## Single HTTP origin

Everything is served from one port:

```text
http://127.0.0.1:8788/
├── /                         React dashboard
├── /api/tasks                task list
├── /api/tasks/:thread/events transcript/history
├── /api/events               realtime SSE
├── /github/webhook           GitHub webhook
├── /tasks                    manual task API
├── /send                     send to existing thread
├── /interrupt                interrupt active turn
├── /bindings                 binding API
└── /notifications/test       Discord test
```

The canonical env is:

```env
PORT=8788
```

For migration compatibility only, when `PORT` is missing the server falls back to `ADMIN_PORT`, then `WEBHOOK_PORT`. Runtime still listens on exactly one port.

## Install

```bash
bun install
cp .env.example .env
```

Minimal `.env`:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-login
PORT=8788

CODEX_BIN=codex
CODEX_AUTO_APPROVE=true
CODEX_ALLOW_NETWORK=false
REVIEW_DEBOUNCE_MS=1200

# Optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`GH_BIN` and `REPO_WORKSPACES` remain optional recovery/advanced overrides.

## Run

Production-style local run:

```bash
bun run typecheck
bun run dashboard:build
bun run start
```

Open only:

```text
http://127.0.0.1:8788/
```

Development is also single-port:

```bash
bun run dev
```

`bun run dev` runs the control plane watcher plus Vite `build --watch`. There is no separate Vite HTTP port; dashboard assets rebuild into `dashboard/dist`, and the control plane continues serving them from `PORT`. Refresh the browser after frontend edits.

## Dashboard

The Vite + React + Tailwind dashboard is read-only in V1 and groups work by durable `threadId`.

It shows:

- Issue → PR mapping
- action and task status
- commit before → after
- task summary
- user messages
- Codex agent messages
- command/tool and file activity
- realtime Codex agent text over SSE
- persisted thread history loaded through Codex App Server

Codex `reasoning` items are intentionally excluded from dashboard persistence and rendering.

Dashboard lifecycle/new-turn events are appended to:

```text
.data/task-events.jsonl
```

## Cloudflare Tunnel: one hostname, one service

Publish a single hostname to the single local origin:

```text
codex.example.com -> http://127.0.0.1:8788
```

The GitHub webhook becomes:

```text
https://codex.example.com/github/webhook
```

No second tunnel or port is required.

## Fast auth with Cloudflare Access

Recommended setup:

1. Create a Cloudflare Access self-hosted application for `codex.example.com/*`.
2. Add an Allow policy for only trusted users. For a personal setup, Cloudflare account membership is the simplest option; email one-time PIN is also easy for a small allowlist.
3. Create a **more-specific** Access application for `codex.example.com/github/webhook` with a **Bypass** policy so GitHub can post webhooks without an interactive login.
4. Keep `GITHUB_WEBHOOK_SECRET` configured. `/github/webhook` always verifies GitHub's `X-Hub-Signature-256` HMAC before accepting the payload.
5. Do not bypass `/`, `/api/*`, `/send`, `/interrupt`, `/tasks`, `/bindings`, or `/notifications/test`.

This keeps the UI and all control/admin APIs behind gateway authentication while exposing only the signed GitHub webhook path to machine traffic.

## Manual APIs

Start an Issue task:

```bash
curl -sS http://127.0.0.1:8788/tasks \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "cwd": "/absolute/path/to/repo",
    "message": "Implement this Issue, run tests, commit, push and create the PR."
  }' | jq
```

Send to an existing Issue thread:

```bash
curl -sS http://127.0.0.1:8788/send \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "message": "Continue this existing Issue conversation."
  }' | jq
```

Interrupt an active turn:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{"repo":"my-org/my-repo","issueNumber":245}' | jq
```

Interrupting stops only the active turn. The durable thread/binding remains resumable.

## Discord notifications

When `DISCORD_WEBHOOK_URL` is configured, tracked work emits:

```text
🚀 started
✅ completed
❌ failed
⚠️ interrupted/cancelled
```

Notifications include target Issue/PR, action, task request, thread/turn IDs, commit transition, summary and GitHub completion-report link when available.

## Security

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep `GITHUB_ALLOWED_REPOS` and `GITHUB_ALLOWED_SENDERS` narrow.
- Keep the origin bound to `127.0.0.1`; publish it through Cloudflare Tunnel rather than exposing the local port directly.
- Put dashboard/admin paths behind Cloudflare Access when publishing the hostname.
- Scope the Access bypass to `/github/webhook` only.
- Treat `DISCORD_WEBHOOK_URL` as a secret.
- `CODEX_AUTO_APPROVE=true` grants Codex unsandboxed local filesystem/command/network access.
