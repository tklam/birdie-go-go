package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
)

// tileColors averages each atlas tile's opaque pixels, for the overview map.
func tileColors(atlasPath string, tile, columns, count int) ([]color.NRGBA, error) {
	f, err := os.Open(atlasPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		return nil, err
	}
	out := make([]color.NRGBA, count)
	for i := range count {
		x0, y0 := (i%columns)*tile, (i/columns)*tile
		var r, g, b, n uint32
		for y := y0; y < y0+tile; y++ {
			for x := x0; x < x0+tile; x++ {
				c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
				if c.A < 128 {
					continue
				}
				r, g, b, n = r+uint32(c.R), g+uint32(c.G), b+uint32(c.B), n+1
			}
		}
		if n > 0 {
			out[i] = color.NRGBA{uint8(r / n), uint8(g / n), uint8(b / n), 255}
		}
	}
	return out, nil
}

// writeOverview renders the whole world at one pixel per tile: overhead
// (canopies, roofs, footbridges) over ground; absent chunks use the fill.
func (b *builder) writeOverview(path string, widthChunks, heightChunks int) error {
	if b.colors == nil {
		return nil
	}
	w, h := widthChunks*chunkTiles, heightChunks*chunkTiles
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	pick := func(v uint16) (color.NRGBA, bool) {
		if v == 0 || int(v) > len(b.colors) {
			return color.NRGBA{}, false
		}
		return b.colors[v-1], true
	}
	fill, _ := pick(uint16(b.fill))
	for y := range h {
		for x := range w {
			c := fill
			if ch, ok := b.chunks[[2]int{x / chunkTiles, y / chunkTiles}]; ok {
				i := (y%chunkTiles)*chunkTiles + x%chunkTiles
				if col, ok := pick(ch.ground[i]); ok {
					c = col
				}
				if col, ok := pick(ch.detail[i]); ok {
					c = col
				}
				if col, ok := pick(ch.overhead[i]); ok {
					c = col
				}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	f, err := os.Create(filepath.Clean(path))
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// writeOverviewAreas writes one grey pixel per tile whose value is the
// tile's area index (absent chunks are 0), matching the overview.
func (b *builder) writeOverviewAreas(path string, widthChunks, heightChunks int) error {
	w, h := widthChunks*chunkTiles, heightChunks*chunkTiles
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			if ch, ok := b.chunks[[2]int{x / chunkTiles, y / chunkTiles}]; ok {
				img.Pix[y*img.Stride+x] = ch.area[(y%chunkTiles)*chunkTiles+x%chunkTiles]
			}
		}
	}
	f, err := os.Create(filepath.Clean(path))
	if err != nil {
		return err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
