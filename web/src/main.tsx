import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Command,
  Inbox,
  ListTodo,
  Menu,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { taskApi } from './api';
import { emptyTask, priorities, Scope, statuses, Status, Task } from './types';
import './styles.css';

type Notice = { kind: 'error' | 'success'; text: string };

const titleFor = (scope: Scope, tag: string, status: string) => {
  if (scope === 'tag') return `#${tag}`;
  if (scope === 'status') return status;
  if (scope === 'all') return 'All Tasks';
  if (scope === 'search') return 'Search results';
  return scope[0].toUpperCase() + scope.slice(1);
};

const parseTags = (value: string) =>
  [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [scope, setScope] = useState<Scope>('today');
  const [activeTag, setActiveTag] = useState('');
  const [activeStatus, setActiveStatus] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async (signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (scope === 'today' || scope === 'inbox') params.set('scope', scope);
    if (scope === 'tag') params.set('tag', activeTag);
    if (scope === 'status') params.set('status', activeStatus);
    if (scope === 'search') params.set('q', query);

    setLoading(true);
    try {
      const [items, all, tagList, counts] = await Promise.all([
        taskApi.list(params, signal),
        taskApi.getAll(signal),
        taskApi.tags(),
        taskApi.stats(),
      ]);
      setTasks(items);
      setAllTasks(all);
      setTags(tagList);
      setStats(counts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () =>
        load(controller.signal).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load tasks.' });
        }),
      scope === 'search' ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [scope, activeTag, activeStatus, query]);

  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      const editingField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === 'c' && !editingField && !editing) {
        setEditing(emptyTask());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  const navigate = (next: Scope, value = '') => {
    setScope(next);
    setActiveTag(next === 'tag' ? value : '');
    setActiveStatus(next === 'status' ? value : '');
    if (next !== 'search') setQuery('');
    setDrawerOpen(false);
  };

  const retry = () => {
    setNotice(null);
    load().catch((error: unknown) => {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load tasks.' });
    });
  };

  const save = async (task: Task) => {
    setBusy(true);
    try {
      const saved = await taskApi.save(task);
      setEditing(null);
      setNotice({ kind: 'success', text: `${saved.shortId} saved` });
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
      setNotice({ kind: 'success', text: 'Task deleted' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(
    () => statuses.map((status) => [status, tasks.filter((task) => task.status === status)] as const),
    [tasks],
  );
  const hasTasks = groups.some(([, items]) => items.length > 0);

  return (
    <div className="app-shell">
      <button className="mobile-menu" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
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
                setScope('search');
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
        <section className="content" aria-busy={loading}>
          <div className="page-heading">
            <div>
              <h1>{titleFor(scope, activeTag, activeStatus)}</h1>
              <p>{scope === 'today' ? 'Due, overdue, and active tasks' : 'Your personal workspace'}</p>
            </div>
          </div>
          {notice && (
            <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              <span>{notice.text}</span>
              {notice.kind === 'error' ? (
                <button onClick={retry}>Retry</button>
              ) : (
                <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
                  <X size={15} />
                </button>
              )}
            </div>
          )}
          <button className="quick-add" onClick={() => setEditing(emptyTask())}>
            <Plus size={16} /> Add task <span>Create quickly</span>
          </button>
          {loading ? (
            <div className="empty">Loading tasks…</div>
          ) : !hasTasks ? (
            <div className="empty">{scope === 'search' ? 'No tasks match this search.' : 'No tasks in this view.'}</div>
          ) : (
            groups.map(([group, items]) =>
              items.length ? <TaskGroup key={group} name={group} tasks={items} open={setEditing} /> : null,
            )
          )}
        </section>
      </main>
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
    <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
      <div className="brand"><CheckCircle2 size={19} /> TaskPilot</div>
      <button className="drawer-close" aria-label="Close navigation" onClick={onClose}><X size={18} /></button>
      <Nav icon={<ListTodo />} label="Today" count={stats.today} active={scope === 'today'} onClick={() => onNavigate('today')} />
      <Nav icon={<Inbox />} label="Inbox" count={stats.inbox} active={scope === 'inbox'} onClick={() => onNavigate('inbox')} />
      <Nav icon={<CalendarDays />} label="All Tasks" count={stats.all} active={scope === 'all'} onClick={() => onNavigate('all')} />
      <p className="nav-heading">Status</p>
      {statuses.map((status) => (
        <Nav key={status} label={status} count={stats[status.toLowerCase()]} active={scope === 'status' && activeStatus === status} onClick={() => onNavigate('status', status)} />
      ))}
      <p className="nav-heading">Tags</p>
      {tags.length ? tags.map((tag) => (
        <Nav key={tag} icon={<Tag />} label={`#${tag}`} active={scope === 'tag' && activeTag === tag} onClick={() => onNavigate('tag', tag)} />
      )) : <p className="muted">No tags yet</p>}
      <div className="sidebar-footer"><Command size={15} /> MCP / CLI</div>
    </aside>
  );
}

function Nav({ icon, label, count, active, onClick }: { icon?: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button className={`nav ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <b>{count}</b>}</button>;
}

function TaskGroup({ name, tasks, open }: { name: Status; tasks: Task[]; open: (task: Task) => void }) {
  return (
    <div className="task-group">
      <h2>{name}<span>{tasks.length}</span></h2>
      {tasks.map((task) => (
        <button className={`task-row ${task.status === 'Done' ? 'done' : ''}`} key={task.id} onClick={() => open(task)}>
          <i className={task.status.toLowerCase()} />
          <span className="task-copy"><strong>{task.title}</strong><small>{task.tags.map((tag) => `#${tag}`).join(' · ')}{task.related.length ? ` · ↗ ${task.related.length}` : ''}</small></span>
          {task.priority !== 'None' && <em className={task.priority.toLowerCase()}>{task.priority}</em>}
          <time>{task.dueAt || ''}</time><ChevronRight size={15} />
        </button>
      ))}
    </div>
  );
}

function TaskEditor({ task, allTasks, busy, onSave, onDelete, onJump, onClose }: {
  task: Task;
  allTasks: Task[];
  busy: boolean;
  onSave: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
  onJump: (task: Task) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(task);
  const [tagText, setTagText] = useState(task.tags.join(', '));
  const [error, setError] = useState('');
  const original = useRef(JSON.stringify(task));
  const titleRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef<() => boolean>(() => false);
  const candidates = allTasks.filter((item) => item.id !== draft.id && !draft.related.includes(item.id));
  const update = <K extends keyof Task>(key: K, value: Task[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changed = () => JSON.stringify({ ...draft, tags: parseTags(tagText) }) !== original.current;

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocus.current?.focus();
    };
  }, []);

  const requestClose = () => {
    if (busy) return false;
    if (changed() && !window.confirm('Discard unsaved changes?')) return false;
    onClose();
    return true;
  };
  closeRef.current = requestClose;

  const save = async () => {
    const next = { ...draft, title: draft.title.trim(), tags: parseTags(tagText) };
    if (!next.title) {
      setError('Task title is required.');
      return;
    }
    setError('');
    try {
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed');
    }
  };

  const deleteTask = async () => {
    try {
      await onDelete(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed');
    }
  };

  const jump = (id: string) => {
    const related = allTasks.find((item) => item.id === id);
    if (related && requestClose()) onJump(related);
  };

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <article className="dialog" role="dialog" aria-modal="true" aria-label="Edit task">
        <header><b>{draft.shortId || 'New task'}</b><button aria-label="Close" disabled={busy} onClick={requestClose}><X /></button></header>
        <div className="dialog-body">
          <input ref={titleRef} className="title-input" value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="Task title" />
          <div className="fields">
            <Field label="Status"><select value={draft.status} onChange={(event) => update('status', event.target.value as Status)}>{statuses.map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Priority"><select value={draft.priority} onChange={(event) => update('priority', event.target.value as Task['priority'])}>{priorities.map((value) => <option key={value}>{value}</option>)}</select></Field>
            <Field label="Start"><input type="date" value={draft.startAt || ''} onChange={(event) => update('startAt', event.target.value || null)} /></Field>
            <Field label="Due"><input type="date" value={draft.dueAt || ''} onChange={(event) => update('dueAt', event.target.value || null)} /></Field>
            <Field label="Tags"><input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="dev, personal" /></Field>
          </div>
          <Section title="Description"><textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Add context…" /></Section>
          <Section title="Related tasks">
            <select value="" aria-label="Link a task" onChange={(event) => event.target.value && update('related', [...draft.related, event.target.value])}>
              <option value="">Link a task…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.shortId} · {item.title}</option>)}
            </select>
            {draft.related.map((id) => {
              const related = allTasks.find((item) => item.id === id);
              return <div className="related" key={id}><button className="related-link" onClick={() => jump(id)}>{related ? `${related.shortId} · ${related.title}` : id}</button><button onClick={() => update('related', draft.related.filter((value) => value !== id))}>Remove</button></div>;
            })}
          </Section>
          <Section title="Subtasks">
            {draft.subtasks.map((subtask, index) => (
              <div className="subtask" key={subtask.id || index}>
                <input type="checkbox" aria-label={`Complete ${subtask.title || 'subtask'}`} checked={subtask.done} onChange={(event) => update('subtasks', draft.subtasks.map((item, itemIndex) => itemIndex === index ? { ...item, done: event.target.checked } : item))} />
                <input value={subtask.title} aria-label="Subtask title" onChange={(event) => update('subtasks', draft.subtasks.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                <button aria-label="Remove subtask" onClick={() => update('subtasks', draft.subtasks.filter((_, itemIndex) => itemIndex !== index))}>×</button>
              </div>
            ))}
            <button className="text-button" onClick={() => update('subtasks', [...draft.subtasks, { title: '', done: false }])}>＋ Add subtask</button>
          </Section>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer>
          {draft.id && <button className="danger" disabled={busy} onClick={deleteTask}><Trash2 size={15} /> Delete</button>}
          <span />
          <button disabled={busy} onClick={requestClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="editor-section"><h3>{title}</h3>{children}</section>;
}

createRoot(document.getElementById('root')!).render(<App />);
