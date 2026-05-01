package backend_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/remote"
)

func TestSafetyClientCheckContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		if r.URL.Path != "/api/v1/content_check" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["id"] != "user-1" {
			t.Fatalf("id = %#v", body["id"])
		}
		if body["content"] != "steal key" {
			t.Fatalf("content = %#v", body["content"])
		}
		if body["content_type"] != float64(1) {
			t.Fatalf("content_type = %#v", body["content_type"])
		}

		_ = json.NewEncoder(w).Encode(remote.ContentCheckResponse{
			Code: 200,
			Result: remote.ContentCheckResult{
				IsSafe:     false,
				RiskLevel:  4,
				LevelOne:   "security",
				LevelTwo:   "exfiltration",
				LevelThree: "credential theft",
			},
			Message: "OK",
		})
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	result, err := client.CheckContent(context.Background(), "user-1", "steal key", 1)
	if err != nil {
		t.Fatalf("CheckContent: %v", err)
	}
	if result.Result.RiskLevel != 4 {
		t.Fatalf("risk level = %d", result.Result.RiskLevel)
	}
	if result.Result.LevelThree != "credential theft" {
		t.Fatalf("level three = %q", result.Result.LevelThree)
	}
}

func TestSafetyClientCheckTool(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		if r.URL.Path != "/api/v1/tool_check" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["id"] != "user-2" {
			t.Fatalf("id = %#v", body["id"])
		}
		if body["content"] != "rm -rf /" {
			t.Fatalf("content = %#v", body["content"])
		}
		if body["content_type"] != float64(3) {
			t.Fatalf("content_type = %#v", body["content_type"])
		}

		_ = json.NewEncoder(w).Encode(remote.ToolCheckResponse{
			Code: 200,
			Result: remote.ToolCheckResult{
				IsSafe:    false,
				RiskLevel: 4,
				Content:   "dangerous command",
			},
			Message: "OK",
		})
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	result, err := client.CheckTool(context.Background(), "user-2", "rm -rf /")
	if err != nil {
		t.Fatalf("CheckTool: %v", err)
	}
	if result.Result.Content != "dangerous command" {
		t.Fatalf("content = %q", result.Result.Content)
	}
}

func TestSafetyClientDisabledWithoutBaseURL(t *testing.T) {
	client := remote.NewSafetyClient(remote.Config{
		Enabled: true,
	})
	if client.Enabled() {
		t.Fatal("client should be disabled without base URL")
	}
	if _, err := client.CheckContent(context.Background(), "user-1", "content", 1); err == nil {
		t.Fatal("expected disabled error")
	}
}

func TestSafetyClientHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusBadGateway)
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	if _, err := client.CheckContent(context.Background(), "user-1", "content", 1); err == nil {
		t.Fatal("expected HTTP error")
	}
}

func TestSafetyClientTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Millisecond,
		Enabled: true,
	})

	if _, err := client.CheckContent(context.Background(), "user-1", "slow", 1); err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestSafetyClientPushRecord(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/push_record" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["risk_level"] != float64(4) {
			t.Fatalf("risk_level = %#v", body["risk_level"])
		}
		_ = json.NewEncoder(w).Encode(remote.PushRecordResponse{Code: 200, Message: "OK"})
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	response, err := client.PushRecord(context.Background(), "user-1", "blocked content", 4)
	if err != nil {
		t.Fatalf("PushRecord: %v", err)
	}
	if response.Code != 200 {
		t.Fatalf("code = %d", response.Code)
	}
}

func TestSafetyClientFetchSkillBlacklist(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("method = %s", r.Method)
		}
		if r.URL.Path != "/api/v1/skill_blacklist" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(remote.SkillBlacklistResponse{
			Code: 200,
			Result: remote.SkillBlacklistResult{
				Entries: []remote.SkillBlacklistEntry{
					{Name: "evil-skill", Reason: "known malicious", Severity: "critical"},
				},
			},
			Message: "OK",
		})
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	response, err := client.FetchSkillBlacklist(context.Background())
	if err != nil {
		t.Fatalf("FetchSkillBlacklist: %v", err)
	}
	if len(response.Result.Entries) != 1 || response.Result.Entries[0].Name != "evil-skill" {
		t.Fatalf("entries = %#v", response.Result.Entries)
	}
}

func TestSafetyClientCheckSkill(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/skill_check" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["skill_name"] != "demo-skill" {
			t.Fatalf("skill_name = %#v", body["skill_name"])
		}
		_ = json.NewEncoder(w).Encode(remote.SkillCheckResponse{
			Code:    200,
			Result:  remote.SkillCheckResult{IsSafe: false, RiskLevel: 3, Reason: "suspicious"},
			Message: "OK",
		})
	}))
	defer server.Close()

	client := remote.NewSafetyClient(remote.Config{
		BaseURL: server.URL,
		Timeout: time.Second,
		Enabled: true,
	})

	response, err := client.CheckSkill(context.Background(), "user-1", "demo-skill", "hash")
	if err != nil {
		t.Fatalf("CheckSkill: %v", err)
	}
	if response.Result.RiskLevel != 3 {
		t.Fatalf("risk level = %d", response.Result.RiskLevel)
	}
}
