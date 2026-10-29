// Command contentbuild validates the YAML in content/ and writes the JSON
// content bundle the client loads at startup.
//
//	go run ./tools/contentbuild -content content -out web/public/content/base.json
//
// Without -out it only validates. It exits non-zero and lists every problem
// if the content is invalid.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"birdiegogo/core/content"
)

func main() {
	dir := flag.String("content", "content", "content directory")
	out := flag.String("out", "", "output bundle path (validate only if empty)")
	flag.Parse()

	if err := run(*dir, *out); err != nil {
		fmt.Fprintln(os.Stderr, "contentbuild:", err)
		os.Exit(1)
	}
}

func run(dir, out string) error {
	bundle, err := load(dir)
	if err != nil {
		return err
	}
	if errs := content.Validate(bundle); len(errs) > 0 {
		for _, e := range errs {
			fmt.Fprintln(os.Stderr, "  -", e)
		}
		return fmt.Errorf("%d content error(s)", len(errs))
	}
	if out == "" {
		return nil
	}
	data, err := json.Marshal(bundle)
	if err != nil {
		return fmt.Errorf("encode bundle: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return err
	}
	return os.WriteFile(out, data, 0o644)
}

// readOptional reads a YAML file into v; a missing file leaves v unchanged.
func readOptional(path string, v any) error {
	err := readYAML(path, v)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// readDir reads every *.yaml file in dir (sorted by name) with fn.
func readDir(dir string, fn func(path string) error) error {
	paths, err := filepath.Glob(filepath.Join(dir, "*.yaml"))
	if err != nil {
		return err
	}
	for _, p := range paths {
		if err := fn(p); err != nil {
			return err
		}
	}
	return nil
}
