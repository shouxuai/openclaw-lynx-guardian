package api

type PolicyVersion struct {
	Version       int64  `json:"version"`
	CreatedAtMs   int64  `json:"createdAtMs"`
	CreatedBy     string `json:"createdBy"`
	ChangeSummary string `json:"changeSummary"`
}

type PolicyRule struct {
	RuleID      string `json:"ruleId"`
	Version     int64  `json:"version"`
	Kind        string `json:"kind"`
	Scope       string `json:"scope"`
	PatternType string `json:"patternType"`
	Pattern     string `json:"pattern"`
	RiskDelta   int    `json:"riskDelta"`
	Enabled     bool   `json:"enabled"`
	CreatedBy   string `json:"createdBy"`
	CreatedAtMs int64  `json:"createdAtMs"`
	UpdatedAtMs int64  `json:"updatedAtMs"`
}

type ProtectedResource struct {
	ResourceID  string `json:"resourceId"`
	Version     int64  `json:"version"`
	Path        string `json:"path"`
	RealPath    string `json:"realPath,omitempty"`
	Preset      string `json:"preset"`
	Enabled     bool   `json:"enabled"`
	CreatedBy   string `json:"createdBy"`
	CreatedAtMs int64  `json:"createdAtMs"`
	UpdatedAtMs int64  `json:"updatedAtMs"`
}

type PolicyRuleUpsertRequest struct {
	RuleID        string `json:"ruleId,omitempty"`
	Kind          string `json:"kind"`
	Scope         string `json:"scope"`
	PatternType   string `json:"patternType"`
	Pattern       string `json:"pattern"`
	RiskDelta     int    `json:"riskDelta"`
	Enabled       bool   `json:"enabled"`
	ActorID       string `json:"actorId"`
	ChangeSummary string `json:"changeSummary"`
}

type ProtectedResourceUpsertRequest struct {
	ResourceID    string `json:"resourceId,omitempty"`
	Path          string `json:"path"`
	RealPath      string `json:"realPath,omitempty"`
	Preset        string `json:"preset"`
	Enabled       bool   `json:"enabled"`
	ActorID       string `json:"actorId"`
	ChangeSummary string `json:"changeSummary"`
}

type PolicyOverview struct {
	CurrentVersion     int64               `json:"currentVersion"`
	Rules              []PolicyRule        `json:"rules"`
	ProtectedResources []ProtectedResource `json:"protectedResources"`
}
