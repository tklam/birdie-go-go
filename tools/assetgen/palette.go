package main

import (
	"fmt"
	"image/color"
	"os"
	"strings"
)

// Master palette (SPEC.md §1.3). Index 0 is transparent. Every placeholder
// asset is drawn with these colors only; `assetgen check` enforces it for all
// assets, including final art.
var palette = color.Palette{
	color.NRGBA{0, 0, 0, 0}, // 0 transparent
	hex(0x101018),           // 1 black
	hex(0x3a3a4a),           // 2 dark gray
	hex(0x6e6e80),           // 3 gray
	hex(0xa8a8b8),           // 4 light gray
	hex(0xf0f0f0),           // 5 white
	hex(0xf2c9a0),           // 6 skin
	hex(0xd09a78),           // 7 skin shadow
	hex(0x3b2418),           // 8 dark brown (hair)
	hex(0x6b4226),           // 9 brown
	hex(0xa8784a),           // 10 tan
	hex(0xe0c890),           // 11 sand
	hex(0xc83c3c),           // 12 red
	hex(0x7a1e28),           // 13 dark red
	hex(0xe88a2c),           // 14 orange
	hex(0xf0d050),           // 15 yellow
	hex(0x1e5a32),           // 16 dark green
	hex(0x3c8c3c),           // 17 green
	hex(0x78c058),           // 18 light green
	hex(0xb0e080),           // 19 pale green
	hex(0x3fbf9f),           // 20 teal
	hex(0x2a8a78),           // 21 dark teal
	hex(0x3f7fdf),           // 22 blue
	hex(0x1b2a4a),           // 23 navy
	hex(0x8cc8f0),           // 24 sky
	hex(0xc8e8f8),           // 25 pale sky
	hex(0x2e6ea8),           // 26 sea
	hex(0x4a9ac8),           // 27 light sea
	hex(0xb8b0a0),           // 28 concrete
	hex(0x8a8478),           // 29 dark concrete
	hex(0xe890a8),           // 30 pink
	hex(0x7a5aa8),           // 31 purple
	hex(0x4a4a52),           // 32 asphalt
	hex(0xe8e0c8),           // 33 road line
	hex(0xb06048),           // 34 brick
	hex(0x6aa8d0),           // 35 window
}

// Palette indices by name, for readable drawing code.
const (
	cClear = iota
	cBlack
	cDarkGray
	cGray
	cLightGray
	cWhite
	cSkin
	cSkinShadow
	cDarkBrown
	cBrown
	cTan
	cSand
	cRed
	cDarkRed
	cOrange
	cYellow
	cDarkGreen
	cGreen
	cLightGreen
	cPaleGreen
	cTeal
	cDarkTeal
	cBlue
	cNavy
	cSky
	cPaleSky
	cSea
	cLightSea
	cConcrete
	cDarkConcrete
	cPink
	cPurple
	cAsphalt
	cRoadLine
	cBrick
	cWindow
)

func hex(v uint32) color.NRGBA {
	return color.NRGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}
}

// writeGPL writes the palette in GIMP/Aseprite .gpl format so artists can
// load it.
func writeGPL(path string) error {
	var b strings.Builder
	b.WriteString("GIMP Palette\nName: Birdie Go Go\nColumns: 8\n#\n")
	for i, c := range palette[1:] {
		n := c.(color.NRGBA)
		fmt.Fprintf(&b, "%3d %3d %3d\tcolor %d\n", n.R, n.G, n.B, i+1)
	}
	return os.WriteFile(path, []byte(b.String()), 0o644)
}
