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

func Usage() models.SystemUsage {
	usage := models.SystemUsage{
		CPUAvailable:    true,
		MemoryAvailable: true,
		GPUMessage:      "未采集到 GPU 负载",
		SampledAt:       time.Now(),
	}

	switch runtime.GOOS {
	case "darwin":
		fillDarwinUsage(&usage)
	case "linux":
		fillLinuxUsage(&usage)
	case "windows":
		fillWindowsUsage(&usage)
	default:
		usage.CPUAvailable = false
		usage.MemoryAvailable = false
	}

	fillGPUUsage(&usage)
	usage.CPUPercent = clampPercent(usage.CPUPercent)
	usage.MemoryPercent = clampPercent(usage.MemoryPercent)
	usage.GPUPercent = clampPercent(usage.GPUPercent)
	return usage
}

func fillDarwin(info *models.SystemInfo) {
	if out := run(5*time.Second, "sw_vers", "-productVersion"); out != "" {
		info.OS = "Darwin " + out
	}
	if out := run(10*time.Second, "system_profiler", "SPHardwareDataType"); out != "" {
		fillDarwinHardware(info, out)
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

func fillDarwinUsage(usage *models.SystemUsage) {
	if out := run(2*time.Second, "ps", "-A", "-o", "%cpu="); out != "" {
		total := 0.0
		for _, line := range strings.Split(out, "\n") {
			if v, err := strconv.ParseFloat(strings.TrimSpace(line), 64); err == nil {
				total += v
			}
		}
		usage.CPUPercent = total / float64(maxInt(runtime.NumCPU(), 1))
	} else {
		usage.CPUAvailable = false
	}

	totalBytes := 0.0
	if out := run(2*time.Second, "sysctl", "-n", "hw.memsize"); out != "" {
		totalBytes, _ = strconv.ParseFloat(out, 64)
	}
	if totalBytes <= 0 {
		usage.MemoryAvailable = false
		return
	}
	pageSize := 4096.0
	if out := run(2*time.Second, "pagesize"); out != "" {
		if v, err := strconv.ParseFloat(out, 64); err == nil && v > 0 {
			pageSize = v
		}
	}
	if out := run(2*time.Second, "vm_stat"); out != "" {
		freePages := darwinVMStatValue(out, "Pages free") + darwinVMStatValue(out, "Pages speculative")
		freeBytes := freePages * pageSize
		usedBytes := totalBytes - freeBytes
		usage.MemoryPercent = usedBytes / totalBytes * 100
		usage.MemoryUsed = formatBytes(int64(usedBytes))
		usage.MemoryTotal = formatBytes(int64(totalBytes))
		return
	}
	usage.MemoryAvailable = false
}

func fillDarwinHardware(info *models.SystemInfo, out string) {
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "Chip", "Processor Name":
			if value != "" && info.CPU == "Unknown" {
				info.CPU = value
			}
		case "Memory":
			if value != "" && info.Memory == "Unknown" {
				info.Memory = value
			}
		case "Total Number of Cores":
			if fields := strings.Fields(value); len(fields) > 0 {
				if v, err := strconv.Atoi(fields[0]); err == nil {
					info.Cores = v
					info.Threads = v
				}
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

func fillLinuxUsage(usage *models.SystemUsage) {
	first, ok := readLinuxCPUStat()
	if !ok {
		usage.CPUAvailable = false
	} else {
		time.Sleep(150 * time.Millisecond)
		second, ok := readLinuxCPUStat()
		if ok {
			totalDelta := float64(second.total - first.total)
			idleDelta := float64(second.idle - first.idle)
			if totalDelta > 0 {
				usage.CPUPercent = (1 - idleDelta/totalDelta) * 100
			}
		}
	}

	total, available, ok := readLinuxMemory()
	if !ok || total <= 0 {
		usage.MemoryAvailable = false
		return
	}
	used := total - available
	usage.MemoryPercent = float64(used) / float64(total) * 100
	usage.MemoryUsed = formatBytes(used)
	usage.MemoryTotal = formatBytes(total)
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

func fillWindowsUsage(usage *models.SystemUsage) {
	if out := run(4*time.Second, "powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime"); out != "" {
		usage.CPUPercent, _ = strconv.ParseFloat(firstLine(out), 64)
	} else {
		usage.CPUAvailable = false
	}

	out := run(4*time.Second, "powershell", "-NoProfile", "-Command", "$m=Get-CimInstance Win32_OperatingSystem; \"$($m.TotalVisibleMemorySize),$($m.FreePhysicalMemory)\"")
	parts := strings.Split(firstLine(out), ",")
	if len(parts) == 2 {
		totalKB, totalErr := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
		freeKB, freeErr := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		if totalErr == nil && freeErr == nil && totalKB > 0 {
			total := totalKB * 1024
			used := (totalKB - freeKB) * 1024
			usage.MemoryPercent = float64(used) / float64(total) * 100
			usage.MemoryUsed = formatBytes(used)
			usage.MemoryTotal = formatBytes(total)
			return
		}
	}
	usage.MemoryAvailable = false
}

type linuxCPUStat struct {
	idle  uint64
	total uint64
}

func readLinuxCPUStat() (linuxCPUStat, bool) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return linuxCPUStat{}, false
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	if !scanner.Scan() {
		return linuxCPUStat{}, false
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return linuxCPUStat{}, false
	}
	values := make([]uint64, 0, len(fields)-1)
	for _, field := range fields[1:] {
		v, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return linuxCPUStat{}, false
		}
		values = append(values, v)
	}
	total := uint64(0)
	for _, v := range values {
		total += v
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return linuxCPUStat{idle: idle, total: total}, true
}

func readLinuxMemory() (total int64, available int64, ok bool) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			total = kb * 1024
		case "MemAvailable":
			available = kb * 1024
		}
	}
	return total, available, total > 0 && available >= 0
}

func fillGPUUsage(usage *models.SystemUsage) {
	if out := run(2*time.Second, "nvidia-smi", "--query-gpu=name,utilization.gpu", "--format=csv,noheader,nounits"); out != "" {
		lines := strings.Split(out, "\n")
		total := 0.0
		count := 0
		names := []string{}
		for _, line := range lines {
			name, value, ok := strings.Cut(strings.TrimSpace(line), ",")
			if !ok {
				continue
			}
			v, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				continue
			}
			names = append(names, strings.TrimSpace(name))
			total += v
			count++
		}
		if count > 0 {
			usage.GPUAvailable = true
			usage.GPUPercent = total / float64(count)
			usage.GPUName = strings.Join(names, " / ")
			usage.GPUMessage = "NVIDIA GPU 负载"
			return
		}
	}
	if runtime.GOOS == "windows" {
		script := "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum"
		if out := run(4*time.Second, "powershell", "-NoProfile", "-Command", script); out != "" {
			if v, err := strconv.ParseFloat(firstLine(out), 64); err == nil {
				usage.GPUAvailable = true
				usage.GPUPercent = v
				usage.GPUMessage = "Windows GPU Engine 负载"
			}
		}
	}
}

func darwinVMStatValue(out, key string) float64 {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, key+":") {
			continue
		}
		value := strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, key+":")), ".")
		value = strings.ReplaceAll(value, ".", "")
		v, _ := strconv.ParseFloat(value, 64)
		return v
	}
	return 0
}

func firstLine(out string) string {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

func clampPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func formatBytes(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value := float64(bytes)
	index := 0
	for value >= 1024 && index < len(units)-1 {
		value /= 1024
		index++
	}
	if index == 0 {
		return fmt.Sprintf("%.0f %s", value, units[index])
	}
	return fmt.Sprintf("%.1f %s", value, units[index])
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
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
