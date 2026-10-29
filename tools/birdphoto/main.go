// Command birdphoto turns licensed bird photos into 16-bit style sprite
// sheets and album portraits that follow the master-palette rules
// (SPEC.md §1.3).
//
//	go run ./tools/birdphoto -sources art/birds/sources.yaml -out art/birds/out
//	go run ./tools/birdphoto -check art/birds/out
//
// For each species, sources.yaml names a photo, crop and cutout settings for
// each of the six poses. The tool removes the background (flood fill from
// the crop border with a Lab color tolerance), scales the bird into a 32×32
// frame with area averaging, quantizes it to ≤15 master-palette colors and
// writes <species>.png (192×32, frames in poseOrder) and album_<species>.png
// (96×64 portrait with background).
package main

import (
	"bytes"
	"flag"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	frameSize = 32
	albumW    = 96
	albumH    = 64
)

// poseOrder is the frame order of the bird sprite sheets (manifest.json).
var poseOrder = []string{"perched", "perched_alert", "wings_spread", "flying1", "flying2", "back_turned"}

// Sources is the schema of art/birds/sources.yaml.
type Sources struct {
	Species map[string]*Species `yaml:"species"`
}

// Species lists the photo used for each pose and the album portrait.
type Species struct {
	Album *Album           `yaml:"album"`
	Poses map[string]*Pose `yaml:"poses"`
}

// Credit is the attribution copied from candidates.json.
type Credit struct {
	Candidate  string `yaml:"candidate"`
	Title      string `yaml:"title"`
	Page       string `yaml:"page"`
	Author     string `yaml:"author"`
	License    string `yaml:"license"`
	LicenseURL string `yaml:"licenseUrl"`
}

// Pose describes how one sprite frame is cut from a photo. Coordinates are
// source-photo pixels.
type Pose struct {
	File   string `yaml:"file"`
	Crop   []int  `yaml:"crop"` // x, y, w, h
	FlipX  bool   `yaml:"flipX"`
	Credit `yaml:",inline"`
	Note   string `yaml:"note,omitempty"`

	// Background removal.
	Tolerance float64     `yaml:"tolerance"` // Lab ΔE to the nearest border color (default 14)
	Step      float64     `yaml:"step"`      // optional neighbor-step flooding (default off)
	Clusters  int         `yaml:"clusters"`  // border colors (default 6)
	MinShare  float64     `yaml:"minShare"`  // ignore border colors below this share (default 0.03)
	Blur      *int        `yaml:"blur"`      // box-blur radius for color measurement (default 1)
	Seeds     [][]int     `yaml:"seeds"`     // extra background seed points [x, y]
	Keep      [][]float64 `yaml:"keep"`      // polygons [x1,y1,x2,y2,...] always kept
	Drop      [][]float64 `yaml:"drop"`      // polygons always removed
	Enclosed  int         `yaml:"enclosed"`  // remove enclosed background-colored regions ≥ this area
	Erode     *int        `yaml:"erode"`     // fringe erosion (default 1)
	KeepParts float64     `yaml:"keepParts"` // keep components ≥ this fraction of the largest
	Sides     []bool      `yaml:"sides"`     // border sides that seed the fill [top,right,bottom,left]

	// Framing and color.
	Anchor     string   `yaml:"anchor"`  // bottom | center (default: bottom for perched poses)
	Size       int      `yaml:"size"`    // long side of the bird in pixels (default 28)
	OffsetX    int      `yaml:"offsetX"` // nudge in frame pixels
	OffsetY    int      `yaml:"offsetY"`
	AlphaCut   float64  `yaml:"alphaCut"`   // coverage threshold (default 0.5)
	Saturation float64  `yaml:"saturation"` // chroma multiplier (default 1.15)
	Contrast   float64  `yaml:"contrast"`   // lightness contrast (default 1.1)
	Brightness float64  `yaml:"brightness"` // lightness offset
	Outline    string   `yaml:"outline"`    // palette color name or "none" (default black)
	Colors     int      `yaml:"colors"`     // max colors incl. outline (default 12, at most 15)
	Require    []string `yaml:"require"`    // palette color names forced into the set
	Dither     float64  `yaml:"dither"`     // ordered-dither amplitude (default 0)
	Despeckle  float64  `yaml:"despeckle"`  // max ΔE of isolated pixels to clean up (default 25, <0 = off)
	NoLevels   bool     `yaml:"noLevels"`   // skip the automatic lightness stretch
	Sharpen    *float64 `yaml:"sharpen"`    // unsharp-mask amount on lightness (default 0.6)
}

