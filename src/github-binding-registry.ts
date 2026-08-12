import { spawn } from "node:child_process";
import type { Binding, BindingKind, RemoteBindingMarker } from "./types.js";

type IssueComment = { id: number; body?: string; user?: { login?: string } };
type PullRequestInfo = { body?: string | null; head?: { ref?: string } };

const MARKER_RE = /<!--\s*codex-control-plane-binding\s+({[\s\S]*?})\s*-->/;

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(`${bin} ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
  });

const parseMarker = (body: string | undefined): RemoteBindingMarker | null => {
  const match = body?.match(MARKER_RE);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as RemoteBindingMarker;
    if (value.version !== 1 || !value.repo || !["issue", "pr"].includes(value.kind) || !Number.isInteger(value.number) || !value.threadId) return null;
    return value;
  } catch {
    return null;
  }
};

export class GithubBindingRegistry {
  private login?: string;
  constructor(private readonly ghBin: string) {}

  async assertAuthenticated() { await run(this.ghBin, ["auth", "status"]); }

  async find(repo: string, kind: BindingKind, number: number) {
    const login = await this.currentLogin();
    const comments = await this.listComments(repo, number);
    for (const comment of comments) {
      if (comment.user?.login?.toLowerCase() !== login.toLowerCase()) continue;
      const marker = parseMarker(comment.body);
      if (marker && marker.repo.toLowerCase() === repo.toLowerCase() && marker.kind === kind && marker.number === number) return marker;
    }
    return null;
  }

  async persist(binding: Binding) {
    const login = await this.currentLogin();
    const comments = await this.listComments(binding.repo, binding.number);
    const payload: RemoteBindingMarker = { version: 1, repo: binding.repo, kind: binding.kind, number: binding.number, threadId: binding.threadId, sourceIssueNumber: binding.sourceIssueNumber };
    const body = [`<!-- codex-control-plane-binding ${JSON.stringify(payload)} -->`, `🤖 Codex control-plane bound ${binding.kind} #${binding.number} to a durable thread.`].join("\n");
    const existing = comments.find((comment) => {
      if (comment.user?.login?.toLowerCase() !== login.toLowerCase()) return false;
      const marker = parseMarker(comment.body);
      return marker?.kind === binding.kind && marker.number === binding.number;
    });
    if (existing) {
      await run(this.ghBin, ["api", "-X", "PATCH", `repos/${binding.repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
      return;
    }
    await run(this.ghBin, ["api", "-X", "POST", `repos/${binding.repo}/issues/${binding.number}/comments`, "-f", `body=${body}`]);
  }

  async discoverSourceIssues(repo: string, prNumber: number) {
    const raw = await run(this.ghBin, ["api", `repos/${repo}/pulls/${prNumber}`]);
    const pr = JSON.parse(raw) as PullRequestInfo;
    const found = new Set<number>();
    const closing = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    let match: RegExpExecArray | null;
    while ((match = closing.exec(pr.body ?? ""))) found.add(Number(match[1]));
    const branchMatch = (pr.head?.ref ?? "").match(/(?:^|\/)(?:issue|task)[\/-](\d+)(?:$|[-_/])/i);
    if (branchMatch) found.add(Number(branchMatch[1]));
    return [...found].filter(Number.isInteger);
  }

  private async currentLogin() {
    if (this.login) return this.login;
    const raw = await run(this.ghBin, ["api", "user"]);
    this.login = String((JSON.parse(raw) as { login?: string }).login ?? "");
    if (!this.login) throw new Error("Unable to resolve authenticated GitHub login from gh");
    return this.login;
  }

  private async listComments(repo: string, number: number) {
    const raw = await run(this.ghBin, ["api", "--paginate", "--slurp", `repos/${repo}/issues/${number}/comments?per_page=100`]);
    const pages = JSON.parse(raw) as IssueComment[][];
    return pages.flat();
  }
}
