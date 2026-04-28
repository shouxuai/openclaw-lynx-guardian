package httpserver

import (
	"net/url"
	"strconv"
	"strings"
)

// ReadString mirrors readStringQuery.
func ReadString(values url.Values, key string) *string {
	raw := strings.TrimSpace(values.Get(key))
	if raw == "" {
		return nil
	}
	return &raw
}

// ReadInt64 mirrors readNumberQuery.
func ReadInt64(values url.Values, key string) *int64 {
	raw := ReadString(values, key)
	if raw == nil {
		return nil
	}
	n, err := strconv.ParseInt(*raw, 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

// ReadInt mirrors readNumberQuery when the target is an int.
func ReadInt(values url.Values, key string) *int {
	if n := ReadInt64(values, key); n != nil {
		v := int(*n)
		return &v
	}
	return nil
}

// ReadBool mirrors readBooleanQuery.
func ReadBool(values url.Values, key string) *bool {
	raw := ReadString(values, key)
	if raw == nil {
		return nil
	}
	switch strings.ToLower(*raw) {
	case "true", "1":
		t := true
		return &t
	case "false", "0":
		f := false
		return &f
	}
	return nil
}

// ReadStringSlice mirrors readStringArrayQuery (comma + repeated key).
func ReadStringSlice(values url.Values, key string) []string {
	raw := values[key]
	if len(raw) == 0 {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, entry := range raw {
		for _, part := range strings.Split(entry, ",") {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
