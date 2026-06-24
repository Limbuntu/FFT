package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/limbuntu/fft/internal/api"
	"github.com/limbuntu/fft/internal/benchmark"
	"github.com/limbuntu/fft/internal/config"
	"github.com/limbuntu/fft/internal/hardware"
	"github.com/limbuntu/fft/internal/models"
	"github.com/limbuntu/fft/internal/presets"
	taskreport "github.com/limbuntu/fft/internal/report"
	fftdb "github.com/limbuntu/fft/internal/store"
	"github.com/limbuntu/fft/internal/sysinfo"
	"github.com/limbuntu/fft/internal/transcode"
	"github.com/limbuntu/fft/internal/watchfolders"
	"github.com/limbuntu/fft/internal/websocket"
)

type Server struct {
	cfg          config.Config
	db           *fftdb.DB
	router       *gin.Engine
	hub          *websocket.Hub
	hardware     *hardware.Detector
	transcoder   *transcode.Service
	bench        *benchmark.Service
	watchFolders *watchfolders.Service
	presets      *presets.Service
}

const feedbackLogMaxBytes int64 = 768 * 1024

var (
	feedbackLogSecretPattern   = regexp.MustCompile(`(?i)\b(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|api[_-]?key|authorization|smtp[_-]?pass|cookie|set-cookie|gitea[_-]?token|github[_-]?token|registry[_-]?token)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)`)
	feedbackAuthHeaderPattern  = regexp.MustCompile(`(?i)\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+[^\s,;]+`)
	feedbackUnixPathPattern    = regexp.MustCompile(`(?:file://)?(?:~|/(?:Users|home|Volumes|private|tmp|var|mnt|media))/[^"',;\n]*?\.[A-Za-z0-9]{1,8}`)
	feedbackWindowsPathPattern = regexp.MustCompile(`(?:file://)?[A-Za-z]:\\[^"',;\n]*?\.[A-Za-z0-9]{1,8}`)
	feedbackPrivateIPPattern   = regexp.MustCompile(`\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?\b`)
	feedbackSensitiveKey       = regexp.MustCompile(`(?i)^(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|api[_-]?key|authorization|smtp[_-]?pass|cookie|set-cookie|gitea[_-]?token|github[_-]?token|registry[_-]?token)$`)
)

var feedbackLogAllowedOrigins = map[string]bool{
	"https://feedback-prod-d4gl0lj03892e606a-1251838363.tcloudbaseapp.com": true,
}

var incompatibleAV1OutputExts = map[string]bool{
	".mov": true, ".avi": true, ".wmv": true, ".flv": true,
	".ts": true, ".mpg": true, ".mpeg": true,
}

func New(cfg config.Config, db *fftdb.DB) *Server {
	gin.SetMode(gin.ReleaseMode)
	hub := websocket.NewHub()
	detector := hardware.NewDetector()

	s := &Server{
		cfg:          cfg,
		db:           db,
		hub:          hub,
		hardware:     detector,
		transcoder:   transcode.New(hub, db),
		watchFolders: watchfolders.New(db),
		presets:      presets.New(db),
	}
	s.bench = benchmark.New(db, detector, hub, cfg.RootDir)

	router := gin.New()
	router.Use(gin.LoggerWithFormatter(redactingGinLogFormatter), gin.Recovery())
	s.routes(router)
	s.router = router
	return s
}

func (s *Server) Router() http.Handler {
	return s.router
}

func redactingGinLogFormatter(param gin.LogFormatterParams) string {
	path := redactURLPathForLog(param.Path)
	if param.ErrorMessage != "" {
		return fmt.Sprintf("[GIN] %v | %3d | %13v | %15s | %-7s %#v\n%s",
			param.TimeStamp.Format("2006/01/02 - 15:04:05"),
			param.StatusCode,
			param.Latency,
			param.ClientIP,
			param.Method,
			path,
			redactPathText(param.ErrorMessage),
		)
	}
	return fmt.Sprintf("[GIN] %v | %3d | %13v | %15s | %-7s %#v\n",
		param.TimeStamp.Format("2006/01/02 - 15:04:05"),
		param.StatusCode,
		param.Latency,
		param.ClientIP,
		param.Method,
		path,
	)
}

func redactURLPathForLog(rawPath string) string {
	parsed, err := url.ParseRequestURI(rawPath)
	if err != nil {
		return redactPathText(rawPath)
	}
	if parsed.RawQuery == "" {
		return rawPath
	}
	pairs := strings.Split(parsed.RawQuery, "&")
	for i, pair := range pairs {
		key, value, ok := strings.Cut(pair, "=")
		if !ok {
			pairs[i] = redactPathText(pair)
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			pairs[i] = key + "=" + redactPathText(value)
			continue
		}
		if feedbackSensitiveKey.MatchString(key) {
			pairs[i] = key + "=xxxxx"
		} else if looksLikeFilesystemPath(decoded) {
			pairs[i] = key + "=" + redactPathForLog(decoded)
		} else {
			pairs[i] = key + "=" + redactSensitiveLogText(decoded)
		}
	}
	parsed.RawQuery = strings.Join(pairs, "&")
	return parsed.String()
}

