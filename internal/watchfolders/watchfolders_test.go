package watchfolders

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanFolderSkipsProxyOutputs(t *testing.T) {
	root := t.TempDir()
	paths := []string{
		filepath.Join(root, "source.mp4"),
		filepath.Join(root, "proxy", "source.mp4"),
		filepath.Join(root, "PROXY", "nested", "other.mkv"),
		filepath.Join(root, "AV1", "legacy.mp4"),
	}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("video"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	files := ScanFolder(root)
	if len(files) != 1 || files[0].Path != paths[0] {
		t.Fatalf("scan returned proxy outputs: %+v", files)
	}
}
