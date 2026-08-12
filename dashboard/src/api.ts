import type { AgentThreadResponse, DashboardEvent, DashboardTask } from "./types";

const readJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
};

export const fetchTasks = () => readJson<DashboardTask[]>("/api/tasks");

export const fetchTaskEvents = (threadId: string) =>
  readJson<DashboardEvent[]>(`/api/tasks/${encodeURIComponent(threadId)}/events`);

export const fetchAgentThread = (threadId: string) =>
  readJson<AgentThreadResponse>(`/api/threads/${encodeURIComponent(threadId)}`);
