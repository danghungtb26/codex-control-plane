import type { BindingKind, CodexAction } from "./types.js";

export type DiscordNotificationTarget = {
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  action: CodexAction;
  request?: string;
};

type DiscordStartedInput = DiscordNotificationTarget & {
  commitBefore?: string;
};

type DiscordFailureInput = DiscordNotificationTarget & {
  error: string;
  commitBefore?: string;
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
  prNumber?: number;
  prUrl?: string;
};

type DiscordPullRequestCreatedInput = {
  repo: string;
  prNumber: number;
  prUrl: string;
  threadId: string;
  sourceIssueNumber?: number;
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

const targetDetails = (input: DiscordNotificationTarget) => {
  const label = input.kind === "pr" ? `PR #${input.number}` : `Issue #${input.number}`;
  const githubUrl = `https://github.com/${input.repo}/${input.kind === "pr" ? "pull" : "issues"}/${input.number}`;
  return { label, githubUrl };
};

export class DiscordNotifier {
  constructor(private readonly webhookUrl?: string) {}

  get enabled() {
    return Boolean(this.webhookUrl);
  }

  private async post(content: string) {
    if (!this.webhookUrl) return false;

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

  async sendStarted(input: DiscordStartedInput) {
    if (!this.webhookUrl) return false;

    const { label, githubUrl } = targetDetails(input);
    const content = [
      "🚀 **Codex task started**",
      `**${input.repo} · ${label}**`,
      `Action: \`${input.action}\``,
      input.request ? `Task: ${compact(input.request, 500)}` : "",
      `Commit before: \`${shortSha(input.commitBefore)}\``,
      `Thread: \`${input.threadId}\``,
      githubUrl,
    ]
      .filter(Boolean)
      .join("\n");

    return this.post(content);
  }

  async sendFailure(input: DiscordFailureInput) {
    if (!this.webhookUrl) return false;

    const { label, githubUrl } = targetDetails(input);
    const content = [
      "❌ **Codex task failed before completion**",
      `**${input.repo} · ${label}**`,
      `Action: \`${input.action}\``,
      input.request ? `Task: ${compact(input.request, 400)}` : "",
      `Error: ${compact(input.error, 700)}`,
      `Commit: \`${shortSha(input.commitBefore)}\``,
      `Thread: \`${input.threadId}\``,
      githubUrl,
    ]
      .filter(Boolean)
      .join("\n");

    return this.post(content);
  }

  async sendPullRequestCreated(input: DiscordPullRequestCreatedInput) {
    if (!this.webhookUrl) return false;

    const content = [
      "🔀 **Codex pull request created**",
      `**${input.repo} · PR #${input.prNumber}**`,
      input.sourceIssueNumber ? `Source: Issue #${input.sourceIssueNumber}` : "",
      `Thread: \`${input.threadId}\``,
      `Pull request: ${input.prUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    return this.post(content);
  }

  async sendCompletion(input: DiscordCompletionInput) {
    if (!this.webhookUrl) return false;

    const prUrl = input.prUrl ?? (input.prNumber ? `https://github.com/${input.repo}/pull/${input.prNumber}` : undefined);
    const { label, githubUrl } = input.prNumber
      ? { label: `PR #${input.prNumber}`, githubUrl: prUrl as string }
      : targetDetails(input);
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
      prUrl ? `Pull request: ${prUrl}` : githubUrl,
    ]
      .filter(Boolean)
      .join("\n");

    return this.post(content);
  }

  async sendTest() {
    if (!this.webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is not configured");
    return this.post("✅ **Codex Control Plane** Discord notifications are configured correctly.");
  }
}
