package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/limbuntu/fft/internal/models"
	_ "modernc.org/sqlite"
)

type DB struct {
	db *sql.DB
}

type WatchFolderRecord struct {
	Path       string
	Label      string
	OutputDest string
	OutputDir  string
	CopyAV1    bool
	PresetName string
}

func Open(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err := db.Exec(`
		PRAGMA busy_timeout = 30000;
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA foreign_keys = ON;
	`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &DB{db: db}, nil
}

func (d *DB) Close() error {
	if d == nil || d.db == nil {
		return nil
	}
	return d.db.Close()
}

func (d *DB) Migrate() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS watch_folders (
			path TEXT PRIMARY KEY,
			label TEXT NOT NULL DEFAULT '',
			output_dest TEXT NOT NULL DEFAULT '',
			output_dir TEXT NOT NULL DEFAULT '',
			copy_av1 INTEGER NOT NULL DEFAULT 1,
			preset_name TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS presets (
			name TEXT PRIMARY KEY,
			encoder TEXT NOT NULL,
			crf INTEGER NOT NULL,
			preset TEXT NOT NULL,
			extra_args TEXT NOT NULL DEFAULT '[]',
			output_ext TEXT NOT NULL DEFAULT 'auto',
			output_folder TEXT NOT NULL DEFAULT '',
			keep_filename INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS benchmark_results (
			encoder TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			fps REAL NOT NULL DEFAULT 0,
			elapsed REAL NOT NULL DEFAULT 0,
			output_size INTEGER NOT NULL DEFAULT 0,
			score REAL NOT NULL DEFAULT 0,
			error TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS transcode_tasks (
			task_id TEXT PRIMARY KEY,
			request TEXT NOT NULL,
			status TEXT NOT NULL,
			progress REAL NOT NULL DEFAULT 0,
			speed TEXT NOT NULL DEFAULT '',
			eta TEXT NOT NULL DEFAULT '',
			eta_seconds REAL NOT NULL DEFAULT 0,
			current_file TEXT NOT NULL DEFAULT '',
			current_index INTEGER NOT NULL DEFAULT 0,
			total_files INTEGER NOT NULL DEFAULT 0,
			message TEXT NOT NULL DEFAULT '',
			output_path TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			finished_at TEXT NOT NULL DEFAULT '',
			duration_sec REAL NOT NULL DEFAULT 0,
			results TEXT NOT NULL DEFAULT '[]',
			updated_at TEXT NOT NULL
		);`,
	}
	for _, stmt := range statements {
		if _, err := d.db.Exec(stmt); err != nil {
			return err
		}
	}
	if err := d.ensureColumn("watch_folders", "copy_av1", "INTEGER NOT NULL DEFAULT 1"); err != nil {
		return err
	}
	if err := d.ensureColumn("watch_folders", "preset_name", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := d.ensureColumn("presets", "output_folder", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := d.ensureColumn("presets", "keep_filename", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	return nil
}

func (d *DB) ensureColumn(table, column, definition string) error {
	rows, err := d.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return rows.Err()
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = d.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

func (d *DB) ImportLegacyJSON(root string) error {
	if err := d.importWatchFolders(filepath.Join(root, "watchfolders.json")); err != nil {
		return err
	}
	if err := d.importPresets(filepath.Join(root, "presets.json")); err != nil {
		return err
	}
	if err := d.importBenchmark(filepath.Join(root, "bench_history.json")); err != nil {
		return err
	}
	return nil
}

func (d *DB) WatchFolders() ([]WatchFolderRecord, error) {
	rows, err := d.db.Query(`SELECT path, label, output_dest, output_dir, copy_av1, preset_name FROM watch_folders ORDER BY created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []WatchFolderRecord
	for rows.Next() {
		var r WatchFolderRecord
		if err := rows.Scan(&r.Path, &r.Label, &r.OutputDest, &r.OutputDir, &r.CopyAV1, &r.PresetName); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

func (d *DB) AddWatchFolder(path, label, outputDest, outputDir string) (WatchFolderRecord, error) {
	now := time.Now().Format(time.RFC3339Nano)
	if label == "" {
		label = filepath.Base(path)
	}
	_, err := d.db.Exec(
		`INSERT OR IGNORE INTO watch_folders(path, label, output_dest, output_dir, copy_av1, preset_name, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 1, '', ?, ?)`,
		path, label, outputDest, outputDir, now, now,
	)
	if err != nil {
		return WatchFolderRecord{}, err
	}
	return d.WatchFolder(path)
}

func (d *DB) WatchFolder(path string) (WatchFolderRecord, error) {
	var r WatchFolderRecord
	err := d.db.QueryRow(
		`SELECT path, label, output_dest, output_dir, copy_av1, preset_name FROM watch_folders WHERE path = ?`,
		path,
	).Scan(&r.Path, &r.Label, &r.OutputDest, &r.OutputDir, &r.CopyAV1, &r.PresetName)
	return r, err
}

func (d *DB) UpdateWatchFolder(path string, outputDest, outputDir, label, presetName *string, copyAV1 *bool) (WatchFolderRecord, error) {
	current, err := d.WatchFolder(path)
	if err != nil {
		return WatchFolderRecord{}, err
	}
	if label != nil {
		current.Label = strings.TrimSpace(*label)
		if current.Label == "" {
			current.Label = filepath.Base(path)
		}
	}
	if outputDest != nil {
		current.OutputDest = *outputDest
	}
	if outputDir != nil {
		current.OutputDir = *outputDir
	}
	if copyAV1 != nil {
		current.CopyAV1 = *copyAV1
	}
	if presetName != nil {
		current.PresetName = strings.TrimSpace(*presetName)
	}
	_, err = d.db.Exec(
		`UPDATE watch_folders SET label = ?, output_dest = ?, output_dir = ?, copy_av1 = ?, preset_name = ?, updated_at = ? WHERE path = ?`,
		current.Label, current.OutputDest, current.OutputDir, current.CopyAV1, current.PresetName, time.Now().Format(time.RFC3339Nano), path,
	)
	if err != nil {
		return WatchFolderRecord{}, err
	}
	return current, nil
}

func (d *DB) MoveWatchFolder(oldPath, newPath string) (WatchFolderRecord, error) {
	current, err := d.WatchFolder(oldPath)
	if err != nil {
		return WatchFolderRecord{}, err
	}
	if current.Path == newPath {
		return current, nil
	}
	if _, err := d.WatchFolder(newPath); err == nil {
		return WatchFolderRecord{}, fmt.Errorf("watch folder already exists")
	} else if err != sql.ErrNoRows {
		return WatchFolderRecord{}, err
	}
	label := filepath.Base(newPath)
	if label == "." || label == string(filepath.Separator) || label == "" {
		label = newPath
	}
	_, err = d.db.Exec(
		`UPDATE watch_folders SET path = ?, label = ?, updated_at = ? WHERE path = ?`,
		newPath, label, time.Now().Format(time.RFC3339Nano), oldPath,
	)
	if err != nil {
		return WatchFolderRecord{}, err
	}
	return d.WatchFolder(newPath)
}

func (d *DB) RemoveWatchFolder(path string) (bool, error) {
	res, err := d.db.Exec(`DELETE FROM watch_folders WHERE path = ?`, path)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (d *DB) CustomPresets() ([]models.Preset, error) {
	rows, err := d.db.Query(`SELECT name, encoder, crf, preset, extra_args, output_ext, output_folder, keep_filename FROM presets ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.Preset
	for rows.Next() {
		var p models.Preset
		var extra string
		if err := rows.Scan(&p.Name, &p.Encoder, &p.CRF, &p.Preset, &extra, &p.OutputExt, &p.OutputFolder, &p.KeepFilename); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(extra), &p.ExtraArgs)
		if p.OutputExt == "" {
			p.OutputExt = "auto"
		}
		result = append(result, p)
	}
	return result, rows.Err()
}

func (d *DB) SavePreset(p models.Preset) (models.Preset, error) {
	extra, err := json.Marshal(p.ExtraArgs)
	if err != nil {
		return models.Preset{}, err
	}
	if p.OutputExt == "" {
		p.OutputExt = "auto"
	}
	now := time.Now().Format(time.RFC3339Nano)
	_, err = d.db.Exec(
		`INSERT INTO presets(name, encoder, crf, preset, extra_args, output_ext, output_folder, keep_filename, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(name) DO UPDATE SET
		 encoder = excluded.encoder,
		 crf = excluded.crf,
		 preset = excluded.preset,
		 extra_args = excluded.extra_args,
		 output_ext = excluded.output_ext,
		 output_folder = excluded.output_folder,
		 keep_filename = excluded.keep_filename,
		 updated_at = excluded.updated_at`,
		p.Name, p.Encoder, p.CRF, p.Preset.String(), string(extra), p.OutputExt, p.OutputFolder, p.KeepFilename, now, now,
	)
	if err != nil {
		return models.Preset{}, err
	}
	p.Builtin = false
	return p, nil
}

func (d *DB) DeletePreset(name string) (bool, error) {
	res, err := d.db.Exec(`DELETE FROM presets WHERE name = ?`, name)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

func (d *DB) SaveBenchmarkResults(results []models.BenchmarkResult) error {
	now := time.Now().Format(time.RFC3339Nano)
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, r := range results {
		_, err := tx.Exec(
			`INSERT INTO benchmark_results(encoder, label, fps, elapsed, output_size, score, error, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(encoder) DO UPDATE SET
			 label = excluded.label,
			 fps = excluded.fps,
			 elapsed = excluded.elapsed,
			 output_size = excluded.output_size,
			 score = excluded.score,
			 error = excluded.error,
			 updated_at = excluded.updated_at`,
			r.Encoder, r.Label, r.FPS, r.Elapsed, r.OutputSize, r.Score, r.Error, now,
		)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) BenchmarkHistory() (map[string]any, error) {
	rows, err := d.db.Query(
		`SELECT encoder, label, fps, elapsed, output_size, score, error, updated_at
		 FROM benchmark_results
		 ORDER BY updated_at DESC, score DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var (
		results   []models.BenchmarkResult
		timestamp string
	)
	for rows.Next() {
		var r models.BenchmarkResult
		var updated string
		if err := rows.Scan(&r.Encoder, &r.Label, &r.FPS, &r.Elapsed, &r.OutputSize, &r.Score, &r.Error, &updated); err != nil {
			return nil, err
		}
		if timestamp == "" {
			timestamp = updated
		}
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"results": results, "timestamp": nullableTimestamp(timestamp)}, nil
}

func (d *DB) SaveTranscodeTask(task models.TaskInfo) error {
	req, err := json.Marshal(task.Request)
	if err != nil {
		return err
	}
	results, err := json.Marshal(task.Results)
	if err != nil {
		return err
	}
	now := time.Now().Format(time.RFC3339Nano)
	_, err = d.db.Exec(
		`INSERT INTO transcode_tasks(
			task_id, request, status, progress, speed, eta, eta_seconds,
			current_file, current_index, total_files, message, output_path,
			created_at, finished_at, duration_sec, results, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(task_id) DO UPDATE SET
			request = excluded.request,
			status = excluded.status,
			progress = excluded.progress,
			speed = excluded.speed,
			eta = excluded.eta,
			eta_seconds = excluded.eta_seconds,
			current_file = excluded.current_file,
			current_index = excluded.current_index,
			total_files = excluded.total_files,
			message = excluded.message,
			output_path = excluded.output_path,
			finished_at = excluded.finished_at,
			duration_sec = excluded.duration_sec,
			results = excluded.results,
			updated_at = excluded.updated_at`,
		task.TaskID,
		string(req),
		task.Status,
		task.Progress,
		task.Speed,
		task.ETA,
		task.ETASeconds,
		task.CurrentFile,
		task.CurrentIndex,
		task.TotalFiles,
		task.Message,
		task.OutputPath,
		formatTime(task.CreatedAt),
		formatTime(task.FinishedAt),
		task.DurationSec,
		string(results),
		now,
	)
	return err
}

func (d *DB) TranscodeTasks() ([]models.TaskInfo, error) {
	rows, err := d.db.Query(
		`SELECT task_id, request, status, progress, speed, eta, eta_seconds,
			current_file, current_index, total_files, message, output_path,
			created_at, finished_at, duration_sec, results
		 FROM transcode_tasks
		 ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tasks []models.TaskInfo
	for rows.Next() {
		var task models.TaskInfo
		var requestJSON, resultsJSON, createdAt, finishedAt string
		if err := rows.Scan(
			&task.TaskID,
			&requestJSON,
			&task.Status,
			&task.Progress,
			&task.Speed,
			&task.ETA,
			&task.ETASeconds,
			&task.CurrentFile,
			&task.CurrentIndex,
			&task.TotalFiles,
			&task.Message,
			&task.OutputPath,
			&createdAt,
			&finishedAt,
			&task.DurationSec,
			&resultsJSON,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(requestJSON), &task.Request)
		_ = json.Unmarshal([]byte(resultsJSON), &task.Results)
		task.CreatedAt = parseTime(createdAt)
		task.FinishedAt = parseTime(finishedAt)
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339Nano)
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339Nano, value)
	return t
}

func nullableTimestamp(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (d *DB) tableEmpty(table string) (bool, error) {
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (d *DB) importWatchFolders(path string) error {
	empty, err := d.tableEmpty("watch_folders")
	if err != nil || !empty {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var records []WatchFolderRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return err
	}
	for _, r := range records {
		if _, err := d.AddWatchFolder(r.Path, r.Label, r.OutputDest, r.OutputDir); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) importPresets(path string) error {
	empty, err := d.tableEmpty("presets")
	if err != nil || !empty {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var presets []models.Preset
	if err := json.Unmarshal(data, &presets); err != nil {
		return err
	}
	for _, p := range presets {
		if _, err := d.SavePreset(p); err != nil {
			return err
		}
	}
	return nil
}

func (d *DB) importBenchmark(path string) error {
	empty, err := d.tableEmpty("benchmark_results")
	if err != nil || !empty {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var history struct {
		Results []models.BenchmarkResult `json:"results"`
	}
	if err := json.Unmarshal(data, &history); err != nil {
		return err
	}
	return d.SaveBenchmarkResults(history.Results)
}
