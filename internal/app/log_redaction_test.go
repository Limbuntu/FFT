package app

import (
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
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

func TestRedactURLPathForLogSecretQuery(t *testing.T) {
	got := redactURLPathForLog("/api/logs/feedback?token=abc123&path=%2FUsers%2Flimbuntu%2FVideos%2Fdemo.mov")
	if strings.Contains(got, "abc123") || strings.Contains(got, "/Users/limbuntu/Videos") {
		t.Fatalf("secret or path was not redacted: %s", got)
	}
	if !strings.Contains(got, "token=xxxxx") || !strings.Contains(got, "xxxxx/demo.mov") {
		t.Fatalf("redacted output missing expected markers: %s", got)
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

func TestRedactFeedbackLogTextRedactsPathsWithSpacesAndTilde(t *testing.T) {
	got := redactFeedbackLogText(`Transcode cmd: ffmpeg -i /Users/limbuntu/Videos/My Clips/source clip.mov -c:a copy ~/Downloads/FFT/test/source clip_av1.mp4`)
	if strings.Contains(got, "/Users/limbuntu/Videos") || strings.Contains(got, "~/Downloads") {
		t.Fatalf("paths were not redacted: %s", got)
	}
	if !strings.Contains(got, "xxxxx/source clip.mov") || !strings.Contains(got, "xxxxx/source clip_av1.mp4") {
		t.Fatalf("filenames were not preserved: %s", got)
	}
}

func TestRedactFeedbackLogTextRemovesSecretsAndPaths(t *testing.T) {
	got := redactFeedbackLogText(`open file=/Users/limbuntu/Videos/demo.mp4 token=abc123 password:"hunter2"`)
	if strings.Contains(got, "/Users/limbuntu/Videos") {
		t.Fatalf("unix path was not redacted: %s", got)
	}
	if strings.Contains(got, "abc123") || strings.Contains(got, "hunter2") {
		t.Fatalf("secret was not redacted: %s", got)
	}
	if !strings.Contains(got, "xxxxx/demo.mp4") {
		t.Fatalf("filename was not preserved: %s", got)
	}
}

func TestRedactFeedbackLogTextRemovesAuthHeadersAndPrivateIPs(t *testing.T) {
	got := redactFeedbackLogText("Authorization: Bearer abc.def.ghi\nLAN access: http://192.168.1.25:8166\napi_key = super-secret")
	if strings.Contains(got, "abc.def.ghi") || strings.Contains(got, "super-secret") || strings.Contains(got, "192.168.1.25") {
		t.Fatalf("sensitive value was not redacted: %s", got)
	}
	if !strings.Contains(got, "Authorization: xxxxx") || !strings.Contains(got, "x.x.x.x") || !strings.Contains(got, "api_key = xxxxx") {
		t.Fatalf("redacted output missing expected markers: %s", got)
	}
}

func TestRedactFeedbackLogTextReplacesInvalidUTF8(t *testing.T) {
	got := redactFeedbackLogText("ok\xfftext")
	if !utf8.ValidString(got) {
		t.Fatalf("feedback log text was not valid utf-8")
	}
	if !strings.Contains(got, "�") {
		t.Fatalf("invalid byte was not replaced: %q", got)
	}
}

func TestLogTimestampFormat(t *testing.T) {
	got := logTimestamp()
	if !regexp.MustCompile(`^\d{8}-\d{6}$`).MatchString(got) {
		t.Fatalf("unexpected timestamp format: %s", got)
	}
}
