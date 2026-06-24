package app

import (
	"os"
	"path/filepath"
	"testing"

	fftdb "github.com/limbuntu/fft/internal/store"
)

func TestTargetPathForHonorsManagedNamingOptions(t *testing.T) {
	root := t.TempDir()
	outputDir := filepath.Join(root, "out")
	folder := fftdb.WatchFolderRecord{
		Path:       filepath.Join(root, "video"),
		OutputDest: "custom",
		OutputDir:  outputDir,
	}
	source := filepath.Join(folder.Path, "War Thunder Gameplay Recording.mov")
	naming := managedOutputNaming{
		SuffixEnabled: false,
		OutputExt:     "auto",
		AutoMP4:       true,
	}

	got := targetPathFor(folder, source, false, naming)
	want := filepath.Join(outputDir, "War Thunder Gameplay Recording.mp4")
	if got != want {
		t.Fatalf("target path mismatch\nwant: %s\n got: %s", want, got)
	}
}

func TestTargetPathForMatchesFlattenedFrontendSuffix(t *testing.T) {
	root := t.TempDir()
	outputDir := filepath.Join(root, "out")
	folder := fftdb.WatchFolderRecord{
		Path:       filepath.Join(root, "video"),
		OutputDest: "custom",
		OutputDir:  outputDir,
	}
	source := filepath.Join(folder.Path, "clips", "Skiing.MP4")
	naming := managedOutputNaming{
		Suffix:        "_av1",
		SuffixEnabled: true,
		OutputExt:     "auto",
		AutoMP4:       true,
	}

	got := targetPathFor(folder, source, false, naming)
	want := filepath.Join(outputDir, "Skiing_clips_av1.MP4")
	if got != want {
		t.Fatalf("target path mismatch\nwant: %s\n got: %s", want, got)
	}
}

func TestSelectManagedTargetPrefersExistingInferredPath(t *testing.T) {
	root := t.TempDir()
	stale := filepath.Join(root, "video_av1.mp4")
	current := filepath.Join(root, "video.mp4")
	if err := os.WriteFile(current, []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}

	got, info, err := selectManagedTarget(stale, current, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got != current {
		t.Fatalf("expected existing inferred target, got %s", got)
	}
	if info == nil || info.Size() == 0 {
		t.Fatalf("expected file info for inferred target")
	}
}
