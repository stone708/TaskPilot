import { normalizeTask, Task } from "./types";

type ErrorBody = { error?: string | { message?: string } };

export type TaskInput = Pick<
  Task,
  | "title"
  | "description"
  | "status"
  | "priority"
  | "startAt"
  | "dueAt"
  | "tags"
  | "subtasks"
  | "related"
> & {
  version?: number;
};

async function request<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    signal,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & ErrorBody;
  if (!response.ok) {
    const error =
      typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(error || "Request failed");
  }
  return body;
}

export function taskInput(task: Task): TaskInput {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    startAt: task.startAt,
    dueAt: task.dueAt,
    tags: task.tags,
    subtasks: task.subtasks,
    related: task.related,
    ...(task.id ? { version: task.version } : {}),
  };
}

export const taskApi = {
  list: async (params: URLSearchParams, signal?: AbortSignal) =>
    (await request<Partial<Task>[]>(`/tasks?${params}`, undefined, signal)).map(
      normalizeTask,
    ),
  getAll: async (signal?: AbortSignal) =>
    (await request<Partial<Task>[]>("/tasks", undefined, signal)).map(
      normalizeTask,
    ),
  tags: () => request<string[]>("/tags"),
  stats: () => request<Record<string, number>>("/stats"),
  save: async (task: Task) =>
    normalizeTask(
      await request<Partial<Task>>(task.id ? `/tasks/${task.id}` : "/tasks", {
        method: task.id ? "PATCH" : "POST",
        body: JSON.stringify(taskInput(task)),
      }),
    ),
  remove: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
};
