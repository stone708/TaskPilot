package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type migration struct {
	version int
	apply   func(context.Context, *sql.Tx) error
}

var databaseMigrations = []migration{
	{version: 1, apply: createInitialSchema},
	{version: 2, apply: addTaskQueryIndex},
}

func createInitialSchema(ctx context.Context, tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)`,
		`CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,short_id TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'None',start_at TEXT,due_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,version INTEGER NOT NULL DEFAULT 1)`,
		`CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS task_tags(task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(task_id,tag_id))`,
		`CREATE TABLE IF NOT EXISTS subtasks(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS task_relations(a TEXT REFERENCES tasks(id) ON DELETE CASCADE,b TEXT REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(a,b),CHECK(a<b))`,
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO meta(key,value) VALUES('next_short_id','101')`); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO meta(key,value) VALUES('timezone',?)`, time.Local.String())
	return err
}

func addTaskQueryIndex(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_tasks_status_due_at ON tasks(status, due_at)`)
	return err
}

func latestSchemaVersion(migrations []migration) int {
	latest := 0
	for _, migration := range migrations {
		if migration.version > latest {
			latest = migration.version
		}
	}
	return latest
}

func migrationState(ctx context.Context, db *sql.DB) (exists bool, applied map[int]bool, maxVersion int, err error) {
	applied = make(map[int]bool)
	var tableName string
	err = db.QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`).Scan(&tableName)
	if errors.Is(err, sql.ErrNoRows) {
		return false, applied, 0, nil
	}
	if err != nil {
		return false, nil, 0, err
	}
	exists = true
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return false, nil, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return false, nil, 0, err
		}
		applied[version] = true
		if version > maxVersion {
			maxVersion = version
		}
	}
	return exists, applied, maxVersion, rows.Err()
}

func pendingMigrations(migrations []migration, applied map[int]bool) []migration {
	pending := make([]migration, 0, len(migrations))
	for _, migration := range migrations {
		if !applied[migration.version] {
			pending = append(pending, migration)
		}
	}
	return pending
}

func applyMigrations(ctx context.Context, db *sql.DB, migrations []migration) (int, error) {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return 0, err
	}
	_, applied, maxVersion, err := migrationState(ctx, db)
	if err != nil {
		return 0, err
	}
	latest := latestSchemaVersion(migrations)
	if maxVersion > latest {
		return 0, fmt.Errorf("database schema version %d is newer than this TaskPilot build (supports %d)", maxVersion, latest)
	}
	for _, migration := range pendingMigrations(migrations, applied) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return 0, err
		}
		if err := migration.apply(ctx, tx); err != nil {
			tx.Rollback()
			return 0, fmt.Errorf("apply database migration %d: %w", migration.version, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, migration.version, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
			tx.Rollback()
			return 0, fmt.Errorf("record database migration %d: %w", migration.version, err)
		}
		if err := tx.Commit(); err != nil {
			return 0, fmt.Errorf("commit database migration %d: %w", migration.version, err)
		}
		maxVersion = migration.version
	}
	return latest, nil
}

func createMigrationBackup(ctx context.Context, db *sql.DB, databasePath string, fromVersion, toVersion int) (string, error) {
	backupDir := filepath.Join(filepath.Dir(databasePath), "backups")
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		return "", fmt.Errorf("create backup directory: %w", err)
	}
	stamp := time.Now().UTC().Format("20060102T150405Z")
	var backupPath string
	for attempt := 0; attempt < 100; attempt++ {
		suffix := ""
		if attempt > 0 {
			suffix = fmt.Sprintf("-%d", attempt)
		}
		candidate := filepath.Join(backupDir, fmt.Sprintf("taskpilot-before-migration-v%d-to-v%d-%s%s.db", fromVersion, toVersion, stamp, suffix))
		if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
			backupPath = candidate
			break
		} else if err != nil {
			return "", err
		}
	}
	if backupPath == "" {
		return "", errors.New("could not allocate a unique database backup path")
	}

	quotedPath := strings.ReplaceAll(filepath.ToSlash(backupPath), "'", "''")
	if _, err := db.ExecContext(ctx, "VACUUM INTO '"+quotedPath+"'"); err != nil {
		_ = os.Remove(backupPath)
		return "", fmt.Errorf("create database backup: %w", err)
	}
	if err := os.Chmod(backupPath, 0600); err != nil {
		return "", fmt.Errorf("protect database backup: %w", err)
	}
	return backupPath, nil
}
