package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"sort"
)

// check verifies the manifest and the 16-bit rules: every opaque pixel uses a
// master-palette color, and each frame (or tile, or whole image) uses at most
// 15 colors plus transparency.
func check(dir string) error {
	data, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest map[string]manifestEntry
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("manifest.json: %w", err)
	}
	ids := make([]string, 0, len(manifest))
	for id := range manifest {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	for _, id := range ids {
		e := manifest[id]
		switch e.Type {
		case "background":
			for _, l := range e.Layers {
				if manifest[l].Type != "image" {
					report("%s: layer %q is not an image entry", id, l)
				}
			}
			continue
		case "audio", "illustration":
			// Illustrations (the splash poster) are full-resolution art for
			// the HTML overlay, exempt from the 16-bit palette rules.
			if _, err := os.Stat(filepath.Join(dir, e.File)); err != nil {
				report("%s: %v", id, err)
			}
			continue
		case "image", "spritesheet":
		default:
			report("%s: unknown type %q", id, e.Type)
			continue
		}
		img, err := readPNG(filepath.Join(dir, e.File))
		if err != nil {
			report("%s: %v", id, err)
			continue
		}
		fw, fh := img.Bounds().Dx(), img.Bounds().Dy()
		if e.Type == "spritesheet" {
			fw, fh = e.FrameWidth, e.FrameHeight
			if fw <= 0 || fh <= 0 || img.Bounds().Dx()%fw != 0 || img.Bounds().Dy()%fh != 0 {
				report("%s: image size %v is not a whole number of %d×%d frames", id, img.Bounds().Size(), fw, fh)
				continue
			}
		}
		for _, p := range checkFrames(img, fw, fh) {
			report("%s: %s", id, p)
		}
	}
	for _, p := range problems {
		fmt.Fprintln(os.Stderr, "  -", p)
	}
	if len(problems) > 0 {
		return fmt.Errorf("%d asset problem(s)", len(problems))
	}
	return nil
}

func readPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

// checkFrames applies the palette rules to each fw×fh cell of img.
func checkFrames(img image.Image, fw, fh int) []string {
	allowed := map[color.NRGBA]bool{}
	for _, c := range palette[1:] {
		allowed[c.(color.NRGBA)] = true
	}
	var problems []string
	b := img.Bounds()
	for fy := b.Min.Y; fy < b.Max.Y; fy += fh {
		for fx := b.Min.X; fx < b.Max.X; fx += fw {
			used := map[color.NRGBA]bool{}
			var bad int
			for y := fy; y < fy+fh; y++ {
				for x := fx; x < fx+fw; x++ {
					c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
					if c.A == 0 {
						continue
					}
					if c.A != 255 || !allowed[c] {
						bad++
						continue
					}
					used[c] = true
				}
			}
			frame := fmt.Sprintf("frame at (%d,%d)", fx-b.Min.X, fy-b.Min.Y)
			if bad > 0 {
				problems = append(problems, fmt.Sprintf("%s: %d pixel(s) outside the master palette or semi-transparent", frame, bad))
			}
			if len(used) > 15 {
				problems = append(problems, fmt.Sprintf("%s: %d colors (max 15 + transparent)", frame, len(used)))
			}
		}
	}
	return problems
}
