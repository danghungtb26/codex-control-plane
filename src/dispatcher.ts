import type { Binding } from "./types.js";
import type { BindingResolver } from "./binding-resolver.js";
import type { CodexAppServerClient } from "./codex-client.js";
import {
  withGithubCompletionComment,
  withGithubCreatePr,
  withGithubIssueImplementation,
  withGithubSummary,
  withRepositoryTaskWorkflow,
} from "./codex-prompt.js";
import type { Config } from "./config.js";
import type { TurnNotifier } from "./turn-notifier.js";
import type { DispatchMessage } from "./types.js";

type PendingBatch = {
  messages: DispatchMessage[];
  timer: NodeJS.Timeout;
};

type UsableBinding = {
  binding: Binding;
  recoveredFromThreadId?: string;
};

const isMissingRolloutError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /"code"\s*:\s*-32600/.test(message) && /no rollout found for thread id/i.test(message);
};

const withRecoveryContext = (prompt: string, recoveredFromThreadId?: string) => {
  if (!recoveredFromThreadId) return prompt;
  return [
    prompt,
    "Control-plane recovery note:",
    `The previous durable Codex thread ${recoveredFromThreadId} could not be resumed because its local rollout was unavailable. This is a replacement durable thread. Reconstruct any missing context from GitHub, the current branch/worktree, commits, tests, and review history before making changes.`,
  ].join("\n\n");
};

