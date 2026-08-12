import type { BindingKind, CodexAction } from "./types.js";

export type DiscordNotificationTarget = {
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  action: CodexAction;
  request?: string;
};

type DiscordCompletionInput = DiscordNotificationTarget & {
  turnId: string;
  status: string;
  summary?: string;
  commitBefore?: string;
  commitAfter?: string;
  reportCommentId?: string;
  reportCommentUrl?: string;
  reportFallback?: boolean;
};

const iconFor = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "completed") return "✅";
  if (normalized === "failed") return "❌";
  if (normalized === "interrupted" || normalized === "cancelled") return "⚠️";
  return "ℹ️";
};

const compact = (value: string | undefined, maxLength: number) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
};

const shortSha = (value: string | undefined) => (value ? value.slice(0, 12) : "unknown");

export class DiscordNotifier {
  constructor(private readonly webhookUrl?: string) {}

  get enabled() {
    return Boolean(this.webhookUrl);
  }

  async sendCompletion(input: DiscordCompletionInput) {
    if (!this.webhookUrl) return false;

    const label = input.kind === "pr" ? `PR #${input.number}` : `Issue #${input.number}`;
    const githubUrl = `https://github.com/${input.repo}/${input.kind === "pr" ? "pull" : "issues"}/${input.number}`;
    const before = shortSha(input.commitBefore);
    const after = shortSha(input.commitAfter);
    const commitLine = before === after ? `Commit: \`${after}\` (unchanged)` : `Commit: \`${before}\` → \`${after}\``;
    const reportLines = [
      input.reportCommentId ? `GitHub report comment: \`${input.reportCommentId}\`` : "",
      input.reportCommentUrl ? `Report: ${input.reportCommentUrl}` : "",
      input.reportCommentId || input.reportCommentUrl
        ? input.reportFallback
          ? "Report source: control-plane fallback"
          : "Report source: Codex"
        : "",
    ].filter(Boolean);
    const content = [
      `${iconFor(input.status)} **Codex ${input.status}**`,
      `**${input.repo} · ${label}**`,
      `Action: \`${input.action}\``,
      input.request ? `Task: ${compact(input.request, 320)}` : "",
      commitLine,
      input.summary ? `Summary: ${compact(input.summary, 600)}` : "",
      `Thread: \`${input.threadId}\``,
      `Turn: \`${input.turnId}\``,
      ...reportLines,
      githubUrl,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Discord webhook failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
      );
    }

    return true;
  }

  async sendTest() {
    if (!this.webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not configured");

    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "✅ **Codex Control Plane** Discord notifications are configured correctly.",
        allowed_mentions: { parse: [] },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Discord webhook failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
      );
    }
  }
}
