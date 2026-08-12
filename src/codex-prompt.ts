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

export const withGithubCompletionComment = ({ repo, prNumber, task }: GithubCompletionPromptInput) =>
  [
    task.trim(),
    "Completion requirement:",
    `When this work is finished, always post exactly one completion comment to GitHub PR ${repo}#${prNumber}.`,
    "Use `gh pr comment` from the current workspace. The comment must include: completion/blocker status, a concise summary of what was done, files changed (if any), tests/checks run and their results, and any remaining follow-up or blocker.",
    "Do not merge the PR unless the task explicitly asks you to merge it.",
    "If GitHub/network access or `gh` authentication prevents posting the comment, do not silently claim success: clearly report that the required PR comment could not be posted and why.",
  ].join("\n\n");

export const withGithubIssueImplementation = ({ repo, issueNumber, task }: GithubIssueTaskPromptInput) =>
  [
    `You are implementing GitHub issue ${repo}#${issueNumber} in a new durable Codex conversation.`,
    task.trim(),
    "Implementation workflow:",
    "Inspect the repository and existing working tree first. Implement the task with minimal, maintainable scope and run the most relevant tests/checks.",
    `Use a dedicated branch for issue #${issueNumber}. When the implementation is ready and network access is available, commit and push the branch, then create or update a pull request whose body contains \`Closes #${issueNumber}\` so the control plane can inherit this same Codex thread for future review fixes.`,
    "After the PR exists, post exactly one completion comment on that PR with completion/blocker status, summary, files changed, tests/checks and results, and remaining follow-up/blockers.",
    "Do not merge the PR unless explicitly asked. If GitHub/network access or `gh` authentication blocks push/PR/comment creation, report that clearly instead of claiming remote completion.",
  ].join("\n\n");
