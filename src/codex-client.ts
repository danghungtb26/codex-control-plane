import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { JsonObject } from "./types.js";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type StartTurnOptions = {
  cwd?: string;
  allowNetwork?: boolean;
};

export type TurnCompletedEvent = {
  threadId: string;
  turnId: string;
  status: string;
  finalText: string;
  raw: Record<string, any>;
};

export type CodexNotificationEvent = {
  method: string;
  params: Record<string, any>;
};

export class CodexAppServerClient extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private activeTurns = new Map<string, string>();
  private turnThreads = new Map<string, string>();
  private finalAgentMessages = new Map<string, string>();
  private loadedThreads = new Set<string>();

  constructor(
    private readonly codexBin: string,
    private readonly defaultAllowNetwork: boolean,
    private readonly autoApprove: boolean,
  ) {
    super();
  }

  async start() {
    if (this.proc) return;

    const proc = spawn(this.codexBin, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.proc = proc;

    proc.stderr.on("data", (chunk) => {
      process.stderr.write(`[codex app-server] ${chunk}`);
    });

    proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.proc = undefined;
      this.loadedThreads.clear();
      this.activeTurns.clear();
      this.turnThreads.clear();
      this.finalAgentMessages.clear();
      this.emit("exit", error);
    });

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handleMessage(JSON.parse(line) as JsonObject);
      } catch (error) {
        console.error("[codex] failed to parse message", line, error);
      }
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex_control_plane",
        title: "Codex Control Plane",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});

    const account = await this.request("account/read", { refreshToken: false });
    console.log("[codex] connected account:", JSON.stringify(account));
    console.log(`[codex] access: ${this.autoApprove ? "danger-full-access" : "workspace-write"}`);
  }

  stop() {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
  }

  async startThread(cwd: string) {
    const result = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: this.autoApprove ? "danger-full-access" : "workspace-write",
      serviceName: "codex_control_plane",
    });

    const threadId = String(result.thread.id);
    this.loadedThreads.add(threadId);
    return { threadId, thread: result.thread };
  }

  async resumeThread(threadId: string) {
    const result = await this.request("thread/resume", {
      threadId,
      approvalPolicy: "never",
      sandbox: this.autoApprove ? "danger-full-access" : "workspace-write",
    });
    this.loadedThreads.add(threadId);
    return result.thread;
  }

  async startTurn(threadId: string, message: string, options: StartTurnOptions = {}) {
    await this.ensureThreadLoaded(threadId);

    const params: Record<string, unknown> = {
      threadId,
      input: [{ type: "text", text: message }],
      approvalPolicy: "never",
    };

    if (options.cwd) {
      params.cwd = options.cwd;
      if (this.autoApprove) {
        params.sandboxPolicy = {
          type: "dangerFullAccess",
        };
      } else {
        const allowNetwork = options.allowNetwork ?? this.defaultAllowNetwork;
        params.sandboxPolicy = {
          type: "workspaceWrite",
          writableRoots: [options.cwd],
          networkAccess: allowNetwork,
        };
      }
    }

    const result = await this.request("turn/start", params);
    const turnId = String(result.turn.id);
    this.activeTurns.set(threadId, turnId);
    this.turnThreads.set(turnId, threadId);
    return { threadId, turnId };
  }

  async steer(threadId: string, message: string) {
    const turnId = this.activeTurns.get(threadId);
    if (!turnId) throw new Error(`Thread ${threadId} has no active turn`);

    const result = await this.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: "text", text: message }],
    });
    return { threadId, turnId: String(result.turnId) };
  }

  async interrupt(threadId: string) {
    const turnId = this.activeTurns.get(threadId);
    if (!turnId) {
      return { threadId, turnId: null, interrupted: false };
    }

    await this.request("turn/interrupt", {
      threadId,
      turnId,
    });

    return { threadId, turnId, interrupted: true };
  }

  async send(threadId: string, message: string, options: StartTurnOptions = {}) {
    await this.ensureThreadLoaded(threadId);
    const activeTurnId = this.activeTurns.get(threadId);
    if (activeTurnId) {
      try {
        console.log(`[codex] steering ${threadId} / ${activeTurnId}`);
        return await this.steer(threadId, message);
      } catch (error) {
        console.warn("[codex] steer failed; retrying as a new turn:", (error as Error).message);
        this.activeTurns.delete(threadId);
      }
    }

    console.log(`[codex] starting new turn on ${threadId}`);
    return this.startTurn(threadId, message, options);
  }

  getActiveTurn(threadId: string) {
    return this.activeTurns.get(threadId) ?? null;
  }

  private async ensureThreadLoaded(threadId: string) {
    if (this.loadedThreads.has(threadId)) return;
    await this.resumeThread(threadId);
  }

  private request(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextRequestId++;
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendRaw({ id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}) {
    this.sendRaw({ method, params });
  }

  private sendRaw(message: Record<string, unknown>) {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleMessage(message: JsonObject) {
    const id = typeof message.id === "number" ? message.id : undefined;
    const method = typeof message.method === "string" ? message.method : undefined;

    if (id !== undefined && !method) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);

      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (id !== undefined && method) {
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      ) {
        this.sendRaw({ id, result: { decision: this.autoApprove ? "accept" : "decline" } });
        return;
      }

      if (method === "item/permissions/requestApproval") {
        const params = (message.params ?? {}) as Record<string, any>;
        const requested = (params.permissions ?? {}) as Record<string, unknown>;
        this.sendRaw({ id, result: { permissions: this.autoApprove ? requested : {} } });
        return;
      }

      if (method === "item/tool/requestUserInput") {
        this.sendRaw({ id, error: { code: -32601, message: "No interactive user input in bridge mode" } });
        return;
      }

      this.sendRaw({ id, error: { code: -32601, message: `Unsupported server request: ${method}` } });
      return;
    }

    if (!method) return;
    const params = (message.params ?? {}) as Record<string, any>;
    this.emit("notification", { method, params } satisfies CodexNotificationEvent);

    if (method === "turn/started") {
      const threadId = String(params.threadId ?? "");
      const turnId = String(params.turn?.id ?? "");
      if (threadId && turnId) {
        this.activeTurns.set(threadId, turnId);
        this.turnThreads.set(turnId, threadId);
      }
      return;
    }

    if (method === "item/completed") {
      const item = params.item ?? {};
      if (item.type === "agentMessage" && typeof item.text === "string") {
        const turnId = String(params.turnId ?? this.activeTurns.get(String(params.threadId ?? "")) ?? "");
        if (turnId) this.finalAgentMessages.set(turnId, item.text);
      }
      return;
    }

    if (method === "turn/completed") {
      const turnId = String(params.turn?.id ?? "");
      const threadId = String(params.threadId ?? this.turnThreads.get(turnId) ?? "");
      const status = String(params.turn?.status ?? "unknown");
      const finalText = this.finalAgentMessages.get(turnId) ?? "";
      if (threadId && this.activeTurns.get(threadId) === turnId) this.activeTurns.delete(threadId);
      if (turnId) {
        this.turnThreads.delete(turnId);
        this.finalAgentMessages.delete(turnId);
      }
      console.log(`[codex] turn completed ${turnId}: ${status}`);
      this.emit("turnCompleted", {
        threadId,
        turnId,
        status,
        finalText,
        raw: params,
      } satisfies TurnCompletedEvent);
      return;
    }

    if (method === "item/agentMessage/delta") {
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (delta) process.stdout.write(delta);
      return;
    }

    if (method === "error") {
      console.error("[codex] turn error:", JSON.stringify(params));
    }
  }
}
