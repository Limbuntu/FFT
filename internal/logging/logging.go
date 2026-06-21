package logging

import (
	"io"
	"log"
	"os"
	"path/filepath"
)

func Setup(logFile string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(logFile), 0o755); err != nil {
		return nil, err
	}

	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}

	log.SetFlags(log.LstdFlags | log.Lmicroseconds | log.Lshortfile)
	log.SetOutput(io.MultiWriter(os.Stdout, file))
	return func() { _ = file.Close() }, nil
}
