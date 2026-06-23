package app

import (
	"strings"
	"testing"
)

func TestRedactURLPathForLogQueryPath(t *testing.T) {
	got := redactURLPathForLog("/api/files?path=%2FUsers%2Flimbuntu%2FVideos%2Fdemo.mov")
	if strings.Contains(got, "/Users/limbuntu/Videos") {
		t.Fatalf("path was not redacted: %s", got)
	}
	if !strings.Contains(got, "xxxxx/demo.mov") {
		t.Fatalf("filename was not preserved: %s", got)
	}
}

func TestRedactPathTextWindowsPath(t *testing.T) {
	got := redactPathText(`remove C:\Users\Limbuntu\Videos\demo.mp4 failed`)
	if strings.Contains(got, `C:\Users\Limbuntu\Videos`) {
		t.Fatalf("path was not redacted: %s", got)
	}
	if !strings.Contains(got, "xxxxx/demo.mp4") {
		t.Fatalf("filename was not preserved: %s", got)
	}
}