func redactPathText(text string) string {
	text = redactFilesystemPaths(text)
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return text
	}
	redacted := text
	for _, field := range fields {
		trimmed := strings.Trim(field, `"'(),;`)
		if !looksLikeFilesystemPath(trimmed) {
			continue
		}
		redacted = strings.ReplaceAll(redacted, trimmed, redactPathForLog(trimmed))
	}
	return redacted
}

func looksLikeFilesystemPath(value string) bool {
	normalized := strings.ReplaceAll(value, "\\", "/")
	return strings.HasPrefix(normalized, "/") || regexp.MustCompile(`^[A-Za-z]:/`).MatchString(normalized)
}

func redactPathForLog(path string) string {
	normalized := strings.ReplaceAll(path, "\\", "/")
	name := normalized
	if index := strings.LastIndex(normalized, "/"); index >= 0 {
		name = normalized[index+1:]
	}
	if name == "" || name == "." {
		return "xxxxx"
	}
	return "xxxxx/" + name
}

func (s *Server) routes(r *gin.Engine) {
	r.GET("/ws", s.hub.Handle)

	apiGroup := r.Group("/api")
	apiGroup.GET("/files", api.BrowseFiles)
	apiGroup.POST("/files/folder", api.CreateFolder)
	apiGroup.GET("/watchfolders", s.listWatchFolders)
	apiGroup.POST("/watchfolders", s.addWatchFolder)
	apiGroup.GET("/watchfolders/:path/manage", s.manageWatchFolder)
	apiGroup.PATCH("/watchfolders/:path", s.updateWatchFolder)
	apiGroup.DELETE("/watchfolders/:path", s.removeWatchFolder)
	apiGroup.POST("/watchfolders/scan", s.listWatchFolders)

	apiGroup.GET("/hardware", s.hardwareInfo)
	apiGroup.GET("/sysinfo", func(c *gin.Context) { c.JSON(http.StatusOK, sysinfo.Get()) })
	apiGroup.GET("/system/usage", func(c *gin.Context) { c.JSON(http.StatusOK, sysinfo.Usage()) })

	apiGroup.POST("/transcode", s.startTranscode)
	apiGroup.DELETE("/transcode/:task_id", s.cancelTranscode)
	apiGroup.GET("/transcode/:task_id/report.pdf", s.downloadTaskReport)
	apiGroup.GET("/tasks", func(c *gin.Context) { c.JSON(http.StatusOK, s.transcoder.Tasks()) })
	apiGroup.POST("/online/transcode", s.startOnlineTranscode)
	apiGroup.GET("/online/download/:task_id", s.downloadOnlineResult)

	apiGroup.GET("/benchmark/history", s.benchmarkHistory)
	apiGroup.POST("/benchmark", s.runBenchmark)
	apiGroup.POST("/benchmark/reset", func(c *gin.Context) { s.bench.Reset(); c.JSON(http.StatusOK, gin.H{"status": "reset"}) })
	apiGroup.POST("/benchmark/cancel", func(c *gin.Context) { s.bench.Cancel(); c.JSON(http.StatusOK, gin.H{"status": "cancelled"}) })
	apiGroup.GET("/leaderboard", s.leaderboard)

	apiGroup.GET("/presets", s.listPresets)
	apiGroup.POST("/presets", s.savePreset)
	apiGroup.DELETE("/presets/:name", s.deletePreset)
	apiGroup.POST("/presets/:name/reset", s.resetPreset)

	apiGroup.OPTIONS("/logs/feedback", s.feedbackLogOptions)
	apiGroup.OPTIONS("/logs/download", s.feedbackLogOptions)
	apiGroup.GET("/logs/feedback", s.feedbackLog)
	apiGroup.GET("/logs/download", s.downloadLogs)

	r.Static("/assets", filepath.Join(s.cfg.StaticDir, "assets"))
	r.StaticFile("/favicon.ico", filepath.Join(s.cfg.StaticDir, "favicon.ico"))
	r.NoRoute(s.index)
	r.GET("/", s.index)
}

func (s *Server) index(c *gin.Context) {
	if strings.HasPrefix(c.Request.URL.Path, "/api/") {
		c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
		return
	}
	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		c.String(http.StatusOK, "FFT backend is running. Build the React frontend with npm run build in frontend/.")
		return
	}
	c.File(index)
}

