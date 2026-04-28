package openapi

import _ "embed"

//go:embed openapi.yaml
var spec []byte

// Spec returns the embedded OpenAPI document served by the binary.
func Spec() []byte {
	return spec
}
