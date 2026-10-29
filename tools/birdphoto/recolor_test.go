package main

import (
	"math"
	"testing"
)

func lch(c lab) (l, chroma, hue float64) {
	h := math.Atan2(c.B, c.A) * 180 / math.Pi
	if h < 0 {
		h += 360
	}
	return c.L, math.Hypot(c.A, c.B), h
}

func fromLCh(l, chroma, hue float64) lab {
	r := hue * math.Pi / 180
	return lab{l, chroma * math.Cos(r), chroma * math.Sin(r)}
}

func TestHueDiff(t *testing.T) {
	tests := []struct{ a, b, want float64 }{
		{10, 350, 20},
		{350, 10, -20},
		{175, 135, 40},
		{0, 180, 180},
		{-90, 90, 180},
		{720, 0, 0},
	}
	for _, tc := range tests {
		if got := hueDiff(tc.a, tc.b); math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("hueDiff(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestHueShiftApply(t *testing.T) {
	greenToTeal := HueShift{From: 135, To: 175, Width: 20, Feather: 40}
	tests := []struct {
		name      string
		shift     HueShift
		in        lab
		wantHue   float64
		wantC     float64
		wantL     float64
		unchanged bool
	}{
		{"center moves fully", greenToTeal, fromLCh(52, 54, 135), 175, 54, 52, false},
		{"flat range keeps hue spread", greenToTeal, fromLCh(52, 54, 120), 160, 54, 52, false},
		{"middle of the feather gets half the rotation", greenToTeal, fromLCh(60, 40, 175), 195, 40, 60, false},
		{"outside the range", greenToTeal, fromLCh(60, 40, 60), 60, 40, 60, true},
		{"beyond the feather", greenToTeal, fromLCh(60, 40, 196), 196, 40, 60, true},
		{"pale beak (low chroma) untouched", greenToTeal, fromLCh(85, 4, 120), 120, 4, 85, true},
		{"dark eye untouched", greenToTeal, fromLCh(8, 2, 140), 140, 2, 8, true},
		{"wraps around 0", HueShift{From: 350, To: 20, Width: 10}, fromLCh(50, 30, 0), 30, 30, 50, false},
		{"chroma and lightness at the center", HueShift{From: 135, To: 175, Chroma: 0.5, Lightness: 10}, fromLCh(50, 60, 135), 175, 30, 60, false},
		{"chroma boost is capped", HueShift{From: 170, To: 175, Chroma: 3, MaxChroma: 35}, fromLCh(50, 14, 170), 175, 35, 50, false},
		{"cap never lowers chroma", HueShift{From: 170, To: 175, Chroma: 3, MaxChroma: 35}, fromLCh(50, 50, 170), 175, 50, 50, false},
		{"boost below the cap", HueShift{From: 170, To: 175, Chroma: 2, MaxChroma: 35}, fromLCh(50, 12, 170), 175, 24, 50, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			out := tc.shift.apply(tc.in)
			if tc.unchanged {
				if out != tc.in {
					t.Errorf("color changed: %v -> %v", tc.in, out)
				}
				return
			}
			l, c, h := lch(out)
			if math.Abs(hueDiff(h, tc.wantHue)) > 1e-6 || math.Abs(c-tc.wantC) > 1e-6 || math.Abs(l-tc.wantL) > 1e-6 {
				t.Errorf("got L %.2f C %.2f h %.2f, want L %.2f C %.2f h %.2f", l, c, h, tc.wantL, tc.wantC, tc.wantHue)
			}
		})
	}
}

// Chroma just above MinChroma gets only part of the rotation, so that
// near-gray pixels change gradually.
func TestHueShiftChromaFade(t *testing.T) {
	s := HueShift{From: 135, To: 175, MinChroma: 10}
	_, _, h := lch(s.apply(fromLCh(50, 15, 135)))
	if math.Abs(h-155) > 1e-6 {
		t.Errorf("hue at chroma 1.5·MinChroma = %.2f, want 155 (half the rotation)", h)
	}
	_, _, h = lch(s.apply(fromLCh(50, 25, 135)))
	if math.Abs(h-175) > 1e-6 {
		t.Errorf("hue at chroma 2.5·MinChroma = %.2f, want 175", h)
	}
}

// A green photo recolored green→teal must quantize to the palette's teal
// colors, while the pale beak and dark eye keep their colors.
func TestRecolorFrameQuantizesToTeal(t *testing.T) {
	green, lightGreen := masterPalette[paletteNames["green"]], masterPalette[paletteNames["light_green"]]
	beak, eye := masterPalette[paletteNames["concrete"]], masterPalette[paletteNames["black"]]
	cols := []struct{ r, g, b uint8 }{
		{green.R, green.G, green.B}, {lightGreen.R, lightGreen.G, lightGreen.B},
		{beak.R, beak.G, beak.B}, {eye.R, eye.G, eye.B},
	}
	f := newFrame(4, 4)
	for i := 0; i < 16; i++ {
		c := cols[i%4]
		f.Alpha[i] = 1
		f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = float64(c.r), float64(c.g), float64(c.b)
	}
	f.Alpha[15] = 0 // transparent pixels are skipped
	f.recolor([]HueShift{{From: 135, To: 177}})
	idx := quantizeFrame(f, quantizeOptions{MaxColors: 15})
	want := []string{"dark_teal", "teal", "concrete", "black"}
	for i := 0; i < 15; i++ {
		if got := idx[i]; got != paletteNames[want[i%4]] {
			t.Errorf("pixel %d: palette index %d, want %s (%d)", i, got, want[i%4], paletteNames[want[i%4]])
		}
	}
	if idx[15] != -1 {
		t.Errorf("transparent pixel quantized to %d", idx[15])
	}
}

func TestRecolorEmptyIsNoop(t *testing.T) {
	f := gradientFrame(8, 8)
	before := append([]float64(nil), f.Pix...)
	f.recolor(nil)
	for i := range before {
		if f.Pix[i] != before[i] {
			t.Fatalf("recolor(nil) changed pixel data at %d", i)
		}
	}
}

func TestTintApply(t *testing.T) {
	teal := Tint{Hue: 178, Chroma: 30, MinL: 25, MaxL: 85}
	tests := []struct {
		name      string
		in        lab
		wantC     float64
		wantHue   float64
		unchanged bool
	}{
		{"pure gray gets the full tint", lab{50, 0, 0}, 30, 178, false},
		{"colorful pixel untouched", fromLCh(50, 40, 60), 0, 0, true},
		{"dark eye untouched", lab{15, 0, 0}, 0, 0, true},
		{"pale beak untouched", fromLCh(90, 8, 50), 0, 0, true},
		{"no chroma configured", lab{50, 0, 0}, 0, 0, true},
	}
	for i, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tn := teal
			if i == len(tests)-1 {
				tn.Chroma = 0
			}
			out := tn.apply(tc.in)
			if tc.unchanged {
				if out != tc.in {
					t.Errorf("color changed: %v -> %v", tc.in, out)
				}
				return
			}
			l, c, h := lch(out)
			if math.Abs(c-tc.wantC) > 1e-6 || math.Abs(hueDiff(h, tc.wantHue)) > 1e-6 || l != tc.in.L {
				t.Errorf("got L %.2f C %.2f h %.2f, want L %.2f C %.2f h %.2f", l, c, h, tc.in.L, tc.wantC, tc.wantHue)
			}
		})
	}
	// A slightly colored gray is pulled part of the way.
	out := teal.apply(fromLCh(50, 15, 178))
	if _, c, _ := lch(out); math.Abs(c-30) > 1e-6 {
		t.Errorf("gray with chroma 15 at the tint hue: chroma %.2f, want 30", c)
	}
}

func TestTintFrameSkipsTransparent(t *testing.T) {
	f := newFrame(2, 1)
	for i := range f.Pix {
		f.Pix[i] = 128
	}
	f.Alpha[0] = 1
	f.tint(&Tint{Hue: 178, Chroma: 30})
	if f.Pix[0] == f.Pix[1] && f.Pix[1] == f.Pix[2] {
		t.Errorf("opaque gray pixel was not tinted: %v", f.Pix[:3])
	}
	if f.Pix[3] != 128 || f.Pix[4] != 128 || f.Pix[5] != 128 {
		t.Errorf("transparent pixel changed: %v", f.Pix[3:])
	}
	f.tint(nil) // no-op
}
