const splitCsv = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );

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
    webhookPort: readInt("WEBHOOK_PORT", 8787),
    adminPort: readInt("ADMIN_PORT", 8788),
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
    codexAllowNetwork: readBool("CODEX_ALLOW_NETWORK", false),
    reviewDebounceMs: readInt("REVIEW_DEBOUNCE_MS", 1200),
    forwardInlineReviewComments: readBool("FORWARD_INLINE_REVIEW_COMMENTS", true),
  };
};

export type Config = ReturnType<typeof loadConfig>;
