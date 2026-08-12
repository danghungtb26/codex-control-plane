# Codex Control Plane (local POC)

A Bun-native local control plane that keeps one durable Codex conversation from GitHub Issue implementation through PR review/fix turns.

```text
Issue /codex:implement
  -> create/resume Issue thread
  -> implement + test
  -> commit + push
  -> create/update PR with Closes #issue
  -> PR inherits same thread

PR comments/reviews
  -> ignored by default
  -> only explicit /codex:* commands execute

PR /codex:fix-comment
  -> resume implementation thread
  -> fix requested feedback + test
  -> commit + push existing PR branch

Issue/PR /codex:summary
  -> reporting only, no code changes
```

## Command protocol

Normal GitHub Issue/PR/review comments do **not** trigger Codex work. A trusted sender must use one of these exact prefixes:

### `/codex:implement`

Valid on a GitHub Issue.

```text
/codex:implement Start working on this issue. Implement the requirements and acceptance criteria, run focused tests and the broader suite, and report important notes.
```

Behavior:

1. create a durable Issue thread on first use, or resume it on later use;
2. inspect the Issue and working tree;
3. create/use the Issue branch;
4. implement and test;
5. create a real commit for task-related changes;
6. push the branch;
7. create/update exactly one PR whose body contains `Closes #<issue>`;
8. post the completion report on the PR.

### `/codex:fix-comment`

Valid only on a PR conversation/review/inline review comment.

```text
/codex:fix-comment Fix this review finding and run the relevant tests.
```

A normal review or inline comment without this prefix is ignored. If the command is standalone and contains no finding text, Codex inspects the PR's current review comments/threads and fixes the actionable feedback authorized by that command.

Behavior:

1. resolve the PR back to its original implementation thread;
2. inspect the referenced/current review feedback;
3. apply only the relevant fix;
4. run relevant tests/checks;
5. if files changed, create a real commit;
6. push the existing PR branch;
7. post the completion report on the PR.

No empty commit is created when no code change is needed.

### `/codex:summary`

Valid on an Issue or PR.

```text
/codex:summary Summarize current status, commits, tests, blockers, and remaining work.
```

This is reporting-only: Codex must not modify implementation files, create commits, push, create a PR, or merge.

### `/codex:create-pr`

Valid on an Issue with an existing durable thread.

```text
/codex:create-pr Create or recover the PR for the implementation already completed in this Issue thread.
```

`/codex:implement` already creates the PR automatically. `create-pr` exists as a recovery/retry action when implementation is done but push/PR creation previously failed or the PR needs to be recreated/updated.

## Core rules

- New Issue implementation work starts a new durable Codex thread.
- PR fix/review work must resume the original implementation thread; the control plane refuses to silently invent a new fix conversation.
- GitHub hidden comments are the durable thread registry; `.data/bindings.json` is the local cache.
- GitHub review events are command-gated; review submissions and inline comments without a supported `/codex:*` prefix are ignored.
- Codex owns the normal GitHub completion report; the control plane only posts a fallback when no valid receipt is returned.
- Bun is the only JavaScript runtime/package manager used by this project.

## Prerequisites

```bash
bun --version
codex --version
gh auth status
```

A local checkout/worktree is required for each managed repository.

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

# Optional
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

`GH_BIN` and `REPO_WORKSPACES` remain optional advanced/recovery overrides.

## Codex access mode

`CODEX_AUTO_APPROVE=true` means full access:

```text
approvalPolicy = never
thread sandbox = danger-full-access
turn sandboxPolicy = dangerFullAccess
```

In this mode Codex can mutate `.git`, create/switch branches, commit, push, execute commands, write outside the workspace, and access the network without approval prompts. `CODEX_ALLOW_NETWORK` is ignored.

Set `CODEX_AUTO_APPROVE=false` to use `workspace-write` with deny-all approvals. In that restricted mode, `CODEX_ALLOW_NETWORK` controls network access.

Keep `GITHUB_ALLOWED_REPOS` and `GITHUB_ALLOWED_SENDERS` narrow when full access is enabled.

## Run

```bash
bun run typecheck
bun run start
```

Development:

