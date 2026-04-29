package decision

import "regexp"

type concealedIntentPattern struct {
	family  string
	pattern *regexp.Regexp
	weight  float64
}

var concealedIntentPatterns = []concealedIntentPattern{
	{"encoding_obfuscation", regexp.MustCompile(`(?i)(?:\bbase64\b|\bb64decode\b|\bfrombase64string\b|\bhex\b|16进制|unicode|fromcharcode|chr\s*\(|powershell(?:\.exe)?\s+-enc|pwsh(?:\.exe)?\s+-enc)`), 1},
	{"execute_sink", regexp.MustCompile(`(?i)(?:\bexec\b|\bexecute\b|\brun\b|运行|执行|落地执行|powershell(?:\.exe)?\s+-enc|pwsh(?:\.exe)?\s+-enc|\beval\b|invoke-expression|\biex\b)`), 2},
	{"detector_evasion", regexp.MustCompile(`(?i)(?:绕过|规避|避开|不被检测|不被识别|风控|检测|detector|evasion)`), 2},
	{"staged_loader_chain", regexp.MustCompile(`(?i)(?:先.+再|第一步.+第二步|分步|逐步|拆成多步|staged loader)`), 1},
	{"approval_bypass", regexp.MustCompile(`(?i)(?:跳过审批|绕过审批|不要授权|别弹|skip approval|bypass approval)`), 2},
}

func detectConcealedIntentGo(text string) signalDetection {
	normalized := normalizeDecisionText(text)
	matches := make([]riskSignal, 0)
	for _, item := range concealedIntentPatterns {
		if item.pattern.MatchString(normalized) {
			matches = append(matches, riskSignal{
				Family: item.family,
				Token:  item.family,
				Weight: item.weight,
				Reason: "concealed:" + item.family,
			})
		}
	}

	families := make([]string, 0, len(matches))
	reasons := make([]string, 0, len(matches))
	for _, match := range matches {
		families = append(families, match.Family)
		reasons = append(reasons, match.Reason)
	}
	families = uniqueStrings(families)
	reasons = uniqueStrings(reasons)
	score := concealedIntentScore(families)
	return signalDetection{
		Detected:        score > 0,
		NormalizedText:  normalized,
		MatchedFamilies: families,
		MatchedTerms:    families,
		Severity:        signalSeverity(score),
		ScoreDelta:      score,
		Reasons:         reasons,
	}
}

func concealedIntentScore(families []string) float64 {
	has := func(family string) bool { return hasSignalFamily(families, family) }
	switch {
	case has("encoding_obfuscation") && has("execute_sink") && has("detector_evasion"):
		return 4
	case has("execute_sink") && has("approval_bypass"):
		return 3
	case has("encoding_obfuscation") && has("execute_sink"):
		return 2
	default:
		return 0
	}
}
