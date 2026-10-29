// Command assetgen manages placeholder assets.
//
//	go run ./tools/assetgen check -assets web/public/assets
//
// check verifies that every manifest entry points to an existing file.
// Palette validation and placeholder generation (`gen`) arrive in M1.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type entry struct {
	Type string `json:"type"`
	File string `json:"file"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: assetgen check|gen [-assets dir]")
		os.Exit(2)
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	dir := fs.String("assets", "web/public/assets", "assets directory")
	_ = fs.Parse(os.Args[2:])

	var err error
	switch os.Args[1] {
	case "check":
		err = check(*dir)
	case "gen":
		err = errors.New("placeholder generation is not implemented yet (TODO.md M1)")
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "assetgen:", err)
		os.Exit(1)
	}
}

func check(dir string) error {
	data, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest map[string]entry
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("manifest.json: %w", err)
	}
	ids := make([]string, 0, len(manifest))
	for id := range manifest {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var problems int
	for _, id := range ids {
		e := manifest[id]
		if e.File == "" {
			fmt.Fprintf(os.Stderr, "  - %s: missing file\n", id)
			problems++
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, e.File)); err != nil {
			fmt.Fprintf(os.Stderr, "  - %s: %v\n", id, err)
			problems++
		}
	}
	if problems > 0 {
		return fmt.Errorf("%d asset problem(s)", problems)
	}
	return nil
}
