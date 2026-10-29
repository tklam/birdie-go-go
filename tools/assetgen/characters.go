package main

import "path/filepath"

// Characters are drawn in a classic top-down adventure style: a big round
// head, a short body, two-tone shading lit from the top left and a dark
// 1-px outline. Every sheet is 4×4 frames of 16×24 (rows down/left/right/up;
// columns idle, walk1–3). Left-facing frames mirror the right-facing ones.

const (
	charW = 16
	charH = 24
)

// charSpec describes one character.
type charSpec struct {
	id                string
	hair, top, bottom uint8
	skin, shoes       uint8
	hairStyle         string // short, messy, bob, ponytail, pigtails, bun
	bottomStyle       string // pants, shorts, skirt
	glasses, hat      bool
	camera            bool
	hatColor          uint8
	child             bool // a head-sized smaller body
	blush             bool
	angieShirt        bool // the Shima-enaga print and camera strap
	hairClip          uint8
}

var angieSpec = charSpec{
	id: "angie", hair: cDarkBrown, top: cPink, bottom: cNavy, skin: cSkin, shoes: cDarkBrown,
	hairStyle: "ponytail", bottomStyle: "skirt", blush: true, angieShirt: true, hairClip: cYellow,
}

var people = []charSpec{
	{id: "mei", hair: cBlack, top: cYellow, bottom: cOrange, skin: cSkin, shoes: cRed, hairStyle: "pigtails", bottomStyle: "skirt", child: true, blush: true, hairClip: cRed},
	{id: "kei", hair: cBlack, top: cNavy, bottom: cBlue, skin: cSkin, shoes: cWhite, hairStyle: "messy", bottomStyle: "pants", glasses: true},
	{id: "neighbour", hair: cLightGray, top: cPurple, bottom: cDarkGray, skin: cSkin, shoes: cBlack, hairStyle: "bun", bottomStyle: "pants"},
	{id: "old_villager", hair: cWhite, top: cTan, bottom: cBrown, skin: cSkinShadow, shoes: cBlack, hairStyle: "short", bottomStyle: "pants", hat: true, hatColor: cSand},
	{id: "fai", hair: cBlack, top: cBlue, bottom: cTan, skin: cSkinShadow, shoes: cBlack, hairStyle: "short", bottomStyle: "shorts", child: true},
	{id: "birder", hair: cDarkBrown, top: cDarkGreen, bottom: cTan, skin: cSkin, shoes: cBrown, hairStyle: "short", bottomStyle: "pants", camera: true, hat: true, hatColor: cTan},
	{id: "jogger", hair: cBlack, top: cRed, bottom: cBlack, skin: cSkinShadow, shoes: cWhite, hairStyle: "short", bottomStyle: "shorts"},
	{id: "office_worker", hair: cBlack, top: cWhite, bottom: cDarkGray, skin: cSkin, shoes: cBlack, hairStyle: "short", bottomStyle: "pants", glasses: true},
	{id: "auntie", hair: cDarkBrown, top: cPink, bottom: cPurple, skin: cSkin, shoes: cBlack, hairStyle: "bob", bottomStyle: "skirt"},
	{id: "student", hair: cBlack, top: cWhite, bottom: cNavy, skin: cSkin, shoes: cBlack, hairStyle: "bob", bottomStyle: "skirt", blush: true},
}

// shadeOf and lightOf pair each colour with a darker / lighter neighbour in
// the master palette.
var shadeOf = map[uint8]uint8{
	cSkin: cSkinShadow, cSkinShadow: cBrown, cPink: cPurple, cNavy: cBlack, cYellow: cOrange, cOrange: cBrown,
	cBlue: cNavy, cRed: cDarkRed, cDarkRed: cBlack, cWhite: cLightGray, cLightGray: cGray, cGray: cDarkGray,
	cDarkGray: cBlack, cPurple: cNavy, cDarkGreen: cBlack, cGreen: cDarkGreen, cTan: cBrown, cBrown: cDarkBrown,
	cDarkBrown: cBlack, cSand: cTan, cTeal: cDarkTeal, cBlack: cBlack,
}

