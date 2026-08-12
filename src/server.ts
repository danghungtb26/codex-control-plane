import "./simple-env.js";
import { createServer } from "node:http";
import { BindingStore } from "./binding-store.js";
import { CodexAppServerClient } from "./codex-client.js";
import { loadConfig } from "./config.js";
import { ReviewDispatcher } from "./dispatcher.js";
import { parseGithubEvent, verifyGithubSignature } from "./github-webhook.js";
import { readBody, sendJson } from "./http-utils.js";

const config = loadConfig();
const store = new BindingStore();
await store.load();

const codex = new CodexAppServerClient(config.codexBin, config.codexAllowNetwork);
await codex.start();

const dispatcher = new ReviewDispatcher(store, codex, config);
const seenDeliveries = new Set<string>();
const rememberDelivery = (id: string) => {
  if (!id) return false;
  if (seenDeliveries.has(id)) return true;
  seenDeliveries.add(id);
  if (seenDeliveries.size > 1000) {
    const oldest = seenDeliveries.values().next().value;
    if (oldest) seenDeliveries.delete(oldest);
  }
  return false;
};

const webhookServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method !== "POST" || req.url !== "/github/webhook") {
      return sendJson(res, 404, { error: "not found" });
    }

    const rawBody = await readBody(req);
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!verifyGithubSignature(rawBody, signature, config.githubWebhookSecret)) {
      return sendJson(res, 401, { error: "invalid signature" });
    }

    const deliveryId = String(req.headers["x-github-delivery"] ?? "");
    if (rememberDelivery(deliveryId)) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    const event = String(req.headers["x-github-event"] ?? "");
    const payload = JSON.parse(rawBody.toString("utf8"));

    if (event === "ping") {
      console.log("[github] ping received");
      return sendJson(res, 200, { ok: true, pong: true });
    }

    const message = parseGithubEvent(event, payload, config);
    if (!message) {
      console.log(`[github] ignored event=${event} action=${payload.action ?? ""}`);
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    console.log(`[github] accepted ${event} for ${message.repo}#${message.prNumber} from @${message.sender}`);
    dispatcher.enqueue(message);
    return sendJson(res, 202, { ok: true, queued: true });
  } catch (error) {
    console.error("[webhook] error:", error);
    return sendJson(res, 500, { error: (error as Error).message });
  }
});

const adminServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/bindings") {
      return sendJson(res, 200, store.list());
    }

    if (req.method === "POST" && req.url === "/bindings") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const prNumber = Number(body.prNumber);
      const threadId = String(body.threadId ?? "");
      const cwd = String(body.cwd ?? "");
      if (!repo || !Number.isInteger(prNumber) || !threadId || !cwd) {
        return sendJson(res, 400, { error: "repo, prNumber, threadId, cwd are required" });
      }
      const binding = await store.set({ repo, prNumber, threadId, cwd });
      return sendJson(res, 201, binding);
    }

    if (req.method === "POST" && req.url === "/tasks") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const prNumber = Number(body.prNumber);
      const cwd = String(body.cwd ?? "");
      const message = String(body.message ?? "");
      if (!repo || !Number.isInteger(prNumber) || !cwd || !message) {
        return sendJson(res, 400, { error: "repo, prNumber, cwd, message are required" });
      }
      if (!config.allowedRepos.has(repo.toLowerCase())) {
        return sendJson(res, 403, { error: `repo ${repo} is not in GITHUB_ALLOWED_REPOS` });
      }

      const { threadId } = await codex.startThread(cwd);
      const binding = await store.set({ repo, prNumber, threadId, cwd });
      const turn = await codex.startTurn(threadId, message, {
        cwd,
        allowNetwork: config.codexAllowNetwork,
      });
      return sendJson(res, 201, { binding, turn });
    }

    if (req.method === "POST" && req.url === "/send") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const prNumber = Number(body.prNumber);
      const message = String(body.message ?? "");
      const binding = store.get(repo, prNumber);
      if (!binding) return sendJson(res, 404, { error: "binding not found" });
      if (!message) return sendJson(res, 400, { error: "message is required" });
      const turn = await codex.send(binding.threadId, message, {
        cwd: binding.cwd,
        allowNetwork: config.codexAllowNetwork,
      });
      return sendJson(res, 202, turn);
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    console.error("[admin] error:", error);
    return sendJson(res, 500, { error: (error as Error).message });
  }
});

webhookServer.listen(config.webhookPort, "127.0.0.1", () => {
  console.log(`[bridge] GitHub webhook: http://127.0.0.1:${config.webhookPort}/github/webhook`);
});

adminServer.listen(config.adminPort, "127.0.0.1", () => {
  console.log(`[bridge] local admin API: http://127.0.0.1:${config.adminPort}`);
});

const shutdown = () => {
  console.log("\n[bridge] shutting down");
  webhookServer.close();
  adminServer.close();
  codex.stop();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
