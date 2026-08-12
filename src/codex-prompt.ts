type GithubCompletionPromptInput = {
  repo: string;
  prNumber: number;
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