var lightOf = map[uint8]uint8{
	cDarkBrown: cBrown, cBlack: cDarkGray, cLightGray: cWhite, cWhite: cWhite, cBrown: cTan,
}

// sprite is one 16×24 frame of palette indices (0 = transparent).
type sprite [charH][charW]uint8

func (s *sprite) set(x, y int, c uint8) {
	if x >= 0 && y >= 0 && x < charW && y < charH {
		s[y][x] = c
	}
}

func (s *sprite) rect(x, y, w, h int, c uint8) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			s.set(i, j, c)
		}
	}
}

func (s *sprite) ellipse(x, y, w, h int, c uint8) {
	cx, cy := float64(x)+float64(w)/2, float64(y)+float64(h)/2
	rx, ry := float64(w)/2, float64(h)/2
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			dx, dy := (float64(i)+0.5-cx)/rx, (float64(j)+0.5-cy)/ry
			if dx*dx+dy*dy <= 1 {
				s.set(i, j, c)
			}
		}
	}
}

// shade darkens pixels on the lower-right rim of each colour region and
// lightens hair on the upper-left rim, for a soft top-left light.
func (s *sprite) shade(hair uint8) {
	src := *s
	at := func(x, y int) uint8 {
		if x < 0 || y < 0 || x >= charW || y >= charH {
			return cClear
		}
		return src[y][x]
	}
	for y := range charH {
		for x := range charW {
			c := src[y][x]
			if c == cClear {
				continue
			}
			if at(x+1, y) != c || at(x, y+1) == cClear {
				if d, ok := shadeOf[c]; ok && at(x-1, y) == c {
					s[y][x] = d
				}
			}
			if c == hair && at(x, y-1) == cClear && at(x-1, y) == c && at(x+1, y) == c {
				if l, ok := lightOf[c]; ok {
					s[y][x] = l
				}
			}
		}
	}
}

// outline puts a dark 1-px border around the character.
func (s *sprite) outline() {
	src := *s
	for y := range charH {
		for x := range charW {
			if src[y][x] != cClear {
				continue
			}
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nx, ny := x+d[0], y+d[1]
				if nx >= 0 && ny >= 0 && nx < charW && ny < charH && src[ny][nx] != cClear {
					s[y][x] = cBlack
					break
				}
			}
		}
	}
}

func (s *sprite) mirror() {
	for y := range charH {
		for x := range charW / 2 {
			s[y][x], s[y][charW-1-x] = s[y][charW-1-x], s[y][x]
		}
	}
}

func (s *sprite) blit(k cell) {
	for y := range charH {
		for x := range charW {
			if s[y][x] != cClear {
				k.set(x, y, s[y][x])
			}
		}
	}
}

func genCharacters(assets string) error {
	for _, p := range append([]charSpec{angieSpec}, people...) {
		c := newCanvas(4*charW, 4*charH)
		for dir := range 4 {
			for f := range 4 {
				fr := drawChar(p, dir, f)
				fr.blit(c.cell(f*charW, dir*charH))
			}
		}
		if err := c.save(filepath.Join(assets, "chars", p.id+".png")); err != nil {
			return err
		}
	}
	return nil
}

// drawChar renders one frame. Walking frames 1 and 3 step with opposite
// legs and bob the body up a pixel.
func drawChar(p charSpec, dir, frame int) sprite {
	var s sprite
	if dir == dirLeft {
		s = drawChar(p, dirRight, frame)
		s.mirror()
		return s
	}
	bob := 0
	if frame == 1 || frame == 3 {
		bob = -1
	}
	// Vertical layout: feet end on row 22 (row 23 is the outline).
	headY, headH, bodyY, bodyH, legY := 1, 11, 12, 6, 18
	if p.child {
		headY, headH, bodyY, bodyH, legY = 4, 10, 14, 5, 19
	}
	headY += bob
	bodyY += bob

	legs(&s, p, dir, frame, legY)
	torso(&s, p, dir, frame, bodyY, bodyH)
	head(&s, p, dir, headY, headH)

	s.shade(p.hair)
	details(&s, p, dir, headY, bodyY)
	s.outline()
	return s
}

