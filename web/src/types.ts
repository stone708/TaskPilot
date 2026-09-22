export const statuses = ["Todo", "Doing", "Holding", "Done"] as const;
export const priorities = ["None", "Low", "Medium", "High", "Urgent"] as const;
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type Scope = "today" | "inbox" | "all" | "tag" | "status" | "search";
export type Subtask = {
  id?: string;
  title: string;
  done: boolean;
  position?: number;
};
export type Task = {
  id: string;
  shortId: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  startAt: string | null;
  dueAt: string | null;
  tags: string[];
  subtasks: Subtask[];
  related: string[];
  version: number;
};
export const emptyTask = (): Task => ({
  id: "",
  shortId: "NEW TASK",
  title: "",
  description: "",
  status: "Todo",
  priority: "None",
  startAt: null,
  dueAt: null,
  tags: [],
  subtasks: [],
  related: [],
  version: 0,
});
export const normalizeTask = (task: Partial<Task>): Task => ({
  ...emptyTask(),
  ...task,
  tags: Array.isArray(task.tags) ? task.tags : [],
  subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
  related: Array.isArray(task.related) ? task.related : [],
});
