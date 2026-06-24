package transcode

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

var incompatibleAV1Exts = map[string]bool{
	".mov": true, ".avi": true, ".wmv": true, ".flv": true,
	".ts": true, ".mpg": true, ".mpeg": true,
}

var qsvPresetMap = map[string]string{
	"veryslow":  "0",
	"slower":    "1",
	"slow":      "2",
	"medium":    "3",
	"fast":      "4",
	"faster":    "5",
	"veryfast":  "6",
	"ultrafast": "7",
}

type Broadcaster interface {
	Broadcast(any)
}

type TaskStore interface {
	SaveTranscodeTask(models.TaskInfo) error
	TranscodeTasks() ([]models.TaskInfo, error)
}

type Service struct {
	mu          sync.Mutex
	tasks       map[string]*models.TaskInfo
	cancels     map[string]context.CancelFunc
	partials    map[string]string
	durations   map[string]float64
	lastPersist map[string]time.Time
	broadcaster Broadcaster
	store       TaskStore
}

func New(broadcaster Broadcaster, store TaskStore) *Service {
	s := &Service{
		tasks:       map[string]*models.TaskInfo{},
		cancels:     map[string]context.CancelFunc{},
		partials:    map[string]string{},
		durations:   map[string]float64{},
		lastPersist: map[string]time.Time{},
		broadcaster: broadcaster,
		store:       store,
	}
	s.loadPersistedTasks()
	return s
}

func (s *Service) Start(req models.TranscodeRequest) (models.TaskInfo, error) {
	req.Normalize()
	if len(req.Files) == 0 {
		return models.TaskInfo{}, errors.New("no files specified")
	}
	for _, file := range req.Files {
		if st, err := os.Stat(file); err != nil || st.IsDir() {
			return models.TaskInfo{}, fmt.Errorf("file not found: %s", file)
		}
	}

	task := &models.TaskInfo{
		TaskID:     randomID(),
		Request:    req,
		Status:     models.TaskPending,
		TotalFiles: len(req.Files),
		CreatedAt:  time.Now(),
	}

	s.mu.Lock()
	s.tasks[task.TaskID] = task
	s.mu.Unlock()
	s.persist(task.TaskID)

	go s.run(task.TaskID)
	return cloneTask(task), nil
}

func (s *Service) Cancel(taskID string) bool {
	s.mu.Lock()
	task := s.tasks[taskID]
	cancel := s.cancels[taskID]
	partial := s.partials[taskID]
	if task == nil || (task.Status != models.TaskPending && task.Status != models.TaskRunning) {
		s.mu.Unlock()
		return false
	}
	task.Status = models.TaskCancelled
	delete(s.cancels, taskID)
	delete(s.partials, taskID)
	delete(s.lastPersist, taskID)
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if partial != "" && cancel == nil {
		if err := removePartialOutput(partial); err != nil {
			log.Printf("remove partial output failed %s: %s", redactPathForLog(partial), sanitizeLogText(err.Error(), partial))
		}
	}
	s.persist(taskID)
	s.notify(taskID)
	return true
}

func (s *Service) Tasks() []models.TaskInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	tasks := make([]models.TaskInfo, 0, len(s.tasks))
	for _, task := range s.tasks {
		tasks = append(tasks, cloneTask(task))
	}
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].CreatedAt.After(tasks[j].CreatedAt)
	})
	return tasks
}

func (s *Service) Task(taskID string) (models.TaskInfo, bool) {
	task := s.get(taskID)
	if task == nil {
		return models.TaskInfo{}, false
	}
	return *task, true
}

