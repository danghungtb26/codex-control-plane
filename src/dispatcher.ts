import type { Binding } from "./types.js";
import type { BindingResolver } from "./binding-resolver.js";
import type { CodexAppServerClient } from "./codex-client.js";
import {
  withGithubCompletionComment,
  withGithubCreatePr,
  withGithubIssueImplementation,
  withGithubSummary,
} from "./codex-prompt.js";
import type { Config } from "./config.js";
import type { TurnNotifier } from "./turn-notifier.js";
import type { DispatchMessage } from "./types.js";

type PendingBatch = {
  messages: DispatchMessage[];
  timer: NodeJS.Timeout;
};

export class ReviewDispatcher {
  private pending = new Map<string, PendingBatch>();

  constructor(
    private readonly resolver: BindingResolver,
    private readonly codex: CodexAppServerClient,
    private readonly notifier: TurnNotifier,
    private readonly config: Config,
  ) {}

  enqueue(message: DispatchMessage) {
    const key = `${message.repo.toLowerCase()}#${message.targetKind}:${message.number}:${message.action}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.messages.push(message);
      clearTimeout(existing.timer);
      existing.timer = this.schedule(key);
      return;
    }

    this.pending.set(key, {
      messages: [message],
      timer: this.schedule(key),
    });
  }

  async sendNow(message: DispatchMessage) {
    return this.dispatchBatch([message]);
  }

  private schedule(key: string) {
    return setTimeout(() => {
      const batch = this.pending.get(key);
      if (!batch) return;
      this.pending.delete(key);
      void this.dispatchBatch(batch.messages).catch((error) => {
        console.error("[dispatcher] failed:", error);
      });
    }, this.config.reviewDebounceMs);
  }

  private async dispatchBatch(messages: DispatchMessage[]) {
    const first = messages[0];
    if (!first) return;

    if (first.targetKind === "issue") {
      return this.dispatchIssueCommand(first);
    }

    return this.dispatchPrBatch(messages);
  }

  private async ensureIssueBinding(message: DispatchMessage) {
    const cwd = this.resolver.getWorkspace(message.repo);
    const existing = await this.resolver.resolveIssue(message.repo, message.number, cwd ?? undefined);
    if (existing) return existing;

    if (message.action !== "implement") {
      throw new Error(
        `Issue ${message.repo}#${message.number} has no durable Codex thread. Run /codex:implement first.`,
      );
    }
    if (!cwd) {
      throw new Error(
        `No local workspace is known for ${message.repo}. Run one task through POST /tasks with cwd once, or bind any Issue/PR in this repository first.`,
      );
    }

    const { threadId } = await this.codex.startThread(cwd);
    return this.resolver.bind({
      repo: message.repo,
      kind: "issue",
      number: message.number,
      threadId,
      cwd,
    });
  }

  private async sendIssueTurn(message: DispatchMessage, binding: Binding, prompt: string) {
    const commitBefore = await this.notifier.snapshotCommit(binding.cwd);
    const turn = await this.codex.send(binding.threadId, prompt, {
      cwd: binding.cwd,
      allowNetwork: this.config.codexAllowNetwork,
    });
    this.notifier.register(turn.turnId, {
      repo: message.repo,
      kind: "issue",
      number: message.number,
      threadId: binding.threadId,
      action: message.action,
      request: message.text || `/codex:${message.action}`,
      cwd: binding.cwd,
      commitBefore,
    });
    return turn;
  }

  private async dispatchIssueCommand(message: DispatchMessage) {
    const binding = await this.ensureIssueBinding(message);

    if (message.action === "implement") {
      console.log(`[dispatcher] implement issue ${message.repo}#${message.number} on ${binding.threadId}`);
      return this.sendIssueTurn(
        message,
        binding,
        withGithubIssueImplementation({
          repo: message.repo,
          issueNumber: message.number,
          task: message.text,
        }),
      );
    }

    if (message.action === "create-pr") {
      console.log(`[dispatcher] create PR for issue ${message.repo}#${message.number} on ${binding.threadId}`);
      return this.sendIssueTurn(
        message,
        binding,
        withGithubCreatePr({
          repo: message.repo,
          issueNumber: message.number,
          task: message.text,
        }),
      );
    }

    if (message.action === "summary") {
      console.log(`[dispatcher] summarize issue ${message.repo}#${message.number} on ${binding.threadId}`);
      return this.sendIssueTurn(
        message,
        binding,
        withGithubSummary({
          repo: message.repo,
          kind: "issue",
          number: message.number,
          task: message.text,
        }),
      );
    }

    throw new Error(`/codex:${message.action} is not valid on an Issue`);
  }

  private async dispatchPrBatch(messages: DispatchMessage[]) {
    const first = messages[0];
    if (!first) return;

    const binding = await this.resolver.resolvePr(first.repo, first.number);
    if (!binding) {
      console.warn(
        `[dispatcher] no durable thread binding for ${first.repo}#${first.number}; refusing to create a new PR conversation`,
      );
      return;
    }

    if (first.action === "summary") {
      const request = messages.map((message) => message.text).filter(Boolean).join("\n\n");
      const prompt = withGithubSummary({
        repo: first.repo,
        kind: "pr",
        number: first.number,
        task: request,
      });
      console.log(`[dispatcher] summarize PR ${first.repo}#${first.number} on ${binding.threadId}`);
      const commitBefore = await this.notifier.snapshotCommit(binding.cwd);
      const turn = await this.codex.send(binding.threadId, prompt, {
        cwd: binding.cwd,
        allowNetwork: this.config.codexAllowNetwork,
      });
      this.notifier.register(turn.turnId, {
        repo: first.repo,
        kind: "pr",
        number: first.number,
        threadId: binding.threadId,
        action: "summary",
        request: request || "/codex:summary",
        cwd: binding.cwd,
        commitBefore,
      });
      return turn;
    }

    if (first.action !== "fix-comment") {
      throw new Error(`/codex:${first.action} is not valid on a PR`);
    }

    const sections = messages.map((message, index) => {
      const source = message.url ? `\nSource: ${message.url}` : "";
      return `Requested fix ${index + 1}:\n${message.text || "Inspect the referenced review comment/thread and fix it."}${source}`;
    });

    const task = [
      `You are continuing work on GitHub PR ${first.repo}#${first.number} in its existing implementation conversation.`,
      "The trusted user explicitly invoked `/codex:fix-comment`. Only now should review feedback be acted on.",
      ...sections,
      "If the command itself does not contain a concrete finding, inspect the PR's current review comments/threads and identify the actionable feedback that the command is authorizing you to fix.",
      "Inspect the current working tree first so you do not overwrite unrelated changes. Apply only the relevant fixes and run the most relevant tests/checks.",
      "If the fix changes files, create a real git commit containing the task-related changes and push it to the existing PR branch before reporting completion. Do not create an empty commit when no code change is required.",
      "Do not merge the PR.",
    ].join("\n\n");

    const prompt = withGithubCompletionComment({
      repo: first.repo,
      prNumber: first.number,
      task,
    });

    console.log(`[dispatcher] fix-comment: forwarding ${messages.length} command(s) to ${binding.threadId}`);
    const commitBefore = await this.notifier.snapshotCommit(binding.cwd);
    const turn = await this.codex.send(binding.threadId, prompt, {
      cwd: binding.cwd,
      allowNetwork: this.config.codexAllowNetwork,
    });
    this.notifier.register(turn.turnId, {
      repo: first.repo,
      kind: "pr",
      number: first.number,
      threadId: binding.threadId,
      action: "fix-comment",
      request: messages.map((message) => message.text).filter(Boolean).join(" | ") || "/codex:fix-comment",
      cwd: binding.cwd,
      commitBefore,
    });
    return turn;
  }
}
