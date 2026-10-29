// Package model holds the types shared by the Go core, the build tools, the
// optional server and the TypeScript client. The TypeScript definitions in
// web/src/core/types.gen.ts are generated from this package with tygo
// (`make gen`); don't edit them by hand.
package model

import "encoding/json"

// CoreVersion identifies the core build. Bump it when the worker protocol
// changes in a way the client must know about.
const CoreVersion = "0.1.0"

// Request is a message from the client to the core worker.
type Request struct {
	ID      int             `json:"id"`
	Op      string          `json:"op"`
	Payload json.RawMessage `json:"payload,omitempty" tstype:"unknown"`
}

// Response is the core worker's reply to a Request with the same ID.
type Response struct {
	ID     int    `json:"id"`
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty" tstype:"unknown"`
	Error  string `json:"error,omitempty"`
}

// PingPayload is the payload of the "ping" op.
type PingPayload struct {
	Echo string `json:"echo"`
}

// PingResult is the result of the "ping" op.
type PingResult struct {
	Echo        string `json:"echo"`
	CoreVersion string `json:"coreVersion"`
}

// ContentValidateResult is the result of the content.validate op: every
// problem found (empty when the bundle is valid).
type ContentValidateResult struct {
	Errors []string `json:"errors"`
}

// UpdateManifest lists the content packs published by the optional update
// server.
type UpdateManifest struct {
	Packs []PackInfo `json:"packs"`
}

// PackInfo describes one downloadable content pack.
type PackInfo struct {
	ID        string `json:"id"`
	Version   string `json:"version"`
	MinClient string `json:"minClient"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
	URL       string `json:"url"`
}
