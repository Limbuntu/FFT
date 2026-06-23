package transcode

import (
	"strings"
	"testing"
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
