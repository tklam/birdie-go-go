package main

import (
	"image"
	"math"
	"sort"
)

// rgbaFrame is a small float image with coverage alpha (0..1) and straight
// (un-premultiplied) color.
type rgbaFrame struct {
	W, H  int
	Pix   []float64 // 3 per pixel, sRGB 0..255
	Alpha []float64
}

func newFrame(w, h int) *rgbaFrame {
	return &rgbaFrame{W: w, H: h, Pix: make([]float64, 3*w*h), Alpha: make([]float64, w*h)}
}

// spanWeights returns, for each of n output cells covering [0,srcLen) source
// pixels, the overlapping source pixels and their overlap lengths.
func spanWeights(srcLen, n int) [][]struct {
	i int
	w float64
} {
	out := make([][]struct {
		i int
		w float64
	}, n)
	scale := float64(srcLen) / float64(n)
	for o := 0; o < n; o++ {
		a, b := float64(o)*scale, float64(o+1)*scale
		for i := int(math.Floor(a)); i < int(math.Ceil(b)) && i < srcLen; i++ {
			ov := math.Min(b, float64(i+1)) - math.Max(a, float64(i))
			if ov > 1e-9 {
				out[o] = append(out[o], struct {
					i int
					w float64
				}{i, ov})
			}
		}
	}
	return out
}

// downscale area-averages region r of img (with per-pixel coverage mask; nil
// means fully opaque) into an ow×oh frame using premultiplied color.
func downscale(img *rgbImage, mask []bool, r image.Rectangle, ow, oh int) *rgbaFrame {
	out := newFrame(ow, oh)
	xs := spanWeights(r.Dx(), ow)
	ys := spanWeights(r.Dy(), oh)
	for oy := 0; oy < oh; oy++ {
		for ox := 0; ox < ow; ox++ {
			var sr, sg, sb, sa, sw float64
			for _, wy := range ys[oy] {
				y := r.Min.Y + wy.i
				for _, wx := range xs[ox] {
					x := r.Min.X + wx.i
					wgt := wx.w * wy.w
					sw += wgt
					if mask != nil && !mask[y*img.W+x] {
						continue
					}
					cr, cg, cb := img.at(x, y)
					sr, sg, sb, sa = sr+wgt*cr, sg+wgt*cg, sb+wgt*cb, sa+wgt
				}
			}
			o := oy*ow + ox
			if sw > 0 {
				out.Alpha[o] = sa / sw
			}
			if sa > 0 {
				out.Pix[3*o], out.Pix[3*o+1], out.Pix[3*o+2] = sr/sa, sg/sa, sb/sa
			}
		}
	}
	return out
}

// fitSize returns the output size for a w×h region whose long side becomes
// size pixels.
func fitSize(w, h, size int) (int, int) {
	if w >= h {
		return size, max(1, int(math.Round(float64(h)*float64(size)/float64(w))))
	}
	return max(1, int(math.Round(float64(w)*float64(size)/float64(h)))), size
}

// placeInFrame copies src into a fw×fh frame. anchor "bottom" puts the
// lowest opaque row at fh-1-pad and centers horizontally; anything else
// centers both ways (by opaque bounds). dx/dy nudge the result.
func placeInFrame(src *rgbaFrame, fw, fh int, anchor string, pad, dx, dy int) *rgbaFrame {
	out := newFrame(fw, fh)
	off, ok := placeOffset(src, fw, fh, anchor, pad, dx, dy)
	if !ok {
		return out
	}
	for y := 0; y < src.H; y++ {
		for x := 0; x < src.W; x++ {
			tx, ty := x+off.X, y+off.Y
			s := y*src.W + x
			if tx < 0 || ty < 0 || tx >= fw || ty >= fh || src.Alpha[s] <= 0 {
				continue
			}
			t := ty*fw + tx
			out.Alpha[t] = src.Alpha[s]
			copy(out.Pix[3*t:3*t+3], src.Pix[3*s:3*s+3])
		}
	}
	return out
}

