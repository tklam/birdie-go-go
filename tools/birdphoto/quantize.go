package main

import (
	"image"
	"image/color"
	"math"
	"sort"
)

// weightedLab is a distinct color with its pixel count.
type weightedLab struct {
	c lab
	w float64
}

// chooseColors picks at most maxColors masterPalette indices that minimize
// the summed squared Lab error of the samples (greedy additions followed by
// swap refinement). forced indices are always included and count toward the
// limit; excluded indices are never picked (forced wins). The result is
// sorted.
func chooseColors(samples []weightedLab, forced, exclude []int, maxColors int) []int {
	n := len(paletteLab)
	// d[s][p]: squared distance of sample s to palette color p.
	d := make([][]float64, len(samples))
	for i, s := range samples {
		d[i] = make([]float64, n)
		for p := range paletteLab {
			d[i][p] = s.c.dist2(paletteLab[p])
		}
	}
	cost := func(set []int) float64 {
		var total float64
		for i, s := range samples {
			best := math.Inf(1)
			for _, p := range set {
				best = math.Min(best, d[i][p])
			}
			total += s.w * best
		}
		return total
	}
	in := make([]bool, n)
	banned := make([]bool, n)
	for _, e := range exclude {
		if e >= 0 && e < n {
			banned[e] = true
		}
	}
	var set []int
	for _, f := range forced {
		if f >= 0 && f < n && !in[f] && len(set) < maxColors {
			in[f] = true
			set = append(set, f)
		}
	}
	if len(samples) == 0 {
		sort.Ints(set)
		return set
	}
	cur := math.Inf(1)
	if len(set) > 0 {
		cur = cost(set)
	}
	for len(set) < maxColors {
		bestC, bestP := cur, -1
		for p := 0; p < n; p++ {
			if in[p] || banned[p] {
				continue
			}
			if c := cost(append(set, p)); c < bestC-1e-9 {
				bestC, bestP = c, p
			}
		}
		if bestP < 0 {
			break
		}
		in[bestP] = true
		set = append(set, bestP)
		cur = bestC
	}
	// Swap refinement: replace a non-forced member with an unused color while
	// that lowers the cost.
	isForced := map[int]bool{}
	for _, f := range forced {
		isForced[f] = true
	}
	for iter := 0; iter < 8; iter++ {
		improved := false
		for k := range set {
			if isForced[set[k]] {
				continue
			}
			old := set[k]
			for p := 0; p < n; p++ {
				if in[p] || banned[p] {
					continue
				}
				set[k] = p
				if c := cost(set); c < cur-1e-9 {
					in[old], in[p] = false, true
					old, cur, improved = p, c, true
				} else {
					set[k] = old
				}
			}
		}
		if !improved {
			break
		}
	}
	// Drop colors that no longer carry any weight (greedy picks can be made
	// redundant by later ones).
	for k := 0; k < len(set); {
		if isForced[set[k]] || len(set) == 1 {
			k++
			continue
		}
		rest := append(append([]int(nil), set[:k]...), set[k+1:]...)
		if cost(rest) <= cur+1e-9 {
			set = rest
			continue
		}
		k++
	}
	sort.Ints(set)
	return set
}

func nearestIn(c lab, set []int) int {
	best, bi := math.Inf(1), set[0]
	for _, p := range set {
		if d := c.dist2(paletteLab[p]); d < best {
			best, bi = d, p
		}
	}
	return bi
}

// bayer4 is the 4×4 ordered-dither matrix.
var bayer4 = [4][4]float64{
	{0, 8, 2, 10},
	{12, 4, 14, 6},
	{3, 11, 1, 9},
	{15, 7, 13, 5},
}

// quantizeOptions control frame quantization.
type quantizeOptions struct {
	MaxColors int     // ≤ 15
	Forced    []int   // palette indices that must be in the set (e.g. outline)
	Exclude   []int   // palette indices that are never used
	Dither    float64 // ordered-dither amplitude in 0..255 units (0 = off)
}

// quantizeFrame maps every opaque pixel of f to a master-palette color,
// using at most opt.MaxColors distinct colors. It returns palette indices
// per pixel (-1 = transparent).
func quantizeFrame(f *rgbaFrame, opt quantizeOptions) []int {
	counts := map[lab]float64{}
	labs := make([]lab, f.W*f.H)
	for i := range labs {
		if f.Alpha[i] <= 0 {
			continue
		}
		labs[i] = rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2])
		counts[labs[i]]++
	}
	samples := make([]weightedLab, 0, len(counts))
	for c, w := range counts {
		samples = append(samples, weightedLab{c, w})
	}
	sort.Slice(samples, func(a, b int) bool {
		x, y := samples[a].c, samples[b].c
		if x.L != y.L {
			return x.L < y.L
		}
		if x.A != y.A {
			return x.A < y.A
		}
		return x.B < y.B
	})
	set := chooseColors(samples, opt.Forced, opt.Exclude, opt.MaxColors)
	out := make([]int, f.W*f.H)
	for i := range out {
		out[i] = -1
		if f.Alpha[i] <= 0 || len(set) == 0 {
			continue
		}
		c := labs[i]
		if opt.Dither > 0 {
			x, y := i%f.W, i/f.W
			t := (bayer4[y%4][x%4]+0.5)/16 - 0.5
			r, g, b := f.Pix[3*i]+t*opt.Dither, f.Pix[3*i+1]+t*opt.Dither, f.Pix[3*i+2]+t*opt.Dither
			c = rgbToLab(clamp255(r), clamp255(g), clamp255(b))
		}
		out[i] = nearestIn(c, set)
	}
	return out
}

func clamp255(v float64) float64 { return math.Max(0, math.Min(255, v)) }

// addOutline sets every transparent pixel that is 4-adjacent to an opaque
// pixel to palette index col.
func addOutline(idx []int, w, h, col int) []int {
	out := append([]int(nil), idx...)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			if idx[i] >= 0 {
				continue
			}
			if (x > 0 && idx[i-1] >= 0) || (x < w-1 && idx[i+1] >= 0) ||
				(y > 0 && idx[i-w] >= 0) || (y < h-1 && idx[i+w] >= 0) {
				out[i] = col
			}
		}
	}
	return out
}

// drawIndexed paints palette indices into dst at (ox,oy).
func drawIndexed(dst *image.NRGBA, idx []int, w, h, ox, oy int) {
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if p := idx[y*w+x]; p >= 0 {
				dst.SetNRGBA(ox+x, oy+y, masterPalette[p])
			} else {
				dst.SetNRGBA(ox+x, oy+y, color.NRGBA{})
			}
		}
	}
}

// despeckle replaces isolated pixels that differ only slightly (Lab ΔE <
// maxDE) from a color shared by at least 6 of their 8 neighbors. Strong
// details such as an eye or a red cheek patch survive.
func despeckle(idx []int, w, h int, maxDE float64) []int {
	out := append([]int(nil), idx...)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			if idx[i] < 0 {
				continue
			}
			counts := map[int]int{}
			same := false
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := x+dx, y+dy
					if (dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= w || ny >= h {
						continue
					}
					c := idx[ny*w+nx]
					if c == idx[i] && (dx == 0 || dy == 0) {
						same = true
					}
					if c >= 0 {
						counts[c]++
					}
				}
			}
			if same {
				continue
			}
			for c, n := range counts {
				if n >= 6 && paletteLab[c].dist(paletteLab[idx[i]]) < maxDE {
					out[i] = c
				}
			}
		}
	}
	return out
}