```bash
bun run dev
```

## Local admin API

### Start a task manually

```bash
curl -sS http://127.0.0.1:8788/tasks \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "cwd": "/absolute/path/to/my-repo",
    "message": "Implement this Issue, run tests, commit, push and create the PR."
  }' | jq
```

### Send to an existing Issue/PR thread

Supply exactly one of `issueNumber` or `prNumber`.

```bash
curl -sS http://127.0.0.1:8788/send \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "issueNumber": 245,
    "message": "Continue this existing Issue conversation."
  }' | jq
```

`/send` is a trusted local manual escape hatch and is reported to Discord as action `manual`; GitHub webhook work remains command-gated by `/codex:*`.

### Interrupt an active turn

By Issue:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{"repo":"my-org/my-repo","issueNumber":245}' | jq
```

By PR:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{"repo":"my-org/my-repo","prNumber":269}' | jq
```

By exact thread:

```bash
curl -sS http://127.0.0.1:8788/interrupt \
  -H 'content-type: application/json' \
  -d '{"threadId":"019..."}' | jq
```

Interrupting stops only the active turn. The durable thread/binding remains and can be resumed later. Interrupted/cancelled turns do not create a fallback GitHub completion report.

## GitHub completion report contract

Codex final replies use:

```text
GITHUB_REPORT_COMMENT_ID=123456789
GITHUB_REPORT_COMMENT_URL=https://github.com/my-org/my-repo/pull/269#issuecomment-123456789
CODEX_TASK_SUMMARY=Fixed the requested validation path, added focused coverage, committed and pushed the PR branch.
```

The control plane validates the GitHub comment receipt. If a non-interrupted turn returns no valid receipt, it posts a fallback report.

## Discord notifications

When `DISCORD_WEBHOOK_URL` is configured, every tracked Codex turn from GitHub commands, `/tasks`, or `/send` has lifecycle notifications.

At task start:

```text
🚀 Codex task started
my-org/my-repo · PR #269
Action: fix-comment
Task: Fix this review finding and run the relevant tests.
Commit before: abc123def456
Thread: 019...
```

On normal completion or terminal failure/interruption:

```text
✅ Codex completed
my-org/my-repo · PR #269
Action: fix-comment
Task: Fix this review finding and run the relevant tests.
Commit: abc123def456 → 789abc012def
Summary: Fixed the validation path, added coverage, committed and pushed the PR branch.
Thread: 019...
Turn: 019...
GitHub report comment: 123456789
Report: https://github.com/...
```

A Codex turn ending with status `failed` uses the same terminal notification with a ❌ status. If `turn/start`, `turn/steer`, or the initial send throws before a tracked turn can reach terminal completion, the control plane sends a separate failure notification:

```text
❌ Codex task failed before completion
my-org/my-repo · PR #269
Action: fix-comment
Task: Fix this review finding.
Error: <actual error>
Commit: abc123def456
Thread: 019...
```

The control plane snapshots `git rev-parse HEAD` before starting the Codex turn and reads it again after completion, so Discord shows the actual commit transition. If the action does not create a commit, it shows the commit as unchanged. Summary prefers the `CODEX_TASK_SUMMARY` returned by Codex and falls back to its final response/task context.

Discord notification errors are logged but do not cause the Codex task itself to fail.

Test Discord connectivity:

```bash
curl -X POST http://127.0.0.1:8788/notifications/test
```

## GitHub webhook

Expose only port `8787`:

```bash
cloudflared tunnel --url http://localhost:8787
```

Subscribe to:

- Issue comments
- Pull request reviews
- Pull request review comments

Only supported `/codex:*` commands from allowlisted senders/repositories enter the dispatcher.

## Security notes

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep repository and sender allowlists narrow.
- Never expose admin port `8788`.
- Treat `DISCORD_WEBHOOK_URL` as a secret.
- `CODEX_AUTO_APPROVE=true` grants Codex unsandboxed local command/filesystem/network access.
- GitHub binding markers never store local absolute paths.
- Only binding markers authored by the authenticated `gh` user are trusted.
- Normal PR comments/reviews never trigger fixes without an explicit supported command prefix.
