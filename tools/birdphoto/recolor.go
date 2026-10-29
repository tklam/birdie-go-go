package main

import (
	"image"
	"math"
)

// HueShift recolors one hue range of a frame in CIE LCh (the polar form of
// Lab), e.g. to turn the green plumage of a wild-type bird into the teal of
// a color mutation. Lightness is kept (unless Lightness is set), so the
// shading of the photo survives; neutral pixels (pale beak, dark eye, white
// highlights) are left alone because their chroma is below MinChroma. Use
// Pose.Protect for colored details that must keep their color.
//
// Every pixel gets a weight w: 1 for hues within Width degrees of From,
// falling off smoothly (raised cosine) to 0 over the next Feather degrees.
// The hue moves by w toward To+(h-From)·Spread: with the default Spread 1
// that is a rotation by To-From that keeps the hue variation of the range;
// a smaller Spread also narrows the range around To (0 collapses it), which
// keeps a wide source range from spilling into neighboring hues. Chroma is
// scaled by 1+(Chroma-1)·w (a boost is capped at MaxChroma, but the cap
// never lowers a pixel's own chroma), and lightness moves by Lightness·w. The
// weight also fades in for chroma between MinChroma and 2·MinChroma so that
// nearly gray pixels don't jump.
//
// Palette hues for reference: green 140, light green 133, teal 172,
// dark teal 177, sky 250, light sea 251, blue 282.
type HueShift struct {
	From      float64  `yaml:"from"`      // source hue center, LCh degrees (green ≈ 135)
	To        float64  `yaml:"to"`        // target hue (teal ≈ 175)
	Width     float64  `yaml:"width"`     // half width of the fully shifted range (default 30)
	Feather   float64  `yaml:"feather"`   // falloff beyond Width in degrees (default 30)
	Spread    *float64 `yaml:"spread"`    // scale of the hue spread around To (default 1)
	MinChroma float64  `yaml:"minChroma"` // pixels below this chroma are untouched (default 6)
	Chroma    float64  `yaml:"chroma"`    // chroma multiplier (default 1)
	MaxChroma float64  `yaml:"maxChroma"` // cap for boosted chroma (default none)
	Lightness float64  `yaml:"lightness"` // L offset (default 0)
}

// hueDiff returns the signed difference a-b wrapped to (-180, 180].
func hueDiff(a, b float64) float64 {
	d := math.Mod(a-b, 360)
	if d > 180 {
		d -= 360
	} else if d <= -180 {
		d += 360
	}
	return d
}

// apply recolors a single Lab color.
func (s HueShift) apply(c lab) lab {
	width, feather := orDefault(s.Width, 30), orDefault(s.Feather, 30)
	minC := orDefault(s.MinChroma, 6)
	chroma := math.Hypot(c.A, c.B)
	if chroma < minC {
		return c
	}
	h := math.Atan2(c.B, c.A) * 180 / math.Pi
	d := math.Abs(hueDiff(h, s.From))
	var w float64
	switch {
	case d <= width:
		w = 1
	case d < width+feather:
		w = 0.5 * (1 + math.Cos(math.Pi*(d-width)/feather))
	default:
		return c
	}
	if chroma < 2*minC {
		w *= (chroma - minC) / minC
	}
	spread := 1.0
	if s.Spread != nil {
		spread = *s.Spread
	}
	target := s.To + hueDiff(h, s.From)*spread
	h += hueDiff(target, h) * w
	boosted := chroma * (1 + (orDefault(s.Chroma, 1)-1)*w)
	if s.MaxChroma > 0 && boosted > s.MaxChroma {
		boosted = math.Max(s.MaxChroma, math.Min(chroma, boosted))
	}
	chroma = boosted
	rad := h * math.Pi / 180
	return lab{
		L: math.Max(0, math.Min(100, c.L+s.Lightness*w)),
		A: chroma * math.Cos(rad),
		B: chroma * math.Sin(rad),
	}
}

// recolor applies the shifts in order to every opaque pixel of f. Each
// shift sees the output of the previous one.
func (f *rgbaFrame) recolor(shifts []HueShift) {
	if len(shifts) == 0 {
		return
	}
	for i := 0; i < f.W*f.H; i++ {
		if f.Alpha[i] <= 0 {
			continue
		}
		c := rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2])
		for _, s := range shifts {
			c = s.apply(c)
		}
		f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = labToRGB(c)
	}
}

// Tint gives near-gray pixels some color: a pixel whose chroma is below
// Chroma is blended toward hue Hue at chroma Chroma, fully for a pure gray
// and not at all once it already has Chroma. Only lightness in [MinL, MaxL]
// is tinted, so a dark eye, a pale beak and white highlights can be kept
// neutral. Use it for photos whose bird is grayish (e.g. a washed-out blue
// mutation) after HueShift has handled the colored pixels.
type Tint struct {
	Hue    float64 `yaml:"hue"`    // LCh hue of the tint (teal ≈ 178)
	Chroma float64 `yaml:"chroma"` // target chroma for gray pixels
	MinL   float64 `yaml:"minL"`   // darkest lightness tinted (default 0)
	MaxL   float64 `yaml:"maxL"`   // lightest lightness tinted (default 100)
}

func (t Tint) apply(c lab) lab {
	maxL := orDefault(t.MaxL, 100)
	chroma := math.Hypot(c.A, c.B)
	if t.Chroma <= 0 || chroma >= t.Chroma || c.L < t.MinL || c.L > maxL {
		return c
	}
	w := 1 - chroma/t.Chroma
	rad := t.Hue * math.Pi / 180
	c.A += w * t.Chroma * math.Cos(rad)
	c.B += w * t.Chroma * math.Sin(rad)
	return c
}

// tint applies t to every opaque pixel of f.
func (f *rgbaFrame) tint(t *Tint) {
	if t == nil {
		return
	}
	for i := 0; i < f.W*f.H; i++ {
		if f.Alpha[i] <= 0 {
			continue
		}
		c := t.apply(rgbToLab(f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2]))
		f.Pix[3*i], f.Pix[3*i+1], f.Pix[3*i+2] = labToRGB(c)
	}
}

// protectWeights returns, per pixel of the ow×oh frame that downscale makes
// from region bounds of a w×h crop, the share of its bird pixels that lie
// inside one of the protect polygons (crop coordinates).
func protectWeights(w, h int, mask []bool, bounds image.Rectangle, ow, oh int, protect [][]fpoint) []float64 {
	m := newRGB(w, h)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := fpoint{float64(x) + 0.5, float64(y) + 0.5}
			for _, poly := range protect {
				if pointInPolygon(c, poly) {
					m.set(x, y, 1, 1, 1)
					break
				}
			}
		}
	}
	small := downscale(m, mask, bounds, ow, oh)
	out := make([]float64, ow*oh)
	for i := range out {
		out[i] = small.Pix[3*i]
	}
	return out
}

// blendBack mixes the original colors orig back in with weight wt per pixel
// (1 = fully original).
func (f *rgbaFrame) blendBack(orig, wt []float64) {
	for i, t := range wt {
		if t <= 0 {
			continue
		}
		for c := 0; c < 3; c++ {
			f.Pix[3*i+c] = f.Pix[3*i+c]*(1-t) + orig[3*i+c]*t
		}
	}
}
