package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// audioRoot holds recorded sound clips, one folder per voice
// (art/audio/oboy/*.mp3; source recordings in src/ are not shipped).
var audioRoot = filepath.Join("art", "audio")

type audioClip struct{ id, file, path string }

// audioClips lists the shipped clips with manifest ids "sfx_<name>".
func audioClips() []audioClip {
	paths, _ := filepath.Glob(filepath.Join(audioRoot, "*", "*.mp3"))
	sort.Strings(paths)
	var out []audioClip
	for _, p := range paths {
		name := strings.TrimSuffix(filepath.Base(p), ".mp3")
		out = append(out, audioClip{id: "sfx_" + name, file: name + ".mp3", path: p})
	}
	return out
}

// genAudio copies the clips into the assets folder.
func genAudio(assets string) error {
	dir := filepath.Join(assets, "audio")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, a := range audioClips() {
		if _, err := copyIfExists(a.path, filepath.Join(dir, a.file)); err != nil {
			return err
		}
	}
	return nil
}
