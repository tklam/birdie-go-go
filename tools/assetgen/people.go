package main

import "path/filepath"

// genPhotographer draws the back view of a birder at a tripod, for the
// foreground of photo sessions: 2 frames of 32×48 (idle, shutter flash).
func genPhotographer(assets string) error {
	c := newCanvas(2*32, 48)
	for f := range 2 {
		k := c.cell(f*32, 0)
		k.rect(13, 24, 1, 24, cDarkGray) // tripod legs
		k.line(14, 24, 6, 47, cDarkGray)
		k.line(14, 24, 22, 47, cDarkGray)
		k.rect(10, 14, 14, 18, cDarkGreen) // vest
		k.rect(12, 16, 3, 3, cTan)
		k.rect(19, 16, 3, 3, cTan)
		k.rect(10, 32, 14, 12, cTan) // trousers
		k.rect(10, 44, 5, 4, cBrown)
		k.rect(19, 44, 5, 4, cBrown)
		k.ellipse(11, 2, 12, 13, cDarkBrown) // head from behind
		k.rect(9, 3, 16, 3, cTan)            // bucket hat
		k.rect(11, 0, 12, 4, cTan)
		k.rect(4, 15, 7, 4, cDarkGreen) // arms raised to the camera
		k.rect(23, 15, 6, 4, cDarkGreen)
		k.rect(2, 12, 6, 6, cBlack) // camera body and long lens
		k.rect(26, 12, 6, 6, cBlack)
		k.rect(24, 13, 2, 4, cDarkGray)
		if f == 1 {
			k.rect(28, 10, 3, 2, cWhite) // shutter glint
			k.set(31, 9, cYellow)
		}
	}
	return c.save(filepath.Join(assets, "chars", "photographer_back.png"))
}
