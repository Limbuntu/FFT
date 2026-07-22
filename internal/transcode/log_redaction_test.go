package transcode

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/limbuntu/fft/internal/models"
)

func TestSanitizeLogTextRedactsSourceAndOutputPaths(t *testing.T) {
	src := "/Users/limbuntu/Videos/source clip.mov"
	dst := "/Users/limbuntu/Videos/AV1/source clip_av1.mp4"
	text := `-i ` + src + ` ` + dst
	got := sanitizeLogText(text, src, dst)
	if strings.Contains(got, "/Users/limbuntu/Videos") {
		t.Fatalf("path was not redacted: %s", got)
	}
	if !strings.Contains(got, "xxxxx/source clip.mov") || !strings.Contains(got, "xxxxx/source clip_av1.mp4") {
		t.Fatalf("filenames were not preserved: %s", got)
	}
}

func TestBuildOutputPathPreservesSourceContainerWhenCopyingAV1(t *testing.T) {
	src := filepath.Join("videos", "clip.mov")
	req := models.TranscodeRequest{
		OutputExt: "auto",
		Prefix:    "av1_",
		Suffix:    "_av1",
		FileOutputs: map[string]map[string]string{
			src: {
				"output_dest": "custom",
				"output_dir":  "out",
				"prefix":      "av1_",
				"suffix":      "",
				"copy_av1":    "true",
			},
		},
	}
	got, changed, _, err := buildOutputPath(src, req, true)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("copying AV1 should not trigger incompatible container rewrite")
	}
	want := filepath.Join("out", "clip.mov")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildOutputPathAutoMP4FallbackDefaultsOn(t *testing.T) {
	src := filepath.Join("videos", "clip.mov")
	req := models.TranscodeRequest{
		OutputExt: "auto",
		Suffix:    "_av1",
	}
	got, changed, _, err := buildOutputPath(src, req, false)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("auto MP4 fallback should be enabled by default")
	}
	want := filepath.Join("videos", "clip_av1.mp4")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildOutputPathAutoPreservesSourceContainerWhenFallbackOff(t *testing.T) {
	src := filepath.Join("videos", "clip.mov")
	off := false
	req := models.TranscodeRequest{
		OutputExt: "auto",
		Suffix:    "_av1",
		AutoMP4:   &off,
	}
	got, changed, _, err := buildOutputPath(src, req, false)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("auto output should preserve the source extension when fallback is disabled")
	}
	want := filepath.Join("videos", "clip_av1.mov")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildOutputPathAppliesPrefixAndSuffix(t *testing.T) {
	src := filepath.Join("videos", "clip.mov")
	req := models.TranscodeRequest{
		OutputExt: ".mp4",
		Prefix:    "av1_",
		Suffix:    "_done",
	}
	got, changed, _, err := buildOutputPath(src, req, false)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("mp4 output should not trigger incompatible container rewrite")
	}
	want := filepath.Join("videos", "av1_clip_done.mp4")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestQSVPresetValueClampsNumericPreset(t *testing.T) {
	tests := map[models.PresetValue]string{
		"8":         "7",
		"99":        "7",
		"-1":        "0",
		"fast":      "4",
		"ultrafast": "7",
	}
	for input, want := range tests {
		if got := qsvPresetValue(input); got != want {
			t.Fatalf("qsvPresetValue(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestStagingPathUsesCacheAndFinalExtension(t *testing.T) {
	cache := t.TempDir()
	service := New(nil, nil, cache)
	got, err := service.stagingPath("task123", 0, filepath.Join("out", "clip_av1.mp4"))
	if err != nil {
		t.Fatal(err)
	}
	wantPrefix := filepath.Join(cache, "transcode-staging", "task123") + string(os.PathSeparator)
	if !strings.HasPrefix(got, wantPrefix) {
		t.Fatalf("staging path %q does not start with %q", got, wantPrefix)
	}
	if filepath.Ext(got) != ".mp4" {
		t.Fatalf("staging path should preserve final extension, got %q", got)
	}
}

func TestVerifyMatchingMD5(t *testing.T) {
	dir := t.TempDir()
	left := filepath.Join(dir, "left.bin")
	right := filepath.Join(dir, "right.bin")
	if err := os.WriteFile(left, []byte("same"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(right, []byte("same"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := verifyMatchingMD5(left, right); err != nil {
		t.Fatalf("matching files should pass md5 check: %v", err)
	}
	if err := os.WriteFile(right, []byte("different"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := verifyMatchingMD5(left, right); err == nil {
		t.Fatal("different files should fail md5 check")
	}
}

func TestReplaceFileOverwritesExistingAndRemovesSource(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "new.bin")
	dst := filepath.Join(dir, "final.bin")
	if err := os.WriteFile(src, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	backup, err := replaceFile(src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if backup == "" {
		t.Fatal("existing destination should be moved to a backup before replacement")
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "new" {
		t.Fatalf("final file = %q, want new", got)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatalf("source temp should be moved away, stat err=%v", err)
	}
	rollbackPublishedFile(dst, backup)
	rolledBack, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(rolledBack) != "old" {
		t.Fatalf("rollback file = %q, want old", rolledBack)
	}
}

func TestValidateMediaFileRejectsEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.mp4")
	if err := os.WriteFile(path, nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := validateMediaFile(path); err == nil {
		t.Fatal("empty media file should fail validation")
	}
}

func TestValidateMediaFileAcceptsGeneratedVideo(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available")
	}
	path := filepath.Join(t.TempDir(), "tiny.mp4")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:s=16x16:d=0.1:r=1", "-frames:v", "1", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generate test video: %v: %s", err, out)
	}
	if err := validateMediaFile(path); err != nil {
		t.Fatalf("generated video should pass validation: %v", err)
	}
}

func TestPublishStagedOutputValidatesAndPublishesVideo(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not available")
	}
	dir := t.TempDir()
	cache := filepath.Join(dir, "cache")
	stage := filepath.Join(cache, "stage.mp4")
	final := filepath.Join(dir, "remote", "final.mp4")
	if err := os.MkdirAll(filepath.Dir(stage), 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=black:s=16x16:d=0.1:r=1", "-frames:v", "1", stage)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generate staged video: %v: %s", err, out)
	}

	service := New(nil, nil, cache)
	if err := service.publishStagedOutput("task123", stage, final); err != nil {
		t.Fatal(err)
	}
	if err := verifyMatchingMD5(stage, final); err != nil {
		t.Fatalf("published file should match staged file: %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(final), "."+filepath.Base(final)+".fft-part-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("publish temp files should not remain: %v", matches)
	}
}
