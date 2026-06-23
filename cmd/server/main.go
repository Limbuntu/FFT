package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/limbuntu/fft/internal/app"
	"github.com/limbuntu/fft/internal/config"
	"github.com/limbuntu/fft/internal/logging"
	fftdb "github.com/limbuntu/fft/internal/store"
)

func main() {
	cfg := config.Load()
	closeLog, err := logging.Setup(cfg.LogFile)
	if err != nil {
		log.Fatalf("setup logging: %v", err)
	}
	defer closeLog()

	db, err := fftdb.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	if err := db.Migrate(); err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	if err := db.ImportLegacyJSON(cfg.RootDir); err != nil {
		log.Printf("legacy import skipped: %v", err)
	}

	server := app.New(cfg, db)
	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)

	if cfg.OpenBrowser {
		go func() {
			time.Sleep(1200 * time.Millisecond)
			openBrowser(fmt.Sprintf("http://127.0.0.1:%s", cfg.Port))
		}()
	}

	log.Printf("FFT listening on http://%s", addr)
	for _, url := range lanURLs(cfg.Host, cfg.Port) {
		log.Printf("LAN access: %s", url)
	}
	if err := http.ListenAndServe(addr, server.Router()); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}

func lanURLs(host, port string) []string {
	if host != "" && host != "0.0.0.0" && host != "::" {
		return nil
	}
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var urls []string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
				continue
			}
			urls = append(urls, fmt.Sprintf("http://%s:%s", ip.String(), port))
		}
	}
	return urls
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Start()
}