export class ReviewDispatcher {
  private pending = new Map<string, PendingBatch>();
  private freshThreads = new Set<string>();

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
    this.freshThreads.add(threadId);
    return this.resolver.bind({
      repo: message.repo,
      kind: "issue",
      number: message.number,
      threadId,
      cwd,
    });
  }

  private async createPrBinding(message: DispatchMessage) {
    const cwd = this.resolver.getWorkspace(message.repo);
    if (!cwd) {
      throw new Error(
        `PR ${message.repo}#${message.number} has no durable Codex thread and no local workspace is known. Bind the repository once through POST /tasks or set REPO_WORKSPACES.`,
      );
    }

    const { threadId } = await this.codex.startThread(cwd);
    this.freshThreads.add(threadId);
    console.warn(
      `[dispatcher] no durable binding for ${message.repo} PR #${message.number}; created replacement thread ${threadId}`,
    );
    return this.resolver.bind({
      repo: message.repo,
      kind: "pr",
      number: message.number,
      threadId,
      cwd,
    });
  }

  private async ensureUsableBinding(binding: Binding): Promise<UsableBinding> {
    if (this.freshThreads.delete(binding.threadId) || this.codex.getActiveTurn(binding.threadId)) {
      return { binding };
    }

    try {
      await this.codex.resumeThread(binding.threadId);
      return { binding };
    } catch (error) {
      if (!isMissingRolloutError(error)) {
        // Preserve the existing tracked failure path for every error except the
        // explicit "rollout is gone" recovery case. codex.send() will retry the
        // resume inside TurnNotifier.runTracked and report failure normally.
        return { binding };
      }

      const previousThreadId = binding.threadId;
      const { threadId } = await this.codex.startThread(binding.cwd);
      console.warn(
        `[dispatcher] missing rollout for ${previousThreadId}; created replacement thread ${threadId} for ${binding.repo} ${binding.kind} #${binding.number}`,
      );

      const rebound = await this.resolver.bind(
        {
          repo: binding.repo,
          kind: binding.kind,
          number: binding.number,
          threadId,
          cwd: binding.cwd,
          sourceIssueNumber: binding.sourceIssueNumber,
        },
        true,
      );

      if (binding.kind === "pr" && binding.sourceIssueNumber) {
        try {
          await this.resolver.bind(
            {
              repo: binding.repo,
              kind: "issue",
              number: binding.sourceIssueNumber,
              threadId,
              cwd: binding.cwd,
            },
            true,
          );
        } catch (sourceError) {
          console.warn(
            `[binding] replacement thread ${threadId} is bound to PR #${binding.number}, but source Issue #${binding.sourceIssueNumber} could not be updated: ${(sourceError as Error).message}`,
          );
        }
      }

      return { binding: rebound, recoveredFromThreadId: previousThreadId };
    }
  }

  private async sendIssueTurn(
    message: DispatchMessage,
    binding: Binding,
    prompt: string,
    recoveredFromThreadId?: string,
  ) {
    return this.notifier.runTracked(
      {
        repo: message.repo,
        kind: "issue",
        number: message.number,
        threadId: binding.threadId,
        action: message.action,
        request: message.text || `/codex:${message.action}`,
        cwd: binding.cwd,
      },
      () =>
        this.codex.send(binding.threadId, withRecoveryContext(prompt, recoveredFromThreadId), {
          cwd: binding.cwd,
          allowNetwork: this.config.codexAllowNetwork,
        }),
    );
  }

  private async dispatchIssueCommand(message: DispatchMessage) {
    const resolved = await this.ensureIssueBinding(message);
    const { binding, recoveredFromThreadId } = await this.ensureUsableBinding(resolved);

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
        recoveredFromThreadId,
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
        recoveredFromThreadId,
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
        recoveredFromThreadId,
      );
    }

    throw new Error(`/codex:${message.action} is not valid on an Issue`);
  }

  private async dispatchPrBatch(messages: DispatchMessage[]) {
    const first = messages[0];
    if (!first) return;
    if (first.action !== "summary" && first.action !== "fix-comment") {
      throw new Error(`/codex:${first.action} is not valid on a PR`);
    }

    const resolved = (await this.resolver.resolvePr(first.repo, first.number)) ?? (await this.createPrBinding(first));
    const { binding, recoveredFromThreadId } = await this.ensureUsableBinding(resolved);

    if (first.action === "summary") {
      const request = messages.map((message) => message.text).filter(Boolean).join("\n\n");
      const prompt = withRecoveryContext(
        withGithubSummary({
          repo: first.repo,
          kind: "pr",
          number: first.number,
          task: request,
        }),
        recoveredFromThreadId,
      );
      console.log(`[dispatcher] summarize PR ${first.repo}#${first.number} on ${binding.threadId}`);
      return this.notifier.runTracked(
        {
          repo: first.repo,
          kind: "pr",
          number: first.number,
          threadId: binding.threadId,
          action: "summary",
          request: request || "/codex:summary",
          cwd: binding.cwd,
        },
        () =>
          this.codex.send(binding.threadId, prompt, {
            cwd: binding.cwd,
            allowNetwork: this.config.codexAllowNetwork,
          }),
      );
    }

    const sections = messages.map((message, index) => {
      const source = message.url ? `\nSource: ${message.url}` : "";
      return `Requested fix ${index + 1}:\n${message.text || "Inspect the referenced review comment/thread and fix it."}${source}`;
    });

    const task = withRepositoryTaskWorkflow(
      [
        `You are continuing work on GitHub PR ${first.repo}#${first.number} in its durable implementation conversation.`,
        "The trusted user explicitly invoked `/codex:fix-comment`. Only now should review feedback be acted on.",
        ...sections,
        "PR-review fix workflow:",
        "Treat the authorized review feedback as the source requirement for this turn. Preserve the existing PR scope and branch; do not create a new PR for the fix.",
        "If the command itself does not contain a concrete finding, inspect the PR's current review comments/threads and identify the actionable feedback that the command is authorizing you to fix.",
        "Use the repository's top-level task workflow for this fix. The main agent must inspect and arbitrate the requested feedback, approve the repair scope, delegate implementation when appropriate, review the resulting diff, then run independent QA before deciding PASS.",
        "Inspect the current working tree first so you do not overwrite unrelated changes. Apply only the relevant accepted fixes and run the repository-required tests/checks/QA.",
        "Do not treat the reviewer comment as automatically correct if it conflicts with repository requirements or the approved task scope; the main agent must resolve that conflict explicitly before changing code.",
        "If the main agent decides PASS and the fix changes files, create a real git commit containing only the task-related changes and push it to the existing PR branch before reporting completion. Do not create an empty commit when no code change is required.",
        "Do not merge the PR.",
      ].join("\n\n"),
    );

    const prompt = withRecoveryContext(
      withGithubCompletionComment({
        repo: first.repo,
        prNumber: first.number,
        task,
      }),
      recoveredFromThreadId,
    );

    console.log(`[dispatcher] fix-comment: forwarding ${messages.length} command(s) to ${binding.threadId}`);
    const request =
      messages.map((message) => message.text).filter(Boolean).join(" | ") || "/codex:fix-comment";
    return this.notifier.runTracked(
      {
        repo: first.repo,
        kind: "pr",
        number: first.number,
        threadId: binding.threadId,
        action: "fix-comment",
        request,
        cwd: binding.cwd,
      },
      () =>
        this.codex.send(binding.threadId, prompt, {
          cwd: binding.cwd,
          allowNetwork: this.config.codexAllowNetwork,
        }),
    );
  }
}
