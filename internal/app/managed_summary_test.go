package app

import (
	"path/filepath"
	"testing"

	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
)

func TestManagedSummaryIncludesZeroProgressActiveTask(t *testing.T) {
	root := t.TempDir()
	folder := fftdb.WatchFolderRecord{Path: filepath.Join(root, "videos")}
	task := models.TaskInfo{
		TaskID: "starting-task",
		Status: models.TaskPending,
		Request: models.TranscodeRequest{
			Files: []string{filepath.Join(folder.Path, "clip.mp4")},
		},
	}

	summary := managedSummary(folder, []models.TaskInfo{task}, 1, 100, 0, "")
	if summary.ActiveTaskID != task.TaskID {
		t.Fatalf("active task id = %q, want %q", summary.ActiveTaskID, task.TaskID)
	}
	if summary.Progress != 0 {
		t.Fatalf("progress = %v, want 0", summary.Progress)
	}
}