// Album describes the portrait crop (background kept).
type Album struct {
	File       string `yaml:"file"`
	Crop       []int  `yaml:"crop"` // x, y, w, h; trimmed to 3:2 around its center
	FlipX      bool   `yaml:"flipX"`
	Credit     `yaml:",inline"`
	Saturation float64  `yaml:"saturation"` // default 1.1
	Contrast   float64  `yaml:"contrast"`   // default 1.05
	Brightness float64  `yaml:"brightness"`
	Dither     float64  `yaml:"dither"` // default 0
	Colors     int      `yaml:"colors"` // default 15
	Require    []string `yaml:"require"`
}

func main() {
	sources := flag.String("sources", "art/birds/sources.yaml", "sources.yaml path")
	out := flag.String("out", "art/birds/out", "output directory")
	check := flag.String("check", "", "only check the PNGs in this directory against the palette rules")
	debug := flag.String("debug", "", "optional directory for cutout debug images")
	only := flag.String("species", "", "only process this species")
	flag.Parse()

	if *check != "" {
		if err := checkDir(*check); err != nil {
			fmt.Fprintln(os.Stderr, "birdphoto check:", err)
			os.Exit(1)
		}
		return
	}
	if err := run(*sources, *out, *debug, *only); err != nil {
		fmt.Fprintln(os.Stderr, "birdphoto:", err)
		os.Exit(1)
	}
	if err := checkDir(*out); err != nil {
		fmt.Fprintln(os.Stderr, "birdphoto check:", err)
		os.Exit(1)
	}
}

func loadSources(path string) (*Sources, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var s Sources
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &s, nil
}

func run(sourcesPath, outDir, debugDir, only string) error {
	src, err := loadSources(sourcesPath)
	if err != nil {
		return err
	}
	base := filepath.Dir(sourcesPath)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	if debugDir != "" {
		if err := os.MkdirAll(debugDir, 0o755); err != nil {
			return err
		}
	}
	names := make([]string, 0, len(src.Species))
	for n := range src.Species {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		if only != "" && name != only {
			continue
		}
		sp := src.Species[name]
		for p := range sp.Poses {
			if !contains(poseOrder, p) {
				return fmt.Errorf("%s: unknown pose %q", name, p)
			}
		}
		sheet := image.NewNRGBA(image.Rect(0, 0, frameSize*len(poseOrder), frameSize))
		for i, pose := range poseOrder {
			p := sp.Poses[pose]
			if p == nil {
				return fmt.Errorf("%s: missing pose %q", name, pose)
			}
			idx, err := renderPose(filepath.Join(base, p.File), pose, p, debugPath(debugDir, name+"_"+pose))
			if err != nil {
				return fmt.Errorf("%s %s: %w", name, pose, err)
			}
			drawIndexed(sheet, idx, frameSize, frameSize, i*frameSize, 0)
		}
		if err := writePNG(filepath.Join(outDir, name+".png"), sheet); err != nil {
			return err
		}
		if sp.Album == nil {
			return fmt.Errorf("%s: missing album", name)
		}
		album, err := renderAlbum(filepath.Join(base, sp.Album.File), sp.Album)
		if err != nil {
			return fmt.Errorf("%s album: %w", name, err)
		}
		if err := writePNG(filepath.Join(outDir, "album_"+name+".png"), album); err != nil {
			return err
		}
		fmt.Printf("wrote %s.png and album_%s.png\n", name, name)
	}
	return nil
}

