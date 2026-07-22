package store

import (
	"path/filepath"
	"testing"

	"github.com/limbuntu/fft/internal/models"
)

func TestPresetOutputWorkflowPersistence(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "fft.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}

	_, err = db.SavePreset(models.Preset{
		Name:         "Proxy Custom",
		Encoder:      "libsvtav1",
		CRF:          30,
		Preset:       "9",
		OutputExt:    "auto",
		OutputFolder: "proxy",
		KeepFilename: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	items, err := db.CustomPresets()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].OutputFolder != "proxy" || !items[0].KeepFilename {
		t.Fatalf("preset workflow was not restored: %+v", items)
	}
}

func TestPresetOutputWorkflowMigratesExistingTable(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "fft.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.db.Exec(`CREATE TABLE presets (
		name TEXT PRIMARY KEY,
		encoder TEXT NOT NULL,
		crf INTEGER NOT NULL,
		preset TEXT NOT NULL,
		extra_args TEXT NOT NULL DEFAULT '[]',
		output_ext TEXT NOT NULL DEFAULT 'auto',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SavePreset(models.Preset{
		Name:         "Migrated Proxy",
		Encoder:      "libsvtav1",
		CRF:          30,
		Preset:       "9",
		OutputFolder: "proxy",
		KeepFilename: true,
	}); err != nil {
		t.Fatal(err)
	}
	items, err := db.CustomPresets()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].OutputFolder != "proxy" || !items[0].KeepFilename {
		t.Fatalf("migrated preset workflow was not restored: %+v", items)
	}
}