func (s *Server) listWatchFolders(c *gin.Context) {
	results, err := s.watchFolders.ScanAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

type addWatchFolderReq struct {
	Path       string `json:"path"`
	Label      string `json:"label"`
	OutputDest string `json:"output_dest"`
	OutputDir  string `json:"output_dir"`
}

func (s *Server) addWatchFolder(c *gin.Context) {
	var req addWatchFolderReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is required"})
		return
	}
	abs, err := filepath.Abs(req.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid path"})
		return
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Path is not a directory"})
		return
	}
	req.OutputDest, req.OutputDir = normalizeWatchFolderOutput(abs, req.OutputDest, req.OutputDir)
	record, err := s.db.AddWatchFolder(abs, req.Label, req.OutputDest, req.OutputDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"path":        record.Path,
		"label":       record.Label,
		"output_dest": record.OutputDest,
		"output_dir":  record.OutputDir,
		"copy_av1":    record.CopyAV1,
		"preset_name": record.PresetName,
	})
}

type updateWatchFolderReq struct {
	OutputDest *string `json:"output_dest"`
	OutputDir  *string `json:"output_dir"`
	Path       *string `json:"path"`
	Label      *string `json:"label"`
	CopyAV1    *bool   `json:"copy_av1"`
	PresetName *string `json:"preset_name"`
}

func (s *Server) updateWatchFolder(c *gin.Context) {
	path, ok := decodePath(c.Param("path"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base64 path"})
		return
	}
	var req updateWatchFolderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var record fftdb.WatchFolderRecord
	var err error
	if req.Path != nil {
		newPath := strings.TrimSpace(*req.Path)
		if newPath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Path is required"})
			return
		}
		abs, absErr := filepath.Abs(newPath)
		if absErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid path"})
			return
		}
		if st, statErr := os.Stat(abs); statErr != nil || !st.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Path is not a directory"})
			return
		}
		record, err = s.db.MoveWatchFolder(path, abs)
	} else {
		if req.OutputDest != nil || req.OutputDir != nil {
			current, currentErr := s.db.WatchFolder(path)
			if currentErr != nil {
				err = currentErr
			} else {
				outputDest := current.OutputDest
				outputDir := current.OutputDir
				if req.OutputDest != nil {
					outputDest = *req.OutputDest
				}
				if req.OutputDir != nil {
					outputDir = *req.OutputDir
				}
				outputDest, outputDir = normalizeWatchFolderOutput(path, outputDest, outputDir)
				req.OutputDest = &outputDest
				req.OutputDir = &outputDir
				record, err = s.db.UpdateWatchFolder(path, req.OutputDest, req.OutputDir, req.Label, req.PresetName, req.CopyAV1)
			}
		} else {
			record, err = s.db.UpdateWatchFolder(path, req.OutputDest, req.OutputDir, req.Label, req.PresetName, req.CopyAV1)
		}
	}
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Watch folder not found"})
			return
		}
		if strings.Contains(err.Error(), "already exists") {
			c.JSON(http.StatusConflict, gin.H{"error": "Watch folder already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"path":        record.Path,
		"label":       record.Label,
		"output_dest": record.OutputDest,
		"output_dir":  record.OutputDir,
		"copy_av1":    record.CopyAV1,
		"preset_name": record.PresetName,
	})
}

