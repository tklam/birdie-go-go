package main

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
)

// canvas is a paletted image with simple drawing helpers. Colors are master
// palette indices.
type canvas struct {
	img *image.Paletted
}

func newCanvas(w, h int) *canvas {
	return &canvas{img: image.NewPaletted(image.Rect(0, 0, w, h), palette)}
}

func (c *canvas) set(x, y int, idx uint8) {
	if image.Pt(x, y).In(c.img.Rect) {
		c.img.SetColorIndex(x, y, idx)
	}
}

func (c *canvas) rect(x, y, w, h int, idx uint8) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			c.set(i, j, idx)
		}
	}
}

// ellipse fills the ellipse inscribed in the given box.
func (c *canvas) ellipse(x, y, w, h int, idx uint8) {
	cx, cy := float64(x)+float64(w)/2, float64(y)+float64(h)/2
	rx, ry := float64(w)/2, float64(h)/2
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			dx, dy := (float64(i)+0.5-cx)/rx, (float64(j)+0.5-cy)/ry
			if dx*dx+dy*dy <= 1 {
				c.set(i, j, idx)
			}
		}
	}
}

// line draws a 1-px line (Bresenham).
func (c *canvas) line(x0, y0, x1, y1 int, idx uint8) {
	dx, dy := abs(x1-x0), -abs(y1-y0)
	sx, sy := sign(x1-x0), sign(y1-y0)
	err := dx + dy
	for {
		c.set(x0, y0, idx)
		if x0 == x1 && y0 == y1 {
			return
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			x0 += sx
		}
		if e2 <= dx {
			err += dx
			y0 += sy
		}
	}
}

// speckle scatters color idx over a box with the given density (0–1),
// deterministically from seed.
func (c *canvas) speckle(x, y, w, h int, idx uint8, density float64, seed uint32) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			if float64(hash3(i, j, seed)%1000)/1000 < density {
				c.set(i, j, idx)
			}
		}
	}
}

func (c *canvas) save(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := png.Encode(f, c.img); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// cell draws into a sub-rectangle using cell-local coordinates.
type cell struct {
	c      *canvas
	ox, oy int
}

func (c *canvas) cell(x, y int) cell { return cell{c: c, ox: x, oy: y} }

func (k cell) set(x, y int, idx uint8)        { k.c.set(k.ox+x, k.oy+y, idx) }
func (k cell) rect(x, y, w, h int, idx uint8) { k.c.rect(k.ox+x, k.oy+y, w, h, idx) }
func (k cell) ellipse(x, y, w, h int, idx uint8) {
	k.c.ellipse(k.ox+x, k.oy+y, w, h, idx)
}
func (k cell) line(x0, y0, x1, y1 int, idx uint8) {
	k.c.line(k.ox+x0, k.oy+y0, k.ox+x1, k.oy+y1, idx)
}
func (k cell) speckle(x, y, w, h int, idx uint8, density float64, seed uint32) {
	k.c.speckle(k.ox+x, k.oy+y, w, h, idx, density, seed)
}

func hash3(x, y int, seed uint32) uint32 {
	h := uint32(x)*374761393 + uint32(y)*668265263 + seed*2246822519
	h = (h ^ (h >> 13)) * 1274126177
	return h ^ (h >> 16)
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func sign(v int) int {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}
