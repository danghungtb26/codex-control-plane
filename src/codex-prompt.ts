type GithubCompletionPromptInput = {
  repo: string;
  prNumber: number;
  task: string;
};

type GithubIssueTaskPromptInput = {
  repo: string;
  issueNumber: number;
  task: string;
};

type GithubSummaryPromptInput = {
  repo: string;
  kind: "issue" | "pr";
  number: number;
  task: string;
};

const finalSummaryInstructions = [
  "Your FINAL reply must include one concise machine-readable summary line:",
  "CODEX_TASK_SUMMARY=<single-line summary of what you did or found>",
  "Keep it factual and under 300 characters.",
].join("\n");

const githubReportReceiptInstructions = [
  "After posting the completion comment, your FINAL reply must include these machine-readable receipt lines:",
  "GITHUB_REPORT_COMMENT_ID=<numeric GitHub issue-comment id>",
  "GITHUB_REPORT_COMMENT_URL=<full GitHub comment URL>",
  "Get the real comment id/url from the GitHub CLI/API response; never invent them. If you could not post the comment, omit both receipt lines and clearly explain why.",
  finalSummaryInstructions,
].join("\n");

export const withGithubCompletionComment = ({ repo, prNumber, task }: GithubCompletionPromptInput) =>
  [
    task.trim(),
    "Completion requirement:",
    `When this work is finished, post exactly one completion comment to GitHub PR ${repo}#${prNumber} yourself before ending the turn.`,
    "Use `gh pr comment` or `gh api` from the current workspace. The comment must include: completion/blocker status, a concise summary of what was done, files changed (if any), tests/checks run and their results, and any remaining follow-up or blocker.",
    githubReportReceiptInstructions,
    "Do not merge the PR unless the task explicitly asks you to merge it.",
    "If GitHub/network access or `gh` authentication prevents posting the comment, do not silently claim success: clearly report that the required PR comment could not be posted and why. The control plane may post a fallback report when no valid receipt is returned.",
  ].join("\n\n");

export const withGithubIssueImplementation = ({ repo, issueNumber, task }: GithubIssueTaskPromptInput) =>
  [
    `You are implementing GitHub issue ${repo}#${issueNumber} in its durable Codex conversation.`,
    task.trim(),
    "Implementation workflow:",
    "Inspect the issue requirements, repository, and existing working tree first. Use a dedicated branch for this issue, implement the task with minimal maintainable scope, and run the most relevant focused tests plus the broader suite when practical.",
    "Commit the completed implementation locally when appropriate so the resulting commit ID is durable.",
    "Do NOT create or update a pull request in this action. PR creation is a separate `/codex:create-pr` action.",
    "Do NOT merge anything.",
    finalSummaryInstructions,
  ].join("\n\n");

export const withGithubCreatePr = ({ repo, issueNumber, task }: GithubIssueTaskPromptInput) =>
  [
    `You are creating the pull request for GitHub issue ${repo}#${issueNumber} from its existing implementation conversation.`,
    task.trim(),
    "PR creation workflow:",
    "Inspect the current branch and working tree. Do not discard unrelated local changes. Ensure the intended implementation is committed; do not invent or rewrite work just to create the PR.",
    "Push the implementation branch, then create or update exactly one pull request for this issue. The PR body must contain `Closes #" + issueNumber + "` so the control plane can inherit the Issue thread.",
    "After the PR exists, post exactly one completion comment on that PR with status, concise summary, commit/branch information, tests/checks already known, and any blocker/follow-up.",
    githubReportReceiptInstructions,
    "Do not merge the PR.",
  ].join("\n\n");

export const withGithubSummary = ({ repo, kind, number, task }: GithubSummaryPromptInput) => {
  const label = kind === "pr" ? `PR ${repo}#${number}` : `Issue ${repo}#${number}`;
  return [
    `Summarize the current state of GitHub ${label}.`,
    task.trim(),
    "This is a reporting-only action. Inspect relevant repository/GitHub state, commits, tests, open comments, blockers, and remaining work as useful.",
    "Do NOT modify implementation files, create commits, switch branches unnecessarily, push, create a PR, or merge anything.",
    `Post exactly one summary comment to the ${kind === "pr" ? "PR" : "Issue"} before ending the turn.`,
    githubReportReceiptInstructions,
  ].join("\n\n");
};
