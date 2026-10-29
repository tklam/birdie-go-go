// Package rpc dispatches core worker requests to the core packages. It has no
// dependency on syscall/js, so the whole protocol can be tested natively.
package rpc

import (
	"encoding/json"
	"fmt"

	"birdiegogo/core/model"
)

// Handle decodes a JSON-encoded model.Request, runs it and returns the
// JSON-encoded model.Response. It never panics on bad input; errors are
// reported in the response.
func Handle(raw []byte) []byte {
	var req model.Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return encode(model.Response{ID: req.ID, Error: fmt.Sprintf("decode request: %v", err)})
	}
	result, err := dispatch(req)
	if err != nil {
		return encode(model.Response{ID: req.ID, Error: err.Error()})
	}
	return encode(model.Response{ID: req.ID, OK: true, Result: result})
}

func dispatch(req model.Request) (any, error) {
	switch req.Op {
	case "ping":
		var p model.PingPayload
		if err := decodePayload(req.Payload, &p); err != nil {
			return nil, err
		}
		return model.PingResult{Echo: p.Echo, CoreVersion: model.CoreVersion}, nil
	default:
		return nil, fmt.Errorf("unknown op %q", req.Op)
	}
}

func decodePayload(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return nil
}

func encode(resp model.Response) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		// Only reachable if a result type can't be marshalled, which is a bug.
		out, _ = json.Marshal(model.Response{ID: resp.ID, Error: fmt.Sprintf("encode response: %v", err)})
	}
	return out
}
