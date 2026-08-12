import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Binding, BindingKind, CodexAction } from "./types.js";

export type DashboardTaskContext = {
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  action: CodexAction;
  request?: string;
  cwd: string;
};

export type DashboardEvent = {
  id: string;
  timestamp: string;
  type:
    | "task.started"
    | "task.failed"
    | "turn.started"
    | "turn.completed"
    | "agent.delta"
    | "agent.message"
    | "tool.started"
    | "tool.completed"
    | "codex.error";
  threadId: string;
  turnId?: string;
  itemId?: string;
  repo?: string;
  kind?: BindingKind;
  number?: number;
  action?: CodexAction;
  request?: string;
  status?: string;
  summary?: string;
  commitBefore?: string;
  commitAfter?: string;
  text?: string;
  toolName?: string;
  detail?: string;
};

export type DashboardTask = {
  threadId: string;
  repo: string;
  issueNumber?: number;
  prNumbers: number[];
  status: string;
  action?: CodexAction;
  request?: string;
  commitBefore?: string;
  commitAfter?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

type CodexNotification = {
  method: string;
  params: Record<string, any>;
};

type Subscriber = (event: DashboardEvent) => void;

const compactJson = (value: unknown, maxLength = 5000) => {
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value ?? "");
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n…`;
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const commandText = (item: Record<string, any>) => {
  if (Array.isArray(item.command)) return item.command.map(String).join(" ");
  return asString(item.command) || asString(item.commandLine) || asString(item.name) || item.type;
};

export class DashboardStore {
  private events: DashboardEvent[] = [];
  private subscribers = new Set<Subscriber>();
  private writeChain = Promise.resolve();
  private threadByTurn = new Map<string, string>();

  constructor(private readonly filePath = path.resolve(".data/task-events.jsonl")) {}

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.events = raw
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as DashboardEvent];
          } catch {
            return [];
          }
        });

      for (const event of this.events) {
        if (event.type === "turn.started" && event.turnId) {
          this.threadByTurn.set(event.turnId, event.threadId);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getEvents(threadId: string) {
    return this.events.filter((event) => event.threadId === threadId);
  }

  listTasks(bindings: Binding[]): DashboardTask[] {
    const byThread = new Map<string, Binding[]>();
    for (const binding of bindings) {
      const list = byThread.get(binding.threadId) ?? [];
      list.push(binding);
      byThread.set(binding.threadId, list);
    }

    const threadIds = new Set([...byThread.keys(), ...this.events.map((event) => event.threadId)]);
    const tasks: DashboardTask[] = [];

    for (const threadId of threadIds) {
      const threadBindings = byThread.get(threadId) ?? [];
      const threadEvents = this.events.filter((event) => event.threadId === threadId);
      const latestEvent = threadEvents.at(-1);
      const latestStart = [...threadEvents].reverse().find((event) => event.type === "task.started");
      const latestTerminal = [...threadEvents]
        .reverse()
        .find((event) => event.type === "turn.completed" || event.type === "task.failed");
      const issueBinding = threadBindings.find((binding) => binding.kind === "issue");
      const prBindings = threadBindings.filter((binding) => binding.kind === "pr");
      const repo = latestStart?.repo ?? threadBindings[0]?.repo ?? "unknown";
      const createdAt =
        threadEvents[0]?.timestamp ??
        threadBindings.map((binding) => binding.createdAt).sort()[0] ??
        new Date(0).toISOString();
      const bindingUpdatedAt = threadBindings.map((binding) => binding.updatedAt).sort().at(-1);
      const updatedAt = latestEvent?.timestamp ?? bindingUpdatedAt ?? createdAt;

      let status = "idle";
      if (latestStart && (!latestTerminal || latestStart.timestamp > latestTerminal.timestamp)) {
        status = "running";
      } else if (latestTerminal?.type === "task.failed") {
        status = "failed";
      } else if (latestTerminal?.type === "turn.completed") {
        status = latestTerminal.status ?? "completed";
      }

      const latestCompletion = [...threadEvents]
        .reverse()
        .find((event) => event.type === "turn.completed");

      tasks.push({
        threadId,
        repo,
        issueNumber:
          issueBinding?.number ??
          prBindings.find((binding) => Number.isInteger(binding.sourceIssueNumber))?.sourceIssueNumber,
        prNumbers: [...new Set(prBindings.map((binding) => binding.number))].sort((a, b) => a - b),
        status,
        action: latestStart?.action,
        request: latestStart?.request,
        commitBefore: latestStart?.commitBefore,
        commitAfter: latestCompletion?.commitAfter,
        summary: latestCompletion?.summary,
        createdAt,
        updatedAt,
      });
    }

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async recordTaskStarted(context: DashboardTaskContext, commitBefore: string) {
    return this.publish({
      type: "task.started",
      threadId: context.threadId,
      repo: context.repo,
      kind: context.kind,
      number: context.number,
      action: context.action,
      request: context.request,
      commitBefore,
    });
  }

  async recordTaskFailed(context: DashboardTaskContext, commitBefore: string, error: Error) {
    return this.publish({
      type: "task.failed",
      threadId: context.threadId,
      repo: context.repo,
      kind: context.kind,
      number: context.number,
      action: context.action,
      request: context.request,
      commitBefore,
      status: "failed",
      text: error.message,
    });
  }

  async recordTurnCompleted(input: {
    context: DashboardTaskContext;
    turnId: string;
    status: string;
    summary: string;
    commitBefore: string;
    commitAfter: string;
  }) {
    return this.publish({
      type: "turn.completed",
      threadId: input.context.threadId,
      turnId: input.turnId,
      repo: input.context.repo,
      kind: input.context.kind,
      number: input.context.number,
      action: input.context.action,
      request: input.context.request,
      status: input.status,
      summary: input.summary,
      commitBefore: input.commitBefore,
      commitAfter: input.commitAfter,
    });
  }

  recordCodexNotification(notification: CodexNotification) {
    const { method, params } = notification;
    const turnId = asString(params.turnId) || asString(params.turn?.id);
    const directThreadId = asString(params.threadId);
    const threadId = directThreadId || (turnId ? this.threadByTurn.get(turnId) ?? "" : "");

    if (method === "turn/started" && directThreadId && turnId) {
      this.threadByTurn.set(turnId, directThreadId);
      void this.publish({
        type: "turn.started",
        threadId: directThreadId,
        turnId,
        status: asString(params.turn?.status) || "running",
      });
      return;
    }

    if (!threadId) return;

    if (method === "item/agentMessage/delta") {
      const delta = asString(params.delta);
      if (!delta) return;
      void this.publish(
        {
          type: "agent.delta",
          threadId,
          turnId: turnId || undefined,
          itemId: asString(params.itemId) || undefined,
          text: delta,
        },
        false,
      );
      return;
    }

    if (method === "item/started") {
      const item = (params.item ?? {}) as Record<string, any>;
      if (item.type === "agentMessage") return;
      void this.publish({
        type: "tool.started",
        threadId,
        turnId: turnId || undefined,
        itemId: asString(item.id) || undefined,
        toolName: commandText(item),
        detail: compactJson(item),
      });
      return;
    }

    if (method === "item/completed") {
      const item = (params.item ?? {}) as Record<string, any>;
      if (item.type === "agentMessage" && typeof item.text === "string") {
        void this.publish({
          type: "agent.message",
          threadId,
          turnId: turnId || undefined,
          itemId: asString(item.id) || undefined,
          text: item.text,
        });
        return;
      }

      void this.publish({
        type: "tool.completed",
        threadId,
        turnId: turnId || undefined,
        itemId: asString(item.id) || undefined,
        toolName: commandText(item),
        detail: compactJson(item),
      });
      return;
    }

    if (method === "error") {
      void this.publish({
        type: "codex.error",
        threadId,
        turnId: turnId || undefined,
        status: "failed",
        text: compactJson(params, 3000),
      });
    }
  }

  private async publish(
    input: Omit<DashboardEvent, "id" | "timestamp">,
    persist = true,
  ): Promise<DashboardEvent> {
    const event: DashboardEvent = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    if (persist) {
      this.events.push(event);
      this.writeChain = this.writeChain.then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      });
      await this.writeChain;
    }

    for (const subscriber of this.subscribers) subscriber(event);
    return event;
  }
}
