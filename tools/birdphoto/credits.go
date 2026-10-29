package main

import (
	"fmt"
	"io"
	"sort"
	"strings"
)

// writeCredits prints the CREDITS.md section for each named species: one
// entry per source photo with its author, licence, source page and the
// frames made from it (derived frames count for the photo they copy).
func writeCredits(w io.Writer, src *Sources, species []string, names map[string]string) error {
	for _, id := range species {
		sp := src.Species[id]
		if sp == nil {
			return fmt.Errorf("unknown species %q", id)
		}
		type use struct {
			credit Credit
			file   string
			uses   []string
		}
		byFile := map[string]*use{}
		add := func(file string, c Credit, what string) {
			u := byFile[file]
			if u == nil {
				u = &use{credit: c, file: file}
				byFile[file] = u
			}
			u.uses = append(u.uses, what)
		}
		for _, pose := range poseOrder {
			p := sp.Poses[pose]
			if p == nil {
				continue
			}
			src, what := p, pose
			if p.From != "" {
				src = sp.Poses[p.From]
				if src == nil {
					return fmt.Errorf("%s %s: from unknown pose %q", id, pose, p.From)
				}
				what += " (copy of " + p.From
				if p.FlipX {
					what += ", mirrored"
				}
				what += ")"
			} else if p.FlipX {
				what += " (mirrored)"
			}
			add(src.File, src.Credit, what)
		}
		if sp.Album != nil {
			add(sp.Album.File, sp.Album.Credit, "album portrait")
		}
		files := make([]string, 0, len(byFile))
		for f := range byFile {
			files = append(files, f)
		}
		sort.Strings(files)
		name := names[id]
		if name == "" {
			name = id
		}
		fmt.Fprintf(w, "## %s (`%s`)\n\n", name, id)
		for _, f := range files {
			u := byFile[f]
			fmt.Fprintf(w, "- **%s** (`%s`)\n", strings.TrimPrefix(u.credit.Title, "File:"), u.file)
			fmt.Fprintf(w, "  - Author: %s\n", u.credit.Author)
			if u.credit.LicenseURL != "" {
				fmt.Fprintf(w, "  - License: [%s](%s)\n", u.credit.License, u.credit.LicenseURL)
			} else {
				fmt.Fprintf(w, "  - License: %s\n", u.credit.License)
			}
			fmt.Fprintf(w, "  - Source: <%s>\n", u.credit.Page)
			fmt.Fprintf(w, "  - Used for: %s\n\n", strings.Join(u.uses, ", "))
		}
	}
	return nil
}
