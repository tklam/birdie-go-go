package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// splashArt is the splash poster's source (SPEC.md §1.3): a hand-made SVG
// illustration, the one asset outside the 16-bit look.
var splashArt = filepath.Join("art", "splash", "poster.svg")

func genSplash(assets string) error {
	dir := filepath.Join(assets, "splash")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	ok, err := copyIfExists(splashArt, filepath.Join(dir, "poster.svg"))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("missing %s", splashArt)
	}
	return nil
}
