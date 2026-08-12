# Codex Control Plane (local POC)

A local control plane that keeps one durable Codex conversation across a task's implementation and subsequent PR review/fix cycle.

```text
GitHub Issue / new task
        │
        │ POST /tasks (issueNumber)
        ▼
new Codex thread
        │
        ├── local cache: .data/bindings.json
        └── GitHub Issue hidden binding marker
                │
                │ implementation creates PR with `Closes #123`
                ▼
GitHub PR
        │
        │ review / /codex command / POST /send
        ▼
BindingResolver
   1. local PR binding
   2. GitHub PR marker
   3. linked Issue marker (`Closes #123` or branch `issue/123`)
        │
        ▼
resume the SAME Codex thread
        │
        ├── fix + tests + completion comment on PR
        └── Discord notification on turn completion (optional)
```

## Core rule

- **New Issue/task** => create a new Codex thread.
- **Fix/review for an existing PR** => never silently create a new thread. Resolve and resume the original implementation thread.
- GitHub comments are the durable thread registry; `.data/bindings.json` is only a local cache.

The GitHub marker is stored as a hidden HTML comment. It contains the thread ID and relation metadata, but never the absolute local `cwd`.

## Prerequisites

- Codex CLI installed and authenticated
- GitHub CLI (`gh`) installed and authenticated
- Node.js 20+ or Bun
- A local checkout/worktree for each managed repository

```bash
codex --version
gh auth status
```

## Install

```bash
bun install
cp .env.example .env
```

Generate a webhook secret:

```bash
openssl rand -hex 32
```

Minimal example config:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-login
CODEX_ALLOW_NETWORK=true

# Optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`CODEX_ALLOW_NETWORK=true` is required if Codex itself should push branches, create PRs, or post completion comments. The control plane's own GitHub binding registry uses local `gh api` independently.

`REPO_WORKSPACES` and `GH_BIN` are optional advanced overrides. Most local setups do not need them. `REPO_WORKSPACES` is useful only when the local binding cache is gone and the control plane must recover a GitHub thread binding but no longer knows the repository's local checkout path.

Start:

```bash
bun run start
```

Startup logs show whether Discord notifications are enabled:

```text
[bridge] Discord notifications: enabled
```

## Discord completion notifications

Discord notification delivery is owned by the control plane, not by Codex. When a tracked Codex turn emits `turn/completed`, the control plane posts a short notification to Discord. This means Discord delivery does not depend on the task prompt or on Codex remembering to send a message.

### Create the Discord webhook

In Discord:

1. Open the server and channel where you want Codex notifications.
2. Open **Edit Channel** (or channel settings).
3. Go to **Integrations** -> **Webhooks**.
4. Choose **New Webhook**.
5. Give it a name such as `Codex Control Plane` and select the target channel.
6. Choose **Copy Webhook URL**.

Put the copied URL into your local `.env`:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN
```

Treat the webhook URL as a secret. Do not commit it. `.env` is gitignored by this project.

Restart the control plane after changing `.env`:

```bash
bun run start
```

### Test Discord without running Codex

The admin API exposes a local-only test endpoint:

```bash
curl -X POST http://127.0.0.1:8788/notifications/test
```

Expected response:

```json
{"ok":true,"provider":"discord"}
```

The Discord channel should receive:

```text
✅ Codex Control Plane Discord notifications are configured correctly.
```

If `DISCORD_WEBHOOK_URL` is not configured, the endpoint returns an error while normal control-plane operation continues without Discord notifications.

### Completion message format

A tracked turn completion produces a concise message similar to:

```text
✅ Codex completed

danghungtb26/game-farm · PR #269
Thread: 019...
Turn: 019...
https://github.com/danghungtb26/game-farm/pull/269
```

The notifier also reports non-success terminal statuses such as `failed` or `interrupted`. Discord failures are logged as `[discord] notification failed: ...` and never mark the Codex task itself as failed.

