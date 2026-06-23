package watchfolders

import (
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
)

var videoExts = map[string]bool{
	".mp4": true, ".mkv": true, ".avi": true, ".mov": true,
	".wmv": true, ".flv": true, ".webm": true, ".ts": true,
	".m4v": true, ".mpg": true, ".mpeg": true,
}

var transcodedSuffixes = regexp.MustCompile(`(?i)(_av1|_hevc|_x265|_x264)$`)

type Service struct {
	db *fftdb.DB
}

func New(db *fftdb.DB) *Service {
	return &Service{db: db}
}

func IsVideoFile(path string) bool {
	return videoExts[strings.ToLower(filepath.Ext(path))]
}

func (s *Service) ScanAll() ([]models.WatchFolderScanResult, error) {
	records, err := s.db.WatchFolders()
	if err != nil {
		return nil, err
	}

	results := make([]models.WatchFolderScanResult, 0, len(records))
	for _, record := range records {
		files := ScanFolder(record.Path)
		var total int64
		for _, file := range files {
			total += file.Size
		}
		results = append(results, models.WatchFolderScanResult{
			Folder: models.WatchFolder{
				Path:       record.Path,
				Label:      record.Label,
				FileCount:  len(files),
				TotalSize:  total,
				OutputDest: record.OutputDest,
				OutputDir:  record.OutputDir,
				CopyAV1:    record.CopyAV1,
				PresetName: record.PresetName,
			},
			Files: files,
		})
	}
	return results, nil
}

func ScanFolder(path string) []models.FileEntry {
	files := []models.FileEntry{}
	_ = filepath.WalkDir(path, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			if entry.IsDir() && p != path {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !IsVideoFile(p) || isTranscodedOutput(p) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		files = append(files, models.FileEntry{
			Name:  name,
			Path:  p,
			IsDir: false,
			Size:  info.Size(),
		})
		return nil
	})
	sort.Slice(files, func(i, j int) bool {
		return strings.ToLower(files[i].Path) < strings.ToLower(files[j].Path)
	})
	return files
}

func isTranscodedOutput(path string) bool {
	for _, part := range strings.Split(filepath.Clean(path), string(filepath.Separator)) {
		if part == "av1" || part == "AV1" {
			return true
		}
	}
	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	return transcodedSuffixes.MatchString(stem)
}
