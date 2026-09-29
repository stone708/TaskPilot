import { describe, expect, it, vi } from "vitest";
import { taskApi, taskInput } from "./api";
import { emptyTask, Task } from "./types";

function sampleTask(): Task {
  return {
    ...emptyTask(),
    id: "2c9203a1-833c-4d2f-9a83-119eb4e7ac6f",
    shortId: "TASK-42",
    title: "Ship the change",
    description: "Keep this",
    status: "Doing",
    priority: "High",
    dueAt: "2026-09-22",
    tags: ["Web"],
    version: 7,
  };
}

describe("task API payloads", () => {
  it("sends only editable fields and the version when updating", async () => {
    const task = sampleTask();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => task });
    vi.stubGlobal("fetch", fetchMock);

    await taskApi.save(task);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/tasks/${task.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      title: "Ship the change",
      description: "Keep this",
      status: "Doing",
      priority: "High",
      startAt: null,
      dueAt: "2026-09-22",
      tags: ["Web"],
      subtasks: [],
      related: [],
      version: 7,
    });
  });

  it("does not include a version when creating a task", () => {
    const payload = taskInput(emptyTask());
    expect(payload).not.toHaveProperty("version");
    expect(payload).not.toHaveProperty("id");
    expect(payload.tags).toEqual([]);
  });

  it("normalizes an empty tag response to an array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => null }),
    );

    await expect(taskApi.tags()).resolves.toEqual([]);
  });
});
