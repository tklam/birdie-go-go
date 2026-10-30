package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// TestCommittedMapsMatch fails when the maps in content/ differ from what
// mapgen generates, so hand edits to the .tmj files can't drift from it.
func TestCommittedMapsMatch(t *testing.T) {
	tmp := t.TempDir()
	if err := generate(t, tmp); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join("..", "..", "content")
	for _, dir := range []string{"world", "interiors"} {
		generated, err := filepath.Glob(filepath.Join(tmp, dir, "*"))
		if err != nil {
			t.Fatal(err)
		}
		if len(generated) == 0 {
			t.Fatalf("mapgen wrote nothing to %s", dir)
		}
		for _, g := range generated {
			name := filepath.Join(dir, filepath.Base(g))
			want, err := os.ReadFile(g)
			if err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Errorf("content/%s: %v (run `make maps`)", name, err)
				continue
			}
			if !bytes.Equal(got, want) {
				t.Errorf("content/%s differs from mapgen's output: change tools/mapgen and run `make maps`", name)
			}
		}
	}
}

// TestDeterministic generates twice and expects identical bytes.
func TestDeterministic(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	for _, d := range []string{a, b} {
		if err := generate(t, d); err != nil {
			t.Fatal(err)
		}
	}
	files, _ := filepath.Glob(filepath.Join(a, "*", "*.tmj"))
	for _, f := range files {
		rel, _ := filepath.Rel(a, f)
		x, _ := os.ReadFile(f)
		y, err := os.ReadFile(filepath.Join(b, rel))
		if err != nil || !bytes.Equal(x, y) {
			t.Errorf("%s differs between runs", rel)
		}
	}
}

// generate runs mapgen into dir/world (and dir/interiors).
func generate(t *testing.T, dir string) error {
	t.Helper()
	world := filepath.Join(dir, "world")
	if err := os.MkdirAll(world, 0o755); err != nil {
		return err
	}
	return run(world, true)
}
