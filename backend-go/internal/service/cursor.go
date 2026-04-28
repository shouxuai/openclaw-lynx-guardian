// Package service mirrors backend/src/services.
package service

import (
	"encoding/base64"
	"encoding/json"
)

const (
	DefaultListLimit = 20
	MaxListLimit     = 100
)

// DescendingCursor mirrors DescendingCursor in cursor-service.ts.
type DescendingCursor struct {
	SortValue int64  `json:"sortValue"`
	ID        string `json:"id"`
}

// CursorPage mirrors the TS CursorPage<U>. Items are opaque to keep this generic.
type CursorPage[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor,omitempty"`
}

// ResolveListLimit mirrors resolveListLimit.
func ResolveListLimit(value *int) int {
	if value == nil {
		return DefaultListLimit
	}
	v := *value
	if v < 1 {
		return 1
	}
	if v > MaxListLimit {
		return MaxListLimit
	}
	return v
}

// EncodeCursor matches shared/src/cursor.ts (base64url of JSON).
func EncodeCursor(c DescendingCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodeDescendingCursor mirrors decodeDescendingCursor.
func DecodeDescendingCursor(cursor *string) *DescendingCursor {
	if cursor == nil || *cursor == "" {
		return nil
	}
	data, err := base64.RawURLEncoding.DecodeString(*cursor)
	if err != nil {
		return nil
	}
	var out DescendingCursor
	if err := json.Unmarshal(data, &out); err != nil {
		return nil
	}
	if out.ID == "" {
		return nil
	}
	return &out
}

// BuildCursorPage mirrors buildCursorPage.
func BuildCursorPage[Row, Item any](
	rows []Row,
	limit int,
	mapRow func(Row) Item,
	getCursor func(Row) DescendingCursor,
) CursorPage[Item] {
	if limit < 0 {
		limit = 0
	}

	pageRows := rows
	if len(pageRows) > limit {
		pageRows = pageRows[:limit]
	}

	items := make([]Item, 0, len(pageRows))
	for _, row := range pageRows {
		items = append(items, mapRow(row))
	}

	var nextCursor *string
	if len(rows) > limit && len(pageRows) > 0 {
		last := pageRows[len(pageRows)-1]
		encoded := EncodeCursor(getCursor(last))
		nextCursor = &encoded
	}

	return CursorPage[Item]{Items: items, NextCursor: nextCursor}
}
