package report

import (
	"bytes"
	"testing"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

func TestGenerateTaskPDF(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	task := models.TaskInfo{
		TaskID:      "sample-task",
		Status:      models.TaskDone,
		TotalFiles:  1,
		CreatedAt:   now,
		FinishedAt:  now.Add(75 * time.Second),
		DurationSec: 75,
		Request: models.TranscodeRequest{
			Files:     []string{"/video/Skiing.MP4"},
			Encoder:   "libsvtav1",
			CRF:       30,
			Preset:    "8",
			Suffix:    "_av1",
			OutputExt: ".mkv",
		},
		OutputPath: "/video/Skiing_av1.mkv",
		Results: []models.TaskFileResult{
			{
				InputPath:    "/video/Skiing.MP4",
				OutputPath:   "/video/Skiing_av1.mkv",
				OriginalSize: 224800000,
				OutputSize:   125410000,
				StartedAt:    now,
				FinishedAt:   now.Add(75 * time.Second),
				DurationSec:  75,
			},
		},
	}

	pdf, filename, err := GenerateTaskPDF(task)
	if err != nil {
		t.Fatalf("GenerateTaskPDF returned error: %v", err)
	}
	if filename != "fft-task-sample-task-report.pdf" {
		t.Fatalf("unexpected filename: %s", filename)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("generated report is not a PDF")
	}
	if !bytes.Contains(pdf, []byte("xref")) || !bytes.Contains(pdf, []byte("%%EOF")) {
		t.Fatalf("generated PDF is missing required sections")
	}
}
