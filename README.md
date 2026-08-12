# Codex Control Plane (local POC)

A local control plane that keeps one durable Codex conversation across implementation and later PR review/fix turns.

```text
new Issue/task
  -> new Codex thread
  -> persist issue -> threadId
  -> Codex implements and opens PR
  -> PR inherits the same thread
  -> review/fix resumes that thread
  -> Codex posts completion report
  -> control-plane validates report receipt
       -> receipt exists: use Codex report
       -> no receipt: post fallback report
  -> Discord notification includes GitHub report comment id/link
```

## Core rules

- **New Issue/task** creates a new Codex thread.
- **Existing PR fix/review** must resume the original thread; the control plane refuses to silently create a new fix conversation.
- GitHub hidden comments are the durable thread registry; `.data/bindings.json` is the local cache.
- **Codex owns the normal completion report.** The control plane only posts a fallback when Codex returns no valid GitHub report receipt.

## Prerequisites

```bash
codex --version
gh auth status
```

You need Codex CLI, authenticated GitHub CLI, Node.js 20+ or Bun, and a local checkout/worktree.

## Install

```bash
bun install
cp .env.example .env
```

Generate the GitHub webhook secret:

```bash
openssl rand -hex 32
```

Minimal `.env`:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-login
WEBHOOK_PORT=8787
ADMIN_PORT=8788
CODEX_BIN=codex
CODEX_ALLOW_NETWORK=true
REVIEW_DEBOUNCE_MS=1200
FORWARD_INLINE_REVIEW_COMMENTS=true

# Optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`GH_BIN` and `REPO_WORKSPACES` are optional advanced/recovery overrides and are not required for the normal local flow.

`CODEX_ALLOW_NETWORK=true` is required when Codex itself must push, create/update PRs, or post its GitHub completion report. The control plane's binding registry and fallback reporter use local authenticated `gh api` independently.

Start:

```bash
bun run start
```

## Start a new implementation task

Use the GitHub Issue as task identity:

```bash
curl -sS http://127.0.0.1:8788/tasks \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "cwd": "/absolute/path/to/my-repo",
    "message": "Implement issue #245, run tests, push the branch and open a PR."
  }' | jq
```

The control plane creates a new thread and persists the Issue binding. Codex is instructed to create/update a PR containing `Closes #245`, allowing that PR to inherit the same thread later.

Calling `/tasks` again for an already-bound Issue returns `409` unless `forceNewThread=true` is intentionally supplied.

## Fix/review an existing PR

```bash
curl -sS http://127.0.0.1:8788/send \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269,
    "message": "Fix the review findings and run focused tests."
  }' | jq
```

PR resolution order:

1. local PR binding;
2. hidden binding marker on the PR;
3. source Issue from `Closes #<issue>`;
4. source Issue inferred from branch names such as `issue/245` or `task/245`.

If the original thread cannot be recovered, no new fix thread is created.

## GitHub completion report contract

Every PR-bound turn requires Codex to post exactly one completion comment with:

- completed/blocked status;
- concise summary;
- files changed;
- tests/checks and results;
- remaining follow-up/blockers.

After posting, the **final Codex reply** must include the real GitHub receipt:

```text
GITHUB_REPORT_COMMENT_ID=123456789
GITHUB_REPORT_COMMENT_URL=https://github.com/my-org/my-repo/pull/269#issuecomment-123456789
```

Codex must obtain these values from GitHub and must never invent them.

The control plane accepts either ID or URL:

- if an ID is present, it calls `gh api repos/<repo>/issues/comments/<id>` and resolves the authoritative `html_url`;
- if only a URL is present, it extracts the comment ID when possible and verifies it through GitHub;
- if no valid receipt can be resolved, the fallback reporter runs.

### Fallback behavior

On `turn/completed`, the control plane captures the final Codex agent reply.

**Receipt found:**

```text
Codex report -> keep it
control-plane -> no duplicate comment
Discord -> Codex report comment id/link
```

**Receipt missing/invalid:**

```text
control-plane -> post fallback completion report
GitHub API -> returns real comment id + html_url
Discord -> fallback report comment id/link
```

The fallback body includes the Codex final result, turn status, thread ID and turn ID. For PR turns it is posted to the PR conversation. For an Issue implementation turn that never produced a PR receipt, it is posted to the Issue so the result is still durable on GitHub.

Completion comments do not loop into Codex because only comments starting with `/codex` or `/codex-fix` are treated as commands.

## Discord notifications

Discord is optional and is sent by the **control plane**, not by Codex.

Add:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN
```

Treat the URL as a secret.

### Get the webhook URL

In Discord:

1. Open the target channel settings.
2. **Integrations -> Webhooks**.
3. Create **New Webhook**.
4. Select the channel and **Copy Webhook URL**.
5. Put it in `.env` and restart the control plane.

### Test Discord

```bash
curl -X POST http://127.0.0.1:8788/notifications/test
```

Expected:

```json
{"ok":true,"provider":"discord"}
```

### Completion notification

Example when Codex reported successfully:

```text
✅ Codex completed
my-org/my-repo · PR #269
Thread: 019...
Turn: 019...
GitHub report comment: 123456789
Report: https://github.com/my-org/my-repo/pull/269#issuecomment-123456789
Report source: Codex
```

If the control plane had to create the report:

```text
Report source: control-plane fallback
```

Discord failures are logged but do not fail the Codex task. Automatic mentions are disabled.

## GitHub webhook

Expose only port `8787`:

```bash
cloudflared tunnel --url http://localhost:8787
```

Payload URL:

```text
https://YOUR-TUNNEL.trycloudflare.com/github/webhook
```

Subscribe to:

- Issue comments
- Pull request reviews
- Pull request review comments

Example command on a PR:

```text
/codex fix the review findings, run tests, and keep the change minimal
```

## Manual binding

List local bindings:

```bash
curl -sS http://127.0.0.1:8788/bindings | jq
```

Bind an existing thread:

```bash
curl -sS http://127.0.0.1:8788/bindings \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "kind": "pr",
    "number": 269,
    "threadId": "019...",
    "cwd": "/absolute/path/to/my-repo"
  }' | jq
```

## Security notes

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep repository and sender allowlists narrow.
- Never expose admin port `8788`.
- Treat `DISCORD_WEBHOOK_URL` as a secret.
- GitHub binding markers never store local absolute paths.
- Only binding markers authored by the authenticated `gh` user are trusted.
- Review/fix flows never invent a new conversation when the original thread cannot be recovered.
