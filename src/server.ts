import "./simple-env.js";
import { createServer } from "node:http";
import { BindingResolver } from "./binding-resolver.js";
import { BindingStore } from "./binding-store.js";
import { CodexAppServerClient } from "./codex-client.js";
import { withGithubCompletionComment, withGithubIssueImplementation } from "./codex-prompt.js";
import { loadConfig } from "./config.js";
import { DiscordNotifier } from "./discord-notifier.js";
import { ReviewDispatcher } from "./dispatcher.js";
import { GithubBindingRegistry } from "./github-binding-registry.js";
import { parseGithubEvent, verifyGithubSignature } from "./github-webhook.js";
import { readBody, sendJson } from "./http-utils.js";
import { TurnNotifier } from "./turn-notifier.js";

const config = loadConfig();
const store = new BindingStore();
await store.load();

const githubBindings = new GithubBindingRegistry(config.ghBin);
const resolver = new BindingResolver(store, githubBindings, config);
const codex = new CodexAppServerClient(config.codexBin, config.codexAllowNetwork);
const discord = new DiscordNotifier(config.discordWebhookUrl);
const turnNotifier = new TurnNotifier(codex, discord);
await codex.start();

const dispatcher = new ReviewDispatcher(resolver, codex, turnNotifier, config);
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

    console.log(
      `[github] accepted ${event} for ${message.repo}#${message.prNumber} from @${message.sender}`,
    );
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

    if (req.method === "POST" && req.url === "/notifications/test") {
      await discord.sendTest();
      return sendJson(res, 200, { ok: true, provider: "discord" });
    }

    if (req.method === "POST" && req.url === "/bindings") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const kind = body.kind === "issue" ? "issue" : "pr";
      const number = Number(body.number ?? (kind === "issue" ? body.issueNumber : body.prNumber));
      const threadId = String(body.threadId ?? "");
      const cwd = String(body.cwd ?? "");
      const sourceIssueNumber =
        body.sourceIssueNumber == null ? undefined : Number(body.sourceIssueNumber);

      if (!repo || !Number.isInteger(number) || !threadId || !cwd) {
        return sendJson(res, 400, {
          error: "repo, kind/number, threadId, cwd are required",
        });
      }

      const binding = await resolver.bind(
        { repo, kind, number, threadId, cwd, sourceIssueNumber },
        Boolean(body.replace),
      );
      return sendJson(res, 201, binding);
    }

    if (req.method === "POST" && req.url === "/tasks") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const issueNumber = Number(body.issueNumber);
      const legacyPrNumber = Number(body.prNumber);
      const cwd = String(body.cwd ?? "");
      const message = String(body.message ?? "");

      if (
        !repo ||
        !cwd ||
        !message ||
        (!Number.isInteger(issueNumber) && !Number.isInteger(legacyPrNumber))
      ) {
        return sendJson(res, 400, {
          error: "repo, cwd, message and issueNumber (preferred) or prNumber are required",
        });
      }
      if (!config.allowedRepos.has(repo.toLowerCase())) {
        return sendJson(res, 403, { error: `repo ${repo} is not in GITHUB_ALLOWED_REPOS` });
      }

      await githubBindings.assertAuthenticated();

      if (Number.isInteger(issueNumber)) {
        const existing = await resolver.resolveIssue(repo, issueNumber, cwd);
        if (existing && !body.forceNewThread) {
          return sendJson(res, 409, {
            error: `issue #${issueNumber} is already bound to thread ${existing.threadId}; set forceNewThread=true only when you intentionally want to replace its conversation`,
          });
        }

        const { threadId } = await codex.startThread(cwd);
        const binding = await resolver.bind(
          { repo, kind: "issue", number: issueNumber, threadId, cwd },
          Boolean(body.forceNewThread),
        );
        const prompt = withGithubIssueImplementation({ repo, issueNumber, task: message });
        const turn = await codex.startTurn(threadId, prompt, {
          cwd,
          allowNetwork: config.codexAllowNetwork,
        });
        turnNotifier.register(turn.turnId, {
          repo,
          kind: "issue",
          number: issueNumber,
          threadId,
        });
        return sendJson(res, 201, { binding, turn });
      }

      const { threadId } = await codex.startThread(cwd);
      const binding = await resolver.bind(
        { repo, kind: "pr", number: legacyPrNumber, threadId, cwd },
        Boolean(body.forceNewThread),
      );
      const prompt = withGithubCompletionComment({
        repo,
        prNumber: legacyPrNumber,
        task: message,
      });
      const turn = await codex.startTurn(threadId, prompt, {
        cwd,
        allowNetwork: config.codexAllowNetwork,
      });
      turnNotifier.register(turn.turnId, {
        repo,
        kind: "pr",
        number: legacyPrNumber,
        threadId,
      });
      return sendJson(res, 201, { binding, turn, legacyMode: true });
    }

    if (req.method === "POST" && req.url === "/send") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const repo = String(body.repo ?? "");
      const prNumber = Number(body.prNumber);
      const message = String(body.message ?? "");
      if (!repo || !Number.isInteger(prNumber) || !message) {
        return sendJson(res, 400, { error: "repo, prNumber and message are required" });
      }

      const binding = await resolver.resolvePr(repo, prNumber);
      if (!binding) {
        return sendJson(res, 404, {
          error: `no existing Codex thread found for PR #${prNumber}; refusing to create a new fix conversation`,
        });
      }

      const prompt = withGithubCompletionComment({ repo, prNumber, task: message });
      const turn = await codex.send(binding.threadId, prompt, {
        cwd: binding.cwd,
        allowNetwork: config.codexAllowNetwork,
      });
      turnNotifier.register(turn.turnId, {
        repo,
        kind: "pr",
        number: prNumber,
        threadId: binding.threadId,
      });
      return sendJson(res, 202, { binding, turn });
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
  console.log(`[bridge] Discord notifications: ${discord.enabled ? "enabled" : "disabled"}`);
});

const shutdown = () => {
  console.log("\n[bridge] shutting down");
  webhookServer.close();
  adminServer.close();
  codex.stop();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