// placeOffset returns where placeInFrame puts src: frame pixel = src pixel
// + offset. ok is false if src has no opaque pixel.
func placeOffset(src *rgbaFrame, fw, fh int, anchor string, pad, dx, dy int) (image.Point, bool) {
	minX, minY, maxX, maxY := src.W, src.H, -1, -1
	for y := 0; y < src.H; y++ {
		for x := 0; x < src.W; x++ {
			if src.Alpha[y*src.W+x] > 0 {
				minX, minY = min(minX, x), min(minY, y)
				maxX, maxY = max(maxX, x), max(maxY, y)
			}
		}
	}
	if maxX < 0 {
		return image.Point{}, false
	}
	bw, bh := maxX-minX+1, maxY-minY+1
	ox := (fw-bw)/2 + dx
	oy := (fh-bh)/2 + dy
	if anchor == "bottom" {
		oy = fh - 1 - pad - (bh - 1) + dy
	}
	return image.Pt(ox-minX, oy-minY), true
}

// flipX mirrors a frame horizontally in place.
func (f *rgbaFrame) flipX() {
	for y := 0; y < f.H; y++ {
		for x := 0; x < f.W/2; x++ {
			a, b := y*f.W+x, y*f.W+f.W-1-x
			f.Alpha[a], f.Alpha[b] = f.Alpha[b], f.Alpha[a]
			for c := 0; c < 3; c++ {
				f.Pix[3*a+c], f.Pix[3*b+c] = f.Pix[3*b+c], f.Pix[3*a+c]
			}
		}
	}
}

// threshold makes alpha binary.
func (f *rgbaFrame) threshold(t float64) {
	for i, a := range f.Alpha {
		if a >= t {
			f.Alpha[i] = 1
		} else {
			f.Alpha[i] = 0
		}
	}
}

// adjust tweaks color in Lab: chroma scaled by sat, L by contrast around 50
// plus bright.
func (f *rgbaFrame) adjust(sat, contrast, bright float64) {
	if sat == 1 && contrast == 1 && bright == 0 {
		return
	}
	for i := 0; i < f.W*f.H; i++ {
		c := rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2])
		c.A *= sat
		c.B *= sat
		c.L = math.Max(0, math.Min(100, (c.L-50)*contrast+50+bright))
		f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = labToRGB(c)
	}
}

// sharpen applies an unsharp mask to lightness: each opaque pixel moves
// away from the mean of its opaque 3×3 neighborhood by amount.
func (f *rgbaFrame) sharpen(amount float64) {
	if amount == 0 {
		return
	}
	labs := make([]lab, f.W*f.H)
	for i := range labs {
		labs[i] = rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2])
	}
	for y := 0; y < f.H; y++ {
		for x := 0; x < f.W; x++ {
			i := y*f.W + x
			if f.Alpha[i] <= 0 {
				continue
			}
			var sum, n float64
			for yy := max(0, y-1); yy <= min(f.H-1, y+1); yy++ {
				for xx := max(0, x-1); xx <= min(f.W-1, x+1); xx++ {
					if j := yy*f.W + xx; f.Alpha[j] > 0 {
						sum += labs[j].L
						n++
					}
				}
			}
			c := labs[i]
			c.L = math.Max(0, math.Min(100, c.L+amount*(c.L-sum/n)))
			f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = labToRGB(c)
		}
	}
}

// autoLevels stretches the lightness of opaque pixels so the 2nd percentile
// reaches at most lo and the 98th at least hi (it never compresses).
func (f *rgbaFrame) autoLevels(lo, hi float64) {
	var ls []float64
	for i, a := range f.Alpha {
		if a > 0 {
			ls = append(ls, rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2]).L)
		}
	}
	if len(ls) < 2 {
		return
	}
	sort.Float64s(ls)
	p2, p98 := ls[len(ls)*2/100], ls[len(ls)*98/100]
	if p98-p2 < 1 {
		return
	}
	tlo, thi := math.Min(p2, lo), math.Max(p98, hi)
	for i, a := range f.Alpha {
		if a <= 0 {
			continue
		}
		c := rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2])
		c.L = math.Max(0, math.Min(100, (c.L-p2)/(p98-p2)*(thi-tlo)+tlo))
		f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = labToRGB(c)
	}
}
