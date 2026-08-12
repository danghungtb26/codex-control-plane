import { createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import type { DispatchMessage } from "./types.js";

type GithubPayload = Record<string, any>;

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

export const parseGithubEvent = (
  event: string,
  payload: GithubPayload,
  config: Config,
): DispatchMessage | null => {
  const repo = clean(payload.repository?.full_name);
  const sender = clean(payload.sender?.login);
  if (!repo || !sender || !isAllowed(config, repo, sender)) return null;

  if (event === "pull_request_review" && payload.action === "submitted") {
    const number = Number(payload.pull_request?.number);
    const state = clean(payload.review?.state).toLowerCase();
    const body = clean(payload.review?.body);
    if (!Number.isInteger(number)) return null;
    if (!["changes_requested", "commented"].includes(state)) return null;
    if (!body && state !== "changes_requested") return null;

    return {
      repo,
      targetKind: "pr",
      number,
      sender,
      kind: "review",
      url: clean(payload.review?.html_url),
      text: [
        `GitHub review submitted by @${sender}.`,
        `State: ${state}.`,
        body ? `Review body:\n${body}` : "Review requested changes but has no summary body; inspect the PR review comments for context if available locally.",
      ].join("\n\n"),
    };
  }

  if (
    event === "pull_request_review_comment" &&
    payload.action === "created" &&
    config.forwardInlineReviewComments
  ) {
    const number = Number(payload.pull_request?.number);
    const body = clean(payload.comment?.body);
    if (!Number.isInteger(number) || !body) return null;

    const path = clean(payload.comment?.path);
    const line = payload.comment?.line ?? payload.comment?.original_line ?? "?";
    return {
      repo,
      targetKind: "pr",
      number,
      sender,
      kind: "inline-review",
      url: clean(payload.comment?.html_url),
      text: [
        `Inline PR review comment from @${sender}.`,
        path ? `Location: ${path}:${line}` : "",
        `Comment:\n${body}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  if (event === "issue_comment" && payload.action === "created") {
    const number = Number(payload.issue?.number);
    const body = clean(payload.comment?.body);
    if (!Number.isInteger(number) || !body) return null;

    const match = body.match(/^\/codex(?:-fix)?\s+([\s\S]+)$/i);
    if (!match) return null;

    return {
      repo,
      targetKind: payload.issue?.pull_request ? "pr" : "issue",
      number,
      sender,
      kind: "command",
      url: clean(payload.comment?.html_url),
      text: `Direct GitHub command from @${sender}:\n\n${match[1].trim()}`,
    };
  }

  return null;
};