func debugPath(dir, name string) string {
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, name+".png")
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func cropRect(c []int, b image.Rectangle) (image.Rectangle, error) {
	if len(c) == 0 {
		return b, nil
	}
	if len(c) != 4 || c[2] <= 0 || c[3] <= 0 {
		return image.Rectangle{}, fmt.Errorf("crop must be [x, y, w, h], got %v", c)
	}
	r := image.Rect(c[0], c[1], c[0]+c[2], c[1]+c[3]).Intersect(b)
	if r.Empty() {
		return image.Rectangle{}, fmt.Errorf("crop %v is outside the image %v", c, b)
	}
	return r, nil
}

func polygons(in [][]float64, off image.Point) ([][]fpoint, error) {
	var out [][]fpoint
	for _, flat := range in {
		if len(flat) < 6 || len(flat)%2 != 0 {
			return nil, fmt.Errorf("polygon needs ≥3 x,y pairs, got %v", flat)
		}
		var poly []fpoint
		for i := 0; i < len(flat); i += 2 {
			poly = append(poly, fpoint{flat[i] - float64(off.X), flat[i+1] - float64(off.Y)})
		}
		out = append(out, poly)
	}
	return out, nil
}

func orDefault(v, d float64) float64 {
	if v == 0 {
		return d
	}
	return v
}

func intOr(p *int, d int) int {
	if p == nil {
		return d
	}
	return *p
}

func colorIndices(names []string) ([]int, error) {
	var out []int
	for _, n := range names {
		i, ok := paletteNames[n]
		if !ok {
			return nil, fmt.Errorf("unknown palette color %q", n)
		}
		out = append(out, i)
	}
	return out, nil
}

// renderPose produces the 32×32 frame (palette indices, -1 transparent).
func renderPose(path, pose string, p *Pose, debug string) ([]int, error) {
	img, err := readImage(path)
	if err != nil {
		return nil, err
	}
	r, err := cropRect(p.Crop, img.Bounds())
	if err != nil {
		return nil, err
	}
	crop := fromImage(img, r)
	keep, err := polygons(p.Keep, r.Min)
	if err != nil {
		return nil, err
	}
	drop, err := polygons(p.Drop, r.Min)
	if err != nil {
		return nil, err
	}
	var seeds []image.Point
	for _, s := range p.Seeds {
		if len(s) != 2 {
			return nil, fmt.Errorf("seed must be [x, y], got %v", s)
		}
		seeds = append(seeds, image.Pt(s[0], s[1]).Sub(r.Min))
	}
	mask := cutout(crop, cutoutParams{
		Tolerance:  orDefault(p.Tolerance, 14),
		Step:       p.Step,
		Clusters:   p.Clusters,
		MinShare:   p.MinShare,
		Blur:       intOr(p.Blur, 1),
		Seeds:      seeds,
		Keep:       keep,
		Drop:       drop,
		Enclosed:   p.Enclosed,
		Erode:      intOr(p.Erode, 1),
		KeepParts:  p.KeepParts,
		BorderMask: p.Sides,
	})
	if debug != "" {
		if err := writeDebug(debug, crop, mask); err != nil {
			return nil, err
		}
	}
	bounds := maskBounds(crop.W, crop.H, mask)
	if bounds.Empty() {
		return nil, fmt.Errorf("cutout is empty (tolerance too high?)")
	}

	outline := p.Outline
	if outline == "" {
		outline = "black"
	}
	pad := 1
	if outline == "none" {
		pad = 0
	}
	size := p.Size
	if size == 0 {
		size = 28
		if strings.HasPrefix(pose, "flying") || pose == "wings_spread" {
			size = 30
		}
	}
	size = min(size, frameSize-2*pad)
	ow, oh := fitSize(bounds.Dx(), bounds.Dy(), size)
	small := downscale(crop, mask, bounds, ow, oh)
	small.threshold(orDefault(p.AlphaCut, 0.5))
	if !p.NoLevels {
		small.autoLevels(12, 94)
	}
	small.adjust(orDefault(p.Saturation, 1.15), orDefault(p.Contrast, 1.1), p.Brightness)
	sharp := 0.6
	if p.Sharpen != nil {
		sharp = *p.Sharpen
	}
	small.sharpen(sharp)
	if p.FlipX {
		small.flipX()
	}
	anchor := p.Anchor
	if anchor == "" {
		anchor = "center"
		if pose == "perched" || pose == "perched_alert" || pose == "back_turned" {
			anchor = "bottom"
		}
	}
	frame := placeInFrame(small, frameSize, frameSize, anchor, pad, p.OffsetX, p.OffsetY)

	forced, err := colorIndices(p.Require)
	if err != nil {
		return nil, err
	}
	outlineIdx := -1
	if outline != "none" {
		i, ok := paletteNames[outline]
		if !ok {
			return nil, fmt.Errorf("unknown outline color %q", outline)
		}
		outlineIdx = i
		forced = append([]int{i}, forced...)
	}
	colors := p.Colors
	if colors <= 0 {
		colors = 12
	}
	colors = min(colors, 15)
	idx := quantizeFrame(frame, quantizeOptions{MaxColors: colors, Forced: forced, Dither: p.Dither})
	if de := orDefault(p.Despeckle, 25); de > 0 {
		idx = despeckle(idx, frameSize, frameSize, de)
	}
	if outlineIdx >= 0 {
		idx = addOutline(idx, frameSize, frameSize, outlineIdx)
	}
	return idx, nil
}

