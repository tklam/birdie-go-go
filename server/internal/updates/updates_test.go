package updates

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"birdiegogo/core/model"
)

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestHealth(t *testing.T) {
	rec := get(t, NewHandler(t.TempDir(), "*"), "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("CORS origin = %q", got)
	}
}

func TestManifestMissingIsEmpty(t *testing.T) {
	rec := get(t, NewHandler(t.TempDir(), "*"), "/updates/manifest.json")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var m model.UpdateManifest
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if m.Packs == nil || len(m.Packs) != 0 {
		t.Errorf("packs = %#v, want empty list", m.Packs)
	}
}

func TestManifestAndPack(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"packs":[{"id":"base","version":"1.1.0","minClient":"0.1.0","sha256":"abc","size":4,"url":"packs/base-1.1.0.pack"}]}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "base-1.1.0.pack"), []byte("pack"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(dir, "https://game.example")

	rec := get(t, h, "/updates/manifest.json")
	var m model.UpdateManifest
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Packs) != 1 || m.Packs[0].Version != "1.1.0" {
		t.Errorf("manifest = %+v", m)
	}

	rec = get(t, h, "/updates/packs/base-1.1.0.pack")
	if rec.Code != http.StatusOK || rec.Body.String() != "pack" {
		t.Errorf("pack: status %d body %q", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}
}

func TestPackPathCannotEscape(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "packs")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "secret"), []byte("no"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := get(t, NewHandler(dir, "*"), "/updates/packs/../secret")
	if rec.Code == http.StatusOK && rec.Body.String() == "no" {
		t.Fatal("served a file outside the packs directory")
	}
}