func (s *Service) run(taskID string) {
	s.update(taskID, func(t *models.TaskInfo) {
		t.Status = models.TaskRunning
	})
	s.notify(taskID)

	task := s.get(taskID)
	if task == nil {
		return
	}

	for idx, src := range task.Request.Files {
		if s.status(taskID) == models.TaskCancelled {
			return
		}
		fileStartedAt := time.Now()
		copyAV1 := shouldCopyAV1(src, task.Request)
		dst, changed, originalExt, err := buildOutputPath(src, task.Request, copyAV1)
		if err != nil {
			s.fail(taskID, err.Error())
			return
		}
		if changed {
			s.broadcast(map[string]any{
				"type":    "toast",
				"message": fmt.Sprintf("%s: %s 不适合 AV1，已按高级设置改为 .mp4", filepath.Base(src), originalExt),
				"level":   "info",
			})
		}

		s.update(taskID, func(t *models.TaskInfo) {
			t.CurrentIndex = idx
			t.CurrentFile = filepath.Base(src)
			t.CurrentFileProgress = 0
			t.OutputPath = dst
			t.Message = ""
		})
		s.setPartial(taskID, dst)
		s.notify(taskID)

		duration := probeDuration(src)
		if s.status(taskID) == models.TaskCancelled {
			if err := removePartialOutput(dst); err != nil {
				log.Printf("remove partial output failed %s: %s", redactPathForLog(dst), sanitizeLogText(err.Error(), dst))
			}
			return
		}
		s.mu.Lock()
		s.durations[src] = duration
		s.mu.Unlock()

		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			s.fail(taskID, err.Error())
			return
		}
		if copyAV1 {
			if err := copyFile(src, dst); err != nil {
				s.fail(taskID, err.Error())
				return
			}
			fileFinishedAt := time.Now()
			originalSize := fileSize(src)
			outputSize := fileSize(dst)
			s.update(taskID, func(t *models.TaskInfo) {
				t.CurrentFileProgress = 100
				t.Progress = round1((float64(idx+1) / float64(len(t.Request.Files))) * 100)
				t.Speed = ""
				t.Results = append(t.Results, models.TaskFileResult{
					InputPath:    src,
					OutputPath:   dst,
					OriginalSize: originalSize,
					OutputSize:   outputSize,
					StartedAt:    fileStartedAt,
					FinishedAt:   fileFinishedAt,
					DurationSec:  fileFinishedAt.Sub(fileStartedAt).Seconds(),
				})
			})
			log.Printf("Copied AV1 source for %s -> %s", redactPathForLog(src), redactPathForLog(dst))
			s.notify(taskID)
			continue
		}

		ctx, cancel := context.WithCancel(context.Background())
		s.mu.Lock()
		if taskStatusLocked(s.tasks[taskID]) == models.TaskCancelled {
			s.mu.Unlock()
			cancel()
			if err := removePartialOutput(dst); err != nil {
				log.Printf("remove partial output failed %s: %s", redactPathForLog(dst), sanitizeLogText(err.Error(), dst))
			}
			return
		}
		s.cancels[taskID] = cancel
		s.mu.Unlock()

		cmd := exec.CommandContext(ctx, "ffmpeg", buildFFmpegArgs(src, dst, task.Request)...)
		stderr, err := cmd.StderrPipe()
		if err != nil {
			cancel()
			s.fail(taskID, err.Error())
			return
		}
		cmd.Stdout = io.Discard
		logVideoMetadata(src)
		log.Printf("Transcode cmd: ffmpeg %s", sanitizeLogText(strings.Join(cmd.Args[1:], " "), src, dst))

		if err := cmd.Start(); err != nil {
			cancel()
			if s.status(taskID) == models.TaskCancelled {
				if err := removePartialOutput(dst); err != nil {
					log.Printf("remove partial output failed %s: %s", redactPathForLog(dst), sanitizeLogText(err.Error(), dst))
				}
				return
			}
			s.fail(taskID, err.Error())
			return
		}

		readDone := make(chan struct{})
		progress := newProgressTracker()
		go func() {
			defer close(readDone)
			s.readProgress(taskID, idx, stderr, duration, progress)
		}()

		err = cmd.Wait()
		<-readDone
		cancel()

		s.mu.Lock()
		delete(s.cancels, taskID)
		delete(s.partials, taskID)
		delete(s.lastPersist, taskID)
		status := taskStatusLocked(s.tasks[taskID])
		s.mu.Unlock()

		if status == models.TaskCancelled {
			if err := removePartialOutput(dst); err != nil {
				log.Printf("remove partial output failed %s: %s", redactPathForLog(dst), sanitizeLogText(err.Error(), dst))
			}
			return
		}
		if err != nil {
			detail := progress.Tail()
			message := fmt.Sprintf("ffmpeg exited: %v", err)
			if detail != "" {
				message += ": " + detail
			}
			log.Printf("Transcode failed for %s: %s", redactPathForLog(src), sanitizeLogText(message, src, dst))
			s.fail(taskID, message)
			return
		}
		fileFinishedAt := time.Now()
		originalSize := fileSize(src)
		outputSize := fileSize(dst)
		s.update(taskID, func(t *models.TaskInfo) {
			t.CurrentFileProgress = 100
			t.Results = append(t.Results, models.TaskFileResult{
				InputPath:    src,
				OutputPath:   dst,
				OriginalSize: originalSize,
				OutputSize:   outputSize,
				StartedAt:    fileStartedAt,
				FinishedAt:   fileFinishedAt,
				DurationSec:  fileFinishedAt.Sub(fileStartedAt).Seconds(),
			})
		})
		log.Printf("Transcode finished for %s -> %s", redactPathForLog(src), redactPathForLog(dst))
	}

	s.update(taskID, func(t *models.TaskInfo) {
		t.Progress = 100
		t.Status = models.TaskDone
		t.Message = "All files transcoded"
		elapsed := time.Since(t.CreatedAt).Seconds()
		t.FinishedAt = time.Now()
		t.DurationSec = elapsed
		t.ETA = "耗时 " + formatDuration(elapsed)
		t.ETASeconds = 0
	})
	s.mu.Lock()
	delete(s.lastPersist, taskID)
	s.mu.Unlock()
	log.Printf("Transcode task %s completed", taskID)
	s.notify(taskID)
}

