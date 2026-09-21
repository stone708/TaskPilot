package app

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

//go:embed all:static
var web embed.FS

type Task struct {
	ID          string     `json:"id"`
	ShortID     string     `json:"shortId"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	StartAt     *string    `json:"startAt"`
	DueAt       *string    `json:"dueAt"`
	Tags        []string   `json:"tags"`
	Subtasks    []Subtask  `json:"subtasks"`
	Related     []string   `json:"related"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	CompletedAt *time.Time `json:"completedAt"`
	Version     int        `json:"version"`
}
type Subtask struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Done     bool   `json:"done"`
	Position int    `json:"position"`
}
type Store struct {
	db  *sql.DB
	loc *time.Location
}

var statuses = map[string]bool{"Todo": true, "Doing": true, "Holding": true, "Done": true}
var priorities = map[string]bool{"None": true, "Low": true, "Medium": true, "High": true, "Urgent": true}

func DataPath(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	d, e := os.UserConfigDir()
	if e != nil {
		return "", e
	}
	return filepath.Join(d, "TaskPilot", "taskpilot.db"), nil
}
func Open(path string) (*Store, error) {
	if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
		return nil, e
	}
	db, e := sql.Open("sqlite", path)
	if e != nil {
		return nil, e
	}
	s := &Store{db: db, loc: time.Local}
	_, e = db.Exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,short_id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'None',start_at TEXT,due_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,version INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE NOT NULL); CREATE TABLE IF NOT EXISTS task_tags(task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(task_id,tag_id)); CREATE TABLE IF NOT EXISTS subtasks(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS task_relations(a TEXT REFERENCES tasks(id) ON DELETE CASCADE,b TEXT REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(a,b),CHECK(a<b)); INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now')); INSERT OR IGNORE INTO meta VALUES('next_short_id','101'); INSERT OR IGNORE INTO meta VALUES('timezone','` + time.Local.String() + `');`)
	if e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close() error   { return s.db.Close() }
func (s *Store) now() time.Time { return time.Now().UTC() }
func validDate(v *string) error {
	if v == nil {
		return nil
	}
	_, e := time.Parse("2006-01-02", *v)
	return e
}
func (s *Store) Create(ctx context.Context, t Task) (Task, error) {
	if strings.TrimSpace(t.Title) == "" {
		return t, errors.New("title is required")
	}
	if t.Status == "" {
		t.Status = "Todo"
	}
	if t.Priority == "" {
		t.Priority = "None"
	}
	if !statuses[t.Status] || !priorities[t.Priority] {
		return t, errors.New("invalid status or priority")
	}
	if e := validDate(t.StartAt); e != nil {
		return t, e
	}
	if e := validDate(t.DueAt); e != nil {
		return t, e
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return t, e
	}
	defer tx.Rollback()
	var next int
	if e = tx.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='next_short_id'").Scan(&next); e != nil {
		return t, e
	}
	t.ID = uuid.NewString()
	t.ShortID = fmt.Sprintf("TASK-%d", next)
	t.CreatedAt = s.now()
	t.UpdatedAt = t.CreatedAt
	t.Version = 1
	if t.Status == "Done" {
		x := t.CreatedAt
		t.CompletedAt = &x
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", t.ID, t.ShortID, t.Title, t.Description, t.Status, t.Priority, t.StartAt, t.DueAt, t.CreatedAt.Format(time.RFC3339Nano), t.UpdatedAt.Format(time.RFC3339Nano), timePtr(t.CompletedAt), t.Version)
	if e != nil {
		return t, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE meta SET value=? WHERE key='next_short_id'", strconv.Itoa(next+1)); e != nil {
		return t, e
	}
	if e = s.saveChildren(ctx, tx, &t); e != nil {
		return t, e
	}
	if e = tx.Commit(); e != nil {
		return t, e
	}
	return s.Get(ctx, t.ID)
}
func timePtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format(time.RFC3339Nano)
}
func (s *Store) saveChildren(ctx context.Context, tx *sql.Tx, t *Task) error {
	for _, raw := range t.Tags {
		name := strings.TrimSpace(strings.TrimPrefix(raw, "#"))
		if name == "" {
			continue
		}
		if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO tags(name) VALUES(?)", name); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO task_tags SELECT ?,id FROM tags WHERE name=? COLLATE NOCASE", t.ID, name); e != nil {
			return e
		}
	}
	for i, sub := range t.Subtasks {
		if strings.TrimSpace(sub.Title) == "" {
			continue
		}
		if sub.ID == "" {
			sub.ID = uuid.NewString()
		}
		if _, e := tx.ExecContext(ctx, "INSERT INTO subtasks VALUES(?,?,?,?,?)", sub.ID, t.ID, sub.Title, sub.Done, i); e != nil {
			return e
		}
	}
	for _, other := range t.Related {
		var relatedID string
		if err := tx.QueryRowContext(ctx, "SELECT id FROM tasks WHERE id=? OR short_id=?", other, other).Scan(&relatedID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("related task %q does not exist", other)
			}
			return err
		}
		if relatedID == t.ID {
			return errors.New("a task cannot be related to itself")
		}
		a, b := t.ID, relatedID
		if a > b {
			a, b = b, a
		}
		if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO task_relations(a,b) VALUES(?,?)", a, b); e != nil {
			return e
		}
	}
	return nil
}
func (s *Store) Get(ctx context.Context, key string) (Task, error) {
	rows, e := s.query(ctx, "WHERE (t.id=? OR t.short_id=?)", key, key)
	if e != nil {
		return Task{}, e
	}
	defer rows.Close()
	if !rows.Next() {
		return Task{}, sql.ErrNoRows
	}
	t, e := scan(rows)
	if e != nil {
		return t, e
	}
	return s.loadChildren(ctx, t)
}
func (s *Store) query(ctx context.Context, where string, args ...any) (*sql.Rows, error) {
	return s.db.QueryContext(ctx, `SELECT t.id,t.short_id,t.title,t.description,t.status,t.priority,t.start_at,t.due_at,t.created_at,t.updated_at,t.completed_at,t.version FROM tasks t `+where+` ORDER BY CASE t.priority WHEN 'Urgent' THEN 5 WHEN 'High' THEN 4 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 2 ELSE 1 END DESC, COALESCE(t.due_at,'9999-12-31'),t.created_at DESC`, args...)
}
func scan(r *sql.Rows) (Task, error) {
	t := Task{Tags: make([]string, 0), Subtasks: make([]Subtask, 0), Related: make([]string, 0)}
	var st, du, co sql.NullString
	var cr, up string
	e := r.Scan(&t.ID, &t.ShortID, &t.Title, &t.Description, &t.Status, &t.Priority, &st, &du, &cr, &up, &co, &t.Version)
	if e != nil {
		return t, e
	}
	if st.Valid {
		t.StartAt = &st.String
	}
	if du.Valid {
		t.DueAt = &du.String
	}
	t.CreatedAt, _ = time.Parse(time.RFC3339Nano, cr)
	t.UpdatedAt, _ = time.Parse(time.RFC3339Nano, up)
	if co.Valid {
		x, _ := time.Parse(time.RFC3339Nano, co.String)
		t.CompletedAt = &x
	}
	return t, nil
}
func (s *Store) loadChildren(ctx context.Context, t Task) (Task, error) {
	rs, e := s.db.QueryContext(ctx, "SELECT name FROM tags JOIN task_tags ON id=tag_id WHERE task_id=? ORDER BY name", t.ID)
	if e != nil {
		return t, e
	}
	for rs.Next() {
		var x string
		rs.Scan(&x)
		t.Tags = append(t.Tags, x)
	}
	rs.Close()
	rs, e = s.db.QueryContext(ctx, "SELECT id,title,done,position FROM subtasks WHERE task_id=? ORDER BY position", t.ID)
	if e != nil {
		return t, e
	}
	for rs.Next() {
		var x Subtask
		rs.Scan(&x.ID, &x.Title, &x.Done, &x.Position)
		t.Subtasks = append(t.Subtasks, x)
	}
	rs.Close()
	rs, e = s.db.QueryContext(ctx, "SELECT CASE WHEN a=? THEN b ELSE a END FROM task_relations WHERE a=? OR b=?", t.ID, t.ID, t.ID)
	if e != nil {
		return t, e
	}
	for rs.Next() {
		var x string
		rs.Scan(&x)
		t.Related = append(t.Related, x)
	}
	rs.Close()
	return t, nil
}
func (s *Store) List(ctx context.Context, scope, status, tag, q, from, to string) ([]Task, error) {
	where := "WHERE 1=1"
	args := []any{}
	today := time.Now().In(s.loc).Format("2006-01-02")
	if scope == "today" {
		where += " AND ((t.status != 'Done' AND t.due_at <= ?) OR (t.status='Doing' AND t.start_at <= ?) OR (t.status='Done' AND substr(t.completed_at,1,10)=?))"
		args = append(args, today, today, today)
	} else if scope == "inbox" {
		where += " AND t.due_at IS NULL"
	}
	if status != "" {
		where += " AND t.status=?"
		args = append(args, status)
	}
	if tag != "" {
		where += " AND EXISTS(SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id=tt.tag_id WHERE tt.task_id=t.id AND tg.name=? COLLATE NOCASE)"
		args = append(args, tag)
	}
	if q != "" {
		where += " AND (t.title LIKE ? OR t.description LIKE ? OR t.short_id LIKE ? OR EXISTS(SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id=tt.tag_id WHERE tt.task_id=t.id AND tg.name LIKE ?))"
		z := "%" + q + "%"
		args = append(args, z, z, z, z)
	}
	if from != "" {
		where += " AND t.due_at>=?"
		args = append(args, from)
	}
	if to != "" {
		where += " AND t.due_at<=?"
		args = append(args, to)
	}
	rs, e := s.query(ctx, where, args...)
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	out := make([]Task, 0)
	for rs.Next() {
		t, e := scan(rs)
		if e != nil {
			return nil, e
		}
		t, e = s.loadChildren(ctx, t)
		if e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rs.Err()
}
func (s *Store) Update(ctx context.Context, key string, patch map[string]json.RawMessage) (Task, error) {
	old, e := s.Get(ctx, key)
	if e != nil {
		return old, e
	}
	v, ok := patch["version"]
	if !ok {
		return old, errors.New("version is required")
	}
	var n int
	if err := json.Unmarshal(v, &n); err != nil {
		return old, errors.New("version must be an integer")
	}
	if n != old.Version {
		return old, errors.New("version conflict")
	}
	b, _ := json.Marshal(old)
	var next Task
	json.Unmarshal(b, &next)
	for k, v := range patch {
		switch k {
		case "title", "description", "status", "priority", "startAt", "dueAt", "tags", "subtasks", "related":
			var o map[string]json.RawMessage
			json.Unmarshal(b, &o)
			o[k] = v
			b, _ = json.Marshal(o)
			json.Unmarshal(b, &next)
		}
	}
	if strings.TrimSpace(next.Title) == "" || !statuses[next.Status] || !priorities[next.Priority] {
		return old, errors.New("invalid task")
	}
	if e = validDate(next.StartAt); e != nil {
		return old, e
	}
	if e = validDate(next.DueAt); e != nil {
		return old, e
	}
	next.Version = old.Version + 1
	next.UpdatedAt = s.now()
	if next.Status == "Done" && old.Status != "Done" {
		x := next.UpdatedAt
		next.CompletedAt = &x
	}
	if next.Status != "Done" {
		next.CompletedAt = nil
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return old, e
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(ctx, "UPDATE tasks SET title=?,description=?,status=?,priority=?,start_at=?,due_at=?,updated_at=?,completed_at=?,version=? WHERE id=?", next.Title, next.Description, next.Status, next.Priority, next.StartAt, next.DueAt, next.UpdatedAt.Format(time.RFC3339Nano), timePtr(next.CompletedAt), next.Version, next.ID)
	if e != nil {
		return old, e
	}
	for _, q := range []string{"DELETE FROM task_tags WHERE task_id=?", "DELETE FROM subtasks WHERE task_id=?"} {
		if _, e = tx.ExecContext(ctx, q, next.ID); e != nil {
			return old, e
		}
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM task_relations WHERE a=? OR b=?", next.ID, next.ID); e != nil {
		return old, e
	}
	if e = s.saveChildren(ctx, tx, &next); e != nil {
		return old, e
	}
	if e = tx.Commit(); e != nil {
		return old, e
	}
	return s.Get(ctx, next.ID)
}
func (s *Store) Delete(ctx context.Context, key string) error {
	t, e := s.Get(ctx, key)
	if e != nil {
		return e
	}
	_, e = s.db.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID)
	return e
}
func (s *Store) Tags(ctx context.Context) ([]string, error) {
	rs, e := s.db.QueryContext(ctx, "SELECT name FROM tags ORDER BY name")
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	var x []string
	for rs.Next() {
		var n string
		rs.Scan(&n)
		x = append(x, n)
	}
	return x, rs.Err()
}
func (s *Store) CreateTag(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(strings.TrimPrefix(name, "#"))
	if name == "" {
		return "", errors.New("tag name is required")
	}
	if _, err := s.db.ExecContext(ctx, "INSERT OR IGNORE INTO tags(name) VALUES(?)", name); err != nil {
		return "", err
	}
	var stored string
	err := s.db.QueryRowContext(ctx, "SELECT name FROM tags WHERE name=? COLLATE NOCASE", name).Scan(&stored)
	return stored, err
}
func (s *Store) Timezone(ctx context.Context) (string, error) {
	var x string
	e := s.db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='timezone'").Scan(&x)
	return x, e
}
func (s *Store) SetTimezone(ctx context.Context, n string) error {
	l, e := time.LoadLocation(n)
	if e != nil {
		return e
	}
	s.loc = l
	_, e = s.db.ExecContext(ctx, "UPDATE meta SET value=? WHERE key='timezone'", n)
	return e
}

func Server(s *Store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/health", func(w http.ResponseWriter, r *http.Request) { reply(w, 200, map[string]any{"ok": true}) })
	mux.HandleFunc("/api/v1/tasks", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			items, e := s.List(r.Context(), r.URL.Query().Get("scope"), r.URL.Query().Get("status"), r.URL.Query().Get("tag"), r.URL.Query().Get("q"), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
			respond(w, e, items)
			return
		}
		if r.Method == "POST" {
			var t Task
			if e := json.NewDecoder(r.Body).Decode(&t); e == nil {
				t, e = s.Create(r.Context(), t)
				respond(w, e, t)
			} else {
				respond(w, e, nil)
			}
			return
		}
		http.Error(w, "method not allowed", 405)
	})
	mux.HandleFunc("/api/v1/tasks/", func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.URL.Path, "/api/v1/tasks/")
		if r.Method == "GET" {
			t, e := s.Get(r.Context(), key)
			respond(w, e, t)
		} else if r.Method == "PATCH" {
			var p map[string]json.RawMessage
			e := json.NewDecoder(r.Body).Decode(&p)
			if e == nil {
				t, e := s.Update(r.Context(), key, p)
				respond(w, e, t)
			} else {
				respond(w, e, nil)
			}
		} else if r.Method == "DELETE" {
			respond(w, s.Delete(r.Context(), key), map[string]bool{"deleted": true})
		} else {
			http.Error(w, "method not allowed", 405)
		}
	})
	mux.HandleFunc("/api/v1/tags", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			x, e := s.Tags(r.Context())
			respond(w, e, x)
			return
		}
		if r.Method == http.MethodPost {
			var in struct {
				Name string `json:"name"`
			}
			e := json.NewDecoder(r.Body).Decode(&in)
			if e == nil {
				in.Name, e = s.CreateTag(r.Context(), in.Name)
			}
			respond(w, e, map[string]string{"name": in.Name})
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("/api/v1/stats", func(w http.ResponseWriter, r *http.Request) {
		all, e := s.List(r.Context(), "", "", "", "", "", "")
		if e != nil {
			respond(w, e, nil)
			return
		}
		out := map[string]int{"all": len(all)}
		for _, t := range all {
			out[strings.ToLower(t.Status)]++
			if t.Status != "Done" && t.DueAt == nil {
				out["inbox"]++
			}
		}
		today, e := s.List(r.Context(), "today", "", "", "", "", "")
		if e == nil {
			for _, t := range today {
				if t.Status != "Done" {
					out["today"]++
				}
			}
		}
		respond(w, e, out)
	})
	mux.Handle("/mcp", MCPHandler(s))
	mux.HandleFunc("/api/v1/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			tz, e := s.Timezone(r.Context())
			respond(w, e, map[string]any{"timezone": tz, "dataPath": "local application data"})
		} else {
			var x struct {
				Timezone string `json:"timezone"`
			}
			e := json.NewDecoder(r.Body).Decode(&x)
			if e == nil {
				e = s.SetTimezone(r.Context(), x.Timezone)
			}
			respond(w, e, map[string]bool{"ok": e == nil})
		}
	})
	static, _ := fs.Sub(web, "static")
	mux.Handle("/", http.FileServer(http.FS(static)))
	return localOnly(mux)
}
func respond(w http.ResponseWriter, e error, v any) {
	if e != nil {
		code := 400
		if errors.Is(e, sql.ErrNoRows) {
			code = 404
		}
		if e.Error() == "version conflict" {
			code = 409
		}
		reply(w, code, map[string]any{"error": e.Error()})
		return
	}
	reply(w, 200, v)
}
func reply(w http.ResponseWriter, c int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(c)
	json.NewEncoder(w).Encode(v)
}
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.Split(r.Host, ":")[0]
		if host != "localhost" && host != "127.0.0.1" && host != "" {
			http.Error(w, "local access only", 403)
			return
		}
		next.ServeHTTP(w, r)
	})
}