func legs(s *sprite, p charSpec, dir, frame, y int) {
	legColor := p.bottom
	if p.bottomStyle != "pants" {
		legColor = p.skin
	}
	n := 22 - y // leg length above the shoes row
	switch dir {
	case dirDown, dirUp:
		l, r := 0, 0
		if frame == 1 {
			l = -1
		} else if frame == 3 {
			r = -1
		}
		s.rect(5, y, 2, n+l, legColor)
		s.rect(9, y, 2, n+r, legColor)
		s.rect(5, 21+l, 3, 2, p.shoes)
		s.rect(8, 21+r, 3, 2, p.shoes)
	default: // right; stride front/back
		front, back := 9, 6
		switch frame {
		case 1:
			front, back = 10, 5
		case 3:
			front, back = 8, 7
		}
		s.rect(back, y, 2, n, legColor)
		s.rect(back, 21, 3, 2, shadeOf[p.shoes])
		s.rect(front, y, 2, n, legColor)
		s.rect(front, 21, 3, 2, p.shoes)
	}
	if p.bottomStyle == "shorts" {
		s.rect(5, y, 6, 2, p.bottom)
	}
}

func torso(s *sprite, p charSpec, dir, frame, y, h int) {
	swing := 0
	if frame == 1 {
		swing = 1
	} else if frame == 3 {
		swing = -1
	}
	switch dir {
	case dirDown, dirUp:
		s.rect(4, y, 8, h, p.top)
		// Arms: sleeve, then hand.
		s.rect(2, y+swing, 2, 3, p.top)
		s.rect(2, y+3+swing, 2, 2, p.skin)
		s.rect(12, y-swing, 2, 3, p.top)
		s.rect(12, y+3-swing, 2, 2, p.skin)
	default:
		s.rect(5, y, 6, h, p.top)
		s.rect(7+swing, y+1, 2, 3, shadeOf[p.top])
		s.rect(7+swing, y+4, 2, 2, p.skin)
	}
	if p.bottomStyle == "skirt" && p.child {
		s.rect(3, y+h-1, 10, 2, p.bottom)
	} else if p.bottomStyle == "skirt" {
		s.rect(3, y+h-1, 10, 3, p.bottom)
		s.rect(4, y+h+2, 8, 1, p.bottom)
	} else {
		s.rect(4, y+h-1, 8, 2, p.bottom)
	}
}

func head(s *sprite, p charSpec, dir, y, h int) {
	s.ellipse(2, y, 12, h, p.hair)
	face := func(x, w int) {
		s.rect(x, y+4, w, h-5, p.skin)
		s.rect(x+1, y+h-1, w-2, 1, p.skin) // chin
	}
	switch dir {
	case dirDown:
		face(4, 8)
		// Fringe.
		s.rect(4, y+3, 8, 2, p.hair)
		s.set(6, y+5, p.hair)
		s.set(9, y+5, p.hair)
	case dirRight:
		face(7, 6)
		s.rect(7, y+3, 6, 2, p.hair)
		s.set(13, y+7, p.skin) // nose
		s.set(8, y+6, p.hair)  // sideburn
	}
	switch p.hairStyle {
	case "ponytail":
		if dir == dirRight {
			s.rect(0, y+3, 3, 5, p.hair)
		} else if dir == dirUp {
			s.rect(6, y+h-1, 4, 4, p.hair)
		}
	case "pigtails":
		if dir != dirRight {
			s.rect(0, y+4, 2, 4, p.hair)
			s.rect(14, y+4, 2, 4, p.hair)
		} else {
			s.rect(1, y+4, 2, 4, p.hair)
		}
	case "bun":
		s.ellipse(5, y-1, 6, 4, p.hair)
	case "bob":
		if dir == dirDown {
			s.rect(2, y+5, 2, 5, p.hair)
			s.rect(12, y+5, 2, 5, p.hair)
		}
	case "messy":
		for _, x := range []int{3, 6, 9, 12} {
			s.set(x, y-1, p.hair)
		}
	}
	if p.hat {
		s.rect(1, y+2, 14, 2, p.hatColor)
		s.ellipse(3, y-1, 10, 5, p.hatColor)
	}
}

