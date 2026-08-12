import type { BindingStore } from "./binding-store.js";
import type { Config } from "./config.js";
import type { GithubBindingRegistry } from "./github-binding-registry.js";
import type { Binding, BindingKind, RemoteBindingMarker } from "./types.js";

type BindInput = {
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  cwd: string;
  sourceIssueNumber?: number;
};

export class BindingResolver {
  constructor(
    private readonly store: BindingStore,
    private readonly github: GithubBindingRegistry,
    private readonly config: Config,
  ) {}

  async bind(input: BindInput, replace = false) {
    const remote = await this.github.find(input.repo, input.kind, input.number);
    if (remote && remote.threadId !== input.threadId && !replace) {
      throw new Error(`${input.kind} #${input.number} is already bound to thread ${remote.threadId}`);
    }
    const binding = await this.store.set(input);
    await this.github.persist(binding);
    return binding;
  }

  async resolveIssue(repo: string, issueNumber: number, cwdHint?: string) {
    const local = this.store.getIssue(repo, issueNumber);
    if (local) return local;
    const remote = await this.github.find(repo, "issue", issueNumber);
    if (!remote) return null;
    return this.materialize(remote, cwdHint);
  }

  async resolvePr(repo: string, prNumber: number, cwdHint?: string) {
    const local = this.store.getPr(repo, prNumber);
    if (local) return local;

    const remotePr = await this.github.find(repo, "pr", prNumber);
    if (remotePr) {
      const sourceLocal = remotePr.sourceIssueNumber
        ? this.store.getIssue(repo, remotePr.sourceIssueNumber)
        : null;
      return this.materialize(remotePr, cwdHint ?? sourceLocal?.cwd);
    }

    const issueNumbers = await this.github.discoverSourceIssues(repo, prNumber);
    for (const issueNumber of issueNumbers) {
      const issueBinding = await this.resolveIssue(repo, issueNumber, cwdHint);
      if (!issueBinding) continue;

      const prBinding = await this.store.set({
        repo,
        kind: "pr",
        number: prNumber,
        threadId: issueBinding.threadId,
        cwd: issueBinding.cwd,
        sourceIssueNumber: issueNumber,
      });
      await this.github.persist(prBinding);
      console.log(
        `[binding] inherited ${repo}#pr:${prNumber} from issue #${issueNumber} -> ${issueBinding.threadId}`,
      );
      return prBinding;
    }

    return null;
  }

  private async materialize(remote: RemoteBindingMarker, cwdHint?: string) {
    const cwd = cwdHint ?? this.config.repoWorkspaces.get(remote.repo.toLowerCase());
    if (!cwd) {
      throw new Error(
        `Recovered thread ${remote.threadId} from GitHub for ${remote.repo} ${remote.kind} #${remote.number}, but no local workspace is known. Set REPO_WORKSPACES=${remote.repo}=/absolute/path or bind it once through the admin API.`,
      );
    }

    const binding: Omit<Binding, "createdAt" | "updatedAt"> = {
      repo: remote.repo,
      kind: remote.kind,
      number: remote.number,
      threadId: remote.threadId,
      cwd,
      sourceIssueNumber: remote.sourceIssueNumber,
    };
    console.log(`[binding] recovered ${remote.repo}#${remote.kind}:${remote.number} -> ${remote.threadId}`);
    return this.store.set(binding);
  }
}
