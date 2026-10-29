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
	{id: "eurasian_tree_sparrow", back: cBrown, belly: cLightGray, head: cChestnut, wing: cDarkBrown,
		accent: cBlack, beak: cDarkGray, legs: cSkinShadow, accentAt: [2]int{3, 4}},
	{id: "spotted_dove", back: cTan, belly: cSkinShadow, head: cGray, wing: cBrown,
		accent: cBlack, beak: cDarkGray, legs: cRed, accentAt: [2]int{1, 4}},
	{id: "swinhoes_white_eye", back: cOlive, belly: cYellowGreen, head: cYellowGreen, wing: cOlive,
		accent: cWhite, beak: cDarkGray, legs: cGray, accentAt: [2]int{4, 2}},
	{id: "black_collared_starling", back: cDarkGray, belly: cWhite, head: cWhite, wing: cBlack,
		accent: cBlack, beak: cBlack, legs: cSand, accentAt: [2]int{3, 5}},
	{id: "crested_myna", back: cBlack, belly: cDarkGray, head: cBlack, wing: cDarkGray,
		accent: cWhite, beak: cYellow, legs: cOrange, accentAt: [2]int{2, 0}},
	{id: "light_vented_bulbul", back: cOlive, belly: cLightGray, head: cBlack, wing: cYellowGreen,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{1, 1}},
	{id: "masked_laughingthrush", back: cTan, belly: cSand, head: cBlack, wing: cBrown,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{4, 2}},
	{id: "asian_koel", back: cBlack, belly: cNavy, head: cBlack, wing: cNavy,
		accent: cRed, beak: cPaleGreen, legs: cDarkGray, accentAt: [2]int{5, 2}},
	{id: "long_tailed_shrike", back: cGray, belly: cOrange, head: cBlack, wing: cBlack,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 3}},
	{id: "bull_headed_shrike", back: cChestnut, belly: cSand, head: cChestnut, wing: cDarkBrown,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 3}},
	{id: "fork_tailed_sunbird", back: cOlive, belly: cYellowGreen, head: cDarkTeal, wing: cOlive,
		accent: cRed, beak: cBlack, legs: cDarkGray, accentAt: [2]int{2, 5}},
	{id: "common_tailorbird", back: cOlive, belly: cWhite, head: cChestnut, wing: cYellowGreen,
		accent: cChestnut, beak: cDarkGray, legs: cSkinShadow, accentAt: [2]int{1, 0}},
	{id: "yellow_crested_cockatoo", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cBlack, legs: cDarkGray, accentAt: [2]int{1, -1}},
	{id: "common_kingfisher", back: cTeal, belly: cOrange, head: cBlue, wing: cDarkTeal,
		accent: cWhite, beak: cBlack, legs: cRed, accentAt: [2]int{3, 5}},
	{id: "white_throated_kingfisher", back: cBlue, belly: cChestnut, head: cChestnut, wing: cBlue,
		accent: cWhite, beak: cRed, legs: cRed, accentAt: [2]int{3, 5}},
	{id: "chinese_pond_heron", back: cSand, belly: cWhite, head: cChestnut, wing: cWhite,
		accent: cYellow, beak: cYellow, legs: cYellow, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "great_egret", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cYellow, legs: cBlack, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "pacific_reef_heron", back: cDarkGray, belly: cDarkGray, head: cDarkGray, wing: cGray,
		accent: cSand, beak: cSand, legs: cYellow, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "blue_rock_thrush", back: cNavy, belly: cChestnut, head: cNavy, wing: cDarkGray,
		accent: cBlue, beak: cBlack, legs: cBlack, accentAt: [2]int{3, 4}},
	{id: "black_kite", back: cBrown, belly: cTan, head: cTan, wing: cDarkBrown,
		accent: cDarkBrown, beak: cBlack, legs: cYellow, accentAt: [2]int{4, 2}},
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
