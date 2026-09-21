package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
	"github.com/taskpilot/taskpilot/internal/app"
	"net/http"
	"os"
	"strings"
)

func main() {
	var data, addr string
	root := &cobra.Command{Use: "taskpilot", Short: "TaskPilot personal task manager"}
	root.PersistentFlags().StringVar(&data, "data", "", "database path")
	root.PersistentFlags().StringVar(&addr, "server", "http://127.0.0.1:8080", "TaskPilot server URL")
	root.AddCommand(serve(&data), client(&addr))
	if e := root.Execute(); e != nil {
		os.Exit(1)
	}
}
func serve(data *string) *cobra.Command {
	var listen string
	c := &cobra.Command{Use: "serve", RunE: func(cmd *cobra.Command, args []string) error {
		p, e := app.DataPath(*data)
		if e != nil {
			return e
		}
		s, e := app.Open(p)
		if e != nil {
			return e
		}
		defer s.Close()
		fmt.Printf("TaskPilot running at http://%s\n", listen)
		return http.ListenAndServe(listen, app.Server(s))
	}}
	c.Flags().StringVar(&listen, "listen", "127.0.0.1:8080", "listen address")
	return c
}
func client(base *string) *cobra.Command {
	c := &cobra.Command{Use: "task"}
	call := func(method, path string, body any) error {
		var r *http.Request
		if body != nil {
			b, _ := json.Marshal(body)
			r, _ = http.NewRequest(method, *base+path, strings.NewReader(string(b)))
			r.Header.Set("Content-Type", "application/json")
		} else {
			r, _ = http.NewRequest(method, *base+path, nil)
		}
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			return fmt.Errorf("TaskPilot is not running: %w", e)
		}
		defer res.Body.Close()
		var x any
		json.NewDecoder(res.Body).Decode(&x)
		b, _ := json.MarshalIndent(x, "", "  ")
		fmt.Println(string(b))
		if res.StatusCode >= 400 {
			return fmt.Errorf("request failed")
		}
		return nil
	}
	versionFor := func(id string) (int, error) {
		res, e := http.Get(*base + "/api/v1/tasks/" + id)
		if e != nil {
			return 0, fmt.Errorf("TaskPilot is not running: %w", e)
		}
		defer res.Body.Close()
		if res.StatusCode >= http.StatusBadRequest {
			return 0, fmt.Errorf("could not read task %s", id)
		}
		var task struct {
			Version int `json:"version"`
		}
		if e := json.NewDecoder(res.Body).Decode(&task); e != nil {
			return 0, e
		}
		return task.Version, nil
	}
	c.AddCommand(&cobra.Command{Use: "add TITLE", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, a []string) error {
		return call("POST", "/api/v1/tasks", map[string]any{"title": a[0]})
	}})
	c.AddCommand(&cobra.Command{Use: "list", RunE: func(_ *cobra.Command, a []string) error { return call("GET", "/api/v1/tasks", nil) }})
	c.AddCommand(&cobra.Command{Use: "today", RunE: func(_ *cobra.Command, a []string) error { return call("GET", "/api/v1/tasks?scope=today", nil) }})
	c.AddCommand(&cobra.Command{Use: "show ID", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, a []string) error { return call("GET", "/api/v1/tasks/"+a[0], nil) }})
	for _, name := range []string{"doing", "done"} {
		st := strings.Title(name)
		c.AddCommand(&cobra.Command{Use: name + " ID", Args: cobra.ExactArgs(1), RunE: func(_ *cobra.Command, a []string) error {
			version, e := versionFor(a[0])
			if e != nil {
				return e
			}
			return call("PATCH", "/api/v1/tasks/"+a[0], map[string]any{"status": st, "version": version})
		}})
	}
	_ = context.Background()
	return c
}
