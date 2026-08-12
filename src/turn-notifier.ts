import type { CodexAppServerClient, TurnCompletedEvent } from "./codex-client.js";
import type { DiscordNotificationTarget, DiscordNotifier } from "./discord-notifier.js";
import type { GithubBindingRegistry, GithubReportReceipt } from "./github-binding-registry.js";

type TurnContext = DiscordNotificationTarget;

const COMMENT_ID_RE = /^GITHUB_REPORT_COMMENT_ID=(\d+)$/m;
const COMMENT_URL_RE = /^GITHUB_REPORT_COMMENT_URL=(https:\/\/github\.com\/[^\s]+#issuecomment-\d+)$/m;

const parseReportReceipt = (text: string, context: TurnContext): GithubReportReceipt | null => {
  const id = text.match(COMMENT_ID_RE)?.[1] ?? "";
  const url = text.match(COMMENT_URL_RE)?.[1] ?? "";
  if (!id && !url) return null;

  const idFromUrl = url.match(/#issuecomment-(\d+)$/)?.[1] ?? "";
  const commentId = id || idFromUrl;
  const commentUrl =
    url ||
    (commentId
      ? `https://github.com/${context.repo}/${context.kind === "pr" ? "pull" : "issues"}/${context.number}#issuecomment-${commentId}`
      : "");
  if (!commentId && !commentUrl) return null;
  return { commentId, commentUrl, fallback: false };
};

export class TurnNotifier {
  private contexts = new Map<string, TurnContext>();

  constructor(
    codex: CodexAppServerClient,
    private readonly github: GithubBindingRegistry,
    private readonly discord: DiscordNotifier,
  ) {
    codex.on("turnCompleted", (event: TurnCompletedEvent) => {
      void this.handleCompleted(event);
    });
  }

  register(turnId: string, context: TurnContext) {
    if (!turnId) return;
    this.contexts.set(turnId, context);
  }

  private async handleCompleted(event: TurnCompletedEvent) {
    const context = this.contexts.get(event.turnId);
    if (!context) return;
    this.contexts.delete(event.turnId);

    let receipt = parseReportReceipt(event.finalText, context);
    if (!receipt) {
      try {
        receipt = await this.github.postFallbackReport({
          ...context,
          status: event.status,
          finalText: event.finalText,
          turnId: event.turnId,
        });
        console.log(`[github] fallback completion report: ${receipt.commentUrl}`);
      } catch (error) {
        console.error("[github] fallback completion report failed:", (error as Error).message);
      }
    }

    try {
      await this.discord.sendCompletion({
        ...context,
        turnId: event.turnId,
        status: event.status,
        reportCommentId: receipt?.commentId,
        reportCommentUrl: receipt?.commentUrl,
        reportFallback: receipt?.fallback,
      });
    } catch (error) {
      console.error("[discord] notification failed:", (error as Error).message);
    }
  }
}
