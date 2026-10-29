package main

import (
	"image"
	"image/color"
	"math"
)

// rgbImage is a float sRGB image (components 0..255), used for all
// processing between decoding the photo and quantizing the result.
type rgbImage struct {
	W, H int
	Pix  []float64 // 3 values per pixel
}

func newRGB(w, h int) *rgbImage { return &rgbImage{W: w, H: h, Pix: make([]float64, 3*w*h)} }

func (m *rgbImage) at(x, y int) (r, g, b float64) {
	i := 3 * (y*m.W + x)
	return m.Pix[i], m.Pix[i+1], m.Pix[i+2]
}

func (m *rgbImage) set(x, y int, r, g, b float64) {
	i := 3 * (y*m.W + x)
	m.Pix[i], m.Pix[i+1], m.Pix[i+2] = r, g, b
}

// fromImage copies rect r of img (clipped to its bounds) into an rgbImage.
func fromImage(img image.Image, r image.Rectangle) *rgbImage {
	r = r.Intersect(img.Bounds())
	out := newRGB(r.Dx(), r.Dy())
	for y := 0; y < r.Dy(); y++ {
		for x := 0; x < r.Dx(); x++ {
			c := color.NRGBAModel.Convert(img.At(r.Min.X+x, r.Min.Y+y)).(color.NRGBA)
			out.set(x, y, float64(c.R), float64(c.G), float64(c.B))
		}
	}
	return out
}

// boxBlur returns a copy blurred with a (2r+1)² box (r=0 copies).
func boxBlur(m *rgbImage, r int) *rgbImage {
	out := newRGB(m.W, m.H)
	if r <= 0 {
		copy(out.Pix, m.Pix)
		return out
	}
	for y := 0; y < m.H; y++ {
		for x := 0; x < m.W; x++ {
			var sr, sg, sb, n float64
			for yy := max(0, y-r); yy <= min(m.H-1, y+r); yy++ {
				for xx := max(0, x-r); xx <= min(m.W-1, x+r); xx++ {
					cr, cg, cb := m.at(xx, yy)
					sr, sg, sb, n = sr+cr, sg+cg, sb+cb, n+1
				}
			}
			out.set(x, y, sr/n, sg/n, sb/n)
		}
	}
	return out
}

func toLab(m *rgbImage) []lab {
	out := make([]lab, m.W*m.H)
	for i := range out {
		out[i] = rgbToLab(m.Pix[3*i], m.Pix[3*i+1], m.Pix[3*i+2])
	}
	return out
}

// cutoutParams control background removal. Coordinates are relative to the
// cropped image.
type cutoutParams struct {
	Tolerance  float64       // max Lab ΔE from the nearest background color
	Step       float64       // optional: also flood into pixels within Step of a background neighbor (0 = off)
	Clusters   int           // number of background colors sampled from the border
	MinShare   float64       // ignore border clusters below this share of border pixels (default 0.03)
	Blur       int           // box-blur radius applied before measuring colors
	Seeds      []image.Point // extra flood-fill start points (their colors join the background model)
	Keep       [][]fpoint    // polygons always kept (foreground)
	Drop       [][]fpoint    // polygons always removed (background)
	Enclosed   int           // if >0, enclosed background-colored regions of at least this many pixels are removed too
	Erode      int           // fringe erosion in pixels
	KeepParts  float64       // keep extra components with area ≥ KeepParts × largest (0 = largest only)
	BorderMask []bool        // optional: which border sides seed the flood (top,right,bottom,left); nil = all
}

type fpoint struct{ X, Y float64 }

// pointInPolygon uses the even-odd rule.
func pointInPolygon(p fpoint, poly []fpoint) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X-a.X)*(p.Y-a.Y)/(b.Y-a.Y)+a.X {
			in = !in
		}
	}
	return in
}

