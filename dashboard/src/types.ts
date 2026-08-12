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
    | "user.message"
    | "agent.delta"
    | "agent.message"
    | "tool.started"
    | "tool.completed"
    | "subagent.thread"
    | "subagent.activity"
    | "codex.error";
  threadId: string;
  turnId?: string;
  itemId?: string;
  repo?: string;
  kind?: "issue" | "pr";
  number?: number;
  prNumber?: number;
  action?: CodexAction;
  request?: string;
  status?: string;
  summary?: string;
  commitBefore?: string;
  commitAfter?: string;
  text?: string;
  toolName?: string;
  detail?: string;
  parentThreadId?: string;
  agentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  collabTool?: string;
  prompt?: string;
  agentStatus?: string;
};

export type AgentThread = {
  id: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  status: string;
};

export type AgentThreadResponse = {
  thread: AgentThread;
  events: DashboardEvent[];
};
