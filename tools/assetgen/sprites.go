package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// copyIfExists copies src to dst and reports whether src existed.
func copyIfExists(src, dst string) (bool, error) {
	data, err := os.ReadFile(src)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return false, err
	}
	return true, os.WriteFile(dst, data, 0o644)
}

// fileExists reports whether a file exists.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// Directions in character sheets, one per row (developer_guide.md §6).
const (
	dirDown = iota
	dirLeft
	dirRight
	dirUp
)

// genAngie writes a 4×4 sheet of 16×24 frames: rows down/left/right/up,
// columns idle, walk1–3.
func genAngie(assets string) error {
	c := newCanvas(4*16, 4*24)
	for dir := range 4 {
		for f := range 4 {
			drawAngie(c.cell(f*16, dir*24), dir, f)
		}
	}
	return c.save(filepath.Join(assets, "chars", "angie.png"))
}

func drawAngie(k cell, dir, frame int) {
	// Legs: frames 1 and 3 step with opposite legs.
	lLeg, rLeg := 0, 0
	switch frame {
	case 1:
		lLeg = -1
	case 3:
		rLeg = -1
	}
	k.rect(6, 19+lLeg, 2, 4, cSkin)
	k.rect(9, 19+rLeg, 2, 4, cSkin)
	k.rect(6, 22+lLeg, 2, 2, cDarkBrown)
	k.rect(9, 22+rLeg, 2, 2, cDarkBrown)
	// Skirt and shirt.
	k.rect(5, 16, 7, 4, cNavy)
	k.rect(5, 10, 7, 7, cPink)
	k.rect(5, 15, 7, 1, cPurple)
	// Arms swing a little while walking.
	swing := 0
	if frame == 1 {
		swing = 1
	} else if frame == 3 {
		swing = -1
	}
	switch dir {
	case dirDown, dirUp:
		k.rect(3, 11+swing, 2, 5, cSkin)
		k.rect(12, 11-swing, 2, 5, cSkin)
	case dirLeft:
		k.rect(7, 11+swing, 2, 5, cSkinShadow)
	case dirRight:
		k.rect(8, 11+swing, 2, 5, cSkinShadow)
	}
	// Head and hair.
	k.ellipse(3, 1, 11, 10, cDarkBrown)
	switch dir {
	case dirDown:
		k.rect(5, 4, 7, 6, cSkin)
		k.rect(5, 3, 7, 2, cDarkBrown)
		k.set(6, 6, cBlack)
		k.set(10, 6, cBlack)
		k.set(8, 8, cSkinShadow)
		k.set(5, 7, cPink)
		k.set(11, 7, cPink)
	case dirLeft:
		k.rect(3, 4, 6, 6, cSkin)
		k.set(4, 6, cBlack)
		k.rect(12, 5, 2, 5, cDarkBrown) // ponytail
	case dirRight:
		k.rect(8, 4, 6, 6, cSkin)
		k.set(12, 6, cBlack)
		k.rect(3, 5, 2, 5, cDarkBrown)
	case dirUp:
		k.rect(7, 9, 3, 2, cDarkBrown)
	}
	if dir == dirDown {
		shimaEnaga(k)
	} else {
		// Camera strap across the shirt (the front shows her shirt print instead).
		k.line(5, 10, 11, 15, cBlack)
	}
}

// shimaEnaga prints a tiny Shima-enaga (the white long-tailed tit of
// Hokkaido) on the front of Angie's shirt: a white fluffball with dot eyes,
// a tiny beak and its long dark tail.
func shimaEnaga(k cell) {
	k.rect(7, 11, 3, 1, cWhite) // round fluffy body
	k.rect(6, 12, 5, 2, cWhite)
	k.rect(7, 14, 3, 1, cWhite)
	k.set(7, 12, cBlack) // dot eyes
	k.set(9, 12, cBlack)
	k.set(9, 14, cLightGray)       // wing
	k.line(10, 14, 11, 14, cBlack) // long tail sticking out
	k.set(11, 15, cBlack)
}

// genOBoy writes O Boy's 8×8 overworld sheet: idle, hop.
func genOBoy(assets string) error {
	c := newCanvas(2*8, 8)
	for f := range 2 {
		k := c.cell(f*8, 0)
		dy := 0
		if f == 1 {
			dy = -1
		}
		k.ellipse(1, 2+dy, 6, 5, cTeal)
		k.rect(1, 4+dy, 3, 2, cDarkTeal)
		k.rect(2, 5+dy, 2, 1, cBlue)
		k.set(5, 3+dy, cBlack)
		k.set(7, 4+dy, cSkin)
		k.set(3, 7, cSkin)
		k.set(5, 7, cSkin)
	}
	return c.save(filepath.Join(assets, "chars", "oboy.png"))
}

// birdLook describes a species' placeholder colors.
type birdLook struct {
	id                      string
	back, belly, head, wing uint8
	accent, beak, legs      uint8
	accentAt                [2]int // cheek patch offset from head origin
	longNeck                bool
}

