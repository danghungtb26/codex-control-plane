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
        ▼
fix + tests + completion comment on PR
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

Example config:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-login
REPO_WORKSPACES=my-org/my-repo=/absolute/path/to/my-repo
CODEX_ALLOW_NETWORK=true
```

`REPO_WORKSPACES` is only needed when the local `.data/bindings.json` cache is missing and the control plane must recover a thread from GitHub. It maps a repository to the checkout/worktree that Codex should resume in.

`CODEX_ALLOW_NETWORK=true` is required if Codex itself should push branches, create PRs, or post completion comments. The control plane's own GitHub binding registry uses local `gh api` independently.

Start:

```bash
bun run start
```

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
4. instruct Codex to create/update a PR whose body includes `Closes #245`;
5. require Codex to post one completion comment on that PR.

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

## Security notes

- Always validate `GITHUB_WEBHOOK_SECRET`.
- Keep repository and sender allowlists narrow.
- Never expose admin port `8788` through the tunnel.
- GitHub binding markers never store local absolute paths.
- Only binding markers authored by the currently authenticated `gh` user are trusted.
- Review/fix flows refuse to invent a new conversation when the original thread cannot be recovered.