func (s *Server) removeWatchFolder(c *gin.Context) {
	path, ok := decodePath(c.Param("path"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base64 path"})
		return
	}
	deleted, err := s.db.RemoveWatchFolder(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !deleted {
		c.JSON(http.StatusNotFound, gin.H{"error": "Watch folder not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (s *Server) manageWatchFolder(c *gin.Context) {
	path, ok := decodePath(c.Param("path"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base64 path"})
		return
	}
	record, err := s.db.WatchFolder(path)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Watch folder not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	files := watchfolders.ScanFolder(record.Path)
	tasks := s.transcoder.Tasks()
	activeOutputs := activeTaskOutputs(tasks)
	taskOutputs := transcodeTaskOutputs(tasks, record.Path)
	naming := managedOutputNamingFromQuery(c)
	items := make([]models.ManagedFileItem, 0, len(files))
	targetRoot := targetRootFor(record)
	var sourceSize, targetSize int64
	for _, file := range files {
		sourceSize += file.Size
		relPath := relativePath(record.Path, file.Path)
		relDir := filepath.Dir(relPath)
		if relDir == "." {
			relDir = ""
		}
		sourceMeta := probeMediaMeta(file.Path)
		copyAV1Source := record.CopyAV1 && isAV1Codec(sourceMeta.VideoCodec)
		taskTarget := taskOutputs[cleanPathKey(file.Path)]
		inferredTarget := targetPathFor(record, file.Path, copyAV1Source, naming)
		target, targetInfo, targetErr := selectManagedTarget(taskTarget, inferredTarget, activeOutputs)
		var targetFileName string
		var targetRelativePath string
		targetExists := false
		var targetFileSize int64
		if target != "" {
			targetFileName = filepath.Base(target)
			targetRelativePath = targetFileName
			targetExists = targetErr == nil && targetInfo != nil && !targetInfo.IsDir()
			if targetExists {
				targetFileSize = targetInfo.Size()
				targetSize += targetFileSize
			}
		}
		targetMeta := probeMediaMeta(target)
		status, message := managedStatus(file.Size, targetFileSize, targetExists, targetErr)
		if target != "" && activeOutputs[cleanPathKey(target)] {
			status = "running"
			message = "正在转码"
		}
		if isAV1Codec(sourceMeta.VideoCodec) {
			if record.CopyAV1 {
				if target == "" {
					status = "keep"
					message = "源文件已是 AV1，尚未设置复制目标"
				} else if !targetExists {
					status = "add"
					message = "源文件已是 AV1，将直接复制"
				} else {
					status = "keep"
					message = "AV1 副本已存在"
				}
			} else {
				status = "keep"
				message = "源文件已是 AV1"
			}
		} else if target == "" {
			message = "尚未设置输出方式"
		}
		if status != "running" && targetExists && targetMeta.ProbeFailed {
			status = "force"
			message = "目标文件无法识别，可能已损坏"
		}
		items = append(items, models.ManagedFileItem{
			ID:      pathID(file.Path),
			Status:  status,
			Message: message,
			Source: models.ManagedFileSide{
				Name:         file.Name,
				Path:         file.Path,
				RelativeDir:  relDir,
				RelativePath: relPath,
				Size:         file.Size,
				Exists:       true,
				Meta:         sourceMeta,
			},
			Target: models.ManagedFileSide{
				Name:         targetFileName,
				Path:         target,
				RelativeDir:  relDir,
				RelativePath: targetRelativePath,
				Size:         targetFileSize,
				Exists:       targetExists,
				Meta:         targetMeta,
			},
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return strings.ToLower(items[i].Source.RelativePath) < strings.ToLower(items[j].Source.RelativePath)
	})

	c.JSON(http.StatusOK, models.ManagedFolderResponse{
		Folder: models.WatchFolder{
			Path:       record.Path,
			Label:      record.Label,
			FileCount:  len(files),
			TotalSize:  sourceSize,
			OutputDest: record.OutputDest,
			OutputDir:  record.OutputDir,
			CopyAV1:    record.CopyAV1,
			PresetName: record.PresetName,
		},
		Summary: managedSummary(record, tasks, len(files), sourceSize, targetSize, targetRoot),
		Items:   items,
	})
}

func (s *Server) hardwareInfo(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	c.JSON(http.StatusOK, s.hardware.Detect(c.Request.Context(), !refresh))
}

func (s *Server) startTranscode(c *gin.Context) {
	var req models.TranscodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	task, err := s.transcoder.Start(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"task_id": task.TaskID})
}

func (s *Server) cancelTranscode(c *gin.Context) {
	if !s.transcoder.Cancel(c.Param("task_id")) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found or not cancellable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

func (s *Server) downloadTaskReport(c *gin.Context) {
	task, ok := s.transcoder.Task(c.Param("task_id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	pdf, filename, err := taskreport.GenerateTaskPDF(task)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, "application/pdf", pdf)
}

func (s *Server) startOnlineTranscode(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "File is required"})
		return
	}

	jobID := randomName("online")
	jobDir := filepath.Join(s.cfg.CacheDir, jobID)
	inputDir := filepath.Join(jobDir, "input")
	outputDir := filepath.Join(jobDir, "output")
	if err := os.MkdirAll(inputDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	inputPath := filepath.Join(inputDir, safeFilename(file.Filename))
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer src.Close()
	dst, err := os.Create(inputPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := dst.Close(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	req := models.TranscodeRequest{
		Files:         []string{inputPath},
		Encoder:       c.DefaultPostForm("encoder", "libsvtav1"),
		CRF:           formInt(c, "crf", 28),
		Preset:        models.PresetValue(c.DefaultPostForm("preset", "8")),
		Prefix:        c.PostForm("prefix"),
		PrefixEnabled: boolPtr(c.DefaultPostForm("prefix_enabled", "false") == "true"),
		Suffix:        c.PostForm("suffix"),
		SuffixEnabled: boolPtr(c.DefaultPostForm("suffix_enabled", "true") != "false"),
		OutputExt:     c.DefaultPostForm("output_ext", "auto"),
		AutoMP4:       boolPtr(c.DefaultPostForm("auto_mp4", "true") != "false"),
		OutputDest:    "custom",
		OutputDir:     outputDir,
		ExtraArgs:     strings.Fields(c.PostForm("extra_args")),
	}
	if !s.encoderAvailable(c.Request.Context(), req.Encoder) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Encoder is not available on this host"})
		return
	}
	task, err := s.transcoder.Start(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"task_id":      task.TaskID,
		"filename":     file.Filename,
		"download_url": "/api/online/download/" + task.TaskID,
	})
}

func (s *Server) encoderAvailable(ctx context.Context, encoder string) bool {
	report := s.hardware.Detect(ctx, true)
	for _, item := range report.Encoders {
		if item.Name == encoder {
			return item.Available
		}
	}
	return false
}

func (s *Server) downloadOnlineResult(c *gin.Context) {
	taskID := c.Param("task_id")
	task, ok := s.transcoder.Task(taskID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}
	if task.Status != models.TaskDone {
		c.JSON(http.StatusConflict, gin.H{"error": "Task is not finished"})
		return
	}
	if task.OutputPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Output file not found"})
		return
	}
	outputPath, err := filepath.Abs(task.OutputPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid output path"})
		return
	}
	cacheDir, err := filepath.Abs(s.cfg.CacheDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if outputPath != cacheDir && !strings.HasPrefix(outputPath, cacheDir+string(os.PathSeparator)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Output file is not in cache"})
		return
	}
	if _, err := os.Stat(outputPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Output file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.FileAttachment(outputPath, filepath.Base(outputPath))
}

func (s *Server) benchmarkHistory(c *gin.Context) {
	history, err := s.bench.History()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, history)
}

func (s *Server) runBenchmark(c *gin.Context) {
	var body struct {
		Encoders []string `json:"encoders"`
	}
	_ = c.ShouldBindJSON(&body)
	c.JSON(http.StatusOK, s.bench.Run(body.Encoders))
}

func (s *Server) leaderboard(c *gin.Context) {
	rows, err := s.bench.Leaderboard()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rows)
}

func (s *Server) listPresets(c *gin.Context) {
	items, err := s.presets.All()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (s *Server) savePreset(c *gin.Context) {
	var p models.Preset
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	saved, err := s.presets.Save(p)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

func (s *Server) deletePreset(c *gin.Context) {
	ok, err := s.presets.Delete(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Preset not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (s *Server) resetPreset(c *gin.Context) {
	ok, err := s.presets.Reset(c.Param("name"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "No override found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (s *Server) downloadLogs(c *gin.Context) {
	setFeedbackLogCORS(c)
	if _, err := os.Stat(s.cfg.LogFile); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Log file not found"})
		return
	}
	c.Header("Access-Control-Expose-Headers", "Content-Disposition, Content-Type")
	c.FileAttachment(s.cfg.LogFile, fmt.Sprintf("fft-%s.log", logTimestamp()))
}

func (s *Server) feedbackLog(c *gin.Context) {
	setFeedbackLogCORS(c)
	data, err := readLogTail(s.cfg.LogFile, feedbackLogMaxBytes)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Log file not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	text := strings.TrimSpace(redactFeedbackLogText(string(data)))
	if text == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Log file is empty"})
		return
	}
	content := []byte(text)
	filename := fmt.Sprintf("fft-feedback-log-%s.txt", logTimestamp())
	c.JSON(http.StatusOK, gin.H{
		"name":     filename,
		"size":     len(content),
		"mime":     "text/plain; charset=utf-8",
		"dataUrl":  "data:text/plain;charset=utf-8;base64," + base64.StdEncoding.EncodeToString(content),
		"redacted": true,
	})
}

func logTimestamp() string {
	return time.Now().Format("20060102-150405")
}

func (s *Server) feedbackLogOptions(c *gin.Context) {
	setFeedbackLogCORS(c)
	c.Status(http.StatusNoContent)
}

func setFeedbackLogCORS(c *gin.Context) {
	origin := c.GetHeader("Origin")
	if !feedbackLogAllowedOrigins[origin] {
		return
	}
	c.Header("Access-Control-Allow-Origin", origin)
	c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Accept, Content-Type")
	c.Header("Vary", "Origin")
}

func readLogTail(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	offset := int64(0)
	if info.Size() > maxBytes {
		offset = info.Size() - maxBytes
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes))
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		text := string(data)
		if index := strings.IndexByte(text, '\n'); index >= 0 && index+1 < len(text) {
			data = []byte(text[index+1:])
		}
	}
	return data, nil
}

func redactFeedbackLogText(text string) string {
	text = strings.ToValidUTF8(text, "�")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = redactSensitiveLogText(line)
	}
	return strings.Join(lines, "\n")
}

func redactSensitiveLogText(text string) string {
	redacted := redactPathText(text)
	redacted = feedbackAuthHeaderPattern.ReplaceAllString(redacted, "${1}xxxxx")
	redacted = feedbackLogSecretPattern.ReplaceAllString(redacted, "${1}${2}xxxxx")
	redacted = feedbackPrivateIPPattern.ReplaceAllString(redacted, "x.x.x.x")
	return redacted
}

func redactFilesystemPaths(text string) string {
	redacted := feedbackWindowsPathPattern.ReplaceAllStringFunc(text, redactPathForLog)
	redacted = feedbackUnixPathPattern.ReplaceAllStringFunc(redacted, redactPathForLog)
	return redacted
}

func decodePath(value string) (string, bool) {
	data, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		data, err = base64.URLEncoding.DecodeString(value)
	}
	if err != nil {
		return "", false
	}
	return string(data), true
}

func pathID(path string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(path))
}

func boolPtr(value bool) *bool {
	return &value
}

func normalizeWatchFolderOutput(folderPath, outputDest, outputDir string) (string, string) {
	if outputDest == "custom" && outputDir != "" && sameCleanPath(folderPath, outputDir) {
		return "beside", ""
	}
	return outputDest, outputDir
}

func sameCleanPath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr == nil {
		left = leftAbs
	}
	if rightErr == nil {
		right = rightAbs
	}
	return strings.EqualFold(filepath.Clean(left), filepath.Clean(right))
}

func relativePath(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return filepath.Base(path)
	}
	return rel
}

func targetRootFor(folder fftdb.WatchFolderRecord) string {
	switch folder.OutputDest {
	case "subfolder":
		return filepath.Join(folder.Path, "AV1")
	case "custom":
		if folder.OutputDir != "" {
			return folder.OutputDir
		}
	case "beside":
		return folder.Path
	}
	return ""
}

type managedOutputNaming struct {
	Prefix        string
	PrefixEnabled bool
	Suffix        string
	SuffixEnabled bool
	OutputExt     string
	AutoMP4       bool
}

func managedOutputNamingFromQuery(c *gin.Context) managedOutputNaming {
	naming := managedOutputNaming{
		Suffix:        "_av1",
		SuffixEnabled: true,
		OutputExt:     "auto",
		AutoMP4:       true,
	}
	if c.Query("prefix_enabled") == "true" {
		naming.PrefixEnabled = true
		naming.Prefix = c.Query("prefix")
	}
	if c.Query("suffix_enabled") == "false" {
		naming.SuffixEnabled = false
		naming.Suffix = ""
	} else if suffix, ok := c.GetQuery("suffix"); ok {
		naming.Suffix = suffix
	}
	if outputExt := c.Query("output_ext"); outputExt != "" {
		naming.OutputExt = outputExt
	}
	if c.Query("auto_mp4") == "false" {
		naming.AutoMP4 = false
	}
	return naming
}

func targetPathFor(folder fftdb.WatchFolderRecord, sourcePath string, preserveSourceContainer bool, naming managedOutputNaming) string {
	if folder.OutputDest == "" {
		return ""
	}
	sourceDir := filepath.Dir(sourcePath)
	sourceBase := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	relDir := filepath.Dir(relativePath(folder.Path, sourcePath))
	if relDir == "." {
		relDir = ""
	}
	ext := filepath.Ext(sourcePath)
	if !preserveSourceContainer && naming.OutputExt != "" && naming.OutputExt != "auto" {
		ext = naming.OutputExt
	}
	if !preserveSourceContainer && naming.AutoMP4 && incompatibleAV1OutputExts[strings.ToLower(ext)] {
		ext = ".mp4"
	}
	if ext == "" {
		ext = ".mkv"
	}
	prefix := ""
	if !preserveSourceContainer && naming.PrefixEnabled {
		prefix = naming.Prefix
	}
	suffix := ""
	if !preserveSourceContainer && naming.SuffixEnabled {
		suffix = naming.Suffix
	}
	name := prefix + sourceBase + suffix + ext
	switch folder.OutputDest {
	case "subfolder":
		if !preserveSourceContainer {
			name = prefix + sourceBase + flattenedOutputSuffix(relDir, suffix) + ext
		}
		return filepath.Join(folder.Path, "AV1", name)
	case "custom":
		if folder.OutputDir != "" {
			if !preserveSourceContainer {
				name = prefix + sourceBase + flattenedOutputSuffix(relDir, suffix) + ext
			}
			return filepath.Join(folder.OutputDir, name)
		}
	}
	return filepath.Join(sourceDir, name)
}

func flattenedOutputSuffix(relDir, suffix string) string {
	relDir = strings.Trim(relDir, string(filepath.Separator))
	if relDir == "" {
		return suffix
	}
	parts := strings.Split(filepath.ToSlash(relDir), "/")
	clean := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" && part != "." {
			clean = append(clean, part)
		}
	}
	if len(clean) == 0 {
		return suffix
	}
	return "_" + strings.Join(clean, "_") + suffix
}

func selectManagedTarget(taskTarget, inferredTarget string, activeOutputs map[string]bool) (string, os.FileInfo, error) {
	candidates := make([]string, 0, 3)
	add := func(path string) {
		if path == "" {
			return
		}
		key := cleanPathKey(path)
		for _, candidate := range candidates {
			if cleanPathKey(candidate) == key {
				return
			}
		}
		candidates = append(candidates, path)
	}
	if taskTarget != "" && activeOutputs[cleanPathKey(taskTarget)] {
		add(taskTarget)
	}
	add(inferredTarget)
	add(taskTarget)
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			return candidate, info, nil
		}
	}
	if len(candidates) == 0 {
		return "", nil, nil
	}
	info, err := os.Stat(candidates[0])
	return candidates[0], info, err
}

