package main

import (
	"fmt"
	"image"
	"image/color"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// checkFrames applies the same 16-bit rules as `assetgen check` to every
// fw×fh cell of img: opaque pixels use master-palette colors, alpha is binary,
// and each cell uses at most 15 colors plus transparency.
func checkFrames(img image.Image, fw, fh int) []string {
	allowed := map[color.NRGBA]bool{}
	for _, c := range masterPalette {
		allowed[c] = true
	}
	var problems []string
	b := img.Bounds()
	if b.Dx()%fw != 0 || b.Dy()%fh != 0 {
		return []string{fmt.Sprintf("image size %v is not a whole number of %d×%d frames", b.Size(), fw, fh)}
	}
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

// checkDir verifies every output in dir: <species>.png sheets (192×32, six
// 32×32 frames) and album_<species>.png portraits (96×64, one frame).
func checkDir(dir string) error {
	files, err := filepath.Glob(filepath.Join(dir, "*.png"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	if len(files) == 0 {
		return fmt.Errorf("no PNG files in %s", dir)
	}
	var problems []string
	for _, f := range files {
		img, err := readImage(f)
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", f, err))
			continue
		}
		name := filepath.Base(f)
		size := img.Bounds().Size()
		fw, fh, want := frameSize, frameSize, image.Pt(frameSize*len(poseOrder), frameSize)
		if strings.HasPrefix(name, "album_") {
			fw, fh, want = albumW, albumH, image.Pt(albumW, albumH)
		}
		if size != want {
			problems = append(problems, fmt.Sprintf("%s: size %v, want %v", name, size, want))
			continue
		}
		for _, p := range checkFrames(img, fw, fh) {
			problems = append(problems, name+": "+p)
		}
	}
	for _, p := range problems {
		fmt.Fprintln(os.Stderr, "  -", p)
	}
	if len(problems) > 0 {
		return fmt.Errorf("%d problem(s)", len(problems))
	}
	fmt.Printf("checked %d file(s): OK\n", len(files))
	return nil
}
