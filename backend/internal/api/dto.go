// Package api holds the DTO types that cross the HTTP boundary.
// Mirror of the subset of shared/src/query-dto.ts that the Go skeleton uses so
// far. Extend as more repositories are ported.
package api

// ApprovalListItem mirrors ApprovalListItemDto.
type ApprovalListItem struct {
	ApprovalID    string  `json:"approvalId"`
	PendingID     *string `json:"pendingId,omitempty"`
	SessionKey    *string `json:"sessionKey,omitempty"`
	RunID         *string `json:"runId,omitempty"`
	Transport     *string `json:"transport,omitempty"`
	RequesterOuID *string `json:"requesterOuId,omitempty"`
	Module        string  `json:"module"`
	RiskLevel     string  `json:"riskLevel"`
	ToolName      *string `json:"toolName,omitempty"`
	ScopeType     string  `json:"scopeType"`
	RequestedAtMs int64   `json:"requestedAtMs"`
	ExpiresAtMs   int64   `json:"expiresAtMs"`
	ResolvedAtMs  *int64  `json:"resolvedAtMs,omitempty"`
	Resolution    *string `json:"resolution,omitempty"`
	PromptExcerpt *string `json:"promptExcerpt,omitempty"`
}

// ApprovalDetail mirrors ApprovalDetailDto.
type ApprovalDetail struct {
	ApprovalListItem
	ChannelProfile         *string        `json:"channelProfile,omitempty"`
	ChannelID              *string        `json:"channelId,omitempty"`
	AccountID              *string        `json:"accountId,omitempty"`
	ConversationID         *string        `json:"conversationId,omitempty"`
	ApproverOuIDs          []string       `json:"approverOuIds,omitempty"`
	ResolvedApproverOuID   *string        `json:"resolvedApproverOuId,omitempty"`
	RequestFingerprintHash *string        `json:"requestFingerprintHash,omitempty"`
	AuditSummaryJson       map[string]any `json:"auditSummaryJson,omitempty"`
	MetadataJson           map[string]any `json:"metadataJson,omitempty"`
}

type DecisionStage string
type DecisionAction string
type RiskLevel string
type EventSeverity string
type AuditColor string
type WinningArbiter string
type DecisionArbiterName string
type EvidenceSource string

type DecisionRequest struct {
	RequestID      string         `json:"requestId"`
	Stage          DecisionStage  `json:"stage"`
	Hook           string         `json:"hook"`
	SessionKey     string         `json:"sessionKey"`
	ChannelProfile string         `json:"channelProfile"`
	ChannelID      string         `json:"channelId"`
	ConversationID string         `json:"conversationId"`
	RequesterID    string         `json:"requesterId"`
	Content        string         `json:"content"`
	ToolName       string         `json:"toolName"`
	ToolArgs       map[string]any `json:"toolArgs"`
	TargetURI      string         `json:"targetUri"`
	ChainSummary   map[string]any `json:"chainSummary"`
	TaintSummary   map[string]any `json:"taintSummary"`
	ProviderSafety map[string]any `json:"providerSafety"`
	CreatedAt      string         `json:"createdAt"`
}

type ScoreBreakdown struct {
	RuleID string  `json:"ruleId"`
	Label  string  `json:"label"`
	Delta  float64 `json:"delta"`
	Reason string  `json:"reason"`
}

type EvidenceItem struct {
	ID         string         `json:"id"`
	Module     string         `json:"module"`
	Kind       string         `json:"kind"`
	Value      string         `json:"value"`
	Severity   EventSeverity  `json:"severity"`
	ScoreDelta float64        `json:"scoreDelta"`
	Source     EvidenceSource `json:"source"`
}

type ArbiterResult struct {
	Arbiter        DecisionArbiterName `json:"arbiter"`
	RiskLevel      RiskLevel           `json:"riskLevel"`
	Action         DecisionAction      `json:"action"`
	Score          float64             `json:"score"`
	MatchedModules []string            `json:"matchedModules"`
	Evidence       []EvidenceItem      `json:"evidence"`
	ScoreBreakdown []ScoreBreakdown    `json:"scoreBreakdown"`
	Reason         string              `json:"reason"`
}

type ApprovalRequestDraft struct {
	RiskFamily string         `json:"riskFamily"`
	Title      string         `json:"title"`
	Summary    string         `json:"summary"`
	Scope      map[string]any `json:"scope"`
	ExpiresAt  string         `json:"expiresAt,omitempty"`
}

type OutputRedaction struct {
	Kind        string `json:"kind"`
	Start       *int   `json:"start,omitempty"`
	End         *int   `json:"end,omitempty"`
	Replacement string `json:"replacement"`
	Reason      string `json:"reason"`
}

type DecisionAudit struct {
	EventSeverity     EventSeverity  `json:"eventSeverity"`
	PolicyDecision    DecisionAction `json:"policyDecision"`
	EnforcementAction DecisionAction `json:"enforcementAction"`
	Color             AuditColor     `json:"color"`
}

type DecisionDegraded struct {
	BackendTimeout     bool   `json:"backendTimeout,omitempty"`
	UsedCachedDecision bool   `json:"usedCachedDecision,omitempty"`
	Reason             string `json:"reason,omitempty"`
}

type DecisionResponse struct {
	DecisionID       string                `json:"decisionId"`
	Stage            DecisionStage         `json:"stage"`
	Block            bool                  `json:"block"`
	Action           DecisionAction        `json:"action"`
	RiskLevel        RiskLevel             `json:"riskLevel"`
	Score            float64               `json:"score"`
	WinningArbiter   WinningArbiter        `json:"winningArbiter"`
	Arbiters         []ArbiterResult       `json:"arbiters"`
	MatchedModules   []string              `json:"matchedModules"`
	RequiresApproval bool                  `json:"requiresApproval"`
	ApprovalRequest  *ApprovalRequestDraft `json:"approvalRequest,omitempty"`
	Redactions       []OutputRedaction     `json:"redactions,omitempty"`
	PromptContext    string                `json:"promptContext,omitempty"`
	UserMessage      string                `json:"userMessage,omitempty"`
	Audit            DecisionAudit         `json:"audit"`
	Degraded         *DecisionDegraded     `json:"degraded,omitempty"`
}