func managedStatus(sourceSize, targetSize int64, targetExists bool, targetErr error) (string, string) {
	if !targetExists {
		if targetErr != nil && !errors.Is(targetErr, os.ErrNotExist) {
			return "force", "目标文件无法读取"
		}
		return "add", "右侧尚无 AV1 文件"
	}
	if targetSize <= 0 || targetSize < sourceSize/100 {
		return "force", "目标文件可能是半成品"
	}
	return "keep", "目标文件已存在"
}

func activeTaskOutputs(tasks []models.TaskInfo) map[string]bool {
	outputs := map[string]bool{}
	for _, task := range tasks {
		if task.Status != models.TaskRunning && task.Status != models.TaskPending {
			continue
		}
		if task.OutputPath != "" && !taskOutputFinished(task, task.OutputPath) {
			outputs[cleanPathKey(task.OutputPath)] = true
		}
	}
	return outputs
}

func taskOutputFinished(task models.TaskInfo, outputPath string) bool {
	key := cleanPathKey(outputPath)
	for _, result := range task.Results {
		if result.OutputPath != "" && cleanPathKey(result.OutputPath) == key {
			return true
		}
	}
	return false
}

func transcodeTaskOutputs(tasks []models.TaskInfo, folder string) map[string]string {
	type taskOutput struct {
		path       string
		finishedAt time.Time
	}
	latest := map[string]taskOutput{}
	outputs := map[string]string{}
	for _, task := range tasks {
		if !taskTouchesFolder(task, folder) {
			continue
		}
		if task.OutputPath != "" && task.CurrentIndex >= 0 && task.CurrentIndex < len(task.Request.Files) {
			sourcePath := task.Request.Files[task.CurrentIndex]
			key := cleanPathKey(sourcePath)
			outputTime := task.FinishedAt
			if outputTime.IsZero() {
				outputTime = task.CreatedAt
			}
			latest[key] = taskOutput{path: task.OutputPath, finishedAt: outputTime}
		}
		for _, result := range task.Results {
			if result.InputPath == "" || result.OutputPath == "" {
				continue
			}
			key := cleanPathKey(result.InputPath)
			old := latest[key]
			if old.path == "" || result.FinishedAt.After(old.finishedAt) {
				latest[key] = taskOutput{path: result.OutputPath, finishedAt: result.FinishedAt}
			}
		}
	}
	for key, output := range latest {
		outputs[key] = output.path
	}
	return outputs
}

