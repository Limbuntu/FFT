package store

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

func TestTranscodeTaskPersistence(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "fft.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}

	createdAt := time.Date(2026, 6, 22, 15, 0, 0, 0, time.UTC)
	finishedAt := createdAt.Add(90 * time.Second)
	task := models.TaskInfo{
		TaskID: "task1234",
		Request: models.TranscodeRequest{
			Files:     []string{"/videos/input.mov"},
			Encoder:   "libsvtav1",
			CRF:       28,
			Preset:    "8",
			Suffix:    "_av1",
			OutputExt: ".mp4",
		},
		Status:      models.TaskDone,
		Progress:    100,
		TotalFiles:  1,
		Message:     "All files transcoded",
		OutputPath:  "/videos/input_av1.mp4",
		CreatedAt:   createdAt,
		FinishedAt:  finishedAt,
		DurationSec: 90,
		Results: []models.TaskFileResult{{
			InputPath:    "/videos/input.mov",
			OutputPath:   "/videos/input_av1.mp4",
			OriginalSize: 1000,
			OutputSize:   400,
			StartedAt:    createdAt,
			FinishedAt:   finishedAt,
			DurationSec:  90,
		}},
	}
	if err := db.SaveTranscodeTask(task); err != nil {
		t.Fatal(err)
	}

	tasks, err := db.TranscodeTasks()
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 {
		t.Fatalf("got %d tasks, want 1", len(tasks))
	}
	got := tasks[0]
	if got.TaskID != task.TaskID || got.Status != models.TaskDone || got.OutputPath != task.OutputPath {
		t.Fatalf("restored task mismatch: %+v", got)
	}
	if got.Request.Encoder != task.Request.Encoder || got.Request.Files[0] != task.Request.Files[0] {
		t.Fatalf("restored request mismatch: %+v", got.Request)
	}
	if len(got.Results) != 1 || got.Results[0].OutputSize != 400 {
		t.Fatalf("restored results mismatch: %+v", got.Results)
	}
	if !got.CreatedAt.Equal(createdAt) || !got.FinishedAt.Equal(finishedAt) {
		t.Fatalf("restored times mismatch: %s %s", got.CreatedAt, got.FinishedAt)
	}
}

func TestWatchFoldersKeepInsertionOrderAndUpdateLabel(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "fft.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}

	if _, err := db.AddWatchFolder("/tmp/z-last-by-name", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := db.AddWatchFolder("/tmp/a-first-by-name", "", "", ""); err != nil {
		t.Fatal(err)
	}
	label := "素材备忘"
	if _, err := db.UpdateWatchFolder("/tmp/z-last-by-name", nil, nil, &label, nil, nil); err != nil {
		t.Fatal(err)
	}

	folders, err := db.WatchFolders()
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != 2 {
		t.Fatalf("got %d folders, want 2", len(folders))
	}
	if folders[0].Path != "/tmp/z-last-by-name" || folders[1].Path != "/tmp/a-first-by-name" {
		t.Fatalf("watch folders not in insertion order: %+v", folders)
	}
	if folders[0].Label != label {
		t.Fatalf("label = %q, want %q", folders[0].Label, label)
	}
	if !folders[0].CopyAV1 || !folders[1].CopyAV1 {
		t.Fatalf("copy AV1 should default on: %+v", folders)
	}
	disabled := false
	presetName := "视觉无损 QSV"
	updated, err := db.UpdateWatchFolder("/tmp/z-last-by-name", nil, nil, nil, &presetName, &disabled)
	if err != nil {
		t.Fatal(err)
	}
	if updated.CopyAV1 {
		t.Fatalf("copy AV1 was not disabled: %+v", updated)
	}
	if updated.PresetName != presetName {
		t.Fatalf("preset name = %q, want %q", updated.PresetName, presetName)
	}
}
