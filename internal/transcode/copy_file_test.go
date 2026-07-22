package transcode

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestCopyFileAllowsUnsupportedSync(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.bin")
	dst := filepath.Join(dir, "target.bin")
	want := []byte("copied content")
	if err := os.WriteFile(src, want, 0o644); err != nil {
		t.Fatal(err)
	}

	err := copyFileWithSync(src, dst, func(*os.File) error {
		return &os.PathError{Op: "sync", Path: dst, Err: syscall.ENOTSUP}
	})
	if err != nil {
		t.Fatalf("unsupported sync should not fail a completed copy: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("target content = %q, want %q", got, want)
	}
}

func TestCopyFileRejectsOtherSyncErrors(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.bin")
	dst := filepath.Join(dir, "target.bin")
	if err := os.WriteFile(src, []byte("copied content"), 0o644); err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("sync failed")

	err := copyFileWithSync(src, dst, func(*os.File) error { return wantErr })
	if !errors.Is(err, wantErr) {
		t.Fatalf("copy error = %v, want %v", err, wantErr)
	}
	if _, err := os.Stat(dst); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed copy should remove target, stat error = %v", err)
	}
}
