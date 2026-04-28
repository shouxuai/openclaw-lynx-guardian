// Package config mirrors backend/src/config/env.ts.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const defaultPort = "31789"

type Config struct {
	Host              string
	ListenHost        string
	Port              string
	DataDir           string
	DatabasePath      string
	IngestToken       string
	TokenPath         string
	FrontendDistPath  string
	TokenUsageEnabled bool
	TrustedProxyIPs   []string
}

func Resolve() (*Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	dataDir := envOr("LYNX_LOCAL_CONSOLE_DATA_DIR",
		filepath.Join(home, ".openclaw", "lynx", "data"))
	dataDir = expandHomePlaceholder(dataDir, home)
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}

	tokenPath := envOr("LYNX_LOCAL_CONSOLE_TOKEN_PATH",
		filepath.Join(dataDir, "console.token"))

	host := envOr("LYNX_LOCAL_CONSOLE_HOST", "127.0.0.1")

	dbPath := envOr("LYNX_LOCAL_CONSOLE_DB_PATH",
		filepath.Join(dataDir, "lynx.db"))

	ingestToken := os.Getenv("LYNX_LOCAL_CONSOLE_TOKEN")
	if ingestToken == "" {
		ingestToken = readTokenFile(tokenPath)
	}

	return &Config{
		Host:              host,
		ListenHost:        envOr("LYNX_LOCAL_CONSOLE_LISTEN_HOST", host),
		Port:              envOr("LYNX_LOCAL_CONSOLE_PORT", defaultPort),
		DataDir:           dataDir,
		DatabasePath:      dbPath,
		IngestToken:       ingestToken,
		TokenPath:         tokenPath,
		FrontendDistPath:  resolveFrontendDist(),
		TokenUsageEnabled: readBool(os.Getenv("LYNX_LOCAL_CONSOLE_TOKEN_USAGE_ENABLED"), false),
		TrustedProxyIPs:   readStringList(os.Getenv("LYNX_LOCAL_CONSOLE_TRUSTED_PROXY_IPS")),
	}, nil
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func expandHomePlaceholder(value, home string) string {
	replacer := strings.NewReplacer("%USERPROFILE%", home, "%userprofile%", home)
	return replacer.Replace(value)
}

func readTokenFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return fallback
}

func readStringList(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func resolveFrontendDist() string {
	if v := os.Getenv("LYNX_LOCAL_CONSOLE_FRONTEND_DIST_PATH"); v != "" {
		abs, _ := filepath.Abs(v)
		return abs
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	base := filepath.Dir(exe)
	for _, rel := range []string{"../frontend/dist", "../../frontend/dist", "frontend/dist"} {
		cand := filepath.Join(base, rel)
		if _, err := os.Stat(cand); err == nil {
			abs, _ := filepath.Abs(cand)
			return abs
		}
	}
	return ""
}

func ParsePort(value string) int {
	if n, err := strconv.Atoi(value); err == nil {
		return n
	}
	return 0
}
