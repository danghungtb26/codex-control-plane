# Codex Control Plane (local POC)

Flow:

```text
ChatGPT / trusted GitHub reviewer
        │ review / inline comment / /codex command
        ▼
GitHub webhook
        │ HTTPS tunnel
        ▼
localhost:8787/github/webhook
        │ HMAC + allowlists
        ▼
PR -> Codex thread binding
        │
        ▼
Codex App Server (local)
   active turn -> turn/steer
   idle thread -> turn/start
        │
        ▼
local repo/worktree
```

## 1. Prerequisites

- Node.js 20+
- Codex CLI installed and authenticated
- A local clone/worktree for the PR

Check:

```bash
codex --version
codex app-server --help
```

## 2. Install

```bash
npm install
cp .env.example .env
```

Generate a webhook secret, for example:

```bash
openssl rand -hex 32
```

Put it in `.env` as `GITHUB_WEBHOOK_SECRET`.

Set narrow allowlists:

```env
GITHUB_ALLOWED_REPOS=my-org/my-repo
GITHUB_ALLOWED_SENDERS=my-github-login
```

Start:

```bash
npm run start
```

You should see:

```text
GitHub webhook: http://127.0.0.1:8787/github/webhook
local admin API: http://127.0.0.1:8788
```

## 3. Create or bind a Codex thread to a PR

### Option A — let the bridge create the Codex thread

```bash
curl -sS http://127.0.0.1:8788/tasks \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269,
    "cwd": "/absolute/path/to/repo-or-worktree",
    "message": "Inspect the current branch for PR #269. Understand the change and run the relevant tests. Do not merge."
  }' | jq
```

The response includes `threadId` and the binding is persisted in `.data/bindings.json`.

### Option B — bind an existing durable Codex App Server thread

```bash
curl -sS http://127.0.0.1:8788/bindings \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269,
    "threadId": "thr_...",
    "cwd": "/absolute/path/to/repo-or-worktree"
  }' | jq
```

Note: this resumes a durable Codex thread. It does not attach to an unrelated live terminal process that owns a separate in-flight session.

List bindings:

```bash
curl -sS http://127.0.0.1:8788/bindings | jq
```

Manual local test:

```bash
curl -sS http://127.0.0.1:8788/send \
  -H 'content-type: application/json' \
  -d '{
    "repo": "my-org/my-repo",
    "prNumber": 269,
    "message": "Check git status and tell me what remains."
  }' | jq
```

## 4. Expose ONLY the webhook port from localhost

### Cloudflare Quick Tunnel (no account required for quick testing)

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints a temporary URL similar to:

```text
https://random-words.trycloudflare.com
```

Your GitHub Payload URL becomes:

```text
https://random-words.trycloudflare.com/github/webhook
```

Do **not** expose port 8788.

### Or ngrok

```bash
ngrok http 8787
```

Use the generated HTTPS URL plus `/github/webhook`.

## 5. Configure the GitHub repository webhook

Repo -> Settings -> Webhooks -> Add webhook:

- Payload URL: `https://YOUR-TUNNEL/github/webhook`
- Content type: `application/json`
- Secret: exactly the same value as `GITHUB_WEBHOOK_SECRET`
- Let me select individual events:
  - Pull request reviews
  - Pull request review comments
  - Issue comments
- Active: enabled

GitHub sends a `ping` event after creation; the bridge should log `ping received`.

## 6. Trigger Codex from GitHub

### Manual command in a PR conversation

From an allowed GitHub user:

```text
/codex fix the review findings, run tests, and keep the change minimal
```

or:

```text
/codex-fix fix the null handling noted above and add a regression test
```

### Review events

A `pull_request_review` with state `changes_requested` or `commented` is forwarded automatically when the sender is allowlisted.

Inline review comments are forwarded too when:

```env
FORWARD_INLINE_REVIEW_COMMENTS=true
```

Events for one PR are debounced and bundled before sending to Codex. If the Codex thread still has an active regular turn, the bridge uses `turn/steer`; otherwise it starts a new turn.

## 7. Let Codex push updates (optional)

Default:

```env
CODEX_ALLOW_NETWORK=false
```

This is safer for the first test. The workspace can be changed, but network access is disabled by the bridge's sandbox policy.

To allow `git push`, `gh`, package registry access, etc.:

```env
CODEX_ALLOW_NETWORK=true
```

Restart the bridge after editing `.env`.

This still uses `workspaceWrite`, not unrestricted filesystem access. Your local Git/GitHub credentials must already work in the environment where `codex app-server` runs.

## 8. Suggested end-to-end test

1. Start the bridge.
2. Bind PR #269 to a Codex thread via `/tasks`.
3. Start Cloudflare tunnel or ngrok.
4. Add the GitHub webhook and confirm the ping succeeds.
5. Add this PR comment from an allowlisted account:

```text
/codex create a file named bridge-smoke-test.txt containing "webhook reached codex". Do not commit or push.
```

6. Watch the bridge terminal. You should see the GitHub event accepted and then a Codex `turn/start` or `turn/steer`.
7. Confirm the file appears in the bound worktree.

## Security notes

- Never run this without `GITHUB_WEBHOOK_SECRET` validation.
- Keep `GITHUB_ALLOWED_REPOS` and `GITHUB_ALLOWED_SENDERS` narrow.
- Only tunnel port 8787. Admin port 8788 is local-only.
- Keep network disabled until the local edit loop works.
- Do not point `cwd` at a directory containing unrelated sensitive data.
- The bridge declines unexpected Codex approval/elevation requests rather than granting them automatically.
