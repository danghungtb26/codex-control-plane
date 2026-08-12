# Docker dashboard / ingress

The core control-plane runtime stays native on the host. This is intentional: Codex CLI, GitHub CLI, git and repository workspaces keep using the host development environment without container mounts or duplicated toolchains.

Docker is only responsible for the public/dashboard edge:

```text
GitHub / browser
      |
      v
cloudflared (Docker)
      |
      v
Caddy + built React dashboard (Docker)
      |
      +-- static dashboard files
      |
      +-- /api/* and admin APIs ----------> native core :8787
      |
      +-- /github/webhook (no Basic Auth) -> native core :8787
```

The core still owns `.data`, Codex, `gh`, git and all repository paths on the host.

## Configure

```bash
cp .env.example .env
```

Configure the native core as usual:

```env
GITHUB_WEBHOOK_SECRET=...
GITHUB_ALLOWED_REPOS=your-org/your-repo
GITHUB_ALLOWED_SENDERS=your-github-login
PORT=8787

CODEX_BIN=codex
# REPO_WORKSPACES=your-org/your-repo=/absolute/path/to/repo
```

Configure the Docker dashboard ingress:

```env
CADDY_AUTH_USERNAME=admin
CADDY_AUTH_PASSWORD=...
CADDY_PORT=8080
CORE_URL=http://host.docker.internal:8787
```

You may set `CADDY_AUTH_PASSWORD_HASH` instead of a plaintext `CADDY_AUTH_PASSWORD`. If only the plaintext value is present, the Caddy container hashes it during startup.

`host.docker.internal` is the Docker Desktop hostname for services running on the host. Compose also adds the `host-gateway` mapping for Docker Engine compatibility. On a native Linux setup, the core must listen on an address reachable from the Docker bridge if loopback-only access is not forwarded by the local Docker setup.

## Run the native core

The core is not started by Compose:

```bash
bun install
bun run start
```

It keeps using the host's:

```text
codex
gh
git
repositories
.data
```

No Codex auth, GitHub auth, repository or `.data` volume is mounted into Docker.

## Run dashboard + ingress

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

The public dashboard is:

```text
https://<random>.trycloudflare.com/
```

It requires Caddy Basic Auth.

The public GitHub webhook is:

```text
https://<random>.trycloudflare.com/github/webhook
```

`/github/webhook` bypasses Caddy Basic Auth so GitHub can deliver machine-to-machine requests. The native core still validates `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`.

Protected backend paths such as `/api/*`, `/tasks`, `/send`, `/interrupt`, `/bindings`, `/notifications/*` and `/health` are reverse-proxied to the native core after Basic Auth.

## Why the dashboard stays in Docker

The dashboard is a static Vite build and has no dependency on the host development toolchain at runtime. Keeping it with Caddy gives Docker a clear boundary:

- build and serve the dashboard
- protect browser/admin traffic with Basic Auth
- expose the public tunnel
- proxy API/webhook traffic to the native core

The execution boundary stays native, where Codex can use the real repository paths and project-specific toolchains without a mega development image.
