// Package httpserver contains HTTP helpers shared across routes.
package httpserver

import (
	"encoding/json"
	"net/http"
)

// WriteJSON writes a JSON payload with the given status code.
func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(payload)
}

// WriteError writes a {ok:false, message} error body.
func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]any{
		"ok":      false,
		"message": message,
	})
}