// renderAlbum produces the 96×64 portrait.
func renderAlbum(path string, a *Album) (*image.NRGBA, error) {
	img, err := readImage(path)
	if err != nil {
		return nil, err
	}
	r, err := cropRect(a.Crop, img.Bounds())
	if err != nil {
		return nil, err
	}
	r = trimAspect(r, albumW, albumH)
	full := fromImage(img, r)
	small := downscale(full, nil, image.Rect(0, 0, full.W, full.H), albumW, albumH)
	small.adjust(orDefault(a.Saturation, 1.1), orDefault(a.Contrast, 1.05), a.Brightness)
	if a.FlipX {
		small.flipX()
	}
	forced, err := colorIndices(a.Require)
	if err != nil {
		return nil, err
	}
	colors := a.Colors
	if colors <= 0 || colors > 15 {
		colors = 15
	}
	idx := quantizeFrame(small, quantizeOptions{MaxColors: colors, Forced: forced, Dither: a.Dither})
	out := image.NewNRGBA(image.Rect(0, 0, albumW, albumH))
	drawIndexed(out, idx, albumW, albumH, 0, 0)
	return out, nil
}

// trimAspect shrinks r around its center to the aspect ratio w:h.
func trimAspect(r image.Rectangle, w, h int) image.Rectangle {
	rw, rh := r.Dx(), r.Dy()
	if rw*h > rh*w {
		nw := rh * w / h
		x0 := r.Min.X + (rw-nw)/2
		return image.Rect(x0, r.Min.Y, x0+nw, r.Max.Y)
	}
	nh := rw * h / w
	y0 := r.Min.Y + (rh-nh)/2
	return image.Rect(r.Min.X, y0, r.Max.X, y0+nh)
}

func readImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return img, nil
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return fmt.Errorf("%s: %w", path, err)
	}
	return f.Close()
}

// writeDebug saves the crop with the removed background tinted magenta.
func writeDebug(path string, crop *rgbImage, mask []bool) error {
	out := image.NewNRGBA(image.Rect(0, 0, crop.W, crop.H))
	for y := 0; y < crop.H; y++ {
		for x := 0; x < crop.W; x++ {
			r, g, b := crop.at(x, y)
			if !mask[y*crop.W+x] {
				r, g, b = (r+255*2)/3, g/3, (b+255*2)/3
			}
			out.SetNRGBA(x, y, color.NRGBA{uint8(r), uint8(g), uint8(b), 255})
		}
	}
	return writePNG(path, out)
}
