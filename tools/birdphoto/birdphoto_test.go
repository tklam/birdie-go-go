package main

import (
	"image"
	"image/color"
	"math"
	"os"
	"regexp"
	"strconv"
	"testing"
)

// The palette here is a copy of tools/assetgen/palette.go; keep them equal.
func TestPaletteMatchesAssetgen(t *testing.T) {
	src, err := os.ReadFile("../assetgen/palette.go")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`hex\(0x([0-9a-fA-F]{6})\),\s*//\s*(\d+)`)
	m := re.FindAllStringSubmatch(string(src), -1)
	if len(m) != len(masterPalette) {
		t.Fatalf("assetgen has %d palette colors, birdphoto has %d", len(m), len(masterPalette))
	}
	for i, sub := range m {
		v, _ := strconv.ParseUint(sub[1], 16, 32)
		if idx, _ := strconv.Atoi(sub[2]); idx != i+1 {
			t.Errorf("assetgen entry %d is labeled index %d", i+1, idx)
		}
		if got, want := masterPalette[i], hex(uint32(v)); got != want {
			t.Errorf("color %d: birdphoto %v, assetgen %v", i+1, got, want)
		}
	}
	if len(paletteNames) != len(masterPalette) {
		t.Errorf("paletteNames has %d entries, want %d", len(paletteNames), len(masterPalette))
	}
}

func TestLabRoundTrip(t *testing.T) {
	for _, c := range masterPalette {
		r, g, b := labToRGB(nrgbaToLab(c))
		if math.Abs(r-float64(c.R)) > 0.5 || math.Abs(g-float64(c.G)) > 0.5 || math.Abs(b-float64(c.B)) > 0.5 {
			t.Errorf("%v round-trips to %.1f,%.1f,%.1f", c, r, g, b)
		}
	}
}

// gradientFrame is a w×h opaque frame with a smooth rainbow, which needs
// far more than 15 colors.
func gradientFrame(w, h int) *rgbaFrame {
	f := newFrame(w, h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			f.Alpha[i] = 1
			f.Pix[3*i] = float64(x * 255 / (w - 1))
			f.Pix[3*i+1] = float64(y * 255 / (h - 1))
			f.Pix[3*i+2] = float64((x + y) * 255 / (w + h - 2))
		}
	}
	return f
}

func TestQuantizeFrameLimits(t *testing.T) {
	tests := []struct {
		name   string
		max    int
		forced []int
		dither float64
	}{
		{"15 colors", 15, nil, 0},
		{"8 colors with outline", 8, []int{paletteNames["black"]}, 0},
		{"dithered", 15, nil, 24},
		{"single", 1, nil, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := gradientFrame(32, 32)
			f.Alpha[0] = 0 // one transparent pixel
			idx := quantizeFrame(f, quantizeOptions{MaxColors: tc.max, Forced: tc.forced, Dither: tc.dither})
			used := map[int]bool{}
			for i, p := range idx {
				if f.Alpha[i] == 0 {
					if p != -1 {
						t.Fatalf("transparent pixel %d mapped to %d", i, p)
					}
					continue
				}
				if p < 0 || p >= len(masterPalette) {
					t.Fatalf("pixel %d has invalid palette index %d", i, p)
				}
				used[p] = true
			}
			if len(used) > tc.max {
				t.Errorf("used %d colors, max %d", len(used), tc.max)
			}
			if tc.max > 1 && len(used) < 2 {
				t.Errorf("used only %d colors for a rainbow", len(used))
			}
			set := chooseColors([]weightedLab{{rgbToLab(255, 0, 0), 1}}, tc.forced, tc.max)
			for _, f := range tc.forced {
				found := false
				for _, s := range set {
					found = found || s == f
				}
				if !found {
					t.Errorf("forced color %d missing from %v", f, set)
				}
			}
		})
	}
}

