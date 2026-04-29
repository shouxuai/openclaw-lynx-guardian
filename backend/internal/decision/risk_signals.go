package decision

type riskSignal struct {
	Family               string
	Token                string
	Weight               float64
	RequiresCooccurrence bool
	Reason               string
}

type signalDetection struct {
	Detected        bool
	NormalizedText  string
	MatchedFamilies []string
	MatchedTerms    []string
	Severity        string
	ScoreDelta      float64
	Reasons         []string
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
