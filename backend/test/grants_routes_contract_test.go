package backend_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/chain"
	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/routes"
	_ "modernc.org/sqlite"
)

func TestGrantCheckAllowsSameRequesterChainAndTarget(t *testing.T) {
	router := setupGrantRouter(t)
	resolveApproval(t, router, grantResolveBody{
		ApprovalID:     "approval-allow",
		ChainID:        "chain-1",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		ApproverID:     "approver-1",
		ApproverOuID:   "owner-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
	})

	result := checkGrant(t, router, api.GrantCheckRequest{
		ChainID:        "chain-1",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
		OperationKind:  "read",
	})

	if !result.Allowed || result.GrantID == "" {
		t.Fatalf("expected grant to continue, got allowed=%v reason=%s", result.Allowed, result.Reason)
	}
}

func TestGrantCheckRevokesOnRiskEscalation(t *testing.T) {
	router := setupGrantRouter(t)
	resolveApproval(t, router, grantResolveBody{
		ApprovalID:     "approval-escalation",
		ChainID:        "chain-2",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		ApproverID:     "approver-1",
		ApproverOuID:   "owner-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
	})

	result := checkGrant(t, router, api.GrantCheckRequest{
		ChainID:        "chain-2",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L3",
		ToolName:       "write_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
		OperationKind:  "write",
	})

	if result.Allowed || result.Reason != "risk_escalation" || !result.Revoked {
		t.Fatalf("expected risk escalation revoke, got allowed=%v reason=%s revoked=%v", result.Allowed, result.Reason, result.Revoked)
	}
}

func TestGrantCheckRevokesOnChannelMismatch(t *testing.T) {
	router := setupGrantRouter(t)
	resolveApproval(t, router, grantResolveBody{
		ApprovalID:     "approval-channel",
		ChainID:        "chain-3",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		ApproverID:     "approver-1",
		ApproverOuID:   "owner-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
	})

	result := checkGrant(t, router, api.GrantCheckRequest{
		ChainID:        "chain-3",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "other-channel",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
		OperationKind:  "read",
	})

	if result.Allowed || result.Reason != "channel_mismatch" || !result.Revoked {
		t.Fatalf("expected channel mismatch revoke, got allowed=%v reason=%s revoked=%v", result.Allowed, result.Reason, result.Revoked)
	}
}

func TestGrantCheckIgnoresGrantForNewL4(t *testing.T) {
	router := setupGrantRouter(t)
	resolveApproval(t, router, grantResolveBody{
		ApprovalID:     "approval-l4",
		ChainID:        "chain-4",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		ApproverID:     "approver-1",
		ApproverOuID:   "owner-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
	})

	result := checkGrant(t, router, api.GrantCheckRequest{
		ChainID:        "chain-4",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		RiskFamily:     "plugin_integrity",
		RiskLevel:      "L4",
		ToolName:       "write_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
		OperationKind:  "write",
	})

	if result.Allowed || result.Reason != "new_l4" || result.Revoked {
		t.Fatalf("expected L4 to ignore grant without revocation, got allowed=%v reason=%s revoked=%v", result.Allowed, result.Reason, result.Revoked)
	}
}

func TestChainLifecycleRevokesActiveGrants(t *testing.T) {
	router := setupGrantRouter(t)
	resolveApproval(t, router, grantResolveBody{
		ApprovalID:     "approval-lifecycle",
		ChainID:        "chain-5",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		ApproverID:     "approver-1",
		ApproverOuID:   "owner-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
	})
	postJSON(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-5",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		EventType:      "agent_end",
		Hook:           "agent_end",
	})

	result := checkGrant(t, router, api.GrantCheckRequest{
		ChainID:        "chain-5",
		SessionKey:     "session-1",
		ChannelProfile: "feishu",
		ChannelID:      "channel-1",
		ConversationID: "conversation-1",
		RequesterID:    "requester-1",
		RequesterOuID:  "ou-1",
		RiskFamily:     "file_read",
		RiskLevel:      "L2",
		ToolName:       "read_file",
		TargetKind:     "file",
		TargetHash:     "target-a",
		OperationKind:  "read",
	})

	if result.Allowed || result.Reason != "revoked" {
		t.Fatalf("expected lifecycle revoked grant, got allowed=%v reason=%s", result.Allowed, result.Reason)
	}
}

