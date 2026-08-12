export type JsonObject = Record<string, unknown>;

export type Binding = {
  repo: string;
  prNumber: number;
  threadId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
};

export type DispatchMessage = {
  repo: string;
  prNumber: number;
  sender: string;
  kind: "review" | "inline-review" | "command";
  text: string;
  url?: string;
};
