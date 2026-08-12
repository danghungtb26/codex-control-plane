import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { BindingKind, CodexAction, DispatchMessage } from "./types.js";

type GithubPayload = Record<string, any>;
type WebhookAction = Exclude<CodexAction, "manual">;

type ParsedCommand = {
  action: WebhookAction;
  text: string;
};

export const verifyGithubSignature = (rawBody: Buffer, signature: string | undefined, secret: string) => {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
};

const isAllowed = (config: Config, repo: string, sender: string) =>
  config.allowedRepos.has(repo.toLowerCase()) && config.allowedSenders.has(sender.toLowerCase());

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isCreatedOrEdited = (action: unknown) => action === "created" || action === "edited";
const isSubmittedOrEdited = (action: unknown) => action === "submitted" || action === "edited";

const parseCommand = (body: string): ParsedCommand | null => {
  const match = body.match(/^\/codex:(implement|fix-comment|summary|create-pr)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return {
    action: match[1].toLowerCase() as WebhookAction,
    text: (match[2] ?? "").trim(),
  };
};

const isActionAllowed = (action: WebhookAction, targetKind: BindingKind) => {
  if (action === "implement" || action === "create-pr") return targetKind === "issue";
  if (action === "fix-comment") return targetKind === "pr";
  return true;
};

const buildMessage = (input: {
  repo: string;
  targetKind: BindingKind;
  number: number;
  sender: string;
  command: ParsedCommand;
  url?: string;
  context?: string;
}): DispatchMessage | null => {
  if (!isActionAllowed(input.command.action, input.targetKind)) return null;
  const text = [input.context, input.command.text].filter(Boolean).join("\n\n");
  return {
    repo: input.repo,
    targetKind: input.targetKind,
    number: input.number,
    sender: input.sender,
    action: input.command.action,
    text,
    url: input.url,
  };
};

export const parseGithubEvent = (
  event: string,
  payload: GithubPayload,
  config: Config,
): DispatchMessage | null => {
  const repo = clean(payload.repository?.full_name);
  const sender = clean(payload.sender?.login);
  if (!repo || !sender || !isAllowed(config, repo, sender)) return null;

  if (event === "pull_request_review" && isSubmittedOrEdited(payload.action)) {
    const number = Number(payload.pull_request?.number);
    const body = clean(payload.review?.body);
    const command = parseCommand(body);
    if (!Number.isInteger(number) || !command) return null;
    return buildMessage({
      repo,
      targetKind: "pr",
      number,
      sender,
      command,
      url: clean(payload.review?.html_url),
      context: `GitHub PR review command from @${sender}. Review state: ${clean(payload.review?.state) || "unknown"}.`,
    });
  }

  if (event === "pull_request_review_comment" && isCreatedOrEdited(payload.action)) {
    const number = Number(payload.pull_request?.number);
    const body = clean(payload.comment?.body);
    const command = parseCommand(body);
    if (!Number.isInteger(number) || !command) return null;

    const path = clean(payload.comment?.path);
    const line = payload.comment?.line ?? payload.comment?.original_line ?? "?";
    return buildMessage({
      repo,
      targetKind: "pr",
      number,
      sender,
      command,
      url: clean(payload.comment?.html_url),
      context: [
        `Inline PR command from @${sender}.`,
        path ? `Location: ${path}:${line}` : "",
        "Inspect the referenced review thread/comment for the exact requested change.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  if (event === "issue_comment" && isCreatedOrEdited(payload.action)) {
    const number = Number(payload.issue?.number);
    const body = clean(payload.comment?.body);
    const command = parseCommand(body);
    if (!Number.isInteger(number) || !command) return null;

    const targetKind: BindingKind = payload.issue?.pull_request ? "pr" : "issue";
    return buildMessage({
      repo,
      targetKind,
      number,
      sender,
      command,
      url: clean(payload.comment?.html_url),
      context: `Direct GitHub ${targetKind === "pr" ? "PR" : "Issue"} command from @${sender}.`,
    });
  }

  return null;
};
