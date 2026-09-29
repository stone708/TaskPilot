import { useEffect, useRef, useState } from "react";
import { Eye, FilePenLine, ImagePlus, Pencil, Send, Trash2, X } from "lucide-react";
import {
  commentColors,
  CommentColor,
  priorities,
  Status,
  statuses,
  Task,
  TaskComment,
} from "../types";
import { taskApi } from "../api";
import {
  findMissingImageReferences,
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
  const initialDraft = {
    ...task,
    description: initialImages.current.markdown,
  };
  const draftRef = useRef(initialDraft);
  const imagesRef = useRef(initialImages.current.images);
  const [draft, setDraft] = useState(initialDraft);
  const [images, setImages] = useState<Map<string, InlineImage>>(
    initialImages.current.images,
  );
  const [tagText, setTagText] = useState(task.tags.join(", "));
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">(
    "preview",
  );
  const [error, setError] = useState("");
  const [comments, setComments] = useState(task.comments);
  const [commentText, setCommentText] = useState("");
  const [commentColor, setCommentColor] = useState<CommentColor>("lilac");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
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
  const update = <K extends keyof Task>(key: K, value: Task[K]) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  };
  const currentTask = () => ({
    ...draftRef.current,
    description: hydrateImageReferences(
      draftRef.current.description,
      imagesRef.current,
    ),
    tags: parseTags(tagText),
  });
  const missingImages = () =>
    findMissingImageReferences(draftRef.current.description, imagesRef.current);
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
    const unavailableImages = missingImages();
    if (unavailableImages.length > 0) {
      setError(
        "An image reference has no saved image data. Remove it and add the image again before saving.",
      );
      return;
    }
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

  const submitComment = async () => {
    if (!draft.id) {
      setError("Save the task before adding a comment.");
      return;
    }
    const body = commentText.trim();
    if (!body) {
      setError("Comment body is required.");
      return;
    }
    setCommentBusy(true);
    setError("");
    try {
      const comment = editingCommentId
        ? await taskApi.updateComment(
            draft.id,
            editingCommentId,
            body,
            commentColor,
          )
        : await taskApi.createComment(draft.id, body, commentColor);
      setComments((current) =>
        editingCommentId
          ? current.map((item) =>
              item.id === comment.id ? comment : item,
            )
          : [...current, comment],
      );
      setCommentText("");
      setCommentColor("lilac");
      setEditingCommentId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comment save failed");
    } finally {
      setCommentBusy(false);
    }
  };

  const editComment = (comment: TaskComment) => {
    setEditingCommentId(comment.id);
    setCommentText(comment.body);
    setCommentColor(comment.color);
    setError("");
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
      const nextImages = new Map(imagesRef.current).set(id, {
        id,
        dataUrl,
        name: file.name,
      });
      imagesRef.current = nextImages;
      setImages(nextImages);
      const position =
        descriptionRef.current?.selectionStart ??
        draftRef.current.description.length;
      const nextDraft = {
        ...draftRef.current,
        description: `${draftRef.current.description.slice(0, position)}${reference}${draftRef.current.description.slice(position)}`,
      };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
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
            <div className="task-main-grid">
              <Section title="Description" className="description-section">
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
                    missingImages={findMissingImageReferences(
                      draft.description,
                      images,
                    )}
                  />
                )}
              </Section>
              <Section title="Comments" className="comments-section">
                {!draft.id ? (
                  <p className="comments-note">Save this task before adding comments.</p>
                ) : (
                  <>
                    <div className="comment-list" aria-live="polite">
                      {comments.length === 0 ? (
                        <p className="comments-note">No comments yet.</p>
                      ) : (
                        comments.map((comment) => (
                          <article
                            className={`comment comment-${comment.color}`}
                            key={comment.id}
                          >
                            <div className="comment-meta">
                              <time dateTime={comment.updatedAt}>
                                {formatCommentDate(comment)}
                              </time>
                              {editingCommentId !== comment.id && (
                                <button
                                  type="button"
                                  aria-label="Edit comment"
                                  disabled={commentBusy || busy}
                                  onClick={() => editComment(comment)}
                                >
                                  <Pencil size={13} /> Edit
                                </button>
                              )}
                            </div>
                            {editingCommentId === comment.id ? (
                              <p className="comment-editing">
                              Editing this comment below.
                            </p>
                            ) : (
                              <p>{comment.body}</p>
                            )}
                          </article>
                        ))
                      )}
                    </div>
                    <div className="comment-composer">
                      <textarea
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        placeholder={
                          editingCommentId
                            ? "Edit comment…"
                            : "Write a comment…"
                        }
                        aria-label="Comment"
                        disabled={commentBusy || busy}
                      />
                      <div className="comment-composer-actions">
                        <div
                          className="comment-color-picker"
                          role="group"
                          aria-label="Comment background color"
                        >
                          {commentColors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`comment-color ${color} ${
                              commentColor === color ? "selected" : ""
                            }`}
                              aria-label={`Use ${color} comment background`}
                              aria-pressed={commentColor === color}
                              disabled={commentBusy || busy}
                              onClick={() => setCommentColor(color)}
                            />
                          ))}
                        </div>
                        {editingCommentId && (
                          <button
                            type="button"
                            disabled={commentBusy || busy}
                            onClick={() => {
                              setEditingCommentId(null);
                              setCommentText("");
                              setCommentColor("lilac");
                            }}
                          >
                            Cancel edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="primary"
                          disabled={commentBusy || busy}
                          onClick={submitComment}
                        >
                          {editingCommentId ? (
                            <>
                              <Pencil size={14} /> Update comment
                            </>
                          ) : (
                            <>
                              <Send size={14} /> Add comment
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </Section>
            </div>
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

function formatCommentDate(comment: TaskComment) {
  const date = new Date(comment.updatedAt);
  const formatted = Number.isNaN(date.getTime())
    ? comment.updatedAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
  return comment.updatedAt !== comment.createdAt ? `Edited ${formatted}` : formatted;
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
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`editor-section ${className}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