func (s *Service) readProgress(taskID string, fileIndex int, stderr io.Reader, duration float64, progress *progressTracker) {
	timeRe := regexp.MustCompile(`time=(\d+:\d+:\d+\.\d+)`)
	speedRe := regexp.MustCompile(`speed=\s*([\d.]+x)`)
	scanner := bufio.NewScanner(newProgressReader(stderr))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		progress.Add(line)
		timeMatch := timeRe.FindStringSubmatch(line)
		speedMatch := speedRe.FindStringSubmatch(line)
		var speed string
		if len(speedMatch) == 2 {
			speed = speedMatch[1]
		}

		s.updateMemory(taskID, func(t *models.TaskInfo) {
			if speed != "" {
				t.Speed = speed
			}
			if len(timeMatch) == 2 && duration > 0 {
				current := parseTimestamp(timeMatch[1])
				fileProgress := math.Min(current/duration, 1)
				t.CurrentFileProgress = round1(fileProgress * 100)
				t.Progress = round1(((float64(fileIndex) + fileProgress) / float64(len(t.Request.Files))) * 100)
				if speed != "" {
					if speedValue, err := strconvParseSpeed(speed); err == nil && speedValue > 0 {
						remainingFile := math.Max(duration-current, 0) / speedValue
						remainingOther := 0.0
						for _, file := range t.Request.Files[fileIndex+1:] {
							d := s.durations[file]
							remainingOther += d / speedValue
						}
						total := remainingFile + remainingOther
						t.ETASeconds = total
						t.ETA = formatDuration(total)
					}
				}
			}
		})
		s.notify(taskID)
		s.persistThrottled(taskID, 3*time.Second)
	}
}

type progressTracker struct {
	mu    sync.Mutex
	lines []string
}

func newProgressTracker() *progressTracker {
	return &progressTracker{}
}

func (p *progressTracker) Add(line string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lines = append(p.lines, strings.TrimSpace(line))
	if len(p.lines) > 12 {
		p.lines = p.lines[len(p.lines)-12:]
	}
}

func (p *progressTracker) Tail() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	for i := len(p.lines) - 1; i >= 0; i-- {
		line := p.lines[i]
		if isFFmpegErrorLine(line) {
			return trimFFmpegDetail(line)
		}
	}
	for i := len(p.lines) - 1; i >= 0; i-- {
		line := p.lines[i]
		if line == "" || strings.HasPrefix(line, "frame=") || strings.HasPrefix(line, "Duration:") || strings.Contains(line, "vendor_id") {
			continue
		}
		return trimFFmpegDetail(line)
	}
	return ""
}

