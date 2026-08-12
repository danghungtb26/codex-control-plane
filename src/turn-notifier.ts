import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexAppServerClient, TurnCompletedEvent } from "./codex-client.js";
import type { DashboardStore, DashboardTaskContext } from "./dashboard-store.js";
import type { DiscordNotificationTarget, DiscordNotifier } from "./discord-notifier.js";
import type { GithubBindingRegistry, GithubReportReceipt } from "./github-binding-registry.js";

const execFileAsync = promisify(execFile);

type TurnRunContext = DiscordNotificationTarget & {
  cwd: string;
};

type TurnRegistration = TurnRunContext & {
  commitBefore: string;
};

type TurnContext = TurnRegistration;

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

const toDashboardContext = (context: TurnRunContext): DashboardTaskContext => ({
  repo: context.repo,
  kind: context.kind,
  number: context.number,
  threadId: context.threadId,
  action: context.action,
  request: context.request,
  cwd: context.cwd,
});

export class TurnNotifier {
  private contexts = new Map<string, TurnContext>();

  constructor(
    codex: CodexAppServerClient,
    private readonly github: GithubBindingRegistry,
    private readonly discord: DiscordNotifier,
    private readonly dashboard?: DashboardStore,
  ) {
    codex.on("turnCompleted", (event: TurnCompletedEvent) => {
      void this.handleCompleted(event);
    });
  }

  snapshotCommit(cwd: string) {
    return readGitHead(cwd);
  }

  register(turnId: string, context: TurnRegistration) {
    if (!turnId) return;
    this.contexts.set(turnId, context);
  }

  async runTracked<T extends { turnId: string }>(
    context: TurnRunContext,
    run: () => Promise<T>,
  ): Promise<T> {
    const commitBefore = await readGitHead(context.cwd);
    const dashboardContext = toDashboardContext(context);

    try {
      await this.dashboard?.recordTaskStarted(dashboardContext, commitBefore);
    } catch (error) {
      console.error("[dashboard] start event failed:", (error as Error).message);
    }

    try {
      await this.discord.sendStarted({
        repo: context.repo,
        kind: context.kind,
        number: context.number,
        threadId: context.threadId,
        action: context.action,
        request: context.request,
        commitBefore,
      });
    } catch (error) {
      console.error("[discord] start notification failed:", (error as Error).message);
    }

    try {
      const turn = await run();
      this.register(turn.turnId, { ...context, commitBefore });
      return turn;
    } catch (error) {
      try {
        await this.dashboard?.recordTaskFailed(dashboardContext, commitBefore, error as Error);
      } catch (dashboardError) {
        console.error("[dashboard] failure event failed:", (dashboardError as Error).message);
      }

      try {
        await this.discord.sendFailure({
          repo: context.repo,
          kind: context.kind,
          number: context.number,
          threadId: context.threadId,
          action: context.action,
          request: context.request,
          commitBefore,
          error: (error as Error).message,
        });
      } catch (notifyError) {
        console.error("[discord] failure notification failed:", (notifyError as Error).message);
      }
      throw error;
    }
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

    const commitAfter = await readGitHead(context.cwd);
    const summary = summaryFrom(event.finalText, context, event.status);

    try {
      await this.dashboard?.recordTurnCompleted({
        context: toDashboardContext(context),
        turnId: event.turnId,
        status: event.status,
        summary,
        commitBefore: context.commitBefore,
        commitAfter,
      });
    } catch (error) {
      console.error("[dashboard] completion event failed:", (error as Error).message);
    }

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
        commitBefore: context.commitBefore,
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
