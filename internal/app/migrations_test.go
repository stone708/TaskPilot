package app

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func schemaVersions(t *testing.T, db *sql.DB) []int {
	t.Helper()
	rows, err := db.Query(`SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var versions []int
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return versions
}

func TestOpenInitializesFreshDatabaseWithoutBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "taskpilot.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if store.BackupPath() != "" {
		t.Fatalf("fresh database unexpectedly created backup %q", store.BackupPath())
	}
	versions := schemaVersions(t, store.db)
	if len(versions) != 2 || versions[0] != 1 || versions[1] != 2 {
		t.Fatalf("schema versions = %v, want [1 2]", versions)
	}
}

func TestOpenBacksUpBeforePendingMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "taskpilot.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(context.Background(), Task{Title: "keep me"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DROP INDEX idx_tasks_status_due_at; DELETE FROM schema_migrations WHERE version=2`); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	upgraded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	if upgraded.BackupPath() == "" {
		t.Fatal("expected a pre-migration backup")
	}

	backup, err := sql.Open("sqlite", upgraded.BackupPath())
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	var backupTitle string
	if err := backup.QueryRow(`SELECT title FROM tasks WHERE id=?`, created.ID).Scan(&backupTitle); err != nil {
		t.Fatalf("backup did not preserve task: %v", err)
	}
	if backupTitle != created.Title {
		t.Fatalf("backup title = %q, want %q", backupTitle, created.Title)
	}
	var indexName string
	if err := backup.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_status_due_at'`).Scan(&indexName); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("backup should be taken before the index migration, got %v", err)
	}
	if err := upgraded.db.QueryRow(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_status_due_at'`).Scan(&indexName); err != nil {
		t.Fatalf("upgraded database is missing migration index: %v", err)
	}
	if _, err := upgraded.Get(context.Background(), created.ID); err != nil {
		t.Fatalf("upgraded database lost task: %v", err)
	}
}

func TestOpenMigratesLegacyDatabaseAndKeepsData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "taskpilot.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = legacy.Exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,short_id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'None',start_at TEXT,due_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,version INTEGER NOT NULL DEFAULT 1); INSERT INTO tasks VALUES('legacy-id','TASK-101','legacy task','','Todo','None',NULL,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL,1)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if store.BackupPath() == "" {
		t.Fatal("legacy database should be backed up before migration")
	}
	migrated, err := store.Get(context.Background(), "TASK-101")
	if err != nil || migrated.Title != "legacy task" {
		t.Fatalf("legacy task was not preserved: %#v, %v", migrated, err)
	}
}

func TestApplyMigrationsRollsBackFailedMigration(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "taskpilot.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	migrations := []migration{
		{version: 1, apply: func(ctx context.Context, tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `CREATE TABLE committed_table(value TEXT)`)
			return err
		}},
		{version: 2, apply: func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `CREATE TABLE rolled_back_table(value TEXT)`); err != nil {
				return err
			}
			return errors.New("simulated migration failure")
		}},
	}
	if _, err := applyMigrations(context.Background(), db, migrations); err == nil {
		t.Fatal("expected migration failure")
	}
	versions := schemaVersions(t, db)
	if len(versions) != 1 || versions[0] != 1 {
		t.Fatalf("versions after failed migration = %v, want [1]", versions)
	}
	var tableName string
	if err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name='rolled_back_table'`).Scan(&tableName); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("failed migration changes were not rolled back: %v", err)
	}
}

func TestOpenRejectsDatabaseFromNewerBuild(t *testing.T) {
	path := filepath.Join(t.TempDir(), "taskpilot.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(99, '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(path); err == nil {
		t.Fatal("expected newer schema to be rejected")
	}
}
