import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Command,
  Inbox,
  KanbanSquare,
  List,
  ListTodo,
  Menu,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";
import { taskApi } from "./api";
import { TaskBoard } from "./components/TaskBoard";
import { TaskEditor } from "./components/TaskEditor";
import { emptyTask, Scope, statuses, Status, Task } from "./types";

type Notice = { kind: "error" | "success"; text: string };
type ViewMode = "list" | "board";
type DayView = { date: string; planned: Task[]; completed: Task[] };

const localDate = (value = new Date()) =>
  [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");

const titleFor = (scope: Scope, tag: string, status: string) => {
  if (scope === "tag") return `#${tag}`;
  if (scope === "status") return status;
  if (scope === "all") return "All Tasks";
  if (scope === "search") return "Search results";
  return scope[0].toUpperCase() + scope.slice(1);
};

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<Scope>("today");
  const [activeTag, setActiveTag] = useState("");
  const [activeStatus, setActiveStatus] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedDay, setSelectedDay] = useState(localDate);
  const [dayView, setDayView] = useState<DayView | null>(null);
  const [planning, setPlanning] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (scope === "inbox") params.set("scope", scope);
      if (scope === "tag") params.set("tag", activeTag);
      if (scope === "status") params.set("status", activeStatus);
      if (scope === "search") params.set("q", query);
      setLoading(true);
      try {
        const [items, all, tagList, counts] = await Promise.all([
          scope === "today"
            ? taskApi.day(selectedDay, signal)
            : taskApi.list(params, signal),
          taskApi.getAll(signal),
          taskApi.tags(),
          taskApi.stats(),
        ]);
        if (scope === "today") {
          const day = items as DayView;
          setDayView(day);
          setTasks([...day.planned, ...day.completed]);
        } else {
          setDayView(null);
          setTasks(items as Task[]);
        }
        setAllTasks(all);
        setTags(tagList);
        setStats(counts);
      } finally {
        setLoading(false);
      }
    },
    [activeStatus, activeTag, query, scope, selectedDay],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        load(controller.signal).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setNotice({
            kind: "error",
            text:
              error instanceof Error ? error.message : "Could not load tasks.",
          });
        });
      },
      scope === "search" ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load, scope]);

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const editingField = ["INPUT", "TEXTAREA", "SELECT"].includes(
        element.tagName,
      );
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "c" && !editingField && !editing)
        setEditing(emptyTask());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const navigate = (next: Scope, value = "") => {
    setScope(next);
    setActiveTag(next === "tag" ? value : "");
    setActiveStatus(next === "status" ? value : "");
    if (next !== "search") setQuery("");
    if (next === "today") setSelectedDay(localDate());
    setDrawerOpen(false);
  };

  const retry = () => {
    setNotice(null);
    load().catch((error: unknown) =>
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not load tasks.",
      }),
    );
  };

  const save = async (task: Task) => {
    setBusy(true);
    try {
      const saved = await taskApi.save(task);
      setEditing(null);
      setNotice({ kind: "success", text: `${saved.shortId} saved` });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (task: Task) => {
    if (!window.confirm(`Delete ${task.shortId} — ${task.title}?`)) return;
    setBusy(true);
    try {
      await taskApi.remove(task.id);
      setEditing(null);
      setNotice({ kind: "success", text: "Task deleted" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const moveTask = async (task: Task, status: Status) => {
    if (task.status === status || movingTaskId) return;
    const original = task;
    const optimistic = { ...task, status };
    setMovingTaskId(task.id);
    setTasks((items) =>
      items.map((item) => (item.id === task.id ? optimistic : item)),
    );
    setAllTasks((items) =>
      items.map((item) => (item.id === task.id ? optimistic : item)),
    );
    try {
      const saved = await taskApi.save(optimistic);
      setTasks((items) =>
        items.map((item) => (item.id === task.id ? saved : item)),
      );
      setAllTasks((items) =>
        items.map((item) => (item.id === task.id ? saved : item)),
      );
      await load();
    } catch (cause) {
      setTasks((items) =>
        items.map((item) => (item.id === task.id ? original : item)),
      );
      setAllTasks((items) =>
        items.map((item) => (item.id === task.id ? original : item)),
      );
      setNotice({
        kind: "error",
        text:
          cause instanceof Error
            ? `Could not move task: ${cause.message}`
            : "Could not move task.",
      });
    } finally {
      setMovingTaskId(null);
    }
  };

  const planTask = async (task: Task) => {
    setBusy(true);
    try {
      const saved = await taskApi.save({ ...task, plannedFor: selectedDay });
      setAllTasks((items) =>
        items.map((item) => (item.id === saved.id ? saved : item)),
      );
      setNotice({
        kind: "success",
        text: `${saved.shortId} added to the plan`,
      });
      await load();
    } catch (cause) {
      setNotice({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not plan task.",
      });
    } finally {
      setBusy(false);
    }
  };

  const shiftDay = (amount: number) => {
    const date = new Date(`${selectedDay}T12:00:00`);
    date.setDate(date.getDate() + amount);
    setSelectedDay(localDate(date));
  };

  const groups = useMemo(
    () =>
      statuses.map(
        (status) =>
          [status, tasks.filter((task) => task.status === status)] as const,
      ),
    [tasks],
  );
  const hasTasks = groups.some(([, items]) => items.length > 0);

  return (
    <div className="app-shell">
      <button
        className="mobile-menu"
        aria-label="Open navigation"
        onClick={() => setDrawerOpen(true)}
      >
        <Menu size={20} />
      </button>
      <Sidebar
        activeStatus={activeStatus}
        activeTag={activeTag}
        drawerOpen={drawerOpen}
        scope={scope}
        stats={stats}
        tags={tags}
        onClose={() => setDrawerOpen(false)}
        onNavigate={navigate}
      />
      <main>
        <header className="topbar">
          <label className="search">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setScope("search");
              }}
              placeholder="Search all tasks…"
              aria-label="Search all tasks"
            />
          </label>
          <kbd>Ctrl K</kbd>
          <button className="primary" onClick={() => setEditing(emptyTask())}>
            <Plus size={16} /> Add Task
          </button>
        </header>
        <section
          className={`content ${viewMode === "board" ? "board-content" : ""}`}
          aria-busy={loading}
        >
          <div className="page-heading">
            <div>
              <h1>
                {scope === "today"
                  ? formatDay(selectedDay)
                  : titleFor(scope, activeTag, activeStatus)}
              </h1>
              <p>
                {scope === "today"
                  ? selectedDay === localDate()
                    ? "Your plan for today"
                    : selectedDay < localDate()
                      ? "A read-only record of this day"
                      : "Plan ahead with a focused task list"
                  : "Your personal workspace"}
              </p>
              {scope === "today" && dayView && (
                <div className="today-summary" aria-label="Daily summary">
                  <span>
                    <b>{dayView.planned.length}</b> planned
                  </span>
                  <span>
                    <b>{dayView.completed.length}</b> completed
                  </span>
                  <span>
                    <b>{dayView.planned.length}</b> remaining
                  </span>
                </div>
              )}
            </div>
            {scope === "today" ? (
              <div className="day-actions">
                <div className="day-navigation" aria-label="Choose day">
                  <button
                    aria-label="Previous day"
                    onClick={() => shiftDay(-1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <input
                    aria-label="Plan date"
                    type="date"
                    value={selectedDay}
                    onChange={(event) =>
                      setSelectedDay(event.target.value || localDate())
                    }
                  />
                  <button aria-label="Next day" onClick={() => shiftDay(1)}>
                    <ChevronRight size={15} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setSelectedDay(localDate())}
                  >
                    Today
                  </button>
                </div>
                <button
                  className="primary"
                  disabled={selectedDay < localDate()}
                  onClick={() => setPlanning(true)}
                >
                  <Plus size={16} /> Plan tasks
                </button>
              </div>
            ) : (
              <div className="view-switch" aria-label="Choose task view">
                <button
                  className={viewMode === "list" ? "active" : ""}
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                >
                  <List size={15} /> List
                </button>
                <button
                  className={viewMode === "board" ? "active" : ""}
                  onClick={() => setViewMode("board")}
                  aria-pressed={viewMode === "board"}
                >
                  <KanbanSquare size={15} /> Kanban
                </button>
              </div>
            )}
          </div>
          {notice && (
            <div
              className={`notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              <span>{notice.text}</span>
              {notice.kind === "error" ? (
                <button onClick={retry}>Retry</button>
              ) : (
                <button
                  aria-label="Dismiss message"
                  onClick={() => setNotice(null)}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )}
          {loading ? (
            <div className="empty">Loading tasks…</div>
          ) : scope === "today" ? (
            <TodayPlan
              selectedDay={selectedDay}
              planned={dayView?.planned || []}
              completed={dayView?.completed || []}
              movingTaskId={movingTaskId}
              onOpen={setEditing}
              onStatusChange={moveTask}
            />
          ) : !hasTasks ? (
            <div className="empty">
              {scope === "search"
                ? "No tasks match this search."
                : "No tasks in this view."}
            </div>
          ) : viewMode === "board" ? (
            <TaskBoard
              tasks={tasks}
              movingTaskId={movingTaskId}
              onMove={(task, status) => void moveTask(task, status)}
              onOpen={setEditing}
            />
          ) : (
            groups.map(([group, items]) =>
              items.length ? (
                <TaskGroup
                  key={group}
                  name={group}
                  tasks={items}
                  open={setEditing}
                  movingTaskId={movingTaskId}
                  onStatusChange={moveTask}
                />
              ) : null,
            )
          )}
        </section>
      </main>
      {planning && (
        <PlanTasksDialog
          date={selectedDay}
          tasks={allTasks}
          busy={busy}
          onClose={() => setPlanning(false)}
          onPlan={async (task) => {
            await planTask(task);
            setPlanning(false);
          }}
        />
      )}
      {editing && (
        <TaskEditor
          task={editing}
          allTasks={allTasks}
          busy={busy}
          onDelete={remove}
          onJump={setEditing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Sidebar({
  activeStatus,
  activeTag,
  drawerOpen,
  scope,
  stats,
  tags,
  onClose,
  onNavigate,
}: {
  activeStatus: string;
  activeTag: string;
  drawerOpen: boolean;
  scope: Scope;
  stats: Record<string, number>;
  tags: string[];
  onClose: () => void;
  onNavigate: (scope: Scope, value?: string) => void;
}) {
  return (
    <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
      <div className="brand">
        <img src="/taskpilot-icon.png" alt="" /> TaskPilot
      </div>
      <button
        className="drawer-close"
        aria-label="Close navigation"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <Nav
        icon={<ListTodo />}
        label="Today"
        count={stats.today}
        active={scope === "today"}
        onClick={() => onNavigate("today")}
      />
      <Nav
        icon={<Inbox />}
        label="Inbox"
        count={stats.inbox}
        active={scope === "inbox"}
        onClick={() => onNavigate("inbox")}
      />
      <Nav
        icon={<CalendarDays />}
        label="All Tasks"
        count={stats.all}
        active={scope === "all"}
        onClick={() => onNavigate("all")}
      />
      <p className="nav-heading">Status</p>
      {statuses.map((status) => (
        <Nav
          key={status}
          label={status}
          count={stats[status.toLowerCase()]}
          active={scope === "status" && activeStatus === status}
          onClick={() => onNavigate("status", status)}
        />
      ))}
      <p className="nav-heading">Tags</p>
      {tags.length ? (
        tags.map((tag) => (
          <Nav
            key={tag}
            icon={<Tag />}
            label={`#${tag}`}
            active={scope === "tag" && activeTag === tag}
            onClick={() => onNavigate("tag", tag)}
          />
        ))
      ) : (
        <p className="muted">No tags yet</p>
      )}
      <div className="sidebar-footer">
        <Command size={15} /> MCP / CLI
      </div>
    </aside>
  );
}

function Nav({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function TaskGroup({
  name,
  tasks,
  open,
  movingTaskId,
  onStatusChange,
}: {
  name: Status;
  tasks: Task[];
  open: (task: Task) => void;
  movingTaskId: string | null;
  onStatusChange: (task: Task, status: Status) => Promise<void>;
}) {
  return (
    <div className="task-group">
      <h2>
        {name}
        <span>{tasks.length}</span>
      </h2>
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          moving={movingTaskId === task.id}
          onOpen={open}
          onStatusChange={onStatusChange}
        />
      ))}
    </div>
  );
}

function TodayPlan({
  selectedDay,
  planned,
  completed,
  movingTaskId,
  onOpen,
  onStatusChange,
}: {
  selectedDay: string;
  planned: Task[];
  completed: Task[];
  movingTaskId: string | null;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: Status) => Promise<void>;
}) {
  const isToday = selectedDay === localDate();
  return (
    <div className="today-plan">
      <section className="day-task-section">
        <h2>
          {isToday ? "Today's plan" : "Planned"}
          <span>{planned.length}</span>
        </h2>
        {planned.length ? (
          planned.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              moving={movingTaskId === task.id}
              onOpen={onOpen}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <div className="empty day-empty">
            {selectedDay < localDate()
              ? "No planned tasks were kept for this day."
              : "No tasks planned yet. Choose Plan tasks to make this day clear."}
          </div>
        )}
      </section>
      <section className="day-task-section completed-day-section">
        <h2>
          {isToday ? "Completed today" : "Completed"}
          <span>{completed.length}</span>
        </h2>
        {completed.length ? (
          completed.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              moving={false}
              historyComplete
              onOpen={onOpen}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <p className="day-note">No tasks completed on this day.</p>
        )}
      </section>
    </div>
  );
}

function PlanTasksDialog({
  date,
  tasks,
  busy,
  onPlan,
  onClose,
}: {
  date: string;
  tasks: Task[];
  busy: boolean;
  onPlan: (task: Task) => Promise<void>;
  onClose: () => void;
}) {
  const candidates = tasks.filter(
    (task) => task.status !== "Done" && task.plannedFor !== date,
  );
  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <article
        className="dialog plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Plan tasks"
      >
        <header>
          <div>
            <b>Plan tasks</b>
            <small>{formatDay(date)}</small>
          </div>
          <button aria-label="Close" onClick={onClose} disabled={busy}>
            <X />
          </button>
        </header>
        <div className="plan-dialog-body">
          {candidates.length ? (
            candidates.map((task) => (
              <div className="plan-candidate" key={task.id}>
                <div>
                  <b>{task.title}</b>
                  <span>
                    {task.shortId}
                    {task.plannedFor ? ` · Planned ${task.plannedFor}` : ""}
                  </span>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void onPlan(task)}
                >
                  Add
                </button>
              </div>
            ))
          ) : (
            <div className="empty">
              Every open task is already planned for this day.
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

function formatDay(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(value);
}

function TaskRow({
  task,
  moving,
  historyComplete = false,
  onOpen,
  onStatusChange,
}: {
  task: Task;
  moving: boolean;
  historyComplete?: boolean;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: Status) => Promise<void>;
}) {
  const action = historyComplete ? null : quickAction(task);
  const timing = taskTiming(task);
  return (
    <div
      className={`task-row ${task.status === "Done" || historyComplete ? "done" : ""}`}
    >
      <button
        className="task-open"
        aria-label={`Open ${task.shortId}: ${task.title}`}
        onClick={() => onOpen(task)}
      >
        <i className={historyComplete ? "done" : task.status.toLowerCase()} />
        <span className="task-copy">
          <strong>{task.title}</strong>
          <small>
            {task.tags.map((tag) => `#${tag}`).join(" · ")}
            {task.related.length ? ` · ↗ ${task.related.length}` : ""}
          </small>
        </span>
      </button>
      <span className="task-priority">
        {task.priority !== "None" && (
          <em className={task.priority.toLowerCase()}>{task.priority}</em>
        )}
      </span>
      <time className={timing.overdue ? "overdue" : ""}>{timing.label}</time>
      {action && (
        <button
          className="task-row-action"
          aria-label={`${action.label} ${task.shortId}: ${task.title}`}
          disabled={moving}
          onClick={() => void onStatusChange(task, action.status)}
        >
          {moving ? "Updating…" : action.label}
        </button>
      )}
      {!action && (
        <span className="task-row-action-placeholder" aria-hidden="true" />
      )}
      <ChevronRight size={15} />
    </div>
  );
}

function quickAction(task: Task): { label: string; status: Status } | null {
  if (task.status === "Todo") return { label: "Start", status: "Doing" };
  if (task.status === "Doing") return { label: "Complete", status: "Done" };
  if (task.status === "Holding") return { label: "Resume", status: "Doing" };
  return null;
}

function taskTiming(task: Task): { label: string; overdue: boolean } {
  const date = task.dueAt || task.startAt;
  if (!date) return { label: "No schedule", overdue: false };
  const today = new Date();
  const localToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round(
    (target.getTime() - localToday.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (task.dueAt) {
    if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, overdue: true };
    if (days === 0) return { label: "Due today", overdue: false };
    if (days === 1) return { label: "Due tomorrow", overdue: false };
    return { label: `Due ${date}`, overdue: false };
  }
  if (days < 0)
    return { label: `Started ${Math.abs(days)}d ago`, overdue: false };
  if (days === 0) return { label: "Starts today", overdue: false };
  return { label: `Starts ${date}`, overdue: false };
}
