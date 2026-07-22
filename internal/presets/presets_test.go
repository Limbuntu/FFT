package presets

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
)

func TestProxyBuiltinDefaults(t *testing.T) {
	var proxyFound bool
	for _, preset := range Builtins {
		if preset.Name != "Proxy" {
			continue
		}
		proxyFound = true
		if preset.Encoder != "libsvtav1" || preset.Preset.String() != "9" || preset.CRF != 30 {
			t.Fatalf("unexpected Proxy encoding settings: %+v", preset)
		}
		if preset.OutputFolder != "" || !preset.KeepFilename || preset.OutputExt != "auto" {
			t.Fatalf("unexpected Proxy output settings: %+v", preset)
		}
		if !slices.Equal(preset.ExtraArgs, []string{"-pix_fmt", "yuv420p"}) {
			t.Fatalf("unexpected Proxy extra args: %v", preset.ExtraArgs)
		}
	}
	if !proxyFound {
		t.Fatal("Proxy builtin preset was not found")
	}
}

func TestProxyWorkflowDefaultsSurviveBuiltinOverride(t *testing.T) {
	db, err := fftdb.Open(filepath.Join(t.TempDir(), "fft.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}

	service := New(db)
	if _, err := service.Save(models.Preset{
		Name:      "Proxy",
		Encoder:   "libsvtav1",
		CRF:       31,
		Preset:    "8",
		OutputExt: "auto",
	}); err != nil {
		t.Fatal(err)
	}
	items, err := service.All()
	if err != nil {
		t.Fatal(err)
	}
	for _, preset := range items {
		if preset.Name == "Proxy" {
			if preset.CRF != 31 || preset.OutputFolder != "" || !preset.KeepFilename || !preset.Builtin {
				t.Fatalf("unexpected overridden Proxy preset: %+v", preset)
			}
			return
		}
	}
	t.Fatal("Proxy preset was not returned")
}