var birdLooks = []birdLook{
	{id: "red_whiskered_bulbul", back: cBrown, belly: cWhite, head: cBlack, wing: cDarkBrown,
		accent: cRed, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "oriental_magpie_robin", back: cBlack, belly: cWhite, head: cBlack, wing: cWhite,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "pacific_parrotlet", back: cTeal, belly: cPaleGreen, head: cTeal, wing: cDarkTeal,
		accent: cBlue, beak: cSkin, legs: cSkin, accentAt: [2]int{1, 2}},
	{id: "little_egret", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cBlack, legs: cBlack, accentAt: [2]int{4, 2}, longNeck: true},
}

// Photo-scene bird frames, in sheet order (32×32 each).
var birdFrames = []string{"perched", "perched_alert", "wings_spread", "flying1", "flying2", "back_turned"}

// photoBirds is where tools/birdphoto writes sheets made from real photos
// (art/birds/out/<id>.png and album_<id>.png). When a sheet exists there it
// replaces the drawn placeholder.
var photoBirds = filepath.Join("art", "birds", "out")

func genBirds(assets string) error {
	for _, b := range birdLooks {
		dst := filepath.Join(assets, "birds", b.id+".png")
		if ok, err := copyIfExists(filepath.Join(photoBirds, b.id+".png"), dst); err != nil {
			return err
		} else if !ok {
			sheet := newCanvas(len(birdFrames)*32, 32)
			for i, f := range birdFrames {
				drawBird(sheet.cell(i*32, 0), b, f)
			}
			if err := sheet.save(dst); err != nil {
				return err
			}
		}
		if _, err := copyIfExists(filepath.Join(photoBirds, "album_"+b.id+".png"), filepath.Join(assets, "birds", "album_"+b.id+".png")); err != nil {
			return err
		}
		ow := newCanvas(2*8, 8)
		for f := range 2 {
			drawOverworldBird(ow.cell(f*8, 0), b, f)
		}
		if err := ow.save(filepath.Join(assets, "birds", "ow_"+b.id+".png")); err != nil {
			return err
		}
	}
	return nil
}

func drawBird(k cell, b birdLook, frame string) {
	headX, headY := 20, 9
	bodyY := 14
	if frame == "perched_alert" {
		headY -= 2
	}
	if b.longNeck {
		headY -= 4
	}
	flying := frame == "flying1" || frame == "flying2"
	if flying {
		bodyY = 13
		headY = bodyY - 3
	}
	// Tail.
	k.rect(3, bodyY+4, 7, 3, b.back)
	// Legs.
	if !flying {
		legLen := 4
		if b.longNeck {
			legLen = 8
		}
		k.rect(13, bodyY+9, 1, legLen, b.legs)
		k.rect(17, bodyY+9, 1, legLen, b.legs)
	}
	// Body.
	k.ellipse(7, bodyY, 16, 10, b.back)
	k.ellipse(10, bodyY+4, 12, 6, b.belly)
	// Neck for long-necked birds.
	if b.longNeck && !flying {
		k.rect(headX+1, headY+4, 3, bodyY-headY-2, b.head)
	}
	// Head, eye, beak, accent.
	back := frame == "back_turned"
	k.ellipse(headX, headY, 8, 7, b.head)
	if !back {
		k.set(headX+5, headY+2, cWhite)
		k.set(headX+5, headY+3, cBlack)
		beakLen := 3
		if b.longNeck {
			beakLen = 6
		}
		k.rect(headX+8, headY+3, beakLen, 1, b.beak)
		k.rect(headX+b.accentAt[0], headY+b.accentAt[1], 2, 2, b.accent)
	} else {
		k.rect(headX-2, headY+3, 2, 1, b.beak)
	}
	// Wings.
	switch frame {
	case "wings_spread", "flying1":
		for i := range 8 {
			k.line(12+i, bodyY+2, 6+i, bodyY-8+i/2, b.wing)
		}
		k.line(6, bodyY-8, 13, bodyY-4, b.back)
	case "flying2":
		for i := range 8 {
			k.line(12+i, bodyY+5, 8+i, bodyY+13-i/3, b.wing)
		}
	default:
		k.ellipse(9, bodyY+1, 11, 6, b.wing)
	}
}

func drawOverworldBird(k cell, b birdLook, frame int) {
	dy := 0
	if frame == 1 {
		dy = -1
	}
	if b.longNeck {
		k.rect(3, 5, 1, 3, b.legs)
		k.ellipse(1, 3+dy, 5, 3, b.back)
		k.rect(5, 1+dy, 1, 3, b.head)
		k.set(6, 1+dy, b.beak)
		return
	}
	k.ellipse(1, 3+dy, 6, 4, b.back)
	k.rect(2, 5+dy, 3, 1, b.belly)
	k.set(5, 3+dy, b.head)
	k.set(5, 4+dy, b.accent)
	k.set(7, 4+dy, b.beak)
	k.set(3, 7, b.legs)
}