func TestChooseColorsPicksExactPaletteColors(t *testing.T) {
	// Three exact palette colors must be reproduced exactly.
	want := []int{paletteNames["red"], paletteNames["white"], paletteNames["navy"]}
	var samples []weightedLab
	for _, p := range want {
		samples = append(samples, weightedLab{paletteLab[p], 10})
	}
	got := chooseColors(samples, nil, 15)
	if len(got) != 3 {
		t.Fatalf("got %v, want exactly the 3 sample colors", got)
	}
	for _, p := range want {
		if nearestIn(paletteLab[p], got) != p {
			t.Errorf("color %d not reproduced (set %v)", p, got)
		}
	}
}

// syntheticBird draws a red ellipse ("bird") with a dark eye and a tiny
// background-colored hole on a blue-to-cyan gradient, plus a separate small
// red speck that must be discarded.
func syntheticBird() (*rgbImage, func(x, y int) bool) {
	w, h := 80, 60
	img := newRGB(w, h)
	inBird := func(x, y int) bool {
		dx, dy := (float64(x)+0.5-40)/24, (float64(y)+0.5-30)/14
		return dx*dx+dy*dy <= 1
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b := 40.0, 90+float64(x), 200.0 // background gradient
			switch {
			case x >= 5 && x < 8 && y >= 5 && y < 8:
				r, g, b = 220, 40, 40 // speck
			case inBird(x, y) && x >= 38 && x < 40 && y >= 29 && y < 31:
				r, g, b = 40, 90+float64(x), 200 // hole with background color
			case inBird(x, y) && x >= 55 && x < 57 && y >= 26 && y < 28:
				r, g, b = 10, 10, 10 // eye
			case inBird(x, y):
				r, g, b = 220, 40, 40
			}
			img.set(x, y, r, g, b)
		}
	}
	return img, inBird
}

func TestCutoutSynthetic(t *testing.T) {
	img, inBird := syntheticBird()
	mask := cutout(img, cutoutParams{Tolerance: 14, Blur: 0, Erode: 0})
	var wrong, birdPx int
	for y := 0; y < img.H; y++ {
		for x := 0; x < img.W; x++ {
			if inBird(x, y) {
				birdPx++
			}
			if mask[y*img.W+x] != inBird(x, y) {
				wrong++
			}
		}
	}
	if wrong > 0 {
		t.Errorf("%d of %d pixels misclassified", wrong, img.W*img.H)
	}
	if mask[6*img.W+6] {
		t.Error("separate speck was kept")
	}
	if !mask[29*img.W+38] {
		t.Error("small enclosed hole was not filled")
	}

	// Erosion removes exactly the 1-px fringe.
	eroded := cutout(img, cutoutParams{Tolerance: 14, Erode: 1})
	n := 0
	for _, v := range eroded {
		if v {
			n++
		}
	}
	if n >= birdPx || n < birdPx*3/4 {
		t.Errorf("eroded mask has %d pixels, bird has %d", n, birdPx)
	}
}

func TestCutoutOverrides(t *testing.T) {
	img, _ := syntheticBird()
	// Drop the right half of the bird; keep a block of background.
	drop := [][]fpoint{{{40, 0}, {80, 0}, {80, 60}, {40, 60}}}
	keep := [][]fpoint{{{10, 25}, {17, 25}, {17, 35}, {10, 35}}}
	mask := cutout(img, cutoutParams{Tolerance: 14, Drop: drop, Keep: keep, KeepParts: 0.01})
	if mask[30*img.W+50] {
		t.Error("pixel inside drop polygon is foreground")
	}
	if !mask[30*img.W+30] {
		t.Error("bird pixel outside drop polygon was removed")
	}
	if !mask[30*img.W+12] {
		t.Error("pixel inside keep polygon is background")
	}
}

func TestPointInPolygon(t *testing.T) {
	sq := []fpoint{{0, 0}, {10, 0}, {10, 10}, {0, 10}}
	tests := []struct {
		p    fpoint
		want bool
	}{
		{fpoint{5, 5}, true},
		{fpoint{11, 5}, false},
		{fpoint{-1, -1}, false},
		{fpoint{9.9, 0.1}, true},
	}
	for _, tc := range tests {
		if got := pointInPolygon(tc.p, sq); got != tc.want {
			t.Errorf("pointInPolygon(%v) = %v, want %v", tc.p, got, tc.want)
		}
	}
}