// details paints eyes, glasses and clothing marks after shading so they keep
// their exact colours.
func details(s *sprite, p charSpec, dir, headY, bodyY int) {
	eyeY := headY + 6
	if p.child {
		eyeY = headY + 5
	}
	switch dir {
	case dirDown:
		s.rect(5, eyeY, 1, 2, cBlack)
		s.rect(10, eyeY, 1, 2, cBlack)
		if p.glasses {
			s.rect(4, eyeY, 3, 1, cDarkGray)
			s.rect(9, eyeY, 3, 1, cDarkGray)
			s.set(7, eyeY, cDarkGray)
			s.set(8, eyeY, cDarkGray)
			s.set(5, eyeY, cBlack)
			s.set(10, eyeY, cBlack)
		}
		if p.blush {
			s.set(4, eyeY+2, cPink)
			s.set(11, eyeY+2, cPink)
		}
		s.set(7, eyeY+3, cSkinShadow) // mouth
		s.set(8, eyeY+3, cSkinShadow)
	case dirRight:
		s.rect(11, eyeY, 1, 2, cBlack)
		if p.glasses {
			s.rect(10, eyeY, 3, 1, cDarkGray)
			s.set(11, eyeY, cBlack)
			s.set(9, eyeY, cDarkGray)
		}
		if p.blush {
			s.set(11, eyeY+2, cPink)
		}
	}
	if p.hairClip != cClear && dir != dirUp {
		x := 4
		if dir == dirRight {
			x = 9
		}
		s.set(x, headY+3, p.hairClip)
		s.set(x+1, headY+3, p.hairClip)
	}
	if p.angieShirt {
		if dir == dirDown {
			shimaEnaga(s, bodyY)
		} else if dir == dirRight {
			s.set(6, bodyY, cBlack) // camera strap
			s.set(7, bodyY+1, cBlack)
			s.set(8, bodyY+2, cBlack)
			s.rect(9, bodyY+3, 2, 2, cDarkGray) // camera at her hip
		} else {
			s.set(4, bodyY, cBlack)
			s.set(5, bodyY+1, cBlack)
			s.set(6, bodyY+2, cBlack)
			s.set(7, bodyY+3, cBlack)
		}
	}
	if p.camera && dir != dirUp {
		x := 6
		if dir == dirRight {
			x = 8
		}
		s.rect(x, bodyY+1, 4, 3, cBlack)
		s.set(x+3, bodyY+2, cDarkGray)
	}
}

// shimaEnaga prints a tiny Shima-enaga (the white long-tailed tit of
// Hokkaido) on the front of Angie's shirt, in side profile so it reads as a
// bird: a round white body, one eye, a tiny beak, a dark wing and the long
// tail.
func shimaEnaga(s *sprite, y int) {
	s.rect(6, y+1, 3, 1, cWhite) // round body
	s.rect(5, y+2, 5, 2, cWhite)
	s.rect(6, y+4, 3, 1, cWhite)
	s.set(6, y+2, cBlack)    // eye
	s.set(4, y+2, cDarkGray) // tiny beak
	s.set(8, y+3, cDarkGray) // wing
	s.set(9, y+3, cDarkGray)
	s.set(10, y+3, cBlack) // long tail
	s.set(11, y+4, cBlack)
}
