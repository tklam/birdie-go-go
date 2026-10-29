package main

import "path/filepath"

// Enemy art (SPEC.md §4.13): 16×16 overworld sheets (frames: idle, move) and
// 48×48 encounter portraits (frames: idle, attack). Original designs.
var enemyArt = []struct {
	id       string
	overland func(k cell, frame int)
	portrait func(k cell, frame int)
}{
	{"stray_dog", drawDog, drawDogPortrait},
	{"hopping_zombie", drawZombie, drawZombiePortrait},
	{"water_ghost", drawGhost, drawGhostPortrait},
}

func genEnemies(assets string) error {
	for _, e := range enemyArt {
		ow := newCanvas(2*16, 16)
		pt := newCanvas(2*48, 48)
		for f := range 2 {
			e.overland(ow.cell(f*16, 0), f)
			e.portrait(pt.cell(f*48, 0), f)
		}
		if err := ow.save(filepath.Join(assets, "enemies", e.id+".png")); err != nil {
			return err
		}
		if err := pt.save(filepath.Join(assets, "enemies", "portrait_"+e.id+".png")); err != nil {
			return err
		}
	}
	return nil
}

func drawDog(k cell, f int) {
	k.ellipse(2, 6, 11, 6, cBrown)  // body
	k.ellipse(9, 3, 6, 6, cBrown)   // head
	k.rect(13, 6, 2, 2, cDarkBrown) // snout
	k.set(14, 6, cBlack)            // nose
	k.set(11, 5, cBlack)            // eye
	k.rect(9, 2, 2, 2, cDarkBrown)  // ear
	k.line(1, 7, 0, 4+f, cBrown)    // tail
	legs := [][2]int{{3, 11}, {5, 11}, {9, 11}, {11, 11}}
	for i, l := range legs {
		dy := 0
		if f == 1 && i%2 == 0 {
			dy = -1
		}
		k.rect(l[0], l[1]+dy, 1, 4, cDarkBrown)
	}
}

func drawDogPortrait(k cell, f int) {
	dx := 0
	if f == 1 {
		dx = 4 // lunging
	}
	k.ellipse(4+dx, 18, 30, 16, cBrown)
	k.ellipse(6+dx, 24, 22, 8, cTan)
	k.ellipse(26+dx, 8, 18, 17, cBrown)
	k.rect(38+dx, 16, 8, 6, cTan)
	k.rect(43+dx, 16, 3, 3, cBlack)
	k.rect(31+dx, 12, 3, 3, cBlack)
	k.set(32+dx, 12, cWhite)
	k.rect(27+dx, 4, 5, 6, cDarkBrown)
	if f == 1 {
		k.rect(38+dx, 22, 7, 3, cDarkRed)
		k.set(40+dx, 22, cWhite)
		k.set(43+dx, 22, cWhite)
	}
	for _, x := range []int{8, 14, 26, 32} {
		k.rect(x+dx, 32, 4, 14, cDarkBrown)
	}
	k.line(4+dx, 22, 0+dx, 12, cBrown)
	k.line(5+dx, 22, 1+dx, 12, cBrown)
}

func drawZombie(k cell, f int) {
	dy := 0
	if f == 1 {
		dy = -2 // mid-hop
	}
	k.rect(4, 6+dy, 8, 8, cNavy)      // Qing-style robe
	k.rect(4, 9+dy, 8, 1, cDarkTeal)  // sash
	k.rect(5, 2+dy, 6, 5, cPaleGreen) // pale face
	k.rect(4, 1+dy, 8, 2, cBlack)     // hat
	k.rect(7, 2+dy, 2, 4, cYellow)    // paper talisman
	k.set(7, 3+dy, cRed)
	k.rect(12, 7+dy, 4, 2, cNavy)      // arms stretched forward
	k.rect(15, 7+dy, 1, 2, cPaleGreen) // hands
	k.rect(5, 14+dy, 2, 2, cBlack)
	k.rect(9, 14+dy, 2, 2, cBlack)
}

func drawZombiePortrait(k cell, f int) {
	dy := 0
	if f == 1 {
		dy = -6
	}
	k.rect(12, 18+dy, 22, 24, cNavy)
	k.rect(12, 28+dy, 22, 3, cDarkTeal)
	k.rect(16, 18+dy, 14, 2, cPurple)
	k.rect(14, 4+dy, 18, 15, cPaleGreen)
	k.rect(12, 0+dy, 22, 6, cBlack)
	k.rect(16, 0+dy, 14, 2, cDarkGray)
	k.rect(20, 4+dy, 6, 12, cYellow)
	k.line(21, 6+dy, 24, 6+dy, cRed)
	k.line(22, 8+dy, 22, 13+dy, cRed)
	k.line(24, 9+dy, 24, 12+dy, cRed)
	k.rect(16, 10+dy, 3, 2, cDarkGray)
	k.rect(28, 10+dy, 3, 2, cDarkGray)
	k.rect(34, 20+dy, 14, 5, cNavy)
	k.rect(44, 19+dy, 4, 7, cPaleGreen)
	k.rect(14, 42+dy, 6, 6, cBlack)
	k.rect(26, 42+dy, 6, 6, cBlack)
}

func drawGhost(k cell, f int) {
	sway := 0
	if f == 1 {
		sway = 1
	}
	k.ellipse(3+sway, 1, 10, 9, cPaleSky) // head
	k.rect(3+sway, 1, 10, 4, cBlack)      // long wet hair
	k.rect(3+sway, 5, 2, 7, cBlack)
	k.rect(11+sway, 5, 2, 7, cBlack)
	k.ellipse(3, 8, 10, 8, cLightSea) // robe fading into mist
	k.speckle(2, 12, 12, 4, cPaleSky, 0.5, uint32(40+f))
	k.set(6+sway, 6, cBlack)
	k.set(9+sway, 6, cBlack)
}

func drawGhostPortrait(k cell, f int) {
	sway := 0
	if f == 1 {
		sway = 4
	}
	k.ellipse(12+sway, 2, 24, 22, cPaleSky)
	k.rect(10+sway, 0, 28, 8, cBlack)
	k.rect(10+sway, 8, 5, 26, cBlack)
	k.rect(33+sway, 8, 5, 26, cBlack)
	k.rect(18+sway, 12, 4, 3, cBlack)
	k.rect(27+sway, 12, 4, 3, cBlack)
	k.line(20+sway, 19, 28+sway, 19, cSea)
	k.ellipse(8, 20, 32, 26, cLightSea)
	k.speckle(4, 34, 40, 14, cPaleSky, 0.45, uint32(50+f))
	k.speckle(4, 40, 40, 8, cSea, 0.2, uint32(60+f))
	if f == 1 {
		k.rect(2, 22, 8, 3, cLightSea)
		k.rect(0, 21, 3, 5, cPaleSky)
	}
}
