import { useEffect, useRef, useState } from "react";
import { Eye, FilePenLine, ImagePlus, Trash2, X } from "lucide-react";
import { priorities, Status, statuses, Task } from "../types";
import {
  hydrateImageReferences,
  imageReference,
  InlineImage,
  prepareEditableMarkdown,
  readImageAsDataUrl,
} from "./inlineImages";
import { MarkdownPreview } from "./MarkdownPreview";

const supportedImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maximumImageSize = 5 * 1024 * 1024;

const parseTags = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];

export function TaskEditor({
  task,
  allTasks,
  busy,
  onSave,
  onDelete,
  onJump,
  onClose,
}: {
  task: Task;
  allTasks: Task[];
  busy: boolean;
  onSave: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onJump: (task: Task) => void;
  onClose: () => void;
}) {
  const initialImages = useRef(prepareEditableMarkdown(task.description));
  const [draft, setDraft] = useState(() => ({
    ...task,
    description: initialImages.current.markdown,
  }));
  const [images, setImages] = useState<Map<string, InlineImage>>(
    initialImages.current.images,
  );
  const [tagText, setTagText] = useState(task.tags.join(", "));
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">(
    "edit",
  );
  const [error, setError] = useState("");
  const original = useRef(JSON.stringify(task));
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closeRef = useRef<() => boolean>(() => false);
  const candidates = allTasks.filter(
    (item) => item.id !== draft.id && !draft.related.includes(item.id),
  );
  const update = <K extends keyof Task>(key: K, value: Task[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const currentTask = () => ({
    ...draft,
    description: hydrateImageReferences(draft.description, images),
    tags: parseTags(tagText),
  });
  const changed = () => JSON.stringify(currentTask()) !== original.current;

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus();
    };
  }, []);

  const requestClose = () => {
    if (busy) return false;
    if (changed() && !window.confirm("Discard unsaved changes?")) return false;
    onClose();
    return true;
  };
  closeRef.current = requestClose;

  const save = async () => {
    const next = {
      ...currentTask(),
      title: draft.title.trim(),
    };
    if (!next.title) {
      setError("Task title is required.");
      return;
    }
    setError("");
    try {
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
  };

  const deleteTask = async () => {
    try {
      await onDelete(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  };

  const jump = (id: string) => {
    const related = allTasks.find((item) => item.id === id);
    if (related && requestClose()) onJump(related);
  };

  const addImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!supportedImageTypes.has(file.type)) {
      setError("Choose a PNG, JPEG, GIF, WebP, or AVIF image.");
      return;
    }
    if (file.size > maximumImageSize) {
      setError("Images must be 5 MB or smaller.");
      return;
    }
    try {
      const dataUrl = await readImageAsDataUrl(file);
      const id = `image-${crypto.randomUUID()}`;
      const reference = imageReference(file.name, id);
      setImages((current) =>
        new Map(current).set(id, { id, dataUrl, name: file.name }),
      );
      setDraft((current) => {
        const position =
          descriptionRef.current?.selectionStart ?? current.description.length;
        return {
          ...current,
          description: `${current.description.slice(0, position)}${reference}${current.description.slice(position)}`,
        };
      });
      setError("");
      window.requestAnimationFrame(() => descriptionRef.current?.focus());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add this image.",
      );
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(event) =>
        event.target === event.currentTarget && requestClose()
      }
    >
      <article
        className="dialog task-workspace"
        role="dialog"
        aria-modal="true"
        aria-label="Edit task"
      >
        <header>
          <b>{draft.shortId || "New task"}</b>
          <button aria-label="Close" disabled={busy} onClick={requestClose}>
            <X />
          </button>
        </header>
        <div className="dialog-body">
          <div className="workspace-content">
            <input
              ref={titleRef}
              className="title-input"
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Task title"
              aria-label="Task title"
            />
            <div className="fields">
              <Field label="Status">
                <select
                  value={draft.status}
                  onChange={(event) =>
                    update("status", event.target.value as Status)
                  }
                >
                  {statuses.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    update("priority", event.target.value as Task["priority"])
                  }
                >
                  {priorities.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Start">
                <input
                  type="date"
                  value={draft.startAt || ""}
                  onChange={(event) =>
                    update("startAt", event.target.value || null)
                  }
                />
              </Field>
              <Field label="Due">
                <input
                  type="date"
                  value={draft.dueAt || ""}
                  onChange={(event) =>
                    update("dueAt", event.target.value || null)
                  }
                />
              </Field>
              <Field label="Tags">
                <input
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  placeholder="dev, personal"
                />
              </Field>
            </div>
            <Section title="Description">
              <div
                className="description-tabs"
                role="tablist"
                aria-label="Description mode"
              >
                <button
                  className={descriptionMode === "edit" ? "active" : ""}
                  onClick={() => setDescriptionMode("edit")}
                  role="tab"
                  aria-selected={descriptionMode === "edit"}
                >
                  <FilePenLine size={14} /> Edit
                </button>
                <button
                  className={descriptionMode === "preview" ? "active" : ""}
                  onClick={() => setDescriptionMode("preview")}
                  role="tab"
                  aria-selected={descriptionMode === "preview"}
                >
                  <Eye size={14} /> Preview
                </button>
              </div>
              {descriptionMode === "edit" ? (
                <>
                  <div className="description-tools">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ImagePlus size={14} /> Add image
                    </button>
                    <span>
                      Images are stored with the task; Base64 stays hidden while
                      editing.
                    </span>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
                      aria-label="Add image to description"
                      onChange={addImage}
                    />
                  </div>
                  <textarea
                    ref={descriptionRef}
                    value={draft.description}
                    onChange={(event) =>
                      update("description", event.target.value)
                    }
                    placeholder="Use Markdown to add context…"
                    aria-label="Description"
                  />
                </>
              ) : (
                <MarkdownPreview
                  source={hydrateImageReferences(draft.description, images)}
                />
              )}
            </Section>
            <Section title="Related tasks">
              <select
                value=""
                aria-label="Link a task"
                onChange={(event) =>
                  event.target.value &&
                  update("related", [...draft.related, event.target.value])
                }
              >
                <option value="">Link a task…</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.shortId} · {item.title}
                  </option>
                ))}
              </select>
              {draft.related.map((id) => {
                const related = allTasks.find((item) => item.id === id);
                return (
                  <div className="related" key={id}>
                    <button className="related-link" onClick={() => jump(id)}>
                      {related ? `${related.shortId} · ${related.title}` : id}
                    </button>
                    <button
                      onClick={() =>
                        update(
                          "related",
                          draft.related.filter((value) => value !== id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </Section>
            <Section title="Subtasks">
              {draft.subtasks.map((subtask, index) => (
                <div className="subtask" key={subtask.id || index}>
                  <input
                    type="checkbox"
                    aria-label={`Complete ${subtask.title || "subtask"}`}
                    checked={subtask.done}
                    onChange={(event) =>
                      update(
                        "subtasks",
                        draft.subtasks.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, done: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    value={subtask.title}
                    aria-label="Subtask title"
                    onChange={(event) =>
                      update(
                        "subtasks",
                        draft.subtasks.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    aria-label="Remove subtask"
                    onClick={() =>
                      update(
                        "subtasks",
                        draft.subtasks.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  update("subtasks", [
                    ...draft.subtasks,
                    { title: "", done: false },
                  ])
                }
              >
                ＋ Add subtask
              </button>
            </Section>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <footer>
          {draft.id && (
            <button className="danger" disabled={busy} onClick={deleteTask}>
              <Trash2 size={15} /> Delete
            </button>
          )}
          <span />
          <button disabled={busy} onClick={requestClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </article>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="editor-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
