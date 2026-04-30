package repo

import (
	"database/sql"
	"encoding/json"
)

type sqlExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

type sqlQueryable interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

var enforcementToDB = map[string]string{
	"allow":           "allow",
	"warn":            "warn",
	"block":           "block",
	"redact":          "redact",
	"requireApproval": "require_approval",
	"logOnly":         "log_only",
}

var enforcementFromDB = map[string]string{
	"allow":            "allow",
	"warn":             "warn",
	"block":            "block",
	"redact":           "redact",
	"require_approval": "requireApproval",
	"log_only":         "logOnly",
}

var scopeToDB = map[string]string{
	"singleTool": "single_tool",
	"workflow":   "workflow",
	"timeWindow": "time_window",
}

var scopeFromDB = map[string]string{
	"single_tool": "singleTool",
	"workflow":    "workflow",
	"time_window": "timeWindow",
}

func toDBEnforcementAction(value string) string {
	if mapped, ok := enforcementToDB[value]; ok {
		return mapped
	}
	return value
}

func fromDBEnforcementAction(value string) string {
	if mapped, ok := enforcementFromDB[value]; ok {
		return mapped
	}
	return value
}

func toDBApprovalScopeType(value string) string {
	if mapped, ok := scopeToDB[value]; ok {
		return mapped
	}
	return value
}

func mapStringPtr(value *string, mapper func(string) string) *string {
	if value == nil {
		return nil
	}
	mapped := mapper(*value)
	return &mapped
}

func fromDBApprovalScopeType(value string) string {
	if mapped, ok := scopeFromDB[value]; ok {
		return mapped
	}
	return value
}

func toBoolInt(value *bool) int {
	if value != nil && *value {
		return 1
	}
	return 0
}

func fromBoolInt(value int64) bool {
	return value == 1
}

func toJSON(value any) any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return string(data)
}

func resultStatus(result sql.Result) (PersistResult, error) {
	changes, err := result.RowsAffected()
	if err != nil {
		return PersistResult{}, err
	}
	if changes > 0 {
		return PersistResult{Status: "persisted"}, nil
	}
	return PersistResult{Status: "duplicate"}, nil
}

func putString(out map[string]any, key string, value sql.NullString) {
	if value.Valid {
		out[key] = value.String
	}
}

func putRiskLevel(out map[string]any, key string, value sql.NullString) {
	if !value.Valid || value.String == "" {
		out[key] = "L0"
		return
	}
	out[key] = value.String
}

func putInt64(out map[string]any, key string, value sql.NullInt64) {
	if value.Valid {
		out[key] = value.Int64
	}
}

func putJSONRecord(out map[string]any, key string, value sql.NullString) {
	if parsed := parseJSONRecord(value); parsed != nil {
		out[key] = parsed
	}
}

func putJSONArray[T any](out map[string]any, key string, value sql.NullString) {
	if parsed := parseJSONArray[T](value); parsed != nil {
		out[key] = parsed
	}
}
