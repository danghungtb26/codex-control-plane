# Codex Control Plane (local POC)

A Bun-native local control plane that keeps one durable Codex conversation across implementation and later PR review/fix turns.

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
- **Bun is the only JavaScript runtime/package manager used by this project.** TypeScript runs directly in Bun; `tsx` and a separate Node.js runtime are not required.

## Prerequisites

Install and authenticate:

- Bun
- Codex CLI
- GitHub CLI (`gh`)
- a local checkout/worktree for each managed repository

Check:

```bash
bun --version
codex --version
gh auth status
```

## Install

```bash
bun install
cp .env.example .env
```

Bun automatically loads `.env`.

Minimal `.env`:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-login
WEBHOOK_PORT=8787
ADMIN_PORT=8788
CODEX_BIN=codex
CODEX_AUTO_APPROVE=true
CODEX_ALLOW_NETWORK=false
REVIEW_DEBOUNCE_MS=1200
FORWARD_INLINE_REVIEW_COMMENTS=true

# Optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Codex access mode

`CODEX_AUTO_APPROVE=true` means **full access**:

```text
approvalPolicy = never
thread sandbox = danger-full-access
turn sandboxPolicy = dangerFullAccess
```

In this mode Codex can create/switch branches, commit, modify `.git`, write outside the workspace, execute commands, and access the network without approval prompts. `CODEX_ALLOW_NETWORK` is ignored in this mode.

Use full access only with narrow `GITHUB_ALLOWED_REPOS` and `GITHUB_ALLOWED_SENDERS` values because a trusted GitHub command can trigger local code execution.

Set:

```env
CODEX_AUTO_APPROVE=false
```

to restore the restricted mode:

```text
approvalPolicy = never
sandbox = workspace-write
```

In restricted mode, `CODEX_ALLOW_NETWORK` controls network access and approval requests are declined.

`GH_BIN` and `REPO_WORKSPACES` are optional advanced/recovery overrides.

## Run

```bash
bun run typecheck
bun run dev
# or
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

You can also start work directly from a normal GitHub Issue comment:

```text
/codex Start working on this issue. Implement the requirements and acceptance criteria described in the issue, run the focused tests and full test suite, and report back with the resulting PR/commit and any important notes.
```

The first Issue command creates a durable thread. Later `/codex` commands on the same Issue resume that thread.

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

## Interrupt an active turn

`POST /interrupt` stops only the currently active turn. It does **not** delete the durable Codex thread or its GitHub/local binding, so the same conversation can be resumed later with another `/send` or `/codex` command.

Interrupt by PR:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269
  }' | jq
```

Interrupt by Issue:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245
  }' | jq
```

Or interrupt the exact conversation directly:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{
    "threadId": "019..."
  }' | jq
```

When a turn is active, the response is:

```json
{
  "threadId": "019...",
  "turnId": "019...",
  "interrupted": true
}
```

If the thread exists but is already idle:

```json
{
  "threadId": "019...",
  "turnId": null,
  "interrupted": false
}
```

Interrupted/cancelled turns may still produce a Discord terminal-status notification, but the control plane does not create a fallback GitHub completion report for a user-requested interruption.

## GitHub completion report contract

Every PR-bound turn requires Codex to post exactly one completion comment with completed/blocked status, summary, files changed, tests/checks and results, and remaining follow-up/blockers.

After posting, the final Codex reply must include the real GitHub receipt:

```text
GITHUB_REPORT_COMMENT_ID=123456789
GITHUB_REPORT_COMMENT_URL=https://github.com/my-org/my-repo/pull/269#issuecomment-123456789
```

The control plane validates the receipt. If no valid receipt can be resolved, it posts a fallback completion report using the final Codex result.

## Discord notifications

Discord is optional and is sent by the control plane, not by Codex.

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN
```

Test:

```bash
curl -X POST http://127.0.0.1:8788/notifications/test
```

Completion notifications include repo, Issue/PR, thread, turn, GitHub report comment id/link, and whether the report came from Codex or the fallback reporter.

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

## Manual binding

List local bindings:

```bash
curl -sS http://127.0.0.1:8788/bindings | jq
```

## Security notes

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep repository and sender allowlists narrow.
- Never expose admin port `8788`.
- Treat `DISCORD_WEBHOOK_URL` as a secret.
- `CODEX_AUTO_APPROVE=true` grants Codex unsandboxed local command/filesystem/network access.
- GitHub binding markers never store local absolute paths.
- Only binding markers authored by the authenticated `gh` user are trusted.
- Review/fix flows never invent a new conversation when the original thread cannot be recovered.
