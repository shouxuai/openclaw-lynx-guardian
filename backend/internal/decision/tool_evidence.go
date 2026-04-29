package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

func toolRuleMatches(req api.DecisionRequest, chain ChainSummary, predicate func(toolRequestView) bool) bool {
	if req.Stage != "tool_call" {
		return false
	}
	view := buildToolRequestView(req)
	if len(chain.RecentTaintReads) > 0 || len(chain.TaintSummary) > 0 {
		view.SourceKinds = uniqueStrings(append(view.SourceKinds, "tainted_artifact"))
	}
	return predicate(view)
}
