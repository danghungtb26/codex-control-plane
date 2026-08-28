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

const githubPrReceiptInstructions = [
  "After the pull request exists, your FINAL reply must also include these machine-readable PR receipt lines:",
  "GITHUB_PR_NUMBER=<numeric pull request number>",
  "GITHUB_PR_URL=<full GitHub pull request URL>",
  "Get the real PR number/url from `gh` or the GitHub API; never invent them. Include these PR receipt lines whenever the PR exists, even if posting the completion comment fails.",
].join("\n");

export const withRepositoryTaskWorkflow = (task: string) =>
  [
    task.trim(),
    "Repository autonomous-workflow requirement:",
    "Before changing files, inspect the repository's AGENTS.md/instructions and available task/workflow skills.",
    "If `game-task-workflow` exists or repository policy declares it as the top-level workflow, you MUST explicitly use `game-task-workflow` as the main-agent control plane before any specialist skill. Do not bypass it by invoking `game-godot`, `game-ui-pipeline`, `game-asset-pipeline`, `gdd-designer`, `plan-writer`, or `game-runtime-audit` directly as the top-level workflow.",
    "The current durable Codex conversation is the main agent. Keep orchestration, plan approval, implementation-diff review, QA arbitration, repair decisions, final PASS/BLOCKED, and publishing authority in the main conversation. Subagent output is evidence, not authority.",
    "When the repository workflow supports delegation, use bounded subagent runs for implementation and independent QA. Implementation and QA must be logically separate; main-agent review happens before QA; QA reports findings rather than silently repairing them; the main agent decides whether findings are accepted, rejected, or need more evidence before delegating repairs.",
    "Do not let a specialist worker or implementer self-certify task completion. Publish only after the main agent has completed the repository-required review/QA gates and decided PASS.",
    "If this repository does not define `game-task-workflow`, follow its own top-level repository workflow and authority rules instead of inventing a missing skill.",
  ].join("\n\n");

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
    withRepositoryTaskWorkflow(task),
    "Issue implementation workflow:",
    "Inspect the issue requirements, repository, and existing working tree first. Do not overwrite or discard unrelated local changes.",
    `Use a dedicated branch for issue #${issueNumber}. Implement the task with minimal maintainable scope and run the repository-required focused tests, independent QA, and broader checks when applicable.`,
    "Do not publish merely because an implementation worker says it is done. Complete the main-agent review and repository-required QA/arbitration/repair loop first.",
    "After the main agent decides PASS, create a real git commit containing the task-related changes. Do not create an empty commit when there are no changes.",
    "Push the implementation branch to the configured remote.",
    `Create or update exactly one pull request for this issue. The PR body must contain \`Closes #${issueNumber}\` so the control plane can inherit this same Codex thread for later fixes.`,
    "After the PR exists, post exactly one completion comment on that PR with completion/blocker status, concise summary, commit/branch information, files changed, tests/checks and results, and any remaining blocker/follow-up.",
    githubPrReceiptInstructions,
    githubReportReceiptInstructions,
    "Do not merge the PR.",
    "If commit, push, PR creation, or GitHub commenting is blocked, report the exact blocker instead of claiming success.",
  ].join("\n\n");

export const withGithubCreatePr = ({ repo, issueNumber, task }: GithubIssueTaskPromptInput) =>
  [
    `You are creating or recovering the pull request for GitHub issue ${repo}#${issueNumber} from its existing implementation conversation.`,
    task.trim(),
    "PR creation/recovery workflow:",
    "Inspect the current branch and working tree. Do not discard unrelated local changes. Ensure the intended implementation is committed; do not invent or rewrite work just to create the PR.",
    `Push the implementation branch, then create or update exactly one pull request for this issue. The PR body must contain \`Closes #${issueNumber}\` so the control plane can inherit the Issue thread.`,
    "After the PR exists, post exactly one completion comment on that PR with status, concise summary, commit/branch information, tests/checks already known, and any blocker/follow-up.",
    githubPrReceiptInstructions,
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
