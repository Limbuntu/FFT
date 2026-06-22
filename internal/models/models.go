package models

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

type PresetValue string

func (v *PresetValue) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		*v = ""
		return nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*v = PresetValue(s)
		return nil
	}
	*v = PresetValue(string(data))
	return nil
}

func (v PresetValue) MarshalJSON() ([]byte, error) {
	s := strings.TrimSpace(string(v))
	if s == "" {
		return []byte("0"), nil
	}
	if _, err := strconv.Atoi(s); err == nil {
		return []byte(s), nil
	}
	return json.Marshal(s)
}

func (v PresetValue) String() string {
	if v == "" {
		return "0"
	}
	return string(v)
}

type EncoderInfo struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	Available bool   `json:"available"`
	HWType    string `json:"hw_type"`
}

type HardwareReport struct {
	Encoders      []EncoderInfo `json:"encoders"`
	FFmpegVersion string        `json:"ffmpeg_version"`
}

type TaskStatus string

const (
	TaskPending   TaskStatus = "pending"
	TaskRunning   TaskStatus = "running"
	TaskDone      TaskStatus = "done"
	TaskFailed    TaskStatus = "failed"
	TaskCancelled TaskStatus = "cancelled"
)

type TranscodeRequest struct {
	Files       []string                     `json:"files"`
	Encoder     string                       `json:"encoder"`
	CRF         int                          `json:"crf"`
	Preset      PresetValue                  `json:"preset"`
	ExtraArgs   []string                     `json:"extra_args"`
	OutputDir   string                       `json:"output_dir"`
	OutputDest  string                       `json:"output_dest"`
	Suffix      string                       `json:"suffix"`
	OutputExt   string                       `json:"output_ext"`
	FileOutputs map[string]map[string]string `json:"file_outputs"`
}

func (r *TranscodeRequest) Normalize() {
	if r.Encoder == "" {
		r.Encoder = "libsvtav1"
	}
	if r.Preset == "" {
		r.Preset = "8"
	}
	if r.OutputDest == "" {
		r.OutputDest = "beside"
	}
	if r.Suffix == "" {
		r.Suffix = "_av1"
	}
	if r.OutputExt == "" {
		r.OutputExt = "auto"
	}
	if r.FileOutputs == nil {
		r.FileOutputs = map[string]map[string]string{}
	}
}

type TaskProgress struct {
	TaskID       string     `json:"task_id"`
	Status       TaskStatus `json:"status"`
	Progress     float64    `json:"progress"`
	Speed        string     `json:"speed"`
	ETA          string     `json:"eta"`
	ETASeconds   float64    `json:"eta_seconds"`
	CurrentFile  string     `json:"current_file"`
	CurrentIndex int        `json:"current_index"`
	TotalFiles   int        `json:"total_files"`
	Message      string     `json:"message"`
	OutputPath   string     `json:"output_path"`
	CreatedAt    time.Time  `json:"created_at"`
}

type TaskInfo struct {
	TaskID       string           `json:"task_id"`
	Request      TranscodeRequest `json:"request"`
	Status       TaskStatus       `json:"status"`
	Progress     float64          `json:"progress"`
	Speed        string           `json:"speed"`
	ETA          string           `json:"eta"`
	ETASeconds   float64          `json:"eta_seconds"`
	CurrentFile  string           `json:"current_file"`
	CurrentIndex int              `json:"current_index"`
	TotalFiles   int              `json:"total_files"`
	Message      string           `json:"message"`
	CreatedAt    time.Time        `json:"created_at"`
	FinishedAt   time.Time        `json:"finished_at"`
	DurationSec  float64          `json:"duration_sec"`
	OutputPath   string           `json:"output_path"`
	Results      []TaskFileResult `json:"results"`
}

