package app

import (
	"database/sql"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/limbuntu/fft/internal/api"
	"github.com/limbuntu/fft/internal/benchmark"
	"github.com/limbuntu/fft/internal/config"
	"github.com/limbuntu/fft/internal/hardware"
	"github.com/limbuntu/fft/internal/models"
	"github.com/limbuntu/fft/internal/presets"
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
		transcoder:   transcode.New(hub),
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
	apiGroup.GET("/watchfolders", s.listWatchFolders)
	apiGroup.POST("/watchfolders", s.addWatchFolder)
	apiGroup.PATCH("/watchfolders/:path", s.updateWatchFolder)
	apiGroup.DELETE("/watchfolders/:path", s.removeWatchFolder)
	apiGroup.POST("/watchfolders/scan", s.listWatchFolders)

	apiGroup.GET("/hardware", s.hardwareInfo)
	apiGroup.GET("/sysinfo", func(c *gin.Context) { c.JSON(http.StatusOK, sysinfo.Get()) })

	apiGroup.POST("/transcode", s.startTranscode)
	apiGroup.DELETE("/transcode/:task_id", s.cancelTranscode)
	apiGroup.GET("/tasks", func(c *gin.Context) { c.JSON(http.StatusOK, s.transcoder.Tasks()) })

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
	record, err := s.db.UpdateWatchFolder(path, req.OutputDest, req.OutputDir)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Watch folder not found"})
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
