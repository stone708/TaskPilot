// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  findMissingImageReferences,
  hydrateImageReferences,
  prepareEditableMarkdown,
  resizeImageReference,
} from "./inlineImages";
import { MarkdownPreview } from "./MarkdownPreview";
import { TaskBoard } from "./TaskBoard";
import { TaskEditor } from "./TaskEditor";
import { emptyTask, Task } from "../types";

function task(overrides: Partial<Task>): Task {
  return {
    ...emptyTask(),
    id: "task-1",
    shortId: "TASK-1",
    title: "Write docs",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("task board", () => {
  it("groups all four statuses and moves a dropped task to its target column", () => {
    const onMove = vi.fn();
    const todo = task({ status: "Todo" });
    const doing = task({
      id: "task-2",
      shortId: "TASK-2",
      title: "Build board",
      status: "Doing",
    });
    const { container } = render(
      <TaskBoard
        tasks={[todo, doing]}
        movingTaskId={null}
        onMove={onMove}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.getByText("Doing")).toBeTruthy();
    expect(screen.getByText("Holding")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();

    const dataTransfer = {
      data: new Map<string, string>(),
      effectAllowed: "",
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) || "";
      },
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /Open TASK-1/ }), {
      dataTransfer,
    });
    fireEvent.drop(container.querySelectorAll(".kanban-column")[1], {
      dataTransfer,
    });
    expect(onMove).toHaveBeenCalledWith(todo, "Doing");
  });
});