func TestChainSummaryAccumulatesEvents(t *testing.T) {
	router := setupGrantRouter(t)

	var first api.ChainSummary
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-accumulate",
		SessionKey:     "session-accumulate",
		ChannelProfile: "webchat",
		ConversationID: "conversation-accumulate",
		RequesterID:    "requester-accumulate",
		EventType:      "before_dispatch",
		Hook:           "before_dispatch",
		RiskLevel:      "L4",
		Action:         "deny",
		Content:        "blocked prompt",
	}, &first)
	if !contractContainsString(first.RecentDenials, "before_dispatch") {
		t.Fatalf("first summary missing denial: %#v", first)
	}

	var second api.ChainSummary
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-accumulate",
		SessionKey:     "session-accumulate",
		ChannelProfile: "webchat",
		ConversationID: "conversation-accumulate",
		RequesterID:    "requester-accumulate",
		EventType:      "before_tool_call",
		Hook:           "before_tool_call",
		RiskLevel:      "L3",
		Action:         "require_approval",
		ToolName:       "read_file",
		TargetURI:      "C:/Users/example/.env",
		Metadata: map[string]any{
			"taintReadLabels": []string{"secret-file"},
			"pendingApproval": "approval-accumulate",
		},
	}, &second)

	if !contractContainsString(second.RecentDenials, "before_dispatch") {
		t.Fatalf("second summary lost prior denial: %#v", second)
	}
	if !contractContainsString(second.RecentApprovals, "before_tool_call") {
		t.Fatalf("second summary missing approval signal: %#v", second)
	}
	if !contractContainsString(second.RecentTools, "read_file") {
		t.Fatalf("second summary missing tool signal: %#v", second)
	}
	if !contractContainsString(second.RecentSensitive, "C:/Users/example/.env") {
		t.Fatalf("second summary missing sensitive target: %#v", second)
	}
	if !contractContainsString(second.RecentTaintReads, "secret-file") {
		t.Fatalf("second summary missing taint signal: %#v", second)
	}
	if second.PendingApproval != "approval-accumulate" {
		t.Fatalf("pending approval = %q, want approval-accumulate", second.PendingApproval)
	}
}

func TestChainListReturnsEmptySignalArrays(t *testing.T) {
	router := setupGrantRouter(t)
	postJSON(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:    "chain-empty-signals",
		SessionKey: "session-empty-signals",
		EventType:  "before_dispatch",
		Hook:       "before_dispatch",
	})

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/lynx/chains", nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for chain list: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "null") {
		t.Fatalf("chain list should use empty arrays instead of null: %s", recorder.Body.String())
	}
}

func TestChainSummaryClearsPendingApprovalAfterGrantResolution(t *testing.T) {
	router := setupGrantRouter(t)

	var pending api.ChainSummary
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-clear-pending",
		SessionKey:     "session-clear-pending",
		ChannelProfile: "webchat",
		ConversationID: "conversation-clear-pending",
		RequesterID:    "requester-clear-pending",
		EventType:      "before_tool_call",
		Hook:           "before_tool_call",
		RiskLevel:      "L3",
		Action:         "require_approval",
		Metadata: map[string]any{
			"pendingApproval": "approval-clear-pending",
		},
	}, &pending)
	if pending.PendingApproval != "approval-clear-pending" {
		t.Fatalf("pending approval not recorded: %#v", pending)
	}

	var resolved api.ChainSummary
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-clear-pending",
		SessionKey:     "session-clear-pending",
		ChannelProfile: "webchat",
		ConversationID: "conversation-clear-pending",
		RequesterID:    "requester-clear-pending",
		EventType:      "approval_resolved",
		Hook:           "approval_resolved",
		Action:         "allow",
		Metadata: map[string]any{
			"activeGrantId":    "grant-clear-pending",
			"approvalResolved": true,
		},
	}, &resolved)

	if resolved.PendingApproval != "" {
		t.Fatalf("pending approval persisted after grant resolution: %#v", resolved)
	}
	if resolved.ActiveGrantID != "grant-clear-pending" {
		t.Fatalf("active grant not recorded after resolution: %#v", resolved)
	}
}

func TestChainSummaryClearsPendingApprovalOnDenyBlockAndLifecycleEnd(t *testing.T) {
	router := setupGrantRouter(t)

	cases := []struct {
		name      string
		eventType string
		action    string
	}{
		{name: "deny", eventType: "before_dispatch", action: "deny"},
		{name: "block", eventType: "before_tool_call", action: "block"},
		{name: "lifecycle", eventType: "agent_end", action: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			chainID := "chain-clear-pending-" + tc.name
			var pending api.ChainSummary
			postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
				ChainID:        chainID,
				SessionKey:     "session-" + tc.name,
				ChannelProfile: "webchat",
				ConversationID: "conversation-" + tc.name,
				RequesterID:    "requester-" + tc.name,
				EventType:      "approval_requested",
				Hook:           "before_tool_call",
				RiskLevel:      "L3",
				Action:         "require_approval",
				Metadata: map[string]any{
					"pendingApproval": "approval-" + tc.name,
				},
			}, &pending)
			if pending.PendingApproval == "" {
				t.Fatalf("pending approval not recorded before clear: %#v", pending)
			}

			var cleared api.ChainSummary
			postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
				ChainID:        chainID,
				SessionKey:     "session-" + tc.name,
				ChannelProfile: "webchat",
				ConversationID: "conversation-" + tc.name,
				RequesterID:    "requester-" + tc.name,
				EventType:      tc.eventType,
				Hook:           tc.eventType,
				Action:         tc.action,
			}, &cleared)

			if cleared.PendingApproval != "" {
				t.Fatalf("pending approval persisted after %s: %#v", tc.name, cleared)
			}
		})
	}
}

