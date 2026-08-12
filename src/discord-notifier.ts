export type DiscordNotificationTarget = {
  repo: string;
  kind: "issue" | "pr";
  number: number;
  threadId: string;
};

type DiscordCompletionInput = DiscordNotificationTarget & {
  turnId: string;
  status: string;
};

const iconFor = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "completed") return "✅";
  if (normalized === "failed") return "❌";
  if (normalized === "interrupted" || normalized === "cancelled") return "⚠️";
  return "ℹ️";
};

export class DiscordNotifier {
  constructor(private readonly webhookUrl?: string) {}

  get enabled() {
    return Boolean(this.webhookUrl);
  }

  async sendCompletion(input: DiscordCompletionInput) {
    if (!this.webhookUrl) return false;

    const label = input.kind === "pr" ? `PR #${input.number}` : `Issue #${input.number}`;
    const githubUrl = `https://github.com/${input.repo}/${input.kind === "pr" ? "pull" : "issues"}/${input.number}`;
    const content = [
      `${iconFor(input.status)} **Codex ${input.status}**`,
      `**${input.repo} · ${label}**`,
      `Thread: \`${input.threadId}\``,
      `Turn: \`${input.turnId}\``,
      githubUrl,
    ].join("\n");

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
