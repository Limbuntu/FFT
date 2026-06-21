package api

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/limbuntu/fft/internal/models"
	"github.com/limbuntu/fft/internal/watchfolders"
)

func BrowseFiles(c *gin.Context) {
	path := c.DefaultQuery("path", string(filepath.Separator))
	abs, err := filepath.Abs(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid path"})
		return
	}

	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		c.JSON(http.StatusNotFound, gin.H{"error": "Directory not found"})
		return
	}

	items, err := os.ReadDir(abs)
	if err != nil {
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Permission denied"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir() != items[j].IsDir() {
			return items[i].IsDir()
		}
		return strings.ToLower(items[i].Name()) < strings.ToLower(items[j].Name())
	})

	entries := make([]models.FileEntry, 0, len(items))
	for _, item := range items {
		if strings.HasPrefix(item.Name(), ".") {
			continue
		}
		full := filepath.Join(abs, item.Name())
		if item.IsDir() {
			entries = append(entries, models.FileEntry{Name: item.Name(), Path: full, IsDir: true})
			continue
		}
		if !watchfolders.IsVideoFile(full) {
			continue
		}
		info, err := item.Info()
		if err != nil {
			continue
		}
		entries = append(entries, models.FileEntry{Name: item.Name(), Path: full, IsDir: false, Size: info.Size()})
	}

	var parent *string
	if dir := filepath.Dir(abs); dir != abs {
		parent = &dir
	}

	c.JSON(http.StatusOK, models.FileBrowseResponse{
		Current: abs,
		Parent:  parent,
		Entries: entries,
	})
}
