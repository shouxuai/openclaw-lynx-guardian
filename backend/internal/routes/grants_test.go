package routes

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
	RegisterChains(query, internal, chainService, chainRepository)
	RegisterGrants(query, internal, grantService, grantRepository)
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
