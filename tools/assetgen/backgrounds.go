package main

import "path/filepath"

const bgW, bgH = 320, 180

// background is a photo-scene backdrop: three parallax layers plus where
// birds can perch and where waders can stand.
type background struct {
	id      string
	far     func(c *canvas)
	mid     func(c *canvas)
	near    func(c *canvas)
	perches [][2]int
	ground  [2]int // y range of walkable/wadeable ground, or 0,0 for none
}

var backgrounds = []background{
	{
		id: "bg_waterfront",
		far: func(c *canvas) {
			sky(c, 110)
			// Hills and towers across Junk Bay.
			c.ellipse(-40, 70, 200, 70, cDarkTeal)
			c.ellipse(120, 60, 260, 90, cDarkGreen)
			for i, x := range []int{30, 52, 70, 200, 222, 250, 275} {
				h := 30 + int(hash3(i, 0, 31)%25)
				c.rect(x, 110-h, 14, h, cLightGray)
				for y := 110 - h + 3; y < 106; y += 5 {
					c.rect(x+2, y, 10, 1, cWindow)
				}
			}
			c.rect(0, 110, bgW, bgH-110, cSea)
			for y := 114; y < bgH; y += 7 {
				for x := int(hash3(y, 1, 32) % 30); x < bgW; x += 37 {
					c.rect(x, y, 10, 1, cLightSea)
				}
			}
		},
		mid: func(c *canvas) {
			tree(c, 18, 60, 52)
			tree(c, 285, 50, 60)
			c.rect(150, 96, 3, 54, cDarkGray) // lamp post
			c.rect(145, 92, 13, 5, cYellow)
		},
		near: func(c *canvas) {
			// Promenade railing along the bottom, with a mudflat on the left.
			c.rect(0, 148, bgW, 3, cLightGray)
			for x := 4; x < bgW; x += 24 {
				c.rect(x, 151, 3, 29, cGray)
			}
			c.rect(0, 166, 110, 14, cTan)
			c.speckle(0, 166, 110, 14, cBrown, 0.15, 33)
			// A branch reaching in from the right.
			c.line(320, 70, 250, 84, cBrown)
			c.line(320, 71, 250, 85, cDarkBrown)
			c.line(280, 78, 266, 66, cBrown)
			c.ellipse(258, 58, 18, 12, cGreen)
		},
		perches: [][2]int{{40, 148}, {96, 148}, {180, 148}, {232, 148}, {262, 82}, {290, 76}, {151, 92}},
		ground:  [2]int{168, 178},
	},
	{
		id: "bg_garden",
		far: func(c *canvas) {
			sky(c, 140)
			for i, x := range []int{10, 70, 140, 215, 270} {
				h := 90 + int(hash3(i, 2, 34)%40)
				c.rect(x, 140-h, 44, h, cLightGray)
				for y := 140 - h + 4; y < 136; y += 6 {
					for wx := x + 3; wx < x+41; wx += 6 {
						c.rect(wx, y, 3, 3, cWindow)
					}
				}
			}
			c.rect(0, 140, bgW, 40, cGreen)
			c.speckle(0, 140, bgW, 40, cLightGreen, 0.1, 35)
		},
		mid: func(c *canvas) {
			tree(c, 60, 70, 70)
			tree(c, 230, 64, 76)
			for x := 0; x < bgW; x += 26 {
				c.ellipse(x, 136, 30, 18, cDarkGreen)
				c.ellipse(x+3, 136, 22, 12, cGreen)
			}
		},
		near: func(c *canvas) {
			c.rect(0, 166, bgW, 14, cBrick)
			c.rect(0, 166, bgW, 2, cDarkRed)
			c.speckle(0, 168, bgW, 12, cPink, 0.05, 36)
			c.line(0, 60, 70, 74, cBrown)
			c.line(0, 61, 70, 75, cDarkBrown)
			c.ellipse(60, 52, 22, 14, cGreen)
			c.rect(296, 88, 3, 78, cDarkGray)
			c.rect(291, 84, 13, 5, cYellow)
		},
		perches: [][2]int{{30, 66}, {58, 70}, {297, 84}, {120, 166}, {200, 166}, {78, 70}, {250, 64}},
		ground:  [2]int{150, 164},
	},
}

// sky fills the top of a background with banded 16-bit-style sky.
func sky(c *canvas, horizon int) {
	c.rect(0, 0, bgW, horizon, cSky)
	c.rect(0, horizon*2/3, bgW, horizon/3, cPaleSky)
	// Dithered band between the two blues.
	for y := horizon*2/3 - 6; y < horizon*2/3; y++ {
		for x := (y % 2); x < bgW; x += 2 {
			c.set(x, y, cPaleSky)
		}
	}
	c.ellipse(40, 18, 50, 14, cWhite)
	c.ellipse(200, 30, 70, 16, cWhite)
}

func tree(c *canvas, x, y, size int) {
	c.rect(x+size/2-3, y+size/2, 6, size, cBrown)
	c.ellipse(x, y, size, size*3/4, cDarkGreen)
	c.ellipse(x+4, y+3, size-10, size*3/4-10, cGreen)
	c.speckle(x+6, y+5, size-14, size/2-6, cLightGreen, 0.15, uint32(x+y))
}

func genBackgrounds(assets string) error {
	for _, bg := range backgrounds {
		for name, draw := range map[string]func(*canvas){"far": bg.far, "mid": bg.mid, "near": bg.near} {
			c := newCanvas(bgW, bgH)
			draw(c)
			if err := c.save(filepath.Join(assets, "backgrounds", bg.id+"_"+name+".png")); err != nil {
				return err
			}
		}
	}
	return nil
}
