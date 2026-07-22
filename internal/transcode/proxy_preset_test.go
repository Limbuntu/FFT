package transcode

import (
	"path/filepath"
	"testing"

	"github.com/limbuntu/fft/internal/models"
)

func TestBuildOutputPathProxyKeepsOriginalFilename(t *testing.T) {
	autoMP4 := true
	req := models.TranscodeRequest{
		OutputDest:   "subfolder",
		OutputFolder: "proxy",
		KeepFilename: true,
		Prefix:       "encoded_",
		Suffix:       "_av1",
		OutputExt:    "auto",
		AutoMP4:      &autoMP4,
	}
	source := filepath.Join("videos", "clip.mp4")
	got, changed, _, err := buildOutputPath(source, req, false)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("videos", "proxy", "clip.mp4")
	if got != want {
		t.Fatalf("output path = %q, want %q", got, want)
	}
	if changed {
		t.Fatal("compatible source extension should not be rewritten")
	}
}

func TestBuildOutputPathProxyFallsBackFromIncompatibleContainer(t *testing.T) {
	autoMP4 := true
	got, changed, _, err := buildOutputPath(filepath.Join("videos", "clip.mov"), models.TranscodeRequest{
		OutputDest:   "subfolder",
		OutputFolder: "proxy",
		KeepFilename: true,
		OutputExt:    "auto",
		AutoMP4:      &autoMP4,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("videos", "proxy", "clip.mp4")
	if got != want || !changed {
		t.Fatalf("output path = %q, changed = %v; want %q with compatibility rewrite", got, changed, want)
	}
}

func TestBuildOutputPathRejectsUnsafeOutputFolder(t *testing.T) {
	_, _, _, err := buildOutputPath("clip.mp4", models.TranscodeRequest{
		OutputDest:   "subfolder",
		OutputFolder: "../proxy",
	}, false)
	if err == nil {
		t.Fatal("unsafe output folder should be rejected")
	}
}
