package main

import "path/filepath"

// umbrellaColors are the canopy colors, one frame each (16×12, seen from the
// 3/4 top-down view): red, navy, teal, yellow, and pink (frame 4, Angie's).
var umbrellaColors = [][2]uint8{{cRed, cDarkRed}, {cBlue, cNavy}, {cTeal, cDarkTeal}, {cYellow, cOrange}, {cPink, cRed}}

// genUmbrella draws an open umbrella held over a character's head.
func genUmbrella(assets string) error {
	c := newCanvas(len(umbrellaColors)*16, 12)
	for i, col := range umbrellaColors {
		k := c.cell(i*16, 0)
		k.ellipse(0, 0, 16, 9, col[1]) // canopy rim / shadow side
		k.ellipse(1, 0, 14, 7, col[0]) // canopy
		k.line(4, 1, 2, 7, col[1])     // ribs
		k.line(8, 0, 8, 8, col[1])
		k.line(12, 1, 14, 7, col[1])
		k.set(8, 0, cWhite) // tip and highlight
		k.set(5, 2, cWhite)
		k.rect(8, 8, 1, 4, cDarkGray) // shaft down to the hand
	}
	return c.save(filepath.Join(assets, "chars", "umbrella.png"))
}
