import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Binding, BindingKind } from "./types.js";

type LegacyBinding = Partial<Binding> & { prNumber?: number };

const keyOf = (repo: string, kind: BindingKind, number: number) =>
  `${repo.toLowerCase()}#${kind}:${number}`;

const normalize = (raw: LegacyBinding): Binding | null => {
  const legacyPr = Number.isInteger(raw.prNumber) ? raw.prNumber : undefined;
  const kind: BindingKind | undefined =
    raw.kind === "issue" || raw.kind === "pr" ? raw.kind : legacyPr != null ? "pr" : undefined;
  const number = raw.number ?? legacyPr;

  if (!raw.repo || !kind || !Number.isInteger(number) || !raw.threadId || !raw.cwd) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    repo: raw.repo,
    kind,
    number: number as number,
    threadId: raw.threadId,
    cwd: raw.cwd,
    sourceIssueNumber: raw.sourceIssueNumber,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
};

export class BindingStore {
  private readonly filePath: string;
  private bindings = new Map<string, Binding>();

  constructor(filePath = path.resolve(".data/bindings.json")) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const list = (JSON.parse(raw) as LegacyBinding[])
        .map(normalize)
        .filter((binding): binding is Binding => Boolean(binding));
      this.bindings = new Map(
        list.map((binding) => [keyOf(binding.repo, binding.kind, binding.number), binding]),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(repo: string, kind: BindingKind, number: number) {
    return this.bindings.get(keyOf(repo, kind, number)) ?? null;
  }

  getIssue(repo: string, issueNumber: number) {
    return this.get(repo, "issue", issueNumber);
  }

  getPr(repo: string, prNumber: number) {
    return this.get(repo, "pr", prNumber);
  }

  list() {
    return [...this.bindings.values()];
  }

  async set(input: Omit<Binding, "createdAt" | "updatedAt">) {
    const key = keyOf(input.repo, input.kind, input.number);
    const existing = this.bindings.get(key);
    const now = new Date().toISOString();
    const binding: Binding = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.bindings.set(key, binding);
    await this.persist();
    return binding;
  }

  async remove(repo: string, kind: BindingKind, number: number) {
    const deleted = this.bindings.delete(keyOf(repo, kind, number));
    if (deleted) await this.persist();
    return deleted;
  }

  private async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.list(), null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }
}
