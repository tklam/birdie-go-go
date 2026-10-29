// Command packbuild builds a content update pack for the optional update
// server (SPEC.md §9.6) and registers it in the server's manifest:
//
//	go run ./tools/packbuild -content content -id base -version 1.1.0 -min-client 0.1.0 -out packs
//
// A pack is JSON: {id, version, minClient, content: ContentBundle}. Clients
// merge a pack's content over what they have, overriding entries by id. The
// content is validated before the pack is written; the manifest records the
// pack's size and SHA-256 so clients can verify the download.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"

	"birdiegogo/core/content"
	"birdiegogo/core/model"
)

// Pack is the file format of a content pack.
type Pack struct {
	ID        string              `json:"id"`
	Version   string              `json:"version"`
	MinClient string              `json:"minClient"`
	Content   model.ContentBundle `json:"content"`
}

var semver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func main() {
	bundle := flag.String("bundle", "web/public/content/base.json", "built content bundle (run `make content` first)")
	id := flag.String("id", "base", "pack id")
	version := flag.String("version", "", "pack version (MAJOR.MINOR.PATCH)")
	minClient := flag.String("min-client", "0.1.0", "oldest client version that can use the pack")
	out := flag.String("out", "packs", "server packs directory")
	flag.Parse()
	if err := run(*bundle, *id, *version, *minClient, *out); err != nil {
		fmt.Fprintln(os.Stderr, "packbuild:", err)
		os.Exit(1)
	}
}

func run(bundlePath, id, version, minClient, outDir string) error {
	if !semver.MatchString(version) || !semver.MatchString(minClient) {
		return errors.New("version and min-client must be MAJOR.MINOR.PATCH")
	}
	data, err := os.ReadFile(bundlePath)
	if err != nil {
		return err
	}
	var b model.ContentBundle
	if err := json.Unmarshal(data, &b); err != nil {
		return fmt.Errorf("%s: %w", bundlePath, err)
	}
	if errs := content.Validate(&b); len(errs) > 0 {
		return fmt.Errorf("content is invalid: %v", errs)
	}
	packData, err := json.Marshal(Pack{ID: id, Version: version, MinClient: minClient, Content: b})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	name := fmt.Sprintf("%s-%s.pack", id, version)
	if err := os.WriteFile(filepath.Join(outDir, name), packData, 0o644); err != nil {
		return err
	}
	sum := sha256.Sum256(packData)
	info := model.PackInfo{
		ID: id, Version: version, MinClient: minClient,
		SHA256: hex.EncodeToString(sum[:]), Size: int64(len(packData)), URL: "packs/" + name,
	}
	return register(filepath.Join(outDir, "manifest.json"), info)
}

// register adds or replaces the pack in the manifest (one entry per id: the
// newest build).
func register(path string, info model.PackInfo) error {
	m := model.UpdateManifest{Packs: []model.PackInfo{}}
	data, err := os.ReadFile(path)
	switch {
	case err == nil:
		if err := json.Unmarshal(data, &m); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	case !errors.Is(err, fs.ErrNotExist):
		return err
	}
	out := []model.PackInfo{}
	for _, p := range m.Packs {
		if p.ID != info.ID {
			out = append(out, p)
		}
	}
	m.Packs = append(out, info)
	data, err = json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