// kmeansLab clusters samples into at most k centers, deterministically
// (farthest-point initialization, fixed iterations).
func kmeansLab(samples []lab, k int) ([]lab, []float64) {
	if len(samples) == 0 || k <= 0 {
		return nil, nil
	}
	centers := []lab{samples[0]}
	minD := make([]float64, len(samples))
	for i, s := range samples {
		minD[i] = s.dist2(centers[0])
	}
	for len(centers) < k {
		best, bi := -1.0, -1
		for i, d := range minD {
			if d > best {
				best, bi = d, i
			}
		}
		if best <= 1e-9 {
			break
		}
		c := samples[bi]
		centers = append(centers, c)
		for i, s := range samples {
			minD[i] = math.Min(minD[i], s.dist2(c))
		}
	}
	assign := make([]int, len(samples))
	var counts []float64
	for iter := 0; iter < 12; iter++ {
		for i, s := range samples {
			bd, bj := math.Inf(1), 0
			for j, c := range centers {
				if d := s.dist2(c); d < bd {
					bd, bj = d, j
				}
			}
			assign[i] = bj
		}
		sums := make([]lab, len(centers))
		counts = make([]float64, len(centers))
		for i, s := range samples {
			j := assign[i]
			sums[j].L += s.L
			sums[j].A += s.A
			sums[j].B += s.B
			counts[j]++
		}
		for j := range centers {
			if counts[j] > 0 {
				centers[j] = lab{sums[j].L / counts[j], sums[j].A / counts[j], sums[j].B / counts[j]}
			}
		}
	}
	return centers, counts
}

func nearestDist(c lab, set []lab) float64 {
	best := math.Inf(1)
	for _, s := range set {
		best = math.Min(best, c.dist2(s))
	}
	return math.Sqrt(best)
}

// cutout returns a foreground mask (true = bird) for img.
func cutout(img *rgbImage, p cutoutParams) []bool {
	w, h := img.W, img.H
	labs := toLab(boxBlur(img, p.Blur))
	idx := func(x, y int) int { return y*w + x }

	sides := p.BorderMask
	if len(sides) != 4 {
		sides = []bool{true, true, true, true}
	}
	var border []image.Point
	for x := 0; x < w; x++ {
		if sides[0] {
			border = append(border, image.Pt(x, 0))
		}
		if sides[2] {
			border = append(border, image.Pt(x, h-1))
		}
	}
	for y := 1; y < h-1; y++ {
		if sides[3] {
			border = append(border, image.Pt(0, y))
		}
		if sides[1] {
			border = append(border, image.Pt(w-1, y))
		}
	}
	dropped := make([]bool, w*h)
	kept := make([]bool, w*h)
	if len(p.Drop) > 0 || len(p.Keep) > 0 {
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				c := fpoint{float64(x) + 0.5, float64(y) + 0.5}
				for _, poly := range p.Drop {
					if pointInPolygon(c, poly) {
						dropped[idx(x, y)] = true
					}
				}
				for _, poly := range p.Keep {
					if pointInPolygon(c, poly) {
						kept[idx(x, y)] = true
					}
				}
			}
		}
	}

	// Dropped pixels (e.g. a branch crossing the edge) don't describe the
	// background, so they stay out of the color model.
	samples := make([]lab, 0, len(border))
	for _, pt := range border {
		if i := idx(pt.X, pt.Y); !dropped[i] && !kept[i] {
			samples = append(samples, labs[i])
		}
	}
	k := p.Clusters
	if k <= 0 {
		k = 6
	}
	// Border colors covering only a small share of the border are usually
	// the bird (or a branch) touching the crop edge, not background.
	centers, counts := kmeansLab(samples, k)
	minShare := p.MinShare
	if minShare == 0 {
		minShare = 0.03
	}
	var model []lab
	for i, c := range centers {
		if counts[i] >= minShare*float64(len(samples)) {
			model = append(model, c)
		}
	}
	var seeds []image.Point
	for _, s := range p.Seeds {
		if s.X >= 0 && s.Y >= 0 && s.X < w && s.Y < h {
			model = append(model, labs[idx(s.X, s.Y)])
			seeds = append(seeds, s)
		}
	}

	matches := make([]bool, w*h)
	for i, c := range labs {
		matches[i] = nearestDist(c, model) <= p.Tolerance
	}
	// Flood fill the background from the border and the seeds. Dropped
	// pixels conduct the fill too, so a dropped branch doesn't wall off
	// background behind it.
	bg := make([]bool, w*h)
	stack := make([]int, 0, 1024)
	push := func(i int) {
		if !bg[i] && !kept[i] {
			bg[i] = true
			stack = append(stack, i)
		}
	}
	for _, pt := range border {
		if i := idx(pt.X, pt.Y); matches[i] || dropped[i] {
			push(i)
		}
	}
	for _, s := range seeds {
		push(idx(s.X, s.Y))
	}
	for len(stack) > 0 {
		i := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		x, y := i%w, i/w
		for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+d[0], y+d[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			j := idx(nx, ny)
			if bg[j] || kept[j] {
				continue
			}
			if matches[j] || dropped[j] || (p.Step > 0 && labs[j].dist(labs[i]) <= p.Step && !dropped[i]) {
				push(j)
			}
		}
	}

	fg := make([]bool, w*h)
	for i := range fg {
		fg[i] = (!bg[i] && !dropped[i]) || kept[i]
	}
	if p.Enclosed > 0 {
		for _, comp := range components(w, h, func(i int) bool { return !bg[i] && matches[i] && !kept[i] }, false) {
			if len(comp) >= p.Enclosed {
				for _, i := range comp {
					fg[i] = false
				}
			}
		}
	}
	fg = keepLargest(w, h, fg, p.KeepParts)
	fg = fillHoles(w, h, fg, w*h/50+1)
	for n := 0; n < p.Erode; n++ {
		fg = erode(w, h, fg, kept)
	}
	return keepLargest(w, h, fg, p.KeepParts)
}

