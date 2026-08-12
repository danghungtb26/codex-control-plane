export type CodexAction = "implement" | "fix-comment" | "summary" | "create-pr" | "manual";

export type DashboardTask = {
  threadId: string;
  repo: string;
  issueNumber?: number;
  prNumbers: number[];
  status: string;
  action?: CodexAction;
  request?: string;
  commitBefore?: string;
  commitAfter?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardEvent = {
  id: string;
  timestamp: string;
  type:
    | "task.started"
    | "task.failed"
    | "turn.started"
    | "turn.completed"
    | "agent.delta"
    | "agent.message"
    | "tool.started"
    | "tool.completed"
    | "codex.error";
  threadId: string;
  turnId?: string;
  itemId?: string;
  repo?: string;
  kind?: "issue" | "pr";
  number?: number;
  action?: CodexAction;
  request?: string;
  status?: string;
  summary?: string;
  commitBefore?: string;
  commitAfter?: string;
  text?: string;
  toolName?: string;
  detail?: string;
};