func isFFmpegErrorLine(line string) bool {
	lower := strings.ToLower(line)
	for _, marker := range []string{"error", "denied", "not permitted", "invalid data", "unable", "failed", "no such file", "permission"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func trimFFmpegDetail(line string) string {
	if len(line) > 500 {
		return line[len(line)-500:]
	}
	return line
}

func removePartialOutput(path string) error {
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		if err := os.Remove(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			lastErr = err
			time.Sleep(time.Duration(attempt+1) * 150 * time.Millisecond)
			continue
		}
		return nil
	}
	return lastErr
}

func (s *Service) fail(taskID, message string) {
	s.update(taskID, func(t *models.TaskInfo) {
		t.Status = models.TaskFailed
		t.Message = message
		t.Progress = 100
		t.FinishedAt = time.Now()
		t.DurationSec = t.FinishedAt.Sub(t.CreatedAt).Seconds()
		t.ETA = "失败"
		t.ETASeconds = 0
	})
	s.mu.Lock()
	delete(s.lastPersist, taskID)
	s.mu.Unlock()
	s.notify(taskID)
}

func (s *Service) notify(taskID string) {
	task := s.get(taskID)
	if task == nil {
		return
	}
	s.broadcast(task.ProgressPayload())
}

func (s *Service) broadcast(v any) {
	if s.broadcaster != nil {
		s.broadcaster.Broadcast(v)
	}
}

func (s *Service) update(taskID string, fn func(*models.TaskInfo)) {
	s.updateWithPersist(taskID, true, fn)
}

func (s *Service) updateMemory(taskID string, fn func(*models.TaskInfo)) {
	s.updateWithPersist(taskID, false, fn)
}

func (s *Service) updateWithPersist(taskID string, persist bool, fn func(*models.TaskInfo)) {
	s.mu.Lock()
	var snapshot models.TaskInfo
	if task := s.tasks[taskID]; task != nil {
		fn(task)
		snapshot = cloneTask(task)
	}
	s.mu.Unlock()
	if persist && snapshot.TaskID != "" {
		s.saveTask(snapshot)
	}
}

func (s *Service) persistThrottled(taskID string, minInterval time.Duration) {
	task := s.get(taskID)
	if task == nil {
		return
	}
	s.mu.Lock()
	last := s.lastPersist[taskID]
	if !last.IsZero() && time.Since(last) < minInterval {
		s.mu.Unlock()
		return
	}
	s.lastPersist[taskID] = time.Now()
	s.mu.Unlock()
	s.saveTask(*task)
}

func (s *Service) get(taskID string) *models.TaskInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	if task := s.tasks[taskID]; task != nil {
		cloned := cloneTask(task)
		return &cloned
	}
	return nil
}

func (s *Service) status(taskID string) models.TaskStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return taskStatusLocked(s.tasks[taskID])
}

func taskStatusLocked(task *models.TaskInfo) models.TaskStatus {
	if task == nil {
		return ""
	}
	return task.Status
}

func (s *Service) setPartial(taskID, path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.partials[taskID] = path
}

func (s *Service) loadPersistedTasks() {
	if s.store == nil {
		return
	}
	tasks, err := s.store.TranscodeTasks()
	if err != nil {
		log.Printf("load transcode tasks failed: %v", err)
		return
	}
	for i := range tasks {
		task := tasks[i]
		if task.Status == models.TaskRunning || task.Status == models.TaskPending {
			task.Status = models.TaskFailed
			task.Message = "后端重启，任务已中断"
			task.Progress = 100
			if task.FinishedAt.IsZero() {
				task.FinishedAt = time.Now()
			}
			task.DurationSec = task.FinishedAt.Sub(task.CreatedAt).Seconds()
			task.ETA = "已中断"
			task.ETASeconds = 0
			s.saveTask(task)
		}
		cloned := cloneTask(&task)
		s.tasks[cloned.TaskID] = &cloned
	}
}

func (s *Service) persist(taskID string) {
	task := s.get(taskID)
	if task == nil {
		return
	}
	s.saveTask(*task)
}

func (s *Service) saveTask(task models.TaskInfo) {
	if s.store == nil {
		return
	}
	if err := s.store.SaveTranscodeTask(task); err != nil {
		log.Printf("save transcode task %s failed: %v", task.TaskID, err)
	}
}

