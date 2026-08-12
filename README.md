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

## Production HTTP origin

The production runtime serves everything from one port:

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

Open:

```text
http://127.0.0.1:8788/
```

## Development

Keep the normal Vite development server for HMR.

Terminal 1 — control plane:

```bash
bun run dev
```

```text
http://127.0.0.1:8788
```

Terminal 2 — dashboard:

```bash
bun run dashboard:dev
```

```text
http://127.0.0.1:5173
```

Vite proxies `/api/*` to `http://127.0.0.1:8788`, including the SSE endpoint. Production remains single-origin; the second port exists only during local frontend development.

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

## Cloudflare Tunnel

A public deployment can use one hostname and one origin service:

```text
codex.example.com -> http://127.0.0.1:8788
```

The GitHub webhook becomes:

```text
https://codex.example.com/github/webhook
```

No second production tunnel or port is required.

## Cloudflare Access / gateway auth

Cloudflare Access is optional and is not configured by this application. Cloudflare currently offers a Free Zero Trust plan for teams under 50 users, so Access itself does not require a paid plan for a small personal deployment.

This project does not recommend or require an Access Bypass policy for `/github/webhook`.

Important deployment constraint: if Access is placed in front of the **entire** `codex.example.com` hostname, GitHub webhook requests are also subject to Access authentication and normally cannot reach `/github/webhook`. Choose the final gateway/auth ingress layout before enabling hostname-wide Access.

Regardless of gateway choice, `GITHUB_WEBHOOK_SECRET` remains required and `/github/webhook` verifies GitHub's `X-Hub-Signature-256` HMAC before accepting a payload.

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
- Do not put hostname-wide gateway authentication in front of `/github/webhook` unless the gateway design explicitly supports GitHub's machine-to-machine webhook delivery.
- Treat `DISCORD_WEBHOOK_URL` as a secret.
- `CODEX_AUTO_APPROVE=true` grants Codex unsandboxed local filesystem/command/network access.
