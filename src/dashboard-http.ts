import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BindingStore } from "./binding-store.js";
import type { CodexAppServerClient } from "./codex-client.js";
import type { DashboardEvent, DashboardStore } from "./dashboard-store.js";
import { sendJson } from "./http-utils.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const contentTypeFor = (filePath: string) => MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";

const withTimeout = <T>(promise: Promise<T>, milliseconds: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Codex history read timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]);

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const threadStatus = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "unknown";
  const status = value as Record<string, unknown>;
  return asString(status.type) || asString(status.status) || "unknown";
};

const normalizeDashboardEvent = (event: DashboardEvent): DashboardEvent => {
  if (event.toolName !== "collabAgentToolCall") return event;
  return { ...event, toolName: "collabToolCall" };
};

const normalizeDashboardEvents = (events: DashboardEvent[]) => events.map(normalizeDashboardEvent);

export class DashboardHttp {
  private readonly distPath = path.resolve("dashboard/dist");

  constructor(
    private readonly dashboard: DashboardStore,
    private readonly bindings: BindingStore,
    private readonly codex: CodexAppServerClient,
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      sendJson(res, 200, this.dashboard.listTasks(this.bindings.list()));
      return true;
    }

    const eventsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/events$/);
    if (req.method === "GET" && eventsMatch) {
      const threadId = decodeURIComponent(eventsMatch[1]);
      let thread: Record<string, any> | null = null;
      try {
        thread = await withTimeout(this.codex.readThread(threadId, true), 5000);
      } catch (error) {
        console.warn(`[dashboard] history unavailable for ${threadId}:`, (error as Error).message);
      }
      sendJson(res, 200, normalizeDashboardEvents(this.dashboard.mergeThreadHistory(threadId, thread)));
      return true;
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (req.method === "GET" && threadMatch) {
      const threadId = decodeURIComponent(threadMatch[1]);
      let thread: Record<string, any> | null = null;
      try {
        thread = await withTimeout(this.codex.readThread(threadId, true), 5000);
      } catch (error) {
        console.warn(`[dashboard] agent thread unavailable for ${threadId}:`, (error as Error).message);
      }

      sendJson(res, 200, {
        thread: {
          id: threadId,
          parentThreadId: asString(thread?.parentThreadId) || undefined,
          agentNickname: asString(thread?.agentNickname) || undefined,
          agentRole: asString(thread?.agentRole) || undefined,
          status: threadStatus(thread?.status),
        },
        events: normalizeDashboardEvents(this.dashboard.mergeThreadHistory(threadId, thread)),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      this.openEventStream(req, res);
      return true;
    }

    const isUiAsset = url.pathname === "/" || url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico";
    if (req.method === "GET" && isUiAsset) {
      await this.serveUi(url.pathname, res);
      return true;
    }

    return false;
  }

  private openEventStream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    const unsubscribe = this.dashboard.subscribe((event) => {
      const normalized = normalizeDashboardEvent(event);
      res.write(`id: ${normalized.id}\ndata: ${JSON.stringify(normalized)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  private async serveUi(pathname: string, res: ServerResponse) {
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = path.resolve(this.distPath, requested);
    if (!candidate.startsWith(`${this.distPath}${path.sep}`) && candidate !== this.distPath) {
      return sendJson(res, 400, { error: "invalid dashboard path" });
    }

    let filePath = candidate;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      filePath = path.join(this.distPath, "index.html");
    }

    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        "content-type": contentTypeFor(filePath),
        "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      });
      res.end(body);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end(
          "Dashboard is not built yet. Run `bun install` then `bun run dashboard:build`, or use `bun run dashboard:dev` during development.\n",
        );
        return;
      }
      throw error;
    }
  }
}