func cleanPathKey(path string) string {
	abs, err := filepath.Abs(path)
	if err == nil {
		path = abs
	}
	return strings.ToLower(filepath.Clean(path))
}

func managedSummary(folder fftdb.WatchFolderRecord, tasks []models.TaskInfo, fileCount int, sourceSize, targetSize int64, targetRoot string) models.ManagedFolderSummary {
	summary := models.ManagedFolderSummary{
		Name:       folder.Label,
		Source:     folder.Path,
		Target:     targetRoot,
		FileCount:  fileCount,
		SourceSize: sourceSize,
		TargetSize: targetSize,
	}
	if summary.Name == "" {
		summary.Name = filepath.Base(folder.Path)
	}
	var created, finished time.Time
	for _, task := range tasks {
		if !taskTouchesFolder(task, folder.Path) {
			continue
		}
		if created.IsZero() || task.CreatedAt.Before(created) {
			created = task.CreatedAt
		}
		if task.Status == models.TaskRunning || task.Status == models.TaskPending {
			if task.Progress > summary.Progress {
				summary.Progress = task.Progress
				summary.ActiveTaskID = task.TaskID
			}
		}
		if !task.FinishedAt.IsZero() && task.FinishedAt.After(finished) {
			finished = task.FinishedAt
		}
		summary.DurationSec += task.DurationSec
	}
	if !created.IsZero() {
		value := created.Format(time.RFC3339)
		summary.CreatedAt = &value
	}
	if !finished.IsZero() {
		value := finished.Format(time.RFC3339)
		summary.FinishedAt = &value
	}
	return summary
}