func (t TaskInfo) ProgressPayload() TaskProgress {
	return TaskProgress{
		TaskID:       t.TaskID,
		Status:       t.Status,
		Progress:     t.Progress,
		Speed:        t.Speed,
		ETA:          t.ETA,
		ETASeconds:   t.ETASeconds,
		CurrentFile:  t.CurrentFile,
		CurrentIndex: t.CurrentIndex,
		TotalFiles:   t.TotalFiles,
		Message:      t.Message,
		OutputPath:   t.OutputPath,
		CreatedAt:    t.CreatedAt,
	}
}

type TaskFileResult struct {
	InputPath    string    `json:"input_path"`
	OutputPath   string    `json:"output_path"`
	OriginalSize int64     `json:"original_size"`
	OutputSize   int64     `json:"output_size"`
	StartedAt    time.Time `json:"started_at"`
	FinishedAt   time.Time `json:"finished_at"`
	DurationSec  float64   `json:"duration_sec"`
}

type BenchmarkResult struct {
	Encoder    string  `json:"encoder"`
	Label      string  `json:"label"`
	FPS        float64 `json:"fps"`
	Elapsed    float64 `json:"elapsed"`
	OutputSize int64   `json:"output_size"`
	Score      float64 `json:"score"`
	Error      string  `json:"error"`
}

type Preset struct {
	Name      string      `json:"name"`
	Encoder   string      `json:"encoder"`
	CRF       int         `json:"crf"`
	Preset    PresetValue `json:"preset"`
	ExtraArgs []string    `json:"extra_args"`
	Builtin   bool        `json:"builtin"`
	OutputExt string      `json:"output_ext"`
}

type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

type FileBrowseResponse struct {
	Current string      `json:"current"`
	Parent  *string     `json:"parent"`
	Entries []FileEntry `json:"entries"`
}

type WatchFolder struct {
	Path       string `json:"path"`
	Label      string `json:"label"`
	FileCount  int    `json:"file_count"`
	TotalSize  int64  `json:"total_size"`
	OutputDest string `json:"output_dest"`
	OutputDir  string `json:"output_dir"`
}

type WatchFolderScanResult struct {
	Folder WatchFolder `json:"folder"`
	Files  []FileEntry `json:"files"`
}

type ManagedFileMeta struct {
	VideoCodec  string `json:"video_codec"`
	AudioCodec  string `json:"audio_codec"`
	Channels    int    `json:"channels"`
	Resolution  string `json:"resolution"`
	Bitrate     int64  `json:"bitrate"`
	ProbeFailed bool   `json:"probe_failed"`
}

type ManagedFileSide struct {
	Name         string          `json:"name"`
	Path         string          `json:"path"`
	RelativeDir  string          `json:"relative_dir"`
	RelativePath string          `json:"relative_path"`
	Size         int64           `json:"size"`
	Exists       bool            `json:"exists"`
	Meta         ManagedFileMeta `json:"meta"`
}

type ManagedFileItem struct {
	ID      string          `json:"id"`
	Status  string          `json:"status"`
	Source  ManagedFileSide `json:"source"`
	Target  ManagedFileSide `json:"target"`
	Message string          `json:"message"`
}

type ManagedFolderSummary struct {
	Name         string  `json:"name"`
	Source       string  `json:"source"`
	Target       string  `json:"target"`
	FileCount    int     `json:"file_count"`
	SourceSize   int64   `json:"source_size"`
	TargetSize   int64   `json:"target_size"`
	CreatedAt    *string `json:"created_at"`
	FinishedAt   *string `json:"finished_at"`
	DurationSec  float64 `json:"duration_sec"`
	Progress     float64 `json:"progress"`
	ActiveTaskID string  `json:"active_task_id"`
}

type ManagedFolderResponse struct {
	Folder  WatchFolder          `json:"folder"`
	Summary ManagedFolderSummary `json:"summary"`
	Items   []ManagedFileItem    `json:"items"`
}

type SystemInfo struct {
	OS      string `json:"os"`
	CPU     string `json:"cpu"`
	Cores   int    `json:"cores"`
	Threads int    `json:"threads"`
	Memory  string `json:"memory"`
	GPU     string `json:"gpu"`
}
