// Package saves stores cloud saves for the optional server (SPEC.md §9.6).
// There are no accounts: a save lives under a random sync code, which is
// both its name and its key. The game never requires this.
package saves

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// MaxSave is the largest save accepted, in bytes.
const MaxSave = 2 << 20

// codeAlphabet avoids look-alike characters (no 0/O, 1/I/L).
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// codeLen gives ~59 bits of randomness.
const codeLen = 12

var codeRe = regexp.MustCompile(`^[2-9A-HJKMNP-Z]{12}$`)

// ErrBadSave is a body that isn't a save.
var ErrBadSave = errors.New("not a save")

// Store keeps saves as <code>.json files in a directory.
type Store struct {
	Dir string
}

// NewCode returns a fresh random sync code.
func NewCode() (string, error) {
	b := make([]byte, codeLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("sync code: %w", err)
	}
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b), nil
}

// ValidCode reports whether s looks like a sync code (so it's safe as a file name).
func ValidCode(s string) bool {
	return codeRe.MatchString(s)
}

// check accepts a JSON object with a numeric saveVersion.
func check(data []byte) error {
	var v struct {
		SaveVersion *float64 `json:"saveVersion"`
	}
	if err := json.Unmarshal(data, &v); err != nil || v.SaveVersion == nil {
		return ErrBadSave
	}
	return nil
}

// Put writes a save atomically.
func (s Store) Put(code string, data []byte) error {
	if !ValidCode(code) {
		return fmt.Errorf("put %q: %w", code, os.ErrNotExist)
	}
	if err := check(data); err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return fmt.Errorf("put: %w", err)
	}
	tmp, err := os.CreateTemp(s.Dir, ".save-*")
	if err != nil {
		return fmt.Errorf("put: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return fmt.Errorf("put: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("put: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(s.Dir, code+".json")); err != nil {
		return fmt.Errorf("put: %w", err)
	}
	return nil
}

// Get reads a save.
func (s Store) Get(code string) ([]byte, error) {
	if !ValidCode(code) {
		return nil, fmt.Errorf("get %q: %w", code, os.ErrNotExist)
	}
	data, err := os.ReadFile(filepath.Join(s.Dir, code+".json"))
	if err != nil {
		return nil, fmt.Errorf("get: %w", err)
	}
	return data, nil
}

// Register adds the cloud-save API to mux:
//
//	POST /api/save         body: save → {"code": "..."} (a new code)
//	PUT  /api/save/{code}  body: save → 204 (the code must exist)
//	GET  /api/save/{code}  → the save
func (s Store) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/save", func(w http.ResponseWriter, r *http.Request) {
		data, ok := readBody(w, r)
		if !ok {
			return
		}
		code, err := NewCode()
		if err == nil {
			err = s.Put(code, data)
		}
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	})
	mux.HandleFunc("PUT /api/save/{code}", func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")
		if _, err := s.Get(code); err != nil {
			fail(w, err)
			return
		}
		data, ok := readBody(w, r)
		if !ok {
			return
		}
		if err := s.Put(code, data); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/save/{code}", func(w http.ResponseWriter, r *http.Request) {
		data, err := s.Get(r.PathValue("code"))
		if err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
	})
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxSave))
	if err != nil {
		http.Error(w, "save too large", http.StatusRequestEntityTooLarge)
		return nil, false
	}
	return data, true
}

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		http.Error(w, "no save with that code", http.StatusNotFound)
	case errors.Is(err, ErrBadSave):
		http.Error(w, "not a save", http.StatusBadRequest)
	default:
		http.Error(w, "save store unavailable", http.StatusInternalServerError)
	}
}
