package main

import "path/filepath"

// look describes a character's placeholder colors and shape.
type look struct {
	id                 string
	hair, top, bottom  uint8
	skin, shoes        uint8
	skirt, glasses     bool
	pigtails, grayHair bool
	shorter            int // rows shaved off the legs (children)
}

// People besides Angie (who has her own drawing): 4×4 sheets of 16×24
// frames like hers (rows down/left/right/up; columns idle, walk1–3).
var people = []look{
	{id: "mei", hair: cBlack, top: cYellow, bottom: cOrange, skin: cSkin, shoes: cRed, skirt: true, pigtails: true, shorter: 3},
	{id: "kei", hair: cBlack, top: cNavy, bottom: cBlue, skin: cSkin, shoes: cWhite, glasses: true},
	{id: "neighbour", hair: cLightGray, top: cPurple, bottom: cDarkGray, skin: cSkin, shoes: cBlack, grayHair: true},
	{id: "old_villager", hair: cWhite, top: cTan, bottom: cBrown, skin: cSkinShadow, shoes: cBlack, grayHair: true},
}

func genPeople(assets string) error {
	for _, p := range people {
		c := newCanvas(4*16, 4*24)
		for dir := range 4 {
			for f := range 4 {
				drawPerson(c.cell(f*16, dir*24), p, dir, f)
			}
		}
		if err := c.save(filepath.Join(assets, "chars", p.id+".png")); err != nil {
			return err
		}
	}
	return nil
}

func drawPerson(k cell, p look, dir, frame int) {
	top := p.shorter // shift the whole body down for shorter characters
	lLeg, rLeg := 0, 0
	switch frame {
	case 1:
		lLeg = -1
	case 3:
		rLeg = -1
	}
	legTop := 19
	k.rect(6, legTop+lLeg, 2, 4, p.bottom)
	k.rect(9, legTop+rLeg, 2, 4, p.bottom)
	k.rect(6, 22+lLeg, 2, 2, p.shoes)
	k.rect(9, 22+rLeg, 2, 2, p.shoes)
	if p.skirt {
		k.rect(5, 16, 7, 4, p.bottom)
	}
	k.rect(5, 10+top, 7, 7-top+1, p.top)
	swing := 0
	if frame == 1 {
		swing = 1
	} else if frame == 3 {
		swing = -1
	}
	switch dir {
	case dirDown, dirUp:
		k.rect(3, 11+top+swing, 2, 5-top/2, p.top)
		k.rect(12, 11+top-swing, 2, 5-top/2, p.top)
		k.set(3, 15+swing, p.skin)
		k.set(12, 15-swing, p.skin)
	case dirLeft:
		k.rect(7, 11+top+swing, 2, 5, p.skin)
	case dirRight:
		k.rect(8, 11+top+swing, 2, 5, p.skin)
	}
	hy := 1 + top
	k.ellipse(3, hy, 11, 9, p.hair)
	switch dir {
	case dirDown:
		k.rect(5, hy+3, 7, 6, p.skin)
		k.rect(5, hy+2, 7, 2, p.hair)
		k.set(6, hy+5, cBlack)
		k.set(10, hy+5, cBlack)
		if p.glasses {
			k.line(5, hy+5, 11, hy+5, cDarkGray)
			k.set(6, hy+5, cBlack)
			k.set(10, hy+5, cBlack)
		}
		if p.grayHair {
			k.line(6, hy+8, 10, hy+8, cSkinShadow)
		}
	case dirLeft:
		k.rect(3, hy+3, 6, 6, p.skin)
		k.set(4, hy+5, cBlack)
		if p.glasses {
			k.line(3, hy+5, 6, hy+5, cDarkGray)
		}
	case dirRight:
		k.rect(8, hy+3, 6, 6, p.skin)
		k.set(12, hy+5, cBlack)
		if p.glasses {
			k.line(10, hy+5, 13, hy+5, cDarkGray)
		}
	}
	if p.pigtails {
		k.rect(1, hy+3, 2, 4, p.hair)
		k.rect(14, hy+3, 2, 4, p.hair)
	}
}
