// Package repo mirrors backend/src/repositories.
package repo

import (
	"strings"

	"github.com/openclaw/lynx-guardian/backend-go/internal/service"
)

// Filter accumulator mirrors the TS filters/parameters pair.
type Filter struct {
	clauses []string
	params  []any
}

func (f *Filter) Clauses() []string { return f.clauses }
func (f *Filter) Params() []any     { return f.params }

func (f *Filter) Where() string {
	if len(f.clauses) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(f.clauses, " AND ")
}

// AppendRange mirrors appendRangeFilter.
func (f *Filter) AppendRange(field string, fromMs, toMs *int64) {
	if fromMs != nil {
		f.clauses = append(f.clauses, field+" >= ?")
		f.params = append(f.params, *fromMs)
	}
	if toMs != nil {
		f.clauses = append(f.clauses, field+" <= ?")
		f.params = append(f.params, *toMs)
	}
}

// AppendEquals mirrors appendEqualsFilter.
func (f *Filter) AppendEquals(field string, value *string) {
	if value == nil || *value == "" {
		return
	}
	f.clauses = append(f.clauses, field+" = ?")
	f.params = append(f.params, *value)
}

// AppendIn mirrors appendInFilter.
func (f *Filter) AppendIn(field string, values []string) {
	if len(values) == 0 {
		return
	}
	placeholders := make([]string, len(values))
	for i := range values {
		placeholders[i] = "?"
	}
	f.clauses = append(f.clauses, field+" IN ("+strings.Join(placeholders, ", ")+")")
	for _, v := range values {
		f.params = append(f.params, v)
	}
}

// AppendTextSearch mirrors appendTextSearchFilter.
func (f *Filter) AppendTextSearch(fields []string, value *string) {
	if value == nil {
		return
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" || len(fields) == 0 {
		return
	}
	parts := make([]string, len(fields))
	for i, field := range fields {
		parts[i] = "COALESCE(" + field + ", '') LIKE ? ESCAPE '\\'"
	}
	f.clauses = append(f.clauses, "("+strings.Join(parts, " OR ")+")")
	pattern := "%" + escapeLikePattern(trimmed) + "%"
	for range fields {
		f.params = append(f.params, pattern)
	}
}

// AppendDescendingCursor mirrors appendDescendingCursorFilter.
func (f *Filter) AppendDescendingCursor(sortField, idField string, cursor *service.DescendingCursor) {
	if cursor == nil {
		return
	}
	f.clauses = append(f.clauses,
		"("+sortField+" < ? OR ("+sortField+" = ? AND "+idField+" < ?))")
	f.params = append(f.params, cursor.SortValue, cursor.SortValue, cursor.ID)
}

func escapeLikePattern(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		switch r {
		case '\\', '%', '_':
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}
