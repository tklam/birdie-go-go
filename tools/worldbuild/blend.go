package main

import (
	"sort"

	"birdiegogo/core/model"
)

const (
	// blendCell is the size of a blend-field cell in tiles (SPEC.md §4.9).
	blendCell = 4
	// cellsPerChunk is the number of blend cells along a chunk side.
	cellsPerChunk = chunkTiles / blendCell
	// blendSlots is how many areas each cell stores (the strongest ones).
	blendSlots = 3
)

// blendField computes, for every blend cell of every chunk, up to three
// (area, weight) pairs: raw weight max(0, 1 − d/band) where d is the
// distance in tiles from the cell's centre tile to the area (0 inside it),
// normalised so the weights of a cell sum to 255. Exactly on a boundary two
// areas mix 50/50; deep inside an area it's 100% that area; tiles without
// an area (open sea) don't contribute.
//
// Distances come from a multi-source BFS per area over the world tile grid,
// limited to `band` tiles. That's fine for the current world size; a huge
// world would compute it per region instead.
func (b *builder) blendField(widthChunks, heightChunks, band int) {
	w, h := widthChunks*chunkTiles, heightChunks*chunkTiles
	areaAt := func(x, y int) int {
		c, ok := b.chunks[[2]int{x / chunkTiles, y / chunkTiles}]
		if !ok {
			return noArea
		}
		return int(c.area[(y%chunkTiles)*chunkTiles+x%chunkTiles])
	}
	dists := make([][]uint8, len(b.areas))
	for a := range dists {
		dists[a] = bfs(w, h, band, func(x, y int) bool { return areaAt(x, y) == a })
	}
	for key, c := range b.chunks {
		for cy := range cellsPerChunk {
			for cx := range cellsPerChunk {
				tx := key[0]*chunkTiles + cx*blendCell + blendCell/2
				ty := key[1]*chunkTiles + cy*blendCell + blendCell/2
				c.blend[cy*cellsPerChunk+cx] = cellWeights(tx, ty, w, dists, band)
			}
		}
	}
}

// cellWeights returns the top three normalised (area, weight) pairs at a tile.
func cellWeights(tx, ty, w int, dists [][]uint8, band int) [blendSlots][2]uint8 {
	type aw struct {
		area int
		w    float64
	}
	var ws []aw
	total := 0.0
	for a, d := range dists {
		raw := 1 - float64(d[ty*w+tx])/float64(band)
		if raw > 0 {
			ws = append(ws, aw{a, raw})
			total += raw
		}
	}
	var out [blendSlots][2]uint8
	for i := range out {
		out[i] = [2]uint8{noArea, 0}
	}
	if total == 0 {
		return out
	}
	sort.Slice(ws, func(i, j int) bool { return ws[i].w > ws[j].w || ws[i].w == ws[j].w && ws[i].area < ws[j].area })
	if len(ws) > blendSlots {
		ws = ws[:blendSlots]
		total = 0
		for _, x := range ws {
			total += x.w
		}
	}
	sum := 0
	for i, x := range ws {
		v := int(x.w/total*255 + 0.5)
		if i == len(ws)-1 {
			v = 255 - sum // keep the cell's weights summing to exactly 255
		}
		sum += v
		out[i] = [2]uint8{uint8(x.area), uint8(v)}
	}
	return out
}

// bfs returns, per tile, the distance in tiles (8-connected, diagonal = 1)
// to the nearest tile where in(x, y) holds, capped at band (band means "at
// least band away").
func bfs(w, h, band int, in func(x, y int) bool) []uint8 {
	d := make([]uint8, w*h)
	for i := range d {
		d[i] = uint8(band)
	}
	queue := make([]int, 0, w*h/4)
	for y := range h {
		for x := range w {
			if in(x, y) {
				d[y*w+x] = 0
				queue = append(queue, y*w+x)
			}
		}
	}
	for len(queue) > 0 {
		i := queue[0]
		queue = queue[1:]
		x, y := i%w, i/w
		next := d[i] + 1
		if int(next) >= band {
			continue
		}
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				nx, ny := x+dx, y+dy
				if (dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= w || ny >= h {
					continue
				}
				j := ny*w + nx
				if d[j] > next {
					d[j] = next
					queue = append(queue, j)
				}
			}
		}
	}
	return d
}

// areaCenters returns each area's centroid in world pixels.
func (b *builder) areaCenters() map[string]model.Point {
	sums := make([][3]float64, len(b.areas))
	for key, c := range b.chunks {
		for i, a := range c.area {
			if a == noArea {
				continue
			}
			x := float64(key[0]*chunkTiles+i%chunkTiles)*tileSize + tileSize/2
			y := float64(key[1]*chunkTiles+i/chunkTiles)*tileSize + tileSize/2
			sums[a][0] += x
			sums[a][1] += y
			sums[a][2]++
		}
	}
	out := map[string]model.Point{}
	for id, n := range b.areas {
		if s := sums[n]; s[2] > 0 {
			out[id] = model.Point{X: s[0] / s[2], Y: s[1] / s[2]}
		}
	}
	return out
}
