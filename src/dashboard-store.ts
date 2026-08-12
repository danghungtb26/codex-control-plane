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
    | "user.message"
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
  prNumber?: number;
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

const timeFromCodex = (value: unknown, fallback: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const offsetTime = (timestamp: string, offsetMs: number) => {
  const value = new Date(timestamp).getTime();
  return new Date((Number.isNaN(value) ? 0 : value) + offsetMs).toISOString();
};

const userMessageText = (item: Record<string, any>) => {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((part: Record<string, any>) => {
      if (part?.type === "text") return asString(part.text);
      if (part?.type === "image") return "[image input]";
      if (part?.type === "localImage") return `[local image${part.path ? `: ${part.path}` : ""}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const cleanAgentText = (text: string) =>
  text
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("GITHUB_REPORT_COMMENT_ID=") &&
        !line.startsWith("GITHUB_REPORT_COMMENT_URL=") &&
        !line.startsWith("CODEX_TASK_SUMMARY="),
    )
    .join("\n")
    .trim();

const historyToolDetail = (item: Record<string, any>) => {
  if (item.type === "commandExecution") {
    return [
      item.cwd ? `cwd: ${item.cwd}` : "",
      item.status ? `status: ${item.status}` : "",
      Number.isInteger(item.exitCode) ? `exit code: ${item.exitCode}` : "",
      typeof item.durationMs === "number" ? `duration: ${item.durationMs} ms` : "",
      asString(item.aggregatedOutput),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (item.type === "fileChange") {
    return compactJson({ status: item.status, changes: item.changes });
  }

  return compactJson(item);
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

  mergeThreadHistory(threadId: string, thread: Record<string, any> | null) {
    const persisted = this.getEvents(threadId);
    if (!thread || !Array.isArray(thread.turns)) return persisted;

    const persistedItemIds = new Set(
      persisted.map((event) => event.itemId).filter((itemId): itemId is string => Boolean(itemId)),
    );
    const trackedTurnIds = new Set(
      persisted
        .filter((event) => event.type === "turn.started")
        .map((event) => event.turnId)
        .filter((turnId): turnId is string => Boolean(turnId)),
    );
    const persistedTurnStart = new Map<string, string>(
      persisted
        .filter((event) => event.type === "turn.started" && event.turnId)
        .map((event) => [event.turnId as string, event.timestamp] as const),
    );

    const history: DashboardEvent[] = [];
    thread.turns.forEach((rawTurn: unknown, turnIndex: number) => {
      const turn = (rawTurn ?? {}) as Record<string, any>;
      const turnId = asString(turn.id) || `history-turn-${turnIndex}`;
      const fallbackStart = new Date(turnIndex * 1000).toISOString();
      const startedAt = persistedTurnStart.get(turnId) ?? timeFromCodex(turn.startedAt, fallbackStart);
      const items = Array.isArray(turn.items) ? turn.items : [];

      items.forEach((rawItem: unknown, itemIndex: number) => {
        const item = (rawItem ?? {}) as Record<string, any>;
        const itemId = asString(item.id) || `${turnId}-item-${itemIndex}`;
        if (persistedItemIds.has(itemId) || item.type === "reasoning") return;
        const timestamp = offsetTime(startedAt, itemIndex + 1);
        const base = {
          id: `history:${turnId}:${itemId}`,
          timestamp,
          threadId,
          turnId,
          itemId,
        };

        if (item.type === "userMessage") {
          if (trackedTurnIds.has(turnId)) return;
          const text = userMessageText(item);
          if (text) history.push({ ...base, type: "user.message", text });
          return;
        }

        if (item.type === "agentMessage" || item.type === "plan") {
          const text = cleanAgentText(asString(item.text));
          if (text) {
            history.push({
              ...base,
              type: "agent.message",
              text,
              toolName: item.type === "plan" ? "Codex plan" : undefined,
            });
          }
          return;
        }

        history.push({
          ...base,
          type: "tool.completed",
          status: asString(item.status) || undefined,
          toolName: item.type === "commandExecution" ? commandText(item) : item.type || "Codex tool",
          detail: historyToolDetail(item),
        });
      });

      if (!persisted.some((event) => event.type === "turn.completed" && event.turnId === turnId)) {
        const status = asString(turn.status);
        if (status && status !== "inProgress") {
          history.push({
            id: `history:${turnId}:completed`,
            timestamp: timeFromCodex(turn.completedAt, offsetTime(startedAt, items.length + 2)),
            type: "turn.completed",
            threadId,
            turnId,
            status,
            summary: asString(turn.error?.message) || undefined,
          });
        }
      }
    });

    return [...history, ...persisted].sort((a, b) => {
      const byTime = a.timestamp.localeCompare(b.timestamp);
      if (byTime !== 0) return byTime;
      return a.id.localeCompare(b.id);
    });
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
      const eventPrNumbers = threadEvents
        .map((event) => event.prNumber)
        .filter((number): number is number => Number.isInteger(number));

      tasks.push({
        threadId,
        repo,
        issueNumber:
          issueBinding?.number ??
          prBindings.find((binding) => Number.isInteger(binding.sourceIssueNumber))?.sourceIssueNumber,
        prNumbers: [...new Set([...prBindings.map((binding) => binding.number), ...eventPrNumbers])].sort(
          (a, b) => a - b,
        ),
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
    prNumber?: number;
  }) {
    return this.publish({
      type: "turn.completed",
      threadId: input.context.threadId,
      turnId: input.turnId,
      repo: input.context.repo,
      kind: input.context.kind,
      number: input.context.number,
      prNumber: input.prNumber,
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
      if (
        item.type === "agentMessage" ||
        item.type === "plan" ||
        item.type === "reasoning" ||
        item.type === "userMessage"
      ) {
        return;
      }
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
      if (item.type === "reasoning" || item.type === "userMessage") return;
      if ((item.type === "agentMessage" || item.type === "plan") && typeof item.text === "string") {
        const text = cleanAgentText(item.text);
        if (!text) return;
        void this.publish({
          type: "agent.message",
          threadId,
          turnId: turnId || undefined,
          itemId: asString(item.id) || undefined,
          text,
          toolName: item.type === "plan" ? "Codex plan" : undefined,
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
      this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      });
      await this.writeChain;
    }

    for (const subscriber of this.subscribers) subscriber(event);
    return event;
  }
}
