package repo

func baseCountMap(keys ...string) map[string]int64 {
	out := make(map[string]int64, len(keys))
	for _, key := range keys {
		out[key] = 0
	}
	return out
}
