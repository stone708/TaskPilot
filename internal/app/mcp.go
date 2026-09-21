package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCPHandler exposes TaskPilot through the official MCP Streamable HTTP transport.
// The transport is deliberately stateless: only the local TaskPilot service owns the
// database, while MCP, REST, Web, and CLI all call the same Store methods.
func MCPHandler(store *Store) http.Handler {
	server := newMCPServer(store)
	return mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{
			Stateless:             true,
			JSONResponse:          true,
			CrossOriginProtection: http.NewCrossOriginProtection(),
		},
	)
}

type mcpService struct{ store *Store }

type taskCreateArgs struct {
	Title       string           `json:"title" jsonschema:"Task title"`
	Description string           `json:"description,omitempty" jsonschema:"Optional multi-line description"`
	Status      string           `json:"status,omitempty" jsonschema:"Todo, Doing, Holding, or Done"`
	Priority    string           `json:"priority,omitempty" jsonschema:"None, Low, Medium, High, or Urgent"`
	StartAt     *string          `json:"startAt,omitempty" jsonschema:"Start date in YYYY-MM-DD"`
	DueAt       *string          `json:"dueAt,omitempty" jsonschema:"Due date in YYYY-MM-DD"`
	Tags        []string         `json:"tags,omitempty" jsonschema:"Tags; a leading # is allowed"`
	Subtasks    []mcpSubtaskArgs `json:"subtasks,omitempty" jsonschema:"Checklist items"`
	Related     []string         `json:"related,omitempty" jsonschema:"Related task UUIDs or TASK-n identifiers"`
}

type mcpSubtaskArgs struct {
	ID       string `json:"id,omitempty" jsonschema:"Existing subtask ID when updating"`
	Title    string `json:"title" jsonschema:"Checklist item title"`
	Done     bool   `json:"done,omitempty" jsonschema:"Whether the item is complete"`
	Position int    `json:"position,omitempty" jsonschema:"Optional display position"`
}

type taskGetArgs struct {
	ID string `json:"id" jsonschema:"Task UUID or TASK-n identifier"`
}

type taskListArgs struct {
	Scope  string `json:"scope,omitempty" jsonschema:"Optional scope: today or inbox"`
	Status string `json:"status,omitempty" jsonschema:"Optional status filter"`
	Tag    string `json:"tag,omitempty" jsonschema:"Optional tag filter"`
	Query  string `json:"q,omitempty" jsonschema:"Optional full-text query"`
	From   string `json:"from,omitempty" jsonschema:"Optional due date lower bound in YYYY-MM-DD"`
	To     string `json:"to,omitempty" jsonschema:"Optional due date upper bound in YYYY-MM-DD"`
}

// taskUpdateArgs declares the patch schema. The original JSON arguments are passed
// to Store.Update so omitted fields remain omitted and explicit JSON null clears a date.
type taskUpdateArgs struct {
	ID          string            `json:"id" jsonschema:"Task UUID or TASK-n identifier"`
	Version     int               `json:"version" jsonschema:"Current task version, required to avoid overwriting another editor"`
	Title       *string           `json:"title,omitempty" jsonschema:"Replacement title"`
	Description *string           `json:"description,omitempty" jsonschema:"Replacement description"`
	Status      *string           `json:"status,omitempty" jsonschema:"Replacement status"`
	Priority    *string           `json:"priority,omitempty" jsonschema:"Replacement priority"`
	StartAt     *string           `json:"startAt,omitempty" jsonschema:"Replacement start date; null clears it"`
	DueAt       *string           `json:"dueAt,omitempty" jsonschema:"Replacement due date; null clears it"`
	Tags        *[]string         `json:"tags,omitempty" jsonschema:"Replacement tag list"`
	Subtasks    *[]mcpSubtaskArgs `json:"subtasks,omitempty" jsonschema:"Replacement checklist"`
	Related     *[]string         `json:"related,omitempty" jsonschema:"Replacement related task list"`
}

type taskSearchArgs struct {
	Query string `json:"q" jsonschema:"Text to find in task titles, descriptions, tags, and task numbers"`
}

type tagCreateArgs struct {
	Name string `json:"name" jsonschema:"Tag display name; a leading # is allowed"`
}

type deleteResult struct {
	Deleted bool `json:"deleted"`
}

type tagResult struct {
	Name string `json:"name"`
}

