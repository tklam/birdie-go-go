package rpc

import (
	"encoding/json"
	"testing"

	"birdiegogo/core/model"
)

func TestHandle(t *testing.T) {
	tests := []struct {
		name      string
		in        string
		wantID    int
		wantOK    bool
		wantEcho  string
		wantError bool
	}{
		{name: "ping", in: `{"id":1,"op":"ping","payload":{"echo":"chirp"}}`, wantID: 1, wantOK: true, wantEcho: "chirp"},
		{name: "ping without payload", in: `{"id":2,"op":"ping"}`, wantID: 2, wantOK: true},
		{name: "unknown op", in: `{"id":3,"op":"fly"}`, wantID: 3, wantError: true},
		{name: "bad payload", in: `{"id":4,"op":"ping","payload":{"echo":5}}`, wantID: 4, wantError: true},
		{name: "not json", in: `chirp`, wantError: true},
		{name: "empty", in: ``, wantError: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var resp struct {
				model.Response
				Result model.PingResult `json:"result"`
			}
			if err := json.Unmarshal(Handle([]byte(tt.in)), &resp); err != nil {
				t.Fatalf("response is not JSON: %v", err)
			}
			if resp.ID != tt.wantID {
				t.Errorf("id = %d, want %d", resp.ID, tt.wantID)
			}
			if resp.OK != tt.wantOK {
				t.Errorf("ok = %v, want %v", resp.OK, tt.wantOK)
			}
			if (resp.Error != "") != tt.wantError {
				t.Errorf("error = %q, want error: %v", resp.Error, tt.wantError)
			}
			if tt.wantOK {
				if resp.Result.Echo != tt.wantEcho {
					t.Errorf("echo = %q, want %q", resp.Result.Echo, tt.wantEcho)
				}
				if resp.Result.CoreVersion != model.CoreVersion {
					t.Errorf("coreVersion = %q, want %q", resp.Result.CoreVersion, model.CoreVersion)
				}
			}
		})
	}
}
