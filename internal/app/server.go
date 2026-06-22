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
	router.Use(gin.Logger(), gin.Recovery())
	s.routes(router)
	s.router = router
	return s
}

func (s *Server) Router() http.Handler {
	return s.router
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
	})
}

type updateWatchFolderReq struct {
	OutputDest *string `json:"output_dest"`
	OutputDir  *string `json:"output_dir"`
	Path       *string `json:"path"`
	Label      *string `json:"label"`
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
		record, err = s.db.UpdateWatchFolder(path, req.OutputDest, req.OutputDir, req.Label)
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
		target := targetPathFor(record, file.Path)
		var targetErr error
		var targetFileName string
		var targetRelativePath string
		targetExists := false
		var targetFileSize int64
		if target != "" {
			targetFileName = filepath.Base(target)
			targetRelativePath = targetFileName
			var targetInfo os.FileInfo
			targetInfo, targetErr = os.Stat(target)
			targetExists = targetErr == nil && !targetInfo.IsDir()
			if targetExists {
				targetFileSize = targetInfo.Size()
				targetSize += targetFileSize
			}
		}
		sourceMeta := probeMediaMeta(file.Path)
		targetMeta := probeMediaMeta(target)
		status, message := managedStatus(file.Size, targetFileSize, targetExists, targetErr)
		if isAV1Codec(sourceMeta.VideoCodec) {
			status = "keep"
			message = "源文件已是 AV1"
		} else if target == "" {
			message = "尚未设置输出方式"
		}
		if targetExists && targetMeta.ProbeFailed {
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
		Files:      []string{inputPath},
		Encoder:    c.DefaultPostForm("encoder", "libsvtav1"),
		CRF:        formInt(c, "crf", 28),
		Preset:     models.PresetValue(c.DefaultPostForm("preset", "8")),
		Suffix:     c.DefaultPostForm("suffix", "_av1"),
		OutputExt:  c.DefaultPostForm("output_ext", "auto"),
		OutputDest: "custom",
		OutputDir:  outputDir,
		ExtraArgs:  strings.Fields(c.PostForm("extra_args")),
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
	if _, err := os.Stat(s.cfg.LogFile); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Log file not found"})
		return
	}
	c.FileAttachment(s.cfg.LogFile, "fft.log")
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

func targetPathFor(folder fftdb.WatchFolderRecord, sourcePath string) string {
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
	if incompatibleManagedExts[strings.ToLower(ext)] {
		ext = ".mp4"
	}
	name := sourceBase + "_av1" + ext
	switch folder.OutputDest {
	case "subfolder":
		name = flattenedOutputStem(relDir, sourceBase) + "_av1" + ext
		return filepath.Join(folder.Path, "AV1", name)
	case "custom":
		if folder.OutputDir != "" {
			name = flattenedOutputStem(relDir, sourceBase) + "_av1" + ext
			return filepath.Join(folder.OutputDir, name)
		}
	}
	return filepath.Join(sourceDir, name)
}

var incompatibleManagedExts = map[string]bool{
	".mov": true, ".avi": true, ".wmv": true, ".flv": true,
	".ts": true, ".mpg": true, ".mpeg": true,
}

func flattenedOutputStem(relDir, stem string) string {
	relDir = strings.Trim(relDir, string(filepath.Separator))
	if relDir == "" {
		return stem
	}
	parts := strings.Split(filepath.ToSlash(relDir), "/")
	clean := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" && part != "." {
			clean = append(clean, part)
		}
	}
	clean = append(clean, stem)
	return strings.Join(clean, "_")
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
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
		Channels  int    `json:"channels"`
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
