package transcode

import (
	"testing"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

func TestFailDoesNotOverwriteCancelledTask(t *testing.T) {
	service := New(nil, nil, t.TempDir())
	service.tasks["cancelled-task"] = &models.TaskInfo{
		TaskID:    "cancelled-task",
		Status:    models.TaskCancelled,
		CreatedAt: time.Now(),
		Message:   "cancelled",
	}

	service.fail("cancelled-task", "late publish error")
	task, ok := service.Task("cancelled-task")
	if !ok {
		t.Fatal("task was not found")
	}
	if task.Status != models.TaskCancelled || task.Message != "cancelled" {
		t.Fatalf("cancelled task was overwritten: %+v", task)
	}
}
