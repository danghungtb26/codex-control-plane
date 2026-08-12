const splitCsv = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

const readRepoWorkspaces = (value: string | undefined) => {
  const result = new Map<string, string>();
  for (const entry of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`Invalid REPO_WORKSPACES entry: ${entry}`);
    }
    result.set(
      entry.slice(0, separator).trim().toLowerCase(),
      entry.slice(separator + 1).trim(),
    );
  }
  return result;
};

const readInt = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer`);
  return value;
};

const readBool = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

export const loadConfig = () => {
  const allowedRepos = splitCsv(required("GITHUB_ALLOWED_REPOS"));
  const allowedSenders = splitCsv(required("GITHUB_ALLOWED_SENDERS"));

  return {
    githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
    allowedRepos,
    allowedSenders,
    repoWorkspaces: readRepoWorkspaces(process.env.REPO_WORKSPACES),
    webhookPort: readInt("WEBHOOK_PORT", 8787),
    adminPort: readInt("ADMIN_PORT", 8788),
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
    ghBin: process.env.GH_BIN?.trim() || "gh",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || undefined,
    codexAllowNetwork: readBool("CODEX_ALLOW_NETWORK", false),
    codexAutoApprove: readBool("CODEX_AUTO_APPROVE", true),
    reviewDebounceMs: readInt("REVIEW_DEBOUNCE_MS", 1200),
    forwardInlineReviewComments: readBool("FORWARD_INLINE_REVIEW_COMMENTS", true),
  };
};

export type Config = ReturnType<typeof loadConfig>;
