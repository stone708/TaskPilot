import { CalendarDays, CheckSquare, Link2 } from "lucide-react";
import { statuses, Status, Task } from "../types";

export function TaskBoard({
  tasks,
  movingTaskId,
  onMove,
  onOpen,
}: {
  tasks: Task[];
  movingTaskId: string | null;
  onMove: (task: Task, status: Status) => void;
  onOpen: (task: Task) => void;
}) {
  const byStatus = (status: Status) =>
    tasks.filter((task) => task.status === status);

  return (
    <div className="kanban" aria-label="Kanban board">
      {statuses.map((status) => (
        <section
          className="kanban-column"
          key={status}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData("text/taskpilot-id");
            const task = tasks.find((item) => item.id === id);
            if (task) onMove(task, status);
          }}
        >
          <header className={`kanban-heading ${status.toLowerCase()}`}>
            <span>{status}</span>
            <b>{byStatus(status).length}</b>
          </header>
          <div className="kanban-cards">
            {byStatus(status).map((task) => (
              <article
                aria-label={`Open ${task.shortId}: ${task.title}`}
                className={`kanban-card ${task.status === "Done" ? "done" : ""} ${movingTaskId === task.id ? "moving" : ""}`}
                draggable={movingTaskId !== task.id}
                key={task.id}
                onClick={() => onOpen(task)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/taskpilot-id", task.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(task);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="kanban-card-top">
                  <span>{task.shortId}</span>
                  {task.priority !== "None" && (
                    <em className={task.priority.toLowerCase()}>
                      {task.priority}
                    </em>
                  )}
                </div>
                <strong>{task.title}</strong>
                <div className="kanban-card-meta">
                  {task.dueAt && (
                    <span>
                      <CalendarDays size={13} /> {task.dueAt}
                    </span>
                  )}
                  {task.related.length > 0 && (
                    <span>
                      <Link2 size={13} /> {task.related.length}
                    </span>
                  )}
                  {task.subtasks.length > 0 && (
                    <span>
                      <CheckSquare size={13} />{" "}
                      {task.subtasks.filter((item) => item.done).length}/
                      {task.subtasks.length}
                    </span>
                  )}
                </div>
                {task.tags.length > 0 && (
                  <div className="kanban-tags">
                    {task.tags.map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {!byStatus(status).length && (
              <p className="kanban-empty">Drop tasks here</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
