// Package transit is the transit network of SPEC.md §4.11: a graph of lines
// and stops, deterministic timetables, timetabled vehicle positions and a
// route planner. Everything is a pure function of the network and the
// in-game time; nothing is simulated.
//
// Times are in-game minutes. Absolute times count from day 0 at midnight
// (day × 1440 + minutes since midnight). A line's Speed in px/s is taken as px
// per in-game minute, since a ride on the map runs one in-game minute per
// real second.
package transit

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"birdiegogo/core/model"
)

// Timetable defaults for lines that leave them out.
const (
	MinutesPerDay  = 1440
	DefaultHeadway = 15.0
	DefaultFirst   = 6 * 60
	DefaultLast    = 23*60 + 30
)

// eps absorbs float rounding when comparing times and distances.
const eps = 1e-9

// Errors returned by this package; match them with errors.Is.
var (
	ErrInvalidNetwork = errors.New("invalid transit network")
	ErrUnknownStop    = errors.New("unknown stop")
	ErrUnknownLine    = errors.New("unknown line")
	ErrUnreachable    = errors.New("destination unreachable")
)

// UnreachableError reports that no allowed line connects From to To. It
// matches ErrUnreachable.
type UnreachableError struct {
	From, To string
}

func (e *UnreachableError) Error() string {
	return fmt.Sprintf("%v: no route from %q to %q", ErrUnreachable, e.From, e.To)
}

// Is makes errors.Is(err, ErrUnreachable) true.
func (e *UnreachableError) Is(target error) bool { return target == ErrUnreachable }

// Line is a built line: its content plus path geometry and timetable.
type Line struct {
	model.TransitLine
	// Headway, First and Last in minutes, defaults applied.
	HeadwayMin, FirstMin, LastMin float64
	// cum[i] is the path distance from the first point to point i.
	cum []float64
	// StopDist[i] is the path distance of Stops[i] from the first point.
	StopDist []float64
}

// Length is the path length in px.
func (l *Line) Length() float64 { return l.cum[len(l.cum)-1] }

// Duration is the minutes a vehicle takes from one terminus to the other.
func (l *Line) Duration() float64 { return l.Length() / l.Speed }

// Trips is how many departures each terminus has per day.
func (l *Line) Trips() int {
	return int(math.Floor((l.LastMin-l.FirstMin)/l.HeadwayMin+eps)) + 1
}

// serving is one stop of one line: the line's index in the network and the
// stop's index in the line.
type serving struct {
	line, stop int
}

// Network is a built transit network. It is immutable once built and safe to
// share.
type Network struct {
	lines   []*Line
	byID    map[string]int
	stops   map[string]bool
	serving map[string][]serving
}

// Build checks the network and prepares its geometry and timetables.
// positions are stop positions in world pixels (from the world index); they
// place intermediate stops along their paths. Intermediate stops without a
// position are spaced evenly between their neighbours.
func Build(t model.Transit, positions map[string]model.Point) (*Network, error) {
	n := &Network{
		byID:    make(map[string]int, len(t.Lines)),
		stops:   make(map[string]bool, len(t.Stops)),
		serving: make(map[string][]serving),
	}
	for _, s := range t.Stops {
		if s.ID == "" || n.stops[s.ID] {
			return nil, fmt.Errorf("%w: stop %q is empty or duplicated", ErrInvalidNetwork, s.ID)
		}
		n.stops[s.ID] = true
	}
	for _, tl := range t.Lines {
		if _, dup := n.byID[tl.ID]; dup || tl.ID == "" {
			return nil, fmt.Errorf("%w: line %q is empty or duplicated", ErrInvalidNetwork, tl.ID)
		}
		l, err := n.buildLine(tl, positions)
		if err != nil {
			return nil, fmt.Errorf("%w: line %s: %w", ErrInvalidNetwork, tl.ID, err)
		}
		idx := len(n.lines)
		n.byID[l.ID] = idx
		n.lines = append(n.lines, l)
		for i, st := range l.Stops {
			n.serving[st] = append(n.serving[st], serving{line: idx, stop: i})
		}
	}
	return n, nil
}

func (n *Network) buildLine(tl model.TransitLine, positions map[string]model.Point) (*Line, error) {
	if len(tl.Stops) < 2 {
		return nil, errors.New("needs at least two stops")
	}
	for _, st := range tl.Stops {
		if !n.stops[st] {
			return nil, fmt.Errorf("%w %q", ErrUnknownStop, st)
		}
	}
	if len(tl.Path) < 2 {
		return nil, errors.New("path needs at least two points")
	}
	if tl.Speed <= 0 || tl.Fare < 0 || tl.Headway < 0 {
		return nil, errors.New("speed must be > 0, fare and headway ≥ 0")
	}
	l := &Line{TransitLine: tl, HeadwayMin: tl.Headway, FirstMin: DefaultFirst, LastMin: DefaultLast}
	if l.HeadwayMin == 0 {
		l.HeadwayMin = DefaultHeadway
	}
	var err error
	if tl.First != "" {
		if l.FirstMin, err = ParseClock(tl.First); err != nil {
			return nil, fmt.Errorf("first: %w", err)
		}
	}
	if tl.Last != "" {
		if l.LastMin, err = ParseClock(tl.Last); err != nil {
			return nil, fmt.Errorf("last: %w", err)
		}
	}
	if err := CheckService(l.FirstMin, l.LastMin); err != nil {
		return nil, err
	}
	l.cum = make([]float64, len(tl.Path))
	for i := 1; i < len(tl.Path); i++ {
		a, b := tl.Path[i-1], tl.Path[i]
		l.cum[i] = l.cum[i-1] + math.Hypot(b[0]-a[0], b[1]-a[1])
	}
	if l.Length() <= 0 {
		return nil, errors.New("path has zero length")
	}
	l.placeStops(positions)
	return l, nil
}

