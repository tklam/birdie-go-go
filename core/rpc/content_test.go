package rpc

import (
	"encoding/json"
	"testing"

	"birdiegogo/core/model"
)

func TestContentValidate(t *testing.T) {
	s := NewServer()
	call := func(payload string) model.ContentValidateResult {
		t.Helper()
		var resp struct {
			model.Response
			Result model.ContentValidateResult `json:"result"`
		}
		raw := s.Handle([]byte(`{"id":1,"op":"content.validate","payload":` + payload + `}`))
		if err := json.Unmarshal(raw, &resp); err != nil || !resp.OK {
			t.Fatalf("response %s (%v)", raw, err)
		}
		return resp.Result
	}
	ok := call(`{"game":{"title":"T","contentVersion":"0.1.0","startMap":"world","startSpawn":"s"}}`)
	if len(ok.Errors) != 0 {
		t.Errorf("valid bundle: %v", ok.Errors)
	}
	bad := call(`{"game":{"title":""}}`)
	if len(bad.Errors) == 0 {
		t.Error("invalid bundle reported no errors")
	}
}