func TestFitSize(t *testing.T) {
	tests := []struct{ w, h, size, ow, oh int }{
		{300, 150, 28, 28, 14},
		{150, 300, 28, 14, 28},
		{500, 500, 30, 30, 30},
		{1000, 10, 28, 28, 1},
	}
	for _, tc := range tests {
		ow, oh := fitSize(tc.w, tc.h, tc.size)
		if ow != tc.ow || oh != tc.oh {
			t.Errorf("fitSize(%d,%d,%d) = %d,%d, want %d,%d", tc.w, tc.h, tc.size, ow, oh, tc.ow, tc.oh)
		}
	}
}

func TestDownscaleAreaAverage(t *testing.T) {
	// Left half white (opaque), right half masked out: a 2× downscale of a
	// 4-wide image gives full coverage on the left, none on the right, and a
	// 1-px output gives 50% coverage with pure white color (premultiplied).
	img := newRGB(4, 2)
	mask := make([]bool, 8)
	for y := 0; y < 2; y++ {
		for x := 0; x < 4; x++ {
			img.set(x, y, 255, 255, 255)
			mask[y*4+x] = x < 2
			if x >= 2 {
				img.set(x, y, 0, 0, 0)
			}
		}
	}
	f := downscale(img, mask, image.Rect(0, 0, 4, 2), 2, 1)
	if f.Alpha[0] != 1 || f.Alpha[1] != 0 {
		t.Errorf("alpha = %v, want [1 0]", f.Alpha)
	}
	one := downscale(img, mask, image.Rect(0, 0, 4, 2), 1, 1)
	if math.Abs(one.Alpha[0]-0.5) > 1e-9 || one.Pix[0] != 255 {
		t.Errorf("1-px downscale: alpha %v color %v, want 0.5 and 255", one.Alpha[0], one.Pix[0])
	}
	// Non-integer ratio: 3 → 2 keeps total coverage.
	img3 := newRGB(3, 1)
	g := downscale(img3, nil, image.Rect(0, 0, 3, 1), 2, 1)
	if g.Alpha[0] != 1 || g.Alpha[1] != 1 {
		t.Errorf("opaque 3→2 downscale alpha %v", g.Alpha)
	}
}

func blob(w, h int) *rgbaFrame {
	f := newFrame(w, h)
	for i := range f.Alpha {
		f.Alpha[i] = 1
	}
	return f
}

func opaqueBounds(f *rgbaFrame) image.Rectangle {
	var r image.Rectangle
	first := true
	for y := 0; y < f.H; y++ {
		for x := 0; x < f.W; x++ {
			if f.Alpha[y*f.W+x] > 0 {
				p := image.Rect(x, y, x+1, y+1)
				if first {
					r, first = p, false
				} else {
					r = r.Union(p)
				}
			}
		}
	}
	return r
}

func TestPlaceInFrame(t *testing.T) {
	tests := []struct {
		name   string
		w, h   int
		anchor string
		pad    int
		want   image.Rectangle
	}{
		{"bottom with outline pad", 20, 10, "bottom", 1, image.Rect(6, 21, 26, 31)},
		{"bottom without pad", 20, 10, "bottom", 0, image.Rect(6, 22, 26, 32)},
		{"center", 20, 10, "center", 1, image.Rect(6, 11, 26, 21)},
		{"center odd", 7, 9, "center", 1, image.Rect(12, 11, 19, 20)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := opaqueBounds(placeInFrame(blob(tc.w, tc.h), 32, 32, tc.anchor, tc.pad, 0, 0))
			if got != tc.want {
				t.Errorf("bounds %v, want %v", got, tc.want)
			}
		})
	}
}

func TestOutlineAndFlip(t *testing.T) {
	idx := make([]int, 25)
	for i := range idx {
		idx[i] = -1
	}
	idx[12] = paletteNames["white"] // center of 5×5
	out := addOutline(idx, 5, 5, paletteNames["black"])
	n := 0
	for _, p := range out {
		if p == paletteNames["black"] {
			n++
		}
	}
	if n != 4 {
		t.Errorf("outline has %d pixels, want 4", n)
	}

	f := newFrame(3, 1)
	f.Alpha[0] = 1
	f.Pix[0] = 200
	f.flipX()
	if f.Alpha[2] != 1 || f.Alpha[0] != 0 || f.Pix[6] != 200 {
		t.Errorf("flipX did not mirror: alpha %v pix %v", f.Alpha, f.Pix)
	}
}

