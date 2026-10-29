package main

import (
	"image/color"
	"math"
)

// masterPalette is a copy of the master palette in tools/assetgen/palette.go
// (SPEC.md §1.3), without the transparent entry at index 0. The order matches
// assetgen's indices 1..38. TestPaletteMatchesAssetgen keeps the two in sync.
var masterPalette = []color.NRGBA{
	hex(0x101018), // 1 black
	hex(0x3a3a4a), // 2 dark gray
	hex(0x6e6e80), // 3 gray
	hex(0xa8a8b8), // 4 light gray
	hex(0xf0f0f0), // 5 white
	hex(0xf2c9a0), // 6 skin
	hex(0xd09a78), // 7 skin shadow
	hex(0x3b2418), // 8 dark brown (hair)
	hex(0x6b4226), // 9 brown
	hex(0xa8784a), // 10 tan
	hex(0xe0c890), // 11 sand
	hex(0xc83c3c), // 12 red
	hex(0x7a1e28), // 13 dark red
	hex(0xe88a2c), // 14 orange
	hex(0xf0d050), // 15 yellow
	hex(0x1e5a32), // 16 dark green
	hex(0x3c8c3c), // 17 green
	hex(0x78c058), // 18 light green
	hex(0xb0e080), // 19 pale green
	hex(0x3fbf9f), // 20 teal
	hex(0x2a8a78), // 21 dark teal
	hex(0x3f7fdf), // 22 blue
	hex(0x1b2a4a), // 23 navy
	hex(0x8cc8f0), // 24 sky
	hex(0xc8e8f8), // 25 pale sky
	hex(0x2e6ea8), // 26 sea
	hex(0x4a9ac8), // 27 light sea
	hex(0xb8b0a0), // 28 concrete
	hex(0x8a8478), // 29 dark concrete
	hex(0xe890a8), // 30 pink
	hex(0x7a5aa8), // 31 purple
	hex(0x4a4a52), // 32 asphalt
	hex(0xe8e0c8), // 33 road line
	hex(0xb06048), // 34 brick
	hex(0x6aa8d0), // 35 window
	hex(0x6e7428), // 36 olive
	hex(0xb4b840), // 37 yellow-green
	hex(0x9a4424), // 38 chestnut
}

// paletteNames maps readable names (used in sources.yaml) to masterPalette
// indices.
var paletteNames = map[string]int{
	"black": 0, "dark_gray": 1, "gray": 2, "light_gray": 3, "white": 4,
	"skin": 5, "skin_shadow": 6, "dark_brown": 7, "brown": 8, "tan": 9,
	"sand": 10, "red": 11, "dark_red": 12, "orange": 13, "yellow": 14,
	"dark_green": 15, "green": 16, "light_green": 17, "pale_green": 18,
	"teal": 19, "dark_teal": 20, "blue": 21, "navy": 22, "sky": 23,
	"pale_sky": 24, "sea": 25, "light_sea": 26, "concrete": 27,
	"dark_concrete": 28, "pink": 29, "purple": 30, "asphalt": 31,
	"road_line": 32, "brick": 33, "window": 34, "olive": 35, "yellow_green": 36,
	"chestnut": 37,
}

func hex(v uint32) color.NRGBA {
	return color.NRGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}
}

// lab is a CIE L*a*b* color (D65).
type lab struct{ L, A, B float64 }

func (p lab) dist2(q lab) float64 {
	dl, da, db := p.L-q.L, p.A-q.A, p.B-q.B
	return dl*dl + da*da + db*db
}

func (p lab) dist(q lab) float64 { return math.Sqrt(p.dist2(q)) }

func srgbToLinear(v float64) float64 {
	if v <= 0.04045 {
		return v / 12.92
	}
	return math.Pow((v+0.055)/1.055, 2.4)
}

func linearToSRGB(v float64) float64 {
	if v <= 0.0031308 {
		return 12.92 * v
	}
	return 1.055*math.Pow(v, 1/2.4) - 0.055
}

const (
	whiteX = 0.95047
	whiteY = 1.0
	whiteZ = 1.08883
)

func labF(t float64) float64 {
	if t > 216.0/24389.0 {
		return math.Cbrt(t)
	}
	return (24389.0/27.0*t + 16) / 116
}

func labFInv(t float64) float64 {
	if t3 := t * t * t; t3 > 216.0/24389.0 {
		return t3
	}
	return (116*t - 16) / (24389.0 / 27.0)
}

// rgbToLab converts 8-bit-range sRGB components (0..255, may be fractional).
func rgbToLab(r, g, b float64) lab {
	rl, gl, bl := srgbToLinear(r/255), srgbToLinear(g/255), srgbToLinear(b/255)
	x := 0.4124564*rl + 0.3575761*gl + 0.1804375*bl
	y := 0.2126729*rl + 0.7151522*gl + 0.0721750*bl
	z := 0.0193339*rl + 0.1191920*gl + 0.9503041*bl
	fx, fy, fz := labF(x/whiteX), labF(y/whiteY), labF(z/whiteZ)
	return lab{116*fy - 16, 500 * (fx - fy), 200 * (fy - fz)}
}

// labToRGB converts back to sRGB components in 0..255 (clamped).
func labToRGB(c lab) (r, g, b float64) {
	fy := (c.L + 16) / 116
	fx := fy + c.A/500
	fz := fy - c.B/200
	x, y, z := labFInv(fx)*whiteX, labFInv(fy)*whiteY, labFInv(fz)*whiteZ
	rl := 3.2404542*x - 1.5371385*y - 0.4985314*z
	gl := -0.9692660*x + 1.8760108*y + 0.0415560*z
	bl := 0.0556434*x - 0.2040259*y + 1.0572252*z
	conv := func(v float64) float64 {
		return math.Max(0, math.Min(255, 255*linearToSRGB(math.Max(0, v))))
	}
	return conv(rl), conv(gl), conv(bl)
}

func nrgbaToLab(c color.NRGBA) lab { return rgbToLab(float64(c.R), float64(c.G), float64(c.B)) }

// paletteLab holds masterPalette in Lab, index-aligned.
var paletteLab = func() []lab {
	out := make([]lab, len(masterPalette))
	for i, c := range masterPalette {
		out[i] = nrgbaToLab(c)
	}
	return out
}()
