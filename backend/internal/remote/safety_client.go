package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultTimeout = 2 * time.Second

type Config struct {
	BaseURL string
	Timeout time.Duration
	Enabled bool
}

type Client struct {
	baseURL    string
	httpClient *http.Client
	enabled    bool
}

type ContentCheckResult struct {
	IsSafe     bool   `json:"is_safe"`
	RiskLevel  int    `json:"risk_level"`
	LevelOne   string `json:"level_one"`
	LevelTwo   string `json:"level_two"`
	LevelThree string `json:"level_three"`
}

type ContentCheckResponse struct {
	Code    int                `json:"code"`
	Result  ContentCheckResult `json:"result"`
	Message string             `json:"message"`
}

type ToolCheckResult struct {
	IsSafe    bool   `json:"is_safe"`
	RiskLevel int    `json:"risk_level"`
	Content   string `json:"content"`
}

type ToolCheckResponse struct {
	Code    int             `json:"code"`
	Result  ToolCheckResult `json:"result"`
	Message string          `json:"message"`
}

type PushRecordResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type SkillBlacklistEntry struct {
	Name        string `json:"name,omitempty"`
	NamePattern string `json:"namePattern,omitempty"`
	Hash        string `json:"hash,omitempty"`
	Reason      string `json:"reason"`
	Severity    string `json:"severity"`
}

type SkillBlacklistResult struct {
	Entries []SkillBlacklistEntry `json:"entries"`
}

type SkillBlacklistResponse struct {
	Code    int                  `json:"code"`
	Result  SkillBlacklistResult `json:"result"`
	Message string               `json:"message"`
}

type SkillCheckResult struct {
	IsSafe    bool   `json:"is_safe"`
	RiskLevel int    `json:"risk_level"`
	Reason    string `json:"reason"`
}

type SkillCheckResponse struct {
	Code    int              `json:"code"`
	Result  SkillCheckResult `json:"result"`
	Message string           `json:"message"`
}

func NewSafetyClient(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: timeout},
		enabled:    cfg.Enabled && baseURL != "",
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.enabled
}

func (c *Client) CheckContent(ctx context.Context, id string, content string, contentType int) (ContentCheckResponse, error) {
	var out ContentCheckResponse
	err := c.postJSON(ctx, "/api/v1/content_check", map[string]any{
		"id":           id,
		"content":      content,
		"content_type": contentType,
	}, &out)
	return out, err
}

func (c *Client) CheckTool(ctx context.Context, id string, content string) (ToolCheckResponse, error) {
	var out ToolCheckResponse
	err := c.postJSON(ctx, "/api/v1/tool_check", map[string]any{
		"id":           id,
		"content":      content,
		"content_type": 3,
	}, &out)
	return out, err
}

func (c *Client) PushRecord(ctx context.Context, id string, content string, riskLevel int) (PushRecordResponse, error) {
	var out PushRecordResponse
	err := c.postJSON(ctx, "/api/v1/push_record", map[string]any{
		"id":           id,
		"content":      content,
		"content_type": 3,
		"is_safe":      false,
		"risk_level":   riskLevel,
	}, &out)
	return out, err
}

func (c *Client) FetchSkillBlacklist(ctx context.Context) (SkillBlacklistResponse, error) {
	var out SkillBlacklistResponse
	err := c.getJSON(ctx, "/api/v1/skill_blacklist", &out)
	return out, err
}

func (c *Client) CheckSkill(ctx context.Context, id string, skillName string, skillHash string) (SkillCheckResponse, error) {
	var out SkillCheckResponse
	err := c.postJSON(ctx, "/api/v1/skill_check", map[string]any{
		"id":         id,
		"skill_name": skillName,
		"skill_hash": skillHash,
	}, &out)
	return out, err
}

func (c *Client) postJSON(ctx context.Context, path string, body any, out any) error {
	if c == nil || !c.enabled {
		return errors.New("remote safety disabled")
	}

	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("remote safety HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	if c == nil || !c.enabled {
		return errors.New("remote safety disabled")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		data, _ := io.ReadAll(resp.Body)
		if len(data) > 0 {
			return fmt.Errorf("remote safety HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
		}
		return fmt.Errorf("remote safety HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