func TestDespeckleKeepsStrongDetails(t *testing.T) {
	white, light, black := paletteNames["white"], paletteNames["road_line"], paletteNames["black"]
	idx := make([]int, 9)
	for i := range idx {
		idx[i] = white
	}
	idx[4] = light
	if got := despeckle(idx, 3, 3, 25)[4]; got != white {
		t.Errorf("near-white speck kept as %d", got)
	}
	idx[4] = black
	if got := despeckle(idx, 3, 3, 25)[4]; got != black {
		t.Errorf("black eye pixel replaced by %d", got)
	}
}

func TestTrimAspect(t *testing.T) {
	tests := []struct{ in, want image.Rectangle }{
		{image.Rect(0, 0, 300, 100), image.Rect(75, 0, 225, 100)},
		{image.Rect(0, 0, 300, 400), image.Rect(0, 100, 300, 300)},
		{image.Rect(10, 10, 106, 74), image.Rect(10, 10, 106, 74)},
	}
	for _, tc := range tests {
		if got := trimAspect(tc.in, albumW, albumH); got != tc.want {
			t.Errorf("trimAspect(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestCheckFrames(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 64, 32))
	// Frame 0: 15 palette colors → OK. Frame 1: 16 colors plus a
	// semi-transparent and an off-palette pixel → 2 problems.
	for i := 0; i < 15; i++ {
		img.SetNRGBA(i, 0, masterPalette[i])
	}
	for i := 0; i < 16; i++ {
		img.SetNRGBA(32+i, 0, masterPalette[i])
	}
	img.SetNRGBA(40, 5, color.NRGBA{masterPalette[0].R, masterPalette[0].G, masterPalette[0].B, 128})
	img.SetNRGBA(41, 5, color.NRGBA{1, 2, 3, 255})
	probs := checkFrames(img, 32, 32)
	if len(probs) != 2 {
		t.Fatalf("got %d problems %v, want 2 (both in frame 1)", len(probs), probs)
	}
	for _, p := range probs {
		if p[:len("frame at (32,0)")] != "frame at (32,0)" {
			t.Errorf("problem in wrong frame: %s", p)
		}
	}
}

// TestRenderPoseSynthetic runs the whole sprite path on a synthetic photo
// and checks the 16-bit rules.
func TestRenderPoseSynthetic(t *testing.T) {
	src, _ := syntheticBird()
	img := image.NewNRGBA(image.Rect(0, 0, src.W, src.H))
	for y := 0; y < src.H; y++ {
		for x := 0; x < src.W; x++ {
			r, g, b := src.at(x, y)
			img.SetNRGBA(x, y, color.NRGBA{uint8(r), uint8(g), uint8(b), 255})
		}
	}
	path := t.TempDir() + "/bird.png"
	if err := writePNG(path, img); err != nil {
		t.Fatal(err)
	}
	idx, err := renderPose(path, "perched", &Pose{}, "")
	if err != nil {
		t.Fatal(err)
	}
	sheet := image.NewNRGBA(image.Rect(0, 0, frameSize, frameSize))
	drawIndexed(sheet, idx, frameSize, frameSize, 0, 0)
	if probs := checkFrames(sheet, frameSize, frameSize); len(probs) > 0 {
		t.Errorf("rule violations: %v", probs)
	}
	f := newFrame(frameSize, frameSize)
	for i, p := range idx {
		if p >= 0 {
			f.Alpha[i] = 1
		}
	}
	b := opaqueBounds(f)
	if b.Max.Y != frameSize {
		t.Errorf("perched sprite (with outline) should touch the bottom row, bounds %v", b)
	}
	if b.Dx() != 30 {
		t.Errorf("sprite width with outline = %d, want 28+2", b.Dx())
	}
}
