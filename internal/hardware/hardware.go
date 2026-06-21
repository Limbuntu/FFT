package hardware

import (
	"bytes"
	"context"
	"log"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

var encoderMap = []models.EncoderInfo{
	{Name: "av1_nvenc", Label: "NVIDIA NVENC", HWType: "nvidia"},
	{Name: "av1_qsv", Label: "Intel QSV", HWType: "intel"},
	{Name: "av1_amf", Label: "AMD AMF", HWType: "amd"},
	{Name: "libsvtav1", Label: "SVT-AV1 (CPU)", HWType: "software"},
	{Name: "libaom-av1", Label: "libaom AV1 (CPU)", HWType: "software"},
	{Name: "librav1e", Label: "rav1e AV1 (CPU)", HWType: "software"},
}

type Detector struct {
	mu    sync.Mutex
	cache *models.HardwareReport
}

func NewDetector() *Detector {
	return &Detector{}
}

func (d *Detector) Detect(ctx context.Context, useCache bool) models.HardwareReport {
	d.mu.Lock()
	if useCache && d.cache != nil {
		cached := *d.cache
		d.mu.Unlock()
		return cached
	}
	d.mu.Unlock()

	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return models.HardwareReport{FFmpegVersion: "ffmpeg not found"}
	}

	listed := listEncoders(ctx)
	report := models.HardwareReport{FFmpegVersion: ffmpegVersion(ctx)}
	for _, enc := range encoderMap {
		item := enc
		if listed[item.Name] {
			item.Available = probeEncoder(ctx, item.Name)
		}
		report.Encoders = append(report.Encoders, item)
	}

	d.mu.Lock()
	d.cache = &report
	d.mu.Unlock()
	return report
}

func ffmpegVersion(ctx context.Context) string {
	out, err := commandOutput(ctx, 10*time.Second, "ffmpeg", "-version")
	if err != nil {
		log.Printf("ffmpeg version failed: %v", err)
		return ""
	}
	line, _, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(line)
}

func listEncoders(ctx context.Context) map[string]bool {
	out, err := commandOutput(ctx, 15*time.Second, "ffmpeg", "-encoders", "-hide_banner")
	if err != nil {
		log.Printf("ffmpeg encoders failed: %v", err)
		return map[string]bool{}
	}
	re := regexp.MustCompile(`(?m)^\s*[A-Z.]+\s+(\S+)`)
	result := map[string]bool{}
	for _, match := range re.FindAllSubmatch(out, -1) {
		result[string(match[1])] = true
	}
	return result
}

func probeEncoder(ctx context.Context, encoder string) bool {
	_, err := commandOutput(
		ctx,
		30*time.Second,
		"ffmpeg", "-hide_banner", "-y",
		"-f", "lavfi", "-i", "color=black:s=256x256:d=0.5:r=25",
		"-c:v", encoder,
		"-frames:v", "5",
		"-f", "null", "-",
	)
	if err != nil {
		log.Printf("probe %s failed: %v", encoder, err)
		return false
	}
	return true
}

func commandOutput(ctx context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if stderr.Len() > 0 {
			return out, &commandError{err: err, stderr: strings.TrimSpace(stderr.String())}
		}
		return out, err
	}
	return out, nil
}

type commandError struct {
	err    error
	stderr string
}

func (e *commandError) Error() string {
	if e.stderr == "" {
		return e.err.Error()
	}
	return e.err.Error() + ": " + e.stderr
}