// CheckService reports whether first and last departure times (minutes) make
// a valid daily service: first within the day, last no earlier than first
// and less than a day after it.
func CheckService(first, last float64) error {
	if first < 0 || first >= MinutesPerDay {
		return errors.New("first departure must be before 24:00")
	}
	if last < first || last-first >= MinutesPerDay {
		return errors.New("last departure must be after the first and within a day of it")
	}
	return nil
}

// placeStops finds each stop's distance along the path. The end stops sit on
// the path's ends; intermediate stops with a position snap to the nearest
// point of the path past the previous stop, and the rest are spaced evenly
// between their placed neighbours.
func (l *Line) placeStops(positions map[string]model.Point) {
	n := len(l.Stops)
	l.StopDist = make([]float64, n)
	placed := make([]bool, n)
	placed[0], placed[n-1] = true, true
	l.StopDist[n-1] = l.Length()
	prev := 0.0
	for i := 1; i < n-1; i++ {
		p, ok := positions[l.Stops[i]]
		if !ok {
			continue
		}
		prev = l.project(p, prev)
		l.StopDist[i] = prev
		placed[i] = true
	}
	for i := 1; i < n-1; i++ {
		if placed[i] {
			continue
		}
		a, b := i-1, i+1
		for !placed[b] {
			b++
		}
		// a is placed: either it was already, or this loop just filled it.
		l.StopDist[i] = l.StopDist[a] + (l.StopDist[b]-l.StopDist[a])/float64(b-a)
	}
}

// project returns the path distance (≥ min) of the path point nearest p.
func (l *Line) project(p model.Point, min float64) float64 {
	best, bestD := min, math.Inf(1)
	for j := 1; j < len(l.Path); j++ {
		a, b := l.Path[j-1], l.Path[j]
		seg := l.cum[j] - l.cum[j-1]
		if seg == 0 || l.cum[j] < min {
			continue
		}
		u := ((p.X-a[0])*(b[0]-a[0]) + (p.Y-a[1])*(b[1]-a[1])) / (seg * seg)
		lo := math.Max(0, (min-l.cum[j-1])/seg)
		u = math.Max(lo, math.Min(1, u))
		x, y := a[0]+(b[0]-a[0])*u, a[1]+(b[1]-a[1])*u
		if d := math.Hypot(p.X-x, p.Y-y); d < bestD-eps {
			best, bestD = l.cum[j-1]+seg*u, d
		}
	}
	return best
}

// pointAt returns the point s px along the path (clamped) and the unit
// direction of the path there.
func (l *Line) pointAt(s float64) (x, y, dx, dy float64) {
	s = math.Max(0, math.Min(l.Length(), s))
	for j := 1; j < len(l.Path); j++ {
		seg := l.cum[j] - l.cum[j-1]
		if seg == 0 || (s > l.cum[j] && j < len(l.Path)-1) {
			continue
		}
		a, b := l.Path[j-1], l.Path[j]
		u := (s - l.cum[j-1]) / seg
		return a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u, (b[0] - a[0]) / seg, (b[1] - a[1]) / seg
	}
	last := l.Path[len(l.Path)-1]
	return last[0], last[1], 0, 0
}

// subPath returns the polyline between path distances from and to, reversed
// when to < from.
func (l *Line) subPath(from, to float64) [][2]float64 {
	lo, hi := math.Min(from, to), math.Max(from, to)
	x, y, _, _ := l.pointAt(lo)
	out := [][2]float64{{x, y}}
	for j := 1; j < len(l.Path)-1; j++ {
		if l.cum[j] > lo+eps && l.cum[j] < hi-eps {
			out = append(out, l.Path[j])
		}
	}
	x, y, _, _ = l.pointAt(hi)
	out = append(out, [2]float64{x, y})
	if to < from {
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	return out
}

// Line returns a built line by ID.
func (n *Network) Line(id string) (*Line, bool) {
	i, ok := n.byID[id]
	if !ok {
		return nil, false
	}
	return n.lines[i], true
}

// Lines returns the lines in content order.
func (n *Network) Lines() []*Line { return append([]*Line(nil), n.lines...) }

// StopCount is the number of stops.
func (n *Network) StopCount() int { return len(n.stops) }

// ParseClock parses "HH:MM" (hours 0–47, so night services can pass
// midnight) into minutes.
func ParseClock(s string) (float64, error) {
	h, m, ok := strings.Cut(s, ":")
	if !ok || len(m) != 2 || h == "" || len(h) > 2 {
		return 0, fmt.Errorf("time %q is not HH:MM", s)
	}
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if err1 != nil || err2 != nil || hh < 0 || hh > 47 || mm < 0 || mm > 59 {
		return 0, fmt.Errorf("time %q is not HH:MM", s)
	}
	return float64(hh*60 + mm), nil
}
