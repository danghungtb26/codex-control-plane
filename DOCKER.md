# Docker deployment

This setup runs the control plane, Codex CLI, GitHub CLI and Caddy inside one `control-plane` container. A second `cloudflared` container creates a dynamic `*.trycloudflare.com` Quick Tunnel.

Caddy protects every route with Basic Auth except the GitHub webhook endpoint:

```text
/github/webhook
```

The webhook still requires a valid `X-Hub-Signature-256` generated from `GITHUB_WEBHOOK_SECRET`.

## Configure

```bash
cp .env.example .env
```

At minimum, set:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=your-org/your-repo
GITHUB_ALLOWED_SENDERS=your-github-login

CADDY_AUTH_USERNAME=admin
CADDY_AUTH_PASSWORD=...

WORKSPACES_DIR=/absolute/path/to/workspaces
REPO_WORKSPACES=your-org/your-repo=/absolute/path/to/workspaces/your-repo
```

`WORKSPACES_DIR` is mounted at the same absolute path inside the container. This keeps persisted binding `cwd` values valid across native and Docker runs.

The compose file also mounts the host Codex and GitHub CLI auth directories:

```text
~/.codex      -> /root/.codex
~/.config/gh  -> /root/.config/gh
```

## Run

```bash
docker compose up -d --build
```

Local Caddy endpoint:

```text
http://127.0.0.1:8080
```

Get the dynamic TryCloudflare URL:

```bash
docker compose logs -f cloudflared
```

The public webhook URL is:

```text
https://<random>.trycloudflare.com/github/webhook
```

The dashboard uses the same public hostname and requires the configured Caddy Basic Auth credentials.

Application data is persisted on the host through:

```text
./.data -> /app/.data
```

## Quick Tunnel limitation

Cloudflare Quick Tunnels are intended for testing/development and do not support Server-Sent Events (SSE). The dashboard itself and GitHub webhook work through the random TryCloudflare URL, but realtime `/api/events` updates will not stream through that URL.

For realtime dashboard updates over the public hostname, switch the `cloudflared` service to a named Cloudflare Tunnel. The Caddy and control-plane containers do not otherwise need to change.
