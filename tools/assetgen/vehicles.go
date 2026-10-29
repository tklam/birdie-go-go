package main

import "path/filepath"

// Vehicles seen side-on, facing right (flipped for left), 2 frames each
// (wheels/wake animation): a green-and-cream minibus and a harbour ferry.
func genVehicles(assets string) error {
	bus := newCanvas(2*32, 20)
	for f := range 2 {
		k := bus.cell(f*32, 0)
		k.rect(1, 2, 30, 13, cGreen) // green body
		k.rect(1, 2, 30, 5, cSand)   // cream roof band
		k.rect(26, 3, 5, 5, cWindow) // windscreen
		for x := 4; x < 24; x += 6 {
			k.rect(x, 3, 5, 4, cWindow)
		}
		k.rect(1, 10, 30, 1, cDarkGreen)
		k.rect(28, 11, 3, 2, cYellow) // headlight
		k.rect(3, 9, 6, 3, cWhite)    // route sign
		k.set(5, 10, cRed)
		for _, x := range []int{7, 24} {
			k.ellipse(x-3, 13, 7, 7, cBlack)
			k.set(x, 16-f, cGray) // turning hub
		}
	}
	if err := bus.save(filepath.Join(assets, "vehicles", "minibus.png")); err != nil {
		return err
	}
	ferry := newCanvas(2*48, 24)
	for f := range 2 {
		k := ferry.cell(f*48, 0)
		k.rect(10, 4, 26, 8, cWhite) // cabin
		for x := 12; x < 34; x += 5 {
			k.rect(x, 6, 3, 3, cWindow)
		}
		k.rect(18, 1, 4, 4, cRed)    // funnel
		k.rect(2, 12, 44, 6, cWhite) // hull
		k.line(2, 12, 46, 12, cNavy)
		k.rect(4, 18, 40, 2, cNavy)
		k.line(46, 12, 40, 19, cNavy) // bow
		for x := 0; x < 48; x += 4 {
			k.rect(x+(f*2)%4, 21, 2, 1, cPaleSky) // wake
		}
	}
	if err := ferry.save(filepath.Join(assets, "vehicles", "ferry.png")); err != nil {
		return err
	}
	// Kei's gateway pad: a glowing ring with a digital shimmer (2 frames).
	pad := newCanvas(2*16, 16)
	for f := range 2 {
		k := pad.cell(f*16, 0)
		k.ellipse(1, 5, 14, 10, cNavy)
		k.ellipse(2, 6, 12, 8, cTeal)
		k.ellipse(4, 7, 8, 6, cPaleSky)
		for i := range 4 {
			x := 3 + int(hash3(i, f, 70)%10)
			y := int(hash3(i, f, 71) % 6)
			k.rect(x, y, 1, 3, cSky)
		}
	}
	if err := pad.save(filepath.Join(assets, "vehicles", "gateway.png")); err != nil {
		return err
	}
	// A hidden collectible's twinkle: a small four-point star (2 frames).
	spark := newCanvas(2*8, 8)
	for f := range 2 {
		k := spark.cell(f*8, 0)
		r := 3 - f
		k.rect(4-r, 4, 2*r-1+1, 1, cYellow)
		k.rect(4, 4-r, 1, 2*r-1+1, cYellow)
		k.set(4, 4, cWhite)
		if f == 0 {
			k.set(3, 3, cPaleSky)
			k.set(5, 5, cPaleSky)
		}
	}
	return spark.save(filepath.Join(assets, "vehicles", "sparkle.png"))
}
