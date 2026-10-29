// Package updates serves content-pack updates for the optional update server:
// the manifest at /updates/manifest.json and pack files under /updates/packs/.
// The game never requires this server; it only checks it when configured.
package updates

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"birdiegogo/core/model"
)

// NewHandler returns the server's HTTP handler. packsDir holds manifest.json
// and the pack files; allowOrigin is the CORS origin allowed to read them.
// extra registers more routes on the same mux (e.g. cloud saves).
func NewHandler(packsDir, allowOrigin string, extra ...func(*http.ServeMux)) http.Handler {
	mux := http.NewServeMux()
	for _, register := range extra {
		register(mux)
	}
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /updates/manifest.json", func(w http.ResponseWriter, _ *http.Request) {
		manifest, err := readManifest(filepath.Join(packsDir, "manifest.json"))
		if err != nil {
			http.Error(w, "manifest unavailable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, manifest)
	})
	// os.DirFS rejects paths that escape packsDir.
	packs := http.StripPrefix("/updates/packs/", http.FileServerFS(os.DirFS(packsDir)))
	mux.Handle("GET /updates/packs/", immutable(packs))
	return cors(allowOrigin, mux)
}

// readManifest returns an empty manifest if the file doesn't exist yet.
func readManifest(path string) (model.UpdateManifest, error) {
	m := model.UpdateManifest{Packs: []model.PackInfo{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return m, nil
	}
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, err
	}
	if m.Packs == nil {
		m.Packs = []model.PackInfo{}
	}
	return m, nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// immutable marks pack files as cacheable forever: packs are versioned, so a
// changed pack always gets a new file name.
func immutable(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		next.ServeHTTP(w, r)
	})
}

func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