func cloneTask(task *models.TaskInfo) models.TaskInfo {
	if task == nil {
		return models.TaskInfo{}
	}
	cloned := *task
	cloned.Request.Files = append([]string(nil), task.Request.Files...)
	cloned.Request.ExtraArgs = append([]string(nil), task.Request.ExtraArgs...)
	cloned.Results = append([]models.TaskFileResult(nil), task.Results...)
	cloned.Request.FileOutputs = map[string]map[string]string{}
	for k, v := range task.Request.FileOutputs {
		cloned.Request.FileOutputs[k] = map[string]string{}
		for kk, vv := range v {
			cloned.Request.FileOutputs[k][kk] = vv
		}
	}
	return cloned
}

func fileSize(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func buildOutputPath(src string, req models.TranscodeRequest, preserveSourceContainer bool) (string, bool, string, error) {
	base := strings.TrimSuffix(src, filepath.Ext(src))
	srcExt := filepath.Ext(src)
	ext := srcExt
	if !preserveSourceContainer && req.OutputExt != "auto" && req.OutputExt != "" {
		ext = req.OutputExt
	}
	changed := false
	originalExt := ext
	autoMP4 := req.AutoMP4 == nil || *req.AutoMP4
	if !preserveSourceContainer && autoMP4 && incompatibleAV1Exts[strings.ToLower(ext)] {
		ext = ".mp4"
		changed = true
	}

	fileOutput := req.FileOutputs[src]
	dest := req.OutputDest
	dir := req.OutputDir
	prefix := req.Prefix
	suffix := req.Suffix
	if preserveSourceContainer {
		prefix = ""
		suffix = ""
	}
	if fileOutput != nil {
		if value := fileOutput["output_dest"]; value != "" {
			dest = value
		}
		if value := fileOutput["output_dir"]; value != "" {
			dir = value
		}
		if value, ok := fileOutput["suffix"]; ok && !preserveSourceContainer {
			suffix = value
		}
		if value, ok := fileOutput["prefix"]; ok && !preserveSourceContainer {
			prefix = value
		}
	}

	outDir := filepath.Dir(src)
	switch dest {
	case "subfolder":
		outDir = filepath.Join(filepath.Dir(src), "AV1")
	case "custom":
		if dir != "" {
			outDir = dir
		}
	}

	if ext == "" {
		ext = ".mkv"
	}
	return filepath.Join(outDir, prefix+filepath.Base(base)+suffix+ext), changed, originalExt, nil
}

func shouldCopyAV1(src string, req models.TranscodeRequest) bool {
	fileOutput := req.FileOutputs[src]
	return fileOutput != nil && fileOutput["copy_av1"] == "true" && isAV1Codec(probeVideoCodec(src))
}

func probeVideoCodec(file string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", file)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func isAV1Codec(codec string) bool {
	codec = strings.ToLower(strings.TrimSpace(codec))
	return codec == "av1" || codec == "libsvtav1" || codec == "libaom-av1" || codec == "librav1e"
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() {
		_ = out.Close()
	}()
	if _, err := io.Copy(out, in); err != nil {
		_ = os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	if info, err := in.Stat(); err == nil {
		_ = os.Chmod(dst, info.Mode())
	}
	return nil
}

func buildFFmpegArgs(src, dst string, req models.TranscodeRequest) []string {
	args := []string{"-hide_banner", "-y", "-i", src, "-c:v", req.Encoder}
	switch req.Encoder {
	case "libsvtav1":
		args = append(args, "-crf", fmt.Sprint(req.CRF), "-preset", req.Preset.String())
	case "libaom-av1":
		args = append(args, "-crf", fmt.Sprint(req.CRF), "-cpu-used", req.Preset.String())
	case "librav1e":
		args = append(args, "-qp", fmt.Sprint(req.CRF), "-speed", req.Preset.String())
	case "av1_nvenc":
		args = append(args, "-cq", fmt.Sprint(req.CRF), "-preset", "p5")
	case "av1_qsv":
		args = append(args, "-global_quality", fmt.Sprint(req.CRF), "-preset", qsvPresetValue(req.Preset))
	case "av1_amf":
		args = append(args, "-quality", fmt.Sprint(req.CRF), "-usage", "transcoding")
	}
	args = append(args, "-c:a", "copy")
	args = append(args, req.ExtraArgs...)
	args = append(args, dst)
	return args
}

func qsvPresetValue(preset models.PresetValue) string {
	value := strings.ToLower(strings.TrimSpace(preset.String()))
	if mapped, ok := qsvPresetMap[value]; ok {
		return mapped
	}
	if number, err := strconv.Atoi(value); err == nil {
		return strconv.Itoa(clamp(number, 0, 7))
	}
	return value
}

func clamp(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func probeDuration(file string) float64 {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file)
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0
	}
	return value
}

type metadataProbe struct {
	Format struct {
		Tags map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		CodecType string            `json:"codec_type"`
		CodecName string            `json:"codec_name"`
		Tags      map[string]string `json:"tags"`
	} `json:"streams"`
}

func logVideoMetadata(file string) {
	metadata := probeCreationMetadata(file)
	log.Printf(
		"Transcode source metadata for %s: device=%s software=%s encoder=%s",
		redactPathForLog(file),
		metadata["device"],
		metadata["software"],
		metadata["encoder"],
	)
}

func probeCreationMetadata(file string) map[string]string {
	result := map[string]string{
		"device":   "未知",
		"software": "未知",
		"encoder":  "未知",
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", file)
	out, err := cmd.Output()
	if err != nil {
		return result
	}
	var parsed metadataProbe
	if err := json.Unmarshal(out, &parsed); err != nil {
		return result
	}
	tags := []map[string]string{parsed.Format.Tags}
	for _, stream := range parsed.Streams {
		tags = append(tags, stream.Tags)
		if result["encoder"] == "未知" && stream.CodecType == "video" && stream.CodecName != "" {
			result["encoder"] = stream.CodecName
		}
	}
	if value := firstTagValue(tags, "com.apple.quicktime.make", "make", "manufacturer"); value != "" {
		if model := firstTagValue(tags, "com.apple.quicktime.model", "model", "device_model"); model != "" {
			result["device"] = value + " " + model
		} else {
			result["device"] = value
		}
	} else if model := firstTagValue(tags, "com.apple.quicktime.model", "model", "device_model"); model != "" {
		result["device"] = model
	}
	if value := firstTagValue(tags, "software", "encoder", "encoding_tool", "com.apple.quicktime.software"); value != "" {
		result["software"] = value
	}
	if value := firstTagValue(tags, "encoder", "encoding_tool"); value != "" {
		result["encoder"] = value
	}
	for key, value := range result {
		result[key] = sanitizeLogText(value, file)
	}
	return result
}

func firstTagValue(tagSets []map[string]string, keys ...string) string {
	for _, tags := range tagSets {
		if len(tags) == 0 {
			continue
		}
		for _, key := range keys {
			for actual, value := range tags {
				if strings.EqualFold(actual, key) && strings.TrimSpace(value) != "" {
					return strings.TrimSpace(value)
				}
			}
		}
	}
	return ""
}

func redactPathForLog(path string) string {
	name := filepath.Base(path)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return "xxxxx"
	}
	return filepath.Join("xxxxx", name)
}

func sanitizeLogText(text string, paths ...string) string {
	sanitized := text
	for _, path := range paths {
		if path == "" {
			continue
		}
		sanitized = strings.ReplaceAll(sanitized, path, redactPathForLog(path))
		sanitized = strings.ReplaceAll(sanitized, filepath.ToSlash(path), filepath.ToSlash(redactPathForLog(path)))
	}
	return sanitized
}

func parseTimestamp(ts string) float64 {
	parts := strings.Split(ts, ":")
	if len(parts) != 3 {
		return 0
	}
	h, _ := strconv.ParseFloat(parts[0], 64)
	m, _ := strconv.ParseFloat(parts[1], 64)
	s, _ := strconv.ParseFloat(parts[2], 64)
	return h*3600 + m*60 + s
}

func strconvParseSpeed(speed string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSuffix(speed, "x"), 64)
}

func formatDuration(seconds float64) string {
	if seconds >= 3600 {
		return fmt.Sprintf("%dh%dm", int(seconds/3600), int(math.Mod(seconds, 3600)/60))
	}
	if seconds >= 60 {
		return fmt.Sprintf("%dm%ds", int(seconds/60), int(math.Mod(seconds, 60)))
	}
	return fmt.Sprintf("%ds", int(math.Max(seconds, 0)))
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func randomID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%08x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

type progressReader struct {
	r io.Reader
}

func newProgressReader(r io.Reader) io.Reader {
	return &progressReader{r: r}
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	for i := 0; i < n; i++ {
		if p[i] == '\r' {
			p[i] = '\n'
		}
	}
	return n, err
}
