package service

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// StaticWebview serves the webview dist directory, mirroring
// services/static-service.ts. It falls back to index.html for SPA routes.
func StaticWebview(rootDir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rootDir == "" {
			http.Error(w, "Webview not available", http.StatusNotFound)
			return
		}

		cleanRoot, _ := filepath.Abs(rootDir)
		rel := strings.TrimPrefix(r.URL.Path, "/webview")
		rel = strings.TrimPrefix(rel, "/")

		if rel == "" || !hasFileExtension(rel) {
			serveFile(w, filepath.Join(cleanRoot, "index.html"), "no-store")
			return
		}

		candidate := filepath.Join(cleanRoot, rel)
		absCandidate, err := filepath.Abs(candidate)
		if err != nil || !strings.HasPrefix(absCandidate, cleanRoot) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		if _, err := os.Stat(absCandidate); err != nil {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}
		serveFile(w, absCandidate, "public, max-age=3600")
	})
}

func hasFileExtension(value string) bool {
	idx := strings.LastIndex(value, ".")
	if idx == -1 {
		return false
	}
	for _, r := range value[idx+1:] {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func serveFile(w http.ResponseWriter, path, cacheControl string) {
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("Content-Type", mimeFor(path))
	_, _ = w.Write(data)
}

var mimeTypes = map[string]string{
	".css":   "text/css; charset=utf-8",
	".gif":   "image/gif",
	".html":  "text/html; charset=utf-8",
	".ico":   "image/x-icon",
	".jpeg":  "image/jpeg",
	".jpg":   "image/jpeg",
	".js":    "application/javascript; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".mjs":   "application/javascript; charset=utf-8",
	".png":   "image/png",
	".svg":   "image/svg+xml; charset=utf-8",
	".txt":   "text/plain; charset=utf-8",
	".webp":  "image/webp",
	".woff":  "font/woff",
	".woff2": "font/woff2",
}

func mimeFor(path string) string {
	idx := strings.LastIndex(path, ".")
	if idx == -1 {
		return "application/octet-stream"
	}
	if t, ok := mimeTypes[strings.ToLower(path[idx:])]; ok {
		return t
	}
	return "application/octet-stream"
}
