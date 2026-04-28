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