Discord messages disable automatic mentions, so task or repository text cannot accidentally trigger `@everyone` or other mentions.

## Start a NEW implementation task

Use the GitHub Issue number as the task identity:

```bash
curl -sS http://127.0.0.1:8788/tasks \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "cwd": "/absolute/path/to/my-repo",
    "message": "Implement issue #245, run the relevant tests, push the branch and open a PR."
  }' | jq
```

The control plane will:

1. create a new Codex thread;
2. persist `issue #245 -> threadId` locally and in a hidden GitHub Issue comment;
3. start the implementation turn;
4. track the turn for Discord completion notification when configured;
5. instruct Codex to create/update a PR whose body includes `Closes #245`;
6. require Codex to post one completion comment on that PR.

If the Issue is already bound, `/tasks` returns `409` instead of accidentally creating a second conversation. `forceNewThread=true` exists only for an intentional replacement.

## Fix/review an EXISTING PR

Manual send:

```bash
curl -sS http://127.0.0.1:8788/send \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269,
    "message": "Fix the review findings and run focused tests."
  }' | jq
```

For a PR fix, the resolver tries:

1. local PR binding;
2. hidden binding marker on the PR;
3. source Issue discovered from `Closes #<issue>` in the PR body;
4. source Issue inferred from branch names such as `issue/245` or `task/245`.

When an Issue binding is found, the PR inherits the same `threadId` and receives its own hidden binding marker. If no original thread can be found, the control plane refuses to create a new fix conversation.

PR review events, `/codex` commands, and `POST /send` turns are also registered with the Discord notifier, so their completion is reported against the PR rather than the original Issue.

## Manual binding

Bind an existing thread to an Issue:

```bash
curl -sS http://127.0.0.1:8788/bindings \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "kind": "issue",
    "number": 245,
    "threadId": "019...",
    "cwd": "/absolute/path/to/my-repo"
  }' | jq
```

Or to a PR:

```bash
curl -sS http://127.0.0.1:8788/bindings \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "kind": "pr",
    "number": 269,
    "sourceIssueNumber": 245,
    "threadId": "019...",
    "cwd": "/absolute/path/to/my-repo"
  }' | jq
```

List local cache:

```bash
curl -sS http://127.0.0.1:8788/bindings | jq
```

Legacy `.data/bindings.json` entries that used `{ prNumber }` are migrated in memory to the new `{ kind: "pr", number }` format when loaded.

## GitHub webhook

Expose only port `8787`:

```bash
cloudflared tunnel --url http://localhost:8787
```

GitHub webhook payload URL:

```text
https://YOUR-TUNNEL.trycloudflare.com/github/webhook
```

Select:

- Issue comments
- Pull request reviews
- Pull request review comments

A PR comment from an allowlisted user can trigger a fix:

```text
/codex fix the review findings, run tests, and keep the change minimal
```

Completion comments written by Codex do not loop back because only comments beginning with `/codex` or `/codex-fix` are treated as commands.

## Completion contract

Every PR-bound turn requires Codex to post exactly one completion comment containing:

- completed/blocked status;
- concise summary;
- files changed;
- tests/checks and results;
- remaining follow-up/blockers.

New Issue implementation turns require the same completion comment after their PR exists.

GitHub completion comments and Discord completion notifications serve different purposes:

- **GitHub** = durable detailed audit/result.
- **Discord** = immediate short notification that the Codex turn ended.

## Security notes

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep repository and sender allowlists narrow.
- Never expose admin port `8788` through the tunnel.
- Treat `DISCORD_WEBHOOK_URL` as a secret because it contains the webhook token.
- Discord notifications disable automatic mentions.
- GitHub binding markers never store local absolute paths.
- Only binding markers authored by the currently authenticated `gh` user are trusted.
- Review/fix flows refuse to invent a new conversation when the original thread cannot be recovered.