func newMCPServer(store *Store) *mcp.Server {
	service := &mcpService{store: store}
	server := mcp.NewServer(&mcp.Implementation{Name: "TaskPilot", Version: "1.0.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "task.create", Description: "Create a task with optional dates, tags, subtasks, and related tasks."}, service.create)
	mcp.AddTool(server, &mcp.Tool{Name: "task.get", Description: "Get a task by UUID or TASK-n identifier."}, service.get)
	mcp.AddTool(server, &mcp.Tool{Name: "task.list", Description: "List tasks, optionally filtered by scope, status, tag, text, or due date."}, service.list)
	mcp.AddTool(server, &mcp.Tool{Name: "task.today", Description: "List due, overdue, active, and today-completed tasks in the application timezone."}, service.today)
	mcp.AddTool(server, &mcp.Tool{Name: "task.search", Description: "Search all task titles, descriptions, tags, and task numbers."}, service.search)
	mcp.AddTool(server, &mcp.Tool{Name: "task.update", Description: "Update selected task fields. Include the current version; null clears startAt or dueAt."}, service.update)
	mcp.AddTool(server, &mcp.Tool{Name: "task.complete", Description: "Mark a task Done without refreshing an existing completion time."}, service.complete)
	mcp.AddTool(server, &mcp.Tool{Name: "task.delete", Description: "Delete a task and clean up its related-task references."}, service.delete)
	mcp.AddTool(server, &mcp.Tool{Name: "tag.list", Description: "List all tags."}, service.tags)
	mcp.AddTool(server, &mcp.Tool{Name: "tag.create", Description: "Create a tag, preserving the first display spelling."}, service.createTag)
	return server
}

func required(value, field string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	return nil
}

func (service *mcpService) create(ctx context.Context, _ *mcp.CallToolRequest, args taskCreateArgs) (*mcp.CallToolResult, any, error) {
	task, err := service.store.Create(ctx, Task{
		Title: args.Title, Description: args.Description, Status: args.Status, Priority: args.Priority,
		StartAt: args.StartAt, DueAt: args.DueAt, Tags: args.Tags, Subtasks: toSubtasks(args.Subtasks), Related: args.Related,
	})
	return nil, task, err
}

func (service *mcpService) get(ctx context.Context, _ *mcp.CallToolRequest, args taskGetArgs) (*mcp.CallToolResult, any, error) {
	if err := required(args.ID, "id"); err != nil {
		return nil, nil, err
	}
	task, err := service.store.Get(ctx, args.ID)
	return nil, task, err
}

func (service *mcpService) list(ctx context.Context, _ *mcp.CallToolRequest, args taskListArgs) (*mcp.CallToolResult, any, error) {
	tasks, err := service.store.List(ctx, args.Scope, args.Status, args.Tag, args.Query, args.From, args.To)
	return nil, tasks, err
}

func (service *mcpService) today(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	tasks, err := service.store.List(ctx, "today", "", "", "", "", "")
	return nil, tasks, err
}

func (service *mcpService) search(ctx context.Context, _ *mcp.CallToolRequest, args taskSearchArgs) (*mcp.CallToolResult, any, error) {
	if err := required(args.Query, "q"); err != nil {
		return nil, nil, err
	}
	tasks, err := service.store.List(ctx, "", "", "", args.Query, "", "")
	return nil, tasks, err
}

func (service *mcpService) update(ctx context.Context, req *mcp.CallToolRequest, args taskUpdateArgs) (*mcp.CallToolResult, any, error) {
	if err := required(args.ID, "id"); err != nil {
		return nil, nil, err
	}
	if args.Version < 1 {
		return nil, nil, fmt.Errorf("version is required")
	}
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(req.Params.Arguments, &patch); err != nil {
		return nil, nil, err
	}
	if args.Subtasks != nil {
		value, err := json.Marshal(toSubtasks(*args.Subtasks))
		if err != nil {
			return nil, nil, err
		}
		patch["subtasks"] = value
	}
	delete(patch, "id")
	task, err := service.store.Update(ctx, args.ID, patch)
	return nil, task, err
}

func (service *mcpService) complete(ctx context.Context, _ *mcp.CallToolRequest, args taskGetArgs) (*mcp.CallToolResult, any, error) {
	if err := required(args.ID, "id"); err != nil {
		return nil, nil, err
	}
	task, err := service.store.Get(ctx, args.ID)
	if err != nil {
		return nil, nil, err
	}
	patch := map[string]json.RawMessage{
		"status":  json.RawMessage(`"Done"`),
		"version": json.RawMessage(fmt.Sprintf("%d", task.Version)),
	}
	task, err = service.store.Update(ctx, task.ID, patch)
	return nil, task, err
}

func (service *mcpService) delete(ctx context.Context, _ *mcp.CallToolRequest, args taskGetArgs) (*mcp.CallToolResult, any, error) {
	if err := required(args.ID, "id"); err != nil {
		return nil, nil, err
	}
	err := service.store.Delete(ctx, args.ID)
	return nil, deleteResult{Deleted: err == nil}, err
}

func (service *mcpService) tags(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	tags, err := service.store.Tags(ctx)
	return nil, tags, err
}

func (service *mcpService) createTag(ctx context.Context, _ *mcp.CallToolRequest, args tagCreateArgs) (*mcp.CallToolResult, any, error) {
	name, err := service.store.CreateTag(ctx, args.Name)
	return nil, tagResult{Name: name}, err
}

func toSubtasks(items []mcpSubtaskArgs) []Subtask {
	if items == nil {
		return nil
	}
	out := make([]Subtask, len(items))
	for i, item := range items {
		out[i] = Subtask{ID: item.ID, Title: item.Title, Done: item.Done, Position: item.Position}
	}
	return out
}
