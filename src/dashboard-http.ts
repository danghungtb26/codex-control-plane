import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BindingStore } from "./binding-store.js";
import type { DashboardStore } from "./dashboard-store.js";
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

export class DashboardHttp {
  private readonly distPath = path.resolve("dashboard/dist");

  constructor(
    private readonly dashboard: DashboardStore,
    private readonly bindings: BindingStore,
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
      sendJson(res, 200, this.dashboard.getEvents(threadId));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      this.openEventStream(req, res);
      return true;
    }

    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
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
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
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