func TestChainSummaryClearsActiveGrantOnRevocationAndLifecycleEnd(t *testing.T) {
	router := setupGrantRouter(t)

	cases := []struct {
		name      string
		eventType string
	}{
		{name: "revocation", eventType: "grant_revoked"},
		{name: "lifecycle", eventType: "agent_end"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			chainID := "chain-clear-active-grant-" + tc.name
			var active api.ChainSummary
			postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
				ChainID:        chainID,
				SessionKey:     "session-active-" + tc.name,
				ChannelProfile: "webchat",
				ConversationID: "conversation-active-" + tc.name,
				RequesterID:    "requester-active-" + tc.name,
				EventType:      "approval_resolved",
				Hook:           "approval_resolved",
				Action:         "allow",
				Metadata: map[string]any{
					"activeGrantId": "grant-active-" + tc.name,
				},
			}, &active)
			if active.ActiveGrantID == "" {
				t.Fatalf("active grant not recorded before clear: %#v", active)
			}

			var cleared api.ChainSummary
			postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
				ChainID:        chainID,
				SessionKey:     "session-active-" + tc.name,
				ChannelProfile: "webchat",
				ConversationID: "conversation-active-" + tc.name,
				RequesterID:    "requester-active-" + tc.name,
				EventType:      tc.eventType,
				Hook:           tc.eventType,
			}, &cleared)

			if cleared.ActiveGrantID != "" {
				t.Fatalf("active grant persisted after %s: %#v", tc.name, cleared)
			}
		})
	}
}

func TestChainSummaryTruncatesLargeSignals(t *testing.T) {
	router := setupGrantRouter(t)
	longTarget := "C:/Users/example/" + strings.Repeat("secret-token-", 40) + ".env"
	longTaint := "taint-" + strings.Repeat("very-long-label-", 40)

	var summary api.ChainSummary
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/chains/update", api.ChainUpdateRequest{
		ChainID:        "chain-truncate",
		SessionKey:     "session-truncate",
		ChannelProfile: "webchat",
		ConversationID: "conversation-truncate",
		RequesterID:    "requester-truncate",
		EventType:      "after_tool_call",
		Hook:           "after_tool_call",
		TargetURI:      longTarget,
		Metadata: map[string]any{
			"taintReadLabels": []string{longTaint},
		},
	}, &summary)

	if len(summary.RecentSensitive) != 1 || len([]rune(summary.RecentSensitive[0])) > 160 {
		t.Fatalf("sensitive target was not capped: length=%d value=%q", len([]rune(firstValue(summary.RecentSensitive))), firstValue(summary.RecentSensitive))
	}
	if len(summary.RecentTaintReads) != 1 || len([]rune(summary.RecentTaintReads[0])) > 160 {
		t.Fatalf("taint label was not capped: length=%d value=%q", len([]rune(firstValue(summary.RecentTaintReads))), firstValue(summary.RecentTaintReads))
	}
}

type grantResolveBody struct {
	ApprovalID     string `json:"approvalId"`
	ChainID        string `json:"chainId"`
	SessionKey     string `json:"sessionKey"`
	ChannelProfile string `json:"channelProfile"`
	ChannelID      string `json:"channelId"`
	ConversationID string `json:"conversationId"`
	RequesterID    string `json:"requesterId"`
	RequesterOuID  string `json:"requesterOuId"`
	ApproverID     string `json:"approverId"`
	ApproverOuID   string `json:"approverOuId"`
	RiskFamily     string `json:"riskFamily"`
	RiskLevel      string `json:"riskLevel"`
	ToolName       string `json:"toolName"`
	TargetKind     string `json:"targetKind"`
	TargetHash     string `json:"targetHash"`
}

func setupGrantRouter(t *testing.T) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	database.SetMaxOpenConns(1)
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	chainRepository := repo.NewChainRepository(database)
	grantRepository := repo.NewGrantRepository(database)
	grantService := grants.NewService(grantRepository)
	chainService := chain.NewService(chainRepository, grantService)

	router := gin.New()
	query := router.Group("/lynx")
	internal := query.Group("/internal/v1")
	routes.RegisterChains(query, internal, chainService, chainRepository)
	routes.RegisterGrants(query, internal, grantService, grantRepository)
	return router
}

func resolveApproval(t *testing.T, router http.Handler, body grantResolveBody) api.Grant {
	t.Helper()
	var grant api.Grant
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/approvals/"+body.ApprovalID+"/resolve", body, &grant)
	if grant.GrantID == "" {
		t.Fatalf("expected grant id in approval resolution")
	}
	return grant
}

func checkGrant(t *testing.T, router http.Handler, body api.GrantCheckRequest) api.GrantCheckResult {
	t.Helper()
	var result api.GrantCheckResult
	postJSONInto(t, router, http.MethodPost, "/lynx/internal/v1/grants/check", body, &result)
	return result
}

func firstValue(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func contractContainsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func postJSON(t *testing.T, router http.Handler, method string, path string, body any) {
	t.Helper()
	postJSONInto(t, router, method, path, body, nil)
}

func postJSONInto(t *testing.T, router http.Handler, method string, path string, body any, target any) {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for %s: %s", recorder.Code, path, recorder.Body.String())
	}
	if target != nil {
		if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
			t.Fatalf("decode response for %s: %v", path, err)
		}
	}
}
