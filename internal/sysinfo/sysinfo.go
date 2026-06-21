package sysinfo

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

func Get() models.SystemInfo {
	info := models.SystemInfo{
		OS:      runtime.GOOS,
		CPU:     "Unknown",
		Cores:   runtime.NumCPU(),
		Threads: runtime.NumCPU(),
		Memory:  "Unknown",
		GPU:     "Unknown",
	}

	switch runtime.GOOS {
	case "darwin":
		fillDarwin(&info)
	case "linux":
		fillLinux(&info)
	case "windows":
		fillWindows(&info)
	}
	return info
}

func fillDarwin(info *models.SystemInfo) {
	if out := run(5*time.Second, "sw_vers", "-productVersion"); out != "" {
		info.OS = "Darwin " + out
	}
	if out := run(5*time.Second, "sysctl", "-n", "machdep.cpu.brand_string"); out != "" {
		info.CPU = out
	}
	if out := run(5*time.Second, "sysctl", "-n", "hw.physicalcpu"); out != "" {
		if v, err := strconv.Atoi(out); err == nil {
			info.Cores = v
		}
	}
	if out := run(5*time.Second, "sysctl", "-n", "hw.logicalcpu"); out != "" {
		if v, err := strconv.Atoi(out); err == nil {
			info.Threads = v
		}
	}
	if out := run(5*time.Second, "sysctl", "-n", "hw.memsize"); out != "" {
		if v, err := strconv.ParseFloat(out, 64); err == nil {
			info.Memory = fmt.Sprintf("%.1f GB", v/(1024*1024*1024))
		}
	}
	if out := run(10*time.Second, "system_profiler", "SPDisplaysDataType"); out != "" {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "Chipset Model:") || strings.HasPrefix(line, "Chip Model:") {
				info.GPU = strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
				break
			}
		}
	}
}

func fillLinux(info *models.SystemInfo) {
	if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(data))
		threads := 0
		coreIDs := map[string]bool{}
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "model name") && info.CPU == "Unknown" {
				_, value, _ := strings.Cut(line, ":")
				info.CPU = strings.TrimSpace(value)
			}
			if strings.HasPrefix(line, "core id") {
				_, value, _ := strings.Cut(line, ":")
				coreIDs[strings.TrimSpace(value)] = true
			}
			if strings.HasPrefix(line, "processor") {
				threads++
			}
		}
		if len(coreIDs) > 0 {
			info.Cores = len(coreIDs)
		}
		if threads > 0 {
			info.Threads = threads
		}
	}
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		scanner := bufio.NewScanner(bytes.NewReader(data))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "MemTotal:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					if kb, err := strconv.ParseFloat(fields[1], 64); err == nil {
						info.Memory = fmt.Sprintf("%.1f GB", kb/(1024*1024))
					}
				}
				break
			}
		}
	}
	if out := run(5*time.Second, "lspci"); out != "" {
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, "VGA") || strings.Contains(line, "3D") || strings.Contains(line, "Display") {
				parts := strings.SplitN(line, ":", 3)
				info.GPU = strings.TrimSpace(parts[len(parts)-1])
				break
			}
		}
	}
}

func fillWindows(info *models.SystemInfo) {
	info.OS = "Windows"
	if out := run(10*time.Second, "powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1).Name"); out != "" {
		info.CPU = out
	}
	if out := run(10*time.Second, "powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"); out != "" {
		if v, err := strconv.ParseFloat(out, 64); err == nil {
			info.Memory = fmt.Sprintf("%.1f GB", v/(1024*1024*1024))
		}
	}
	if out := run(10*time.Second, "powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name -join ' / '"); out != "" {
		info.GPU = out
	}
}

func run(timeout time.Duration, name string, args ...string) string {
	ctx, cancel := contextWithTimeout(timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func contextWithTimeout(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}
