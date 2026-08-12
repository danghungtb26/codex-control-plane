export type JsonObject = Record<string, unknown>;

export type BindingKind = "issue" | "pr";
export type CodexAction = "implement" | "fix-comment" | "summary" | "create-pr" | "manual";

export type Binding = {
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  cwd: string;
  sourceIssueNumber?: number;
  createdAt: string;
  updatedAt: string;
};

export type RemoteBindingMarker = {
  version: 1;
  repo: string;
  kind: BindingKind;
  number: number;
  threadId: string;
  sourceIssueNumber?: number;
};

export type DispatchMessage = {
  repo: string;
  targetKind: BindingKind;
  number: number;
  sender: string;
  action: Exclude<CodexAction, "manual">;
  text: string;
  url?: string;
};
