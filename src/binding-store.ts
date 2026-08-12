import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Binding } from "./types.js";

const keyOf = (repo: string, prNumber: number) => `${repo.toLowerCase()}#${prNumber}`;

export class BindingStore {
  private readonly filePath: string;
  private bindings = new Map<string, Binding>();

  constructor(filePath = path.resolve(".data/bindings.json")) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const list = JSON.parse(raw) as Binding[];
      this.bindings = new Map(list.map((binding) => [keyOf(binding.repo, binding.prNumber), binding]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(repo: string, prNumber: number) {
    return this.bindings.get(keyOf(repo, prNumber)) ?? null;
  }

  list() {
    return [...this.bindings.values()];
  }

  async set(input: Omit<Binding, "createdAt" | "updatedAt">) {
    const key = keyOf(input.repo, input.prNumber);
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

  async remove(repo: string, prNumber: number) {
    const deleted = this.bindings.delete(keyOf(repo, prNumber));
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
