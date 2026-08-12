import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexAppServerClient, TurnCompletedEvent } from "./codex-client.js";
import type { DiscordNotificationTarget, DiscordNotifier } from "./discord-notifier.js";
import type { GithubBindingRegistry, GithubReportReceipt } from "./github-binding-registry.js";

const execFileAsync = promisify(execFile);

type TurnRegistration = DiscordNotificationTarget & {
  cwd: string;
};

type TurnContext = TurnRegistration & {
  commitBefore: Promise<string>;
};

const COMMENT_ID_RE = /^GITHUB_REPORT_COMMENT_ID=(\d+)$/m;
const COMMENT_URL_RE = /^GITHUB_REPORT_COMMENT_URL=(https:\/\/github\.com\/[^\s]+#issuecomment-\d+)$/m;
const TASK_SUMMARY_RE = /^CODEX_TASK_SUMMARY=(.+)$/m;

const parseReportReceipt = (text: string): { commentId: string; commentUrl: string } | null => {
  const commentId = text.match(COMMENT_ID_RE)?.[1] ?? "";
  const commentUrl = text.match(COMMENT_URL_RE)?.[1] ?? "";
  if (!commentId && !commentUrl) return null;
  return { commentId, commentUrl };
};

const isInterrupted = (status: string) => {
  const normalized = status.toLowerCase();
  return normalized === "interrupted" || normalized === "cancelled";
};

const readGitHead = async (cwd: string) => {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return "";
  }
};

const summaryFrom = (finalText: string, context: TurnContext, status: string) => {
  const explicit = finalText.match(TASK_SUMMARY_RE)?.[1]?.trim();
  if (explicit) return explicit;

  const cleaned = finalText
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("GITHUB_REPORT_COMMENT_ID=") &&
        !line.startsWith("GITHUB_REPORT_COMMENT_URL=") &&
        !line.startsWith("CODEX_TASK_SUMMARY="),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  if (cleaned) return cleaned;

  const request = context.request?.replace(/\s+/g, " ").trim();
  return `${context.action} ${status}${request ? `: ${request.slice(0, 400)}` : ""}`;
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

  register(turnId: string, context: TurnRegistration) {
    if (!turnId) return;
    this.contexts.set(turnId, {
      ...context,
      commitBefore: readGitHead(context.cwd),
    });
  }

  private async resolveCodexReceipt(
    context: TurnContext,
    finalText: string,
  ): Promise<GithubReportReceipt | null> {
    const parsed = parseReportReceipt(finalText);
    if (!parsed) return null;

    if (parsed.commentId) {
      const resolved = await this.github.resolveReportReceipt(context.repo, parsed.commentId);
      if (resolved) return resolved;
    }

    if (parsed.commentUrl) {
      const idFromUrl = parsed.commentUrl.match(/#issuecomment-(\d+)$/)?.[1] ?? "";
      if (idFromUrl) {
        const resolved = await this.github.resolveReportReceipt(context.repo, idFromUrl);
        if (resolved) return resolved;
      }
      return {
        commentId: idFromUrl,
        commentUrl: parsed.commentUrl,
        fallback: false,
      };
    }

    return null;
  }

  private async handleCompleted(event: TurnCompletedEvent) {
    const context = this.contexts.get(event.turnId);
    if (!context) return;
    this.contexts.delete(event.turnId);

    const [commitBefore, commitAfter] = await Promise.all([
      context.commitBefore,
      readGitHead(context.cwd),
    ]);
    const summary = summaryFrom(event.finalText, context, event.status);

    let receipt = await this.resolveCodexReceipt(context, event.finalText);
    if (!receipt && !isInterrupted(event.status)) {
      try {
        receipt = await this.github.postFallbackReport({
          repo: context.repo,
          kind: context.kind,
          number: context.number,
          threadId: context.threadId,
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
        repo: context.repo,
        kind: context.kind,
        number: context.number,
        threadId: context.threadId,
        action: context.action,
        request: context.request,
        turnId: event.turnId,
        status: event.status,
        summary,
        commitBefore,
        commitAfter,
        reportCommentId: receipt?.commentId,
        reportCommentUrl: receipt?.commentUrl,
        reportFallback: receipt?.fallback,
      });
    } catch (error) {
      console.error("[discord] notification failed:", (error as Error).message);
    }
  }
}