describe("MarkdownPreview", () => {
  it("renders GFM while leaving raw HTML inert", () => {
    const { container } = render(
      <MarkdownPreview
        source={
          "# Notes\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });

  it("lets an inline image change width while preserving its aspect ratio", () => {
    const onImageSizeChange = vi.fn();
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const { container } = render(
      <MarkdownPreview
        source={`![Diagram](${dataUrl} "taskpilot-size:45")`}
        onImageSizeChange={onImageSizeChange}
      />,
    );
    const image = screen.getByRole("img", { name: "Diagram" });
    expect(image.getAttribute("style")).toContain("width: 45%");
    expect(container.querySelector(".resizable-image img")).toBeTruthy();

    fireEvent.change(screen.getByRole("slider", { name: "Size for Diagram" }), {
      target: { value: "65" },
    });
    expect(onImageSizeChange).toHaveBeenCalledWith(dataUrl, 65);
  });
});

describe("inline Markdown images", () => {
  it("keeps Base64 out of the editable source and restores it before preview or save", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const source = `Before\n\n![Diagram](${dataUrl})\n\nAfter`;
    const editable = prepareEditableMarkdown(source);

    expect(editable.markdown).toContain("taskpilot-image:image-1");
    expect(editable.markdown).not.toContain("iVBORw0KGgo=");
    expect(hydrateImageReferences(editable.markdown, editable.images)).toBe(
      source,
    );
  });

  it("stores image size in the short editable reference", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const source = `![Diagram](${dataUrl} "taskpilot-size:60")`;
    const editable = prepareEditableMarkdown(source);

    expect(editable.markdown).toContain("taskpilot-size:60");
    expect(resizeImageReference(editable.markdown, "image-1", 40)).toContain(
      "taskpilot-size:40",
    );
    expect(hydrateImageReferences(editable.markdown, editable.images)).toBe(
      source,
    );
  });

  it("identifies an image reference whose Base64 data is unavailable", () => {
    const missing = findMissingImageReferences(
      "![Lost image](taskpilot-image:image-missing)\n[Legacy image](taskpilot-image:image-legacy)",
      new Map(),
    );
    expect(missing).toEqual([
      { id: "image-missing", name: "Lost image" },
      { id: "image-legacy", name: "Legacy image" },
    ]);
  });
});

describe("TaskEditor", () => {
  it("uses the full-screen workspace and switches a draft to Markdown preview", async () => {
    const user = userEvent.setup();
    const item = task({ description: "# Release notes\n\n- Kanban" });
    const { container } = render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );
    expect(container.querySelector(".task-workspace")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Preview" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("heading", { name: "Release notes" })).toBeTruthy();
    expect(screen.getByText("Kanban")).toBeTruthy();
  });

  it("shows whether the task draft has unsaved changes", async () => {
    const user = userEvent.setup();
    const item = task({ description: "Notes" });
    render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Saved")).toBeTruthy();
    const title = screen.getByRole("textbox", { name: "Task title" });
    await user.clear(title);
    await user.type(title, "Updated docs");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("renders stored Base64 images without exposing their contents in Edit mode", async () => {
    const user = userEvent.setup();
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const onSave = vi.fn(async () => undefined);
    const item = task({ description: `![Diagram](${dataUrl})` });
    const { container } = render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Size for Diagram" }), {
      target: { value: "60" },
    });
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Description" });
    expect((editor as HTMLTextAreaElement).value).toContain(
      "taskpilot-image:image-1",
    );
    expect((editor as HTMLTextAreaElement).value).toContain(
      "taskpilot-size:60",
    );
    expect((editor as HTMLTextAreaElement).value).not.toContain("iVBORw0KGgo=");

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          description: `![Diagram](${dataUrl} "taskpilot-size:60")`,
        }),
      ),
    );
  });
  it("adds and edits a dated comment without saving the task draft", async () => {
    const user = userEvent.setup();
    const createdComment = {
      id: "comment-1",
      body: "First comment",
      color: "mint" as const,
      createdAt: "2026-09-28T00:00:00Z",
      updatedAt: "2026-09-28T00:00:00Z",
    };
    const updatedComment = {
      ...createdComment,
      body: "Edited comment",
      color: "rose" as const,
      updatedAt: "2026-09-28T00:01:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createdComment,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => updatedComment,
      });
    vi.stubGlobal("fetch", fetchMock);
    const item = task({ id: "task-comments" });
    const { container } = render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(container.querySelector(".task-main-grid")).toBeTruthy();
    expect(screen.getByText("Lilac background")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Use mint comment background" }),
    );
    expect(screen.getByText("Mint background")).toBeTruthy();
    await user.type(
      screen.getByRole("textbox", { name: "Comment" }),
      "First comment",
    );
    await user.click(screen.getByRole("button", { name: "Add comment" }));
    expect(await screen.findByText("First comment")).toBeTruthy();
    expect(container.querySelector(".comment-mint")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/tasks/task-comments/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "First comment", color: "mint" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    const commentInput = screen.getByRole("textbox", { name: "Comment" });
    await user.clear(commentInput);
    await user.type(commentInput, "Edited comment");
    await user.click(
      screen.getByRole("button", { name: "Use rose comment background" }),
    );
    expect(screen.getByText("Rose background")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update comment" }));
    expect(await screen.findByText("Edited comment")).toBeTruthy();
    expect(screen.getByText(/Edited Sep/)).toBeTruthy();
    expect(container.querySelector(".comment-rose")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/tasks/task-comments/comments/comment-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "Edited comment", color: "rose" }),
      }),
    );
  });

  it("keeps empty related tasks and subtasks collapsed, then opens them on request", async () => {
    const user = userEvent.setup();
    const item = task({ related: [], subtasks: [] });
    render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const relatedToggle = screen.getByRole("button", { name: /Related tasks/ });
    const subtasksToggle = screen.getByRole("button", { name: /Subtasks/ });
    expect(relatedToggle.getAttribute("aria-expanded")).toBe("false");
    expect(subtasksToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "Link a task" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add subtask/ })).toBeNull();

    await user.click(relatedToggle);
    await user.click(subtasksToggle);
    expect(screen.getByRole("combobox", { name: "Link a task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add subtask/ })).toBeTruthy();
  });

  it("opens related tasks and subtasks when the task already has them", () => {
    const related = task({
      id: "task-2",
      shortId: "TASK-2",
      title: "Review copy",
    });
    const item = task({
      related: [related.id],
      subtasks: [{ id: "subtask-1", title: "Check detail", done: false }],
    });
    render(
      <TaskEditor
        task={item}
        allTasks={[item, related]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: /Related tasks/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("TASK-2 · Review copy")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Subtasks/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByDisplayValue("Check detail")).toBeTruthy();
  });

  it("explains missing images in Preview and blocks saving their broken reference", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    const item = task({
      description: "![Lost image](taskpilot-image:image-missing)",
    });
    render(
      <TaskEditor
        task={item}
        allTasks={[item]}
        busy={false}
        onClose={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onJump={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(
      screen
        .getByRole("tab", { name: "Preview" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "Lost image” is unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain(
      "no saved image data",
    );
  });
});

describe("task board updates", () => {
  it("restores a task and shows an error when its status update conflicts", async () => {
    const item = task({ version: 3 });
    const response = (body: unknown, status = 200) => ({
      ok: status < 400,
      json: async () => body,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: RequestInit) => {
        if (path.startsWith("/api/v1/tasks?"))
          return Promise.resolve(response([item]));
        if (path === "/api/v1/tasks/task-1" && init?.method === "PATCH") {
          return Promise.resolve(
            response({ error: { message: "version conflict" } }, 409),
          );
        }
        if (path === "/api/v1/tasks") return Promise.resolve(response([item]));
        if (path === "/api/v1/tags") return Promise.resolve(response([]));
        return Promise.resolve(
          response({ today: 1, inbox: 0, all: 1, todo: 1 }),
        );
      }),
    );

    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Kanban" }));

    const dataTransfer = {
      data: new Map<string, string>(),
      effectAllowed: "",
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) || "";
      },
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /Open TASK-1/ }), {
      dataTransfer,
    });
    fireEvent.drop(document.querySelectorAll(".kanban-column")[1], {
      dataTransfer,
    });

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "version conflict",
      ),
    );
    expect(screen.getByRole("button", { name: /Open TASK-1/ })).toBeTruthy();
  });
});

describe("task list workflow", () => {
  it("uses Today start language, one creation action, and a quick start control", async () => {
    const today = new Date();
    const startAt = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    let current = task({ startAt, dueAt: null, status: "Todo", version: 1 });
    const response = (body: unknown) => ({
      ok: true,
      json: async () => body,
    });
    const fetchMock = vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/v1/tasks/task-1" && init?.method === "PATCH") {
        current = { ...current, status: "Doing", version: 2 };
        return Promise.resolve(response(current));
      }
      if (path.startsWith("/api/v1/tasks"))
        return Promise.resolve(response([current]));
      if (path === "/api/v1/tags") return Promise.resolve(response([]));
      return Promise.resolve(response({ today: 1, inbox: 0, all: 1, todo: 1 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Tasks ready to start")).toBeTruthy();
    expect(screen.getByLabelText("Today summary").textContent).toContain(
      "1 ready",
    );
    expect(screen.getByLabelText("Today summary").textContent).toContain(
      "0 doing",
    );
    expect(screen.getByLabelText("Today summary").textContent).toContain(
      "0 overdue",
    );
    expect(screen.queryByText("Create quickly")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add Task" })).toHaveLength(1);
    expect(screen.getByText("Starts today")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Start TASK-1: Write docs" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/tasks/task-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"status":"Doing"'),
        }),
      ),
    );
  });
});
