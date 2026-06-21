package config

import (
	"os"
	"path/filepath"
	"strconv"
)

type Config struct {
	RootDir      string
	DataDir      string
	StaticDir    string
	DatabasePath string
	LogFile      string
	Host         string
	Port         string
	OpenBrowser  bool
}

func Load() Config {
	root := mustGetwd()
	dataDir := env("FFT_DATA_DIR", root)
	staticDir := env("FFT_STATIC_DIR", firstExisting(
		filepath.Join(root, "frontend", "dist"),
		filepath.Join(root, "static"),
	))
	logFile := env("FFT_LOG_FILE", filepath.Join(dataDir, "logs", "fft.log"))

	return Config{
		RootDir:      root,
		DataDir:      dataDir,
		StaticDir:    staticDir,
		DatabasePath: env("FFT_DB", filepath.Join(dataDir, "fft.db")),
		LogFile:      logFile,
		Host:         env("FFT_HOST", "0.0.0.0"),
		Port:         env("FFT_PORT", "8166"),
		OpenBrowser:  envBool("FFT_OPEN_BROWSER", false),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	ok, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return ok
}

func mustGetwd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func firstExisting(paths ...string) string {
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	if len(paths) > 0 {
		return paths[0]
	}
	return "."
}
