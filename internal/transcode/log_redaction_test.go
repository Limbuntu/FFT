package transcode

import (
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
