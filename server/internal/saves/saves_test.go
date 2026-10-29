package saves

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCodes(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		c, err := NewCode()
		if err != nil {
			t.Fatal(err)
		}
		if !ValidCode(c) || seen[c] {
			t.Fatalf("bad or repeated code %q", c)
		}
		seen[c] = true
	}
	for _, bad := range []string{"", "../etc/passwd", "ABCDEFGHJKM", "abcdefghjkmn", "ABCDEFGHJKM0"} {
		if ValidCode(bad) {
			t.Errorf("ValidCode(%q) = true", bad)
		}
	}
}

func TestAPI(t *testing.T) {
	mux := http.NewServeMux()
	Store{Dir: t.TempDir()}.Register(mux)
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		return rec
	}

	rec := do("POST", "/api/save", `{"saveVersion":4,"day":3}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST = %d %s", rec.Code, rec.Body)
	}
	var got struct{ Code string }
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || !ValidCode(got.Code) {
		t.Fatalf("POST body %s", rec.Body)
	}
	tests := []struct {
		name, method, path, body string
		want                     int
		wantBody                 string
	}{
		{"get", "GET", "/api/save/" + got.Code, "", http.StatusOK, `{"saveVersion":4,"day":3}`},
		{"update", "PUT", "/api/save/" + got.Code, `{"saveVersion":4,"day":9}`, http.StatusNoContent, ""},
		{"get updated", "GET", "/api/save/" + got.Code, "", http.StatusOK, `{"saveVersion":4,"day":9}`},
		{"not a save", "PUT", "/api/save/" + got.Code, `{"day":1}`, http.StatusBadRequest, ""},
		{"unknown code", "GET", "/api/save/ABCDEFGHJKMN", "", http.StatusNotFound, ""},
		{"update unknown", "PUT", "/api/save/ABCDEFGHJKMN", `{"saveVersion":4}`, http.StatusNotFound, ""},
		{"bad code", "GET", "/api/save/..%2F..%2Fsecret", "", http.StatusNotFound, ""},
		{"too large", "POST", "/api/save", `{"saveVersion":4,"x":"` + strings.Repeat("a", MaxSave) + `"}`, http.StatusRequestEntityTooLarge, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(tt.method, tt.path, tt.body)
			if rec.Code != tt.want {
				t.Fatalf("%s %s = %d, want %d (%s)", tt.method, tt.path, rec.Code, tt.want, rec.Body)
			}
			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Errorf("body = %s, want %s", rec.Body, tt.wantBody)
			}
		})
	}
}
