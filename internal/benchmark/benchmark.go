package benchmark

import (
	"bufio"
	"context"
	"encoding/json"
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

	"github.com/limbuntu/fft/internal/hardware"
	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
	"github.com/limbuntu/fft/internal/transcode"
)

const (
	rounds           = 3
	benchDuration    = 10
	benchFPS         = 30
	benchTotalFrames = benchDuration * benchFPS
	benchTimeout     = 120 * time.Second
)

type Service struct {
	mu          sync.Mutex
	running     bool
	cancelled   bool
	currentStop context.CancelFunc
	db          *fftdb.DB
	hardware    *hardware.Detector
	broadcaster transcode.Broadcaster
	rootDir     string
}

func New(db *fftdb.DB, detector *hardware.Detector, broadcaster transcode.Broadcaster, rootDir string) *Service {
	return &Service{db: db, hardware: detector, broadcaster: broadcaster, rootDir: rootDir}
}

func (s *Service) Run(encoders []string) map[string]string {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return map[string]string{"status": "already_running"}
	}
	s.running = true
	s.cancelled = false
	s.mu.Unlock()

	go s.runBackground(encoders)
	return map[string]string{"status": "started"}
}

func (s *Service) Cancel() {
	s.mu.Lock()
	s.cancelled = true
	cancel := s.currentStop
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) Reset() {
	s.Cancel()
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
}

func (s *Service) History() (map[string]any, error) {
	return s.db.BenchmarkHistory()
}

func (s *Service) Leaderboard() ([]map[string]any, error) {
	data, err := os.ReadFile(filepath.Join(s.rootDir, "bench_leaderboard.json"))
	if err != nil {
		return []map[string]any{}, nil
	}
	var rows []map[string]any
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *Service) runBackground(selected []string) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.currentStop = nil
		s.mu.Unlock()
	}()

	report := s.hardware.Detect(context.Background(), true)
	allowed := map[string]bool{}
	for _, enc := range selected {
		allowed[enc] = true
	}

	var available []models.EncoderInfo
	for _, enc := range report.Encoders {
		if !enc.Available {
			continue
		}
		if len(allowed) > 0 && !allowed[enc.Name] {
			continue
		}
		available = append(available, enc)
	}

	if len(available) == 0 {
		s.broadcast(map[string]any{"type": "bench_done", "results": []models.BenchmarkResult{}, "message": "没有可用的编码器"})
		return
	}

	results := make([]models.BenchmarkResult, 0, len(available))
	for _, enc := range available {
		if s.isCancelled() {
			break
		}
		result := s.benchEncoder(enc)
		if s.isCancelled() {
			break
		}
		results = append(results, result)
		s.broadcast(map[string]any{"type": "bench_result", "result": result})
	}

	if len(results) > 0 {
		if err := s.db.SaveBenchmarkResults(results); err != nil {
			log.Printf("save benchmark history failed: %v", err)
		}
	}
	s.broadcast(map[string]any{"type": "bench_done", "results": results})
}

func (s *Service) benchEncoder(enc models.EncoderInfo) models.BenchmarkResult {
	results := make([]models.BenchmarkResult, 0, rounds)
	for i := 0; i < rounds; i++ {
		if s.isCancelled() {
			return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Error: "已取消"}
		}
		log.Printf("Benchmarking %s round %d/%d", enc.Name, i+1, rounds)
		result := s.benchOnce(enc)
		if s.isCancelled() {
			return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Error: "已取消"}
		}
		if result.Error != "" {
			return result
		}
		results = append(results, result)
		s.broadcast(map[string]any{
			"type":         "bench_round",
			"encoder":      enc.Name,
			"round":        i + 1,
			"total_rounds": rounds,
			"fps":          result.FPS,
		})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].FPS < results[j].FPS })
	return results[len(results)/2]
}