func taskTouchesFolder(task models.TaskInfo, folderPath string) bool {
	for _, file := range task.Request.Files {
		if file == folderPath || strings.HasPrefix(file, folderPath+string(os.PathSeparator)) {
			return true
		}
	}
	for _, result := range task.Results {
		if result.InputPath == folderPath || strings.HasPrefix(result.InputPath, folderPath+string(os.PathSeparator)) {
			return true
		}
	}
	return false
}

type ffprobeOutput struct {
	Streams []struct {
		CodecType        string `json:"codec_type"`
		CodecName        string `json:"codec_name"`
		Width            int    `json:"width"`
		Height           int    `json:"height"`
		Channels         int    `json:"channels"`
		PixFmt           string `json:"pix_fmt"`
		BitsPerRawSample string `json:"bits_per_raw_sample"`
		BitsPerSample    int    `json:"bits_per_sample"`
		AvgFrameRate     string `json:"avg_frame_rate"`
		RFrameRate       string `json:"r_frame_rate"`
		NBFrames         string `json:"nb_frames"`
	} `json:"streams"`
	Format struct {
		BitRate string `json:"bit_rate"`
	} `json:"format"`
}

func probeMediaMeta(path string) models.ManagedFileMeta {
	if path == "" {
		return models.ManagedFileMeta{}
	}
	if _, err := os.Stat(path); err != nil {
		return models.ManagedFileMeta{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path)
	out, err := cmd.Output()
	if err != nil {
		return models.ManagedFileMeta{ProbeFailed: true}
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return models.ManagedFileMeta{ProbeFailed: true}
	}
	var meta models.ManagedFileMeta
	meta.Bitrate = parseInt64(parsed.Format.BitRate)
	for _, stream := range parsed.Streams {
		switch stream.CodecType {
		case "video":
			if meta.VideoCodec == "" {
				meta.VideoCodec = stream.CodecName
				if stream.Width > 0 && stream.Height > 0 {
					meta.Resolution = fmt.Sprintf("%dx%d", stream.Width, stream.Height)
				}
				meta.FrameCount = parseInt64(stream.NBFrames)
				meta.FrameRate = formatFrameRate(firstNonEmpty(stream.AvgFrameRate, stream.RFrameRate))
				meta.BitDepth = videoBitDepth(stream.BitsPerRawSample, stream.BitsPerSample, stream.PixFmt)
			}
		case "audio":
			if meta.AudioCodec == "" {
				meta.AudioCodec = stream.CodecName
				meta.Channels = stream.Channels
			}
		}
	}
	return meta
}

func isAV1Codec(codec string) bool {
	codec = strings.ToLower(strings.TrimSpace(codec))
	return codec == "av1" || codec == "libsvtav1" || codec == "libaom-av1" || codec == "librav1e"
}

func parseInt64(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "N/A" {
		return 0
	}
	var parsed int64
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return 0
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && value != "0/0" && value != "N/A" {
			return value
		}
	}
	return ""
}