// components returns the connected components (8- or 4-connected) of pixels
// satisfying in.
func components(w, h int, in func(int) bool, eight bool) [][]int {
	seen := make([]bool, w*h)
	var out [][]int
	dirs := [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}
	if eight {
		dirs = append(dirs, [2]int{1, 1}, [2]int{1, -1}, [2]int{-1, 1}, [2]int{-1, -1})
	}
	for start := 0; start < w*h; start++ {
		if seen[start] || !in(start) {
			continue
		}
		comp := []int{start}
		seen[start] = true
		for k := 0; k < len(comp); k++ {
			x, y := comp[k]%w, comp[k]/w
			for _, d := range dirs {
				nx, ny := x+d[0], y+d[1]
				if nx < 0 || ny < 0 || nx >= w || ny >= h {
					continue
				}
				j := ny*w + nx
				if !seen[j] && in(j) {
					seen[j] = true
					comp = append(comp, j)
				}
			}
		}
		out = append(out, comp)
	}
	return out
}

// keepLargest keeps the largest 8-connected foreground component, plus any
// component at least frac times its size.
func keepLargest(w, h int, fg []bool, frac float64) []bool {
	comps := components(w, h, func(i int) bool { return fg[i] }, true)
	largest := 0
	for _, c := range comps {
		largest = max(largest, len(c))
	}
	out := make([]bool, w*h)
	for _, c := range comps {
		if len(c) == largest || (frac > 0 && float64(len(c)) >= frac*float64(largest)) {
			for _, i := range c {
				out[i] = true
			}
		}
	}
	return out
}

// fillHoles turns background regions that don't touch the image border and
// are smaller than maxArea into foreground.
func fillHoles(w, h int, fg []bool, maxArea int) []bool {
	out := append([]bool(nil), fg...)
	for _, c := range components(w, h, func(i int) bool { return !fg[i] }, false) {
		if len(c) >= maxArea {
			continue
		}
		touches := false
		for _, i := range c {
			x, y := i%w, i/w
			if x == 0 || y == 0 || x == w-1 || y == h-1 {
				touches = true
				break
			}
		}
		if !touches {
			for _, i := range c {
				out[i] = true
			}
		}
	}
	return out
}

// erode removes foreground pixels with a 4-neighbor background pixel, except
// pixels in protect.
func erode(w, h int, fg, protect []bool) []bool {
	out := append([]bool(nil), fg...)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := y*w + x
			if !fg[i] || protect[i] {
				continue
			}
			if x == 0 || y == 0 || x == w-1 || y == h-1 || !fg[i-1] || !fg[i+1] || !fg[i-w] || !fg[i+w] {
				out[i] = false
			}
		}
	}
	return out
}

// maskBounds returns the bounding box of the foreground.
func maskBounds(w, h int, fg []bool) image.Rectangle {
	r := image.Rectangle{}
	first := true
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if !fg[y*w+x] {
				continue
			}
			px := image.Rect(x, y, x+1, y+1)
			if first {
				r, first = px, false
			} else {
				r = r.Union(px)
			}
		}
	}
	return r
}
