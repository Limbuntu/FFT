package app

import (
	"path/filepath"
	"testing"

	fftdb "github.com/limbuntu/fft/internal/store"
)

func TestProxyManagedPathKeepsNestedFilename(t *testing.T) {
	root := t.TempDir()
	folder := fftdb.WatchFolderRecord{Path: filepath.Join(root, "videos")}
	source := filepath.Join(folder.Path, "camera-a", "clip.mp4")
	naming := managedOutputNaming{
		OutputFolder:  "proxy",
		KeepFilename:  true,
		Suffix:        "_av1",
		SuffixEnabled: true,
		OutputExt:     "auto",
		AutoMP4:       true,
	}

	got := targetPathFor(folder, source, false, naming)
	want := filepath.Join(folder.Path, "proxy", "camera-a", "clip.mp4")
	if got != want {
		t.Fatalf("target path mismatch\nwant: %s\n got: %s", want, got)
	}
	if root := targetRootFor(folder, naming); root != filepath.Join(folder.Path, "proxy") {
		t.Fatalf("target root = %q", root)
	}
}

func TestProxyManagedPathUsesCompatibleContainerFallback(t *testing.T) {
	root := t.TempDir()
	folder := fftdb.WatchFolderRecord{Path: filepath.Join(root, "videos")}
	source := filepath.Join(folder.Path, "clip.mov")
	naming := managedOutputNaming{
		OutputFolder: "proxy",
		KeepFilename: true,
		OutputExt:    "auto",
		AutoMP4:      true,
	}

	got := targetPathFor(folder, source, false, naming)
	want := filepath.Join(folder.Path, "proxy", "clip.mp4")
	if got != want {
		t.Fatalf("target path mismatch\nwant: %s\n got: %s", want, got)
	}
}
