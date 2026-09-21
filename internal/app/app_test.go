package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(filepath.Join(t.TempDir(), "taskpilot.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestTaskLifecycleAndRelations(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, e := s.Create(ctx, Task{Title: "A", Tags: []string{"#Dev", "dev"}})
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.Create(ctx, Task{Title: "B", Related: []string{a.ID}})
	if e != nil {
		t.Fatal(e)
	}
	a, e = s.Get(ctx, a.ID)
	if e != nil || len(a.Tags) != 1 || len(a.Related) != 1 {
		t.Fatalf("normalization failed: %#v %v", a, e)
	}
	p := map[string]json.RawMessage{"status": json.RawMessage(`"Done"`), "version": json.RawMessage("1")}
	a, e = s.Update(ctx, a.ID, p)
	if e != nil || a.CompletedAt == nil {
		t.Fatalf("completion failed: %v", e)
	}
	if _, e = s.Update(ctx, a.ID, p); e == nil {
		t.Fatal("expected version conflict")
	}
	if e = s.Delete(ctx, b.ID); e != nil {
		t.Fatal(e)
	}
	a, e = s.Get(ctx, a.ID)
	if e != nil || len(a.Related) != 0 {
		t.Fatalf("relation cleanup failed: %#v %v", a, e)
	}
}
func TestREST(t *testing.T) {
	s := testStore(t)
	h := Server(s)
	post := func(path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
		r.Host = "127.0.0.1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := post("/api/v1/tasks", `{"title":"API task","dueAt":null}`)
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"tags":[]`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"subtasks":[]`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"related":[]`)) {
		t.Fatalf("empty task collections must be arrays: %s", w.Body.String())
	}
	var created Task
	if err := json.NewDecoder(w.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	patch := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPatch, "/api/v1/tasks/"+created.ID, bytes.NewBufferString(body))
		r.Host = "127.0.0.1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w = patch(`{"title":"missing version"}`)
	if w.Code != http.StatusBadRequest || !bytes.Contains(w.Body.Bytes(), []byte("version is required")) {
		t.Fatalf("missing version: %d %s", w.Code, w.Body.String())
	}
	w = patch(`{"title":"updated through REST","version":1}`)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte("updated through REST")) {
		t.Fatalf("versioned update: %d %s", w.Code, w.Body.String())
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	r.Host = "127.0.0.1"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var stats map[string]int
	json.NewDecoder(w.Body).Decode(&stats)
	if stats["all"] != 1 || stats["inbox"] != 1 {
		t.Fatalf("stats: %#v", stats)
	}
}

func TestMCPTools(t *testing.T) {
	s := testStore(t)
	httpServer := httptest.NewServer(Server(s))
	t.Cleanup(httpServer.Close)

	ctx := context.Background()
	client := mcp.NewClient(&mcp.Implementation{Name: "taskpilot-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: httpServer.URL + "/mcp"}, nil)
	if err != nil {
		t.Fatalf("connect MCP client: %v", err)
	}
	t.Cleanup(func() { session.Close() })

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	if len(tools.Tools) != 10 {
		t.Fatalf("got %d MCP tools, want 10", len(tools.Tools))
	}

	call := func(name string, arguments map[string]any) *mcp.CallToolResult {
		t.Helper()
		result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		return result
	}
	decode := func(result *mcp.CallToolResult, target any) {
		t.Helper()
		if result.IsError {
			t.Fatalf("unexpected tool error: %#v", result.Content)
		}
		if len(result.Content) != 1 {
			t.Fatalf("expected one content item: %#v", result.Content)
		}
		text, ok := result.Content[0].(*mcp.TextContent)
		if !ok {
			t.Fatalf("expected text content: %#v", result.Content[0])
		}
		if err := json.Unmarshal([]byte(text.Text), target); err != nil {
			t.Fatalf("decode tool result: %v; %s", err, text.Text)
		}
	}

	var tag tagResult
	decode(call("tag.create", map[string]any{"name": "#MCP"}), &tag)
	if tag.Name != "MCP" {
		t.Fatalf("tag normalization: %#v", tag)
	}
	var tagList []string
	decode(call("tag.list", map[string]any{}), &tagList)
	if len(tagList) != 1 || tagList[0] != "MCP" {
		t.Fatalf("tag.list: %#v", tagList)
	}

	today := time.Now().Format("2006-01-02")
	anchor, err := s.Create(ctx, Task{Title: "Relation anchor"})
	if err != nil {
		t.Fatalf("create relation anchor: %v", err)
	}
	var created Task
	decode(call("task.create", map[string]any{
		"title": "MCP task", "description": "created through MCP", "status": "Doing",
		"dueAt": today, "tags": []string{"mcp"}, "related": []string{anchor.ShortID},
		"subtasks": []map[string]any{{"title": "Check MCP schema"}},
	}), &created)
	if created.ShortID == "" || created.Version != 1 || len(created.Tags) != 1 || len(created.Subtasks) != 1 || len(created.Related) != 1 {
		t.Fatalf("task.create: %#v", created)
	}
	anchor, err = s.Get(ctx, anchor.ID)
	if err != nil || len(anchor.Related) != 1 || anchor.Related[0] != created.ID {
		t.Fatalf("short related ID was not resolved: %#v %v", anchor, err)
	}

	var fetched Task
	decode(call("task.get", map[string]any{"id": created.ShortID}), &fetched)
	if fetched.ID != created.ID {
		t.Fatalf("task.get: %#v", fetched)
	}
	var listed []Task
	decode(call("task.list", map[string]any{"status": "Doing"}), &listed)
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("task.list: %#v", listed)
	}
	decode(call("task.today", map[string]any{}), &listed)
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("task.today: %#v", listed)
	}
	decode(call("task.search", map[string]any{"q": "through MCP"}), &listed)
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("task.search: %#v", listed)
	}

	var updated Task
	decode(call("task.update", map[string]any{
		"id": created.ID, "version": created.Version, "title": "Updated through MCP", "dueAt": nil,
	}), &updated)
	if updated.Title != "Updated through MCP" || updated.DueAt != nil || updated.Version != 2 {
		t.Fatalf("task.update: %#v", updated)
	}
	var completed Task
	decode(call("task.complete", map[string]any{"id": created.ID}), &completed)
	if completed.Status != "Done" || completed.CompletedAt == nil {
		t.Fatalf("task.complete: %#v", completed)
	}
	var deleted deleteResult
	decode(call("task.delete", map[string]any{"id": created.ID}), &deleted)
	if !deleted.Deleted {
		t.Fatalf("task.delete: %#v", deleted)
	}

	conflict := call("task.update", map[string]any{"id": created.ID, "title": "missing version"})
	if !conflict.IsError {
		t.Fatalf("expected structured MCP error: %#v", conflict)
	}
}