func (s *Service) benchOnce(enc models.EncoderInfo) models.BenchmarkResult {
	tmpdir, err := os.MkdirTemp("", "fft_bench_")
	if err != nil {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Error: err.Error()}
	}
	defer os.RemoveAll(tmpdir)

	outfile := filepath.Join(tmpdir, "bench_"+enc.Name+".mkv")
	args := []string{
		"-hide_banner", "-y",
		"-f", "lavfi", "-i",
		"testsrc2=size=1920x1080:rate=30:duration=10",
		"-c:v", enc.Name,
	}
	args = append(args, encoderArgs(enc.Name)...)
	args = append(args, outfile)

	ctx, cancel := context.WithTimeout(context.Background(), benchTimeout)
	s.mu.Lock()
	s.currentStop = cancel
	s.mu.Unlock()
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Error: err.Error()}
	}
	cmd.Stdout = io.Discard
	log.Printf("Benchmark cmd: ffmpeg %s", strings.Join(args, " "))

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Error: err.Error()}
	}

	var tail strings.Builder
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.readBenchmarkProgress(enc.Name, stderr, &tail)
	}()

	err = cmd.Wait()
	<-done
	elapsed := time.Since(start).Seconds()

	if ctx.Err() == context.DeadlineExceeded {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Elapsed: benchTimeout.Seconds(), Error: "超时 (>120s)"}
	}
	if s.isCancelled() {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Elapsed: round2(elapsed), Error: "已取消"}
	}
	if err != nil {
		return models.BenchmarkResult{Encoder: enc.Name, Label: enc.Label, Elapsed: round2(elapsed), Error: trimTail(tail.String(), 300)}
	}

	var size int64
	if st, err := os.Stat(outfile); err == nil {
		size = st.Size()
	}
	fps := float64(benchTotalFrames) / elapsed
	return models.BenchmarkResult{
		Encoder:    enc.Name,
		Label:      enc.Label,
		FPS:        round1(fps),
		Elapsed:    round2(elapsed),
		OutputSize: size,
		Score:      math.Round(fps * 100),
	}
}

func (s *Service) readBenchmarkProgress(encoder string, stderr io.Reader, tail *strings.Builder) {
	timeRe := regexp.MustCompile(`time=(\d+:\d+:\d+\.\d+)`)
	speedRe := regexp.MustCompile(`speed=\s*([\d.]+x)`)
	scanner := bufio.NewScanner(transcodeProgressReader(stderr))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lastProgress := 0.0
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		tail.WriteString(line)
		tail.WriteByte('\n')
		if tail.Len() > 2000 {
			content := tail.String()
			tail.Reset()
			tail.WriteString(trimTail(content, 1000))
		}
		match := timeRe.FindStringSubmatch(line)
		if len(match) != 2 {
			continue
		}
		progress := math.Min(parseTimestamp(match[1])/benchDuration, 1)
		if progress-lastProgress < 0.05 {
			continue
		}
		lastProgress = progress
		msg := map[string]any{
			"type":     "bench_progress",
			"encoder":  encoder,
			"progress": round1(progress * 100),
		}
		if speed := speedRe.FindStringSubmatch(line); len(speed) == 2 {
			msg["speed"] = speed[1]
		}
		s.broadcast(msg)
	}
}

func (s *Service) isCancelled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cancelled
}

func (s *Service) broadcast(v any) {
	if s.broadcaster != nil {
		s.broadcaster.Broadcast(v)
	}
}

func encoderArgs(encoder string) []string {
	switch encoder {
	case "libsvtav1":
		return []string{"-crf", "28", "-preset", "8"}
	case "libaom-av1":
		return []string{"-crf", "28", "-cpu-used", "6"}
	case "librav1e":
		return []string{"-qp", "28", "-speed", "6"}
	case "av1_nvenc":
		return []string{"-cq", "28", "-preset", "p5"}
	case "av1_qsv":
		return []string{"-global_quality", "28", "-preset", "medium"}
	case "av1_amf":
		return []string{"-quality", "28", "-usage", "transcoding"}
	default:
		return nil
	}
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

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func trimTail(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return text[len(text)-max:]
}

type progressReader struct {
	r io.Reader
}

func transcodeProgressReader(r io.Reader) io.Reader {
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
