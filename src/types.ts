export type JsonObject = Record<string, unknown>;

export type BindingKind = "issue" | "pr";

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
  kind: "review" | "inline-review" | "command";
  text: string;
  url?: string;
};