func formatFrameRate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if num, den, ok := strings.Cut(value, "/"); ok {
		n := parseFloat(num)
		d := parseFloat(den)
		if n > 0 && d > 0 {
			fps := n / d
			if fps == float64(int64(fps)) {
				return fmt.Sprintf("%.0f fps", fps)
			}
			return fmt.Sprintf("%.2f fps", fps)
		}
	}
	if fps := parseFloat(value); fps > 0 {
		return fmt.Sprintf("%.2f fps", fps)
	}
	return ""
}

func parseFloat(value string) float64 {
	var parsed float64
	if _, err := fmt.Sscanf(strings.TrimSpace(value), "%f", &parsed); err != nil {
		return 0
	}
	return parsed
}

func videoBitDepth(rawSample string, bitsPerSample int, pixFmt string) int {
	if value := int(parseInt64(rawSample)); value > 0 {
		return value
	}
	if bitsPerSample > 0 {
		return bitsPerSample
	}
	match := regexp.MustCompile(`p(\d{2})(?:le|be)?$`).FindStringSubmatch(strings.ToLower(pixFmt))
	if len(match) == 2 {
		return int(parseInt64(match[1]))
	}
	return 8
}

func formInt(c *gin.Context, key string, fallback int) int {
	value := strings.TrimSpace(c.PostForm(key))
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return fallback
	}
	return parsed
}

func safeFilename(name string) string {
	base := strings.TrimSpace(filepath.Base(name))
	if base == "." || base == string(os.PathSeparator) || base == "" {
		return "upload"
	}
	re := regexp.MustCompile(`[^A-Za-z0-9._-]+`)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	cleanStem := strings.Trim(re.ReplaceAllString(stem, "_"), "._-")
	cleanExt := strings.Trim(re.ReplaceAllString(ext, "_"), "_-")
	if cleanStem == "" {
		cleanStem = "upload"
	}
	if cleanExt == "" && ext != "" {
		cleanExt = ".bin"
	}
	return cleanStem + cleanExt
}

func randomName(prefix string) string {
	var buf [4]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s-%s-%s", prefix, time.Now().Format("20060102-150405"), hex.EncodeToString(buf[:]))
}
