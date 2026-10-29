package transit

import (
	"cmp"
	"fmt"
	"math"
	"slices"

	"birdiegogo/core/model"
)

// Timetables: every day, each terminus sends a vehicle at First, First +
// Headway, … up to Last. Forward trips (direction 1) leave the first stop,
// backward trips (direction −1) the last. Vehicles run the whole path at the
// line's speed without dwelling, so a trip's position is a pure function of
// the time since it departed.

// offset is the minutes from a trip's departure to its pass of stop i.
func (l *Line) offset(dir, i int) float64 {
	if dir > 0 {
		return l.StopDist[i] / l.Speed
	}
	return (l.Length() - l.StopDist[i]) / l.Speed
}

// RideTime is the minutes from stop index from to stop index to.
func (l *Line) RideTime(from, to int) float64 {
	return math.Abs(l.StopDist[to]-l.StopDist[from]) / l.Speed
}

// NextDeparture returns the departure time from its terminus of the first
// trip in direction dir that passes stop index i at or after t, and when it
// passes. Service repeats daily, so there is always one.
func (l *Line) NextDeparture(dir, i int, t float64) (depart, pass float64) {
	off := l.offset(dir, i)
	target := t - off
	day := math.Floor(target / MinutesPerDay)
	best := math.Inf(1)
	last := float64(l.Trips() - 1)
	// A day's departures lie within two days of its midnight, so the day
	// before, of and after the target cover the earliest one.
	for d := day - 1; d <= day+1; d++ {
		base := d*MinutesPerDay + l.FirstMin
		k := math.Max(0, math.Ceil((target-base)/l.HeadwayMin-eps))
		if k > last {
			continue
		}
		best = math.Min(best, base+k*l.HeadwayMin)
	}
	return best, best + off
}

// VehicleAt returns every vehicle of a line in service at absolute time t:
// forward trips first, each direction in departure order.
func (n *Network) VehicleAt(line string, t float64) ([]model.TransitVehicle, error) {
	l, ok := n.Line(line)
	if !ok {
		return nil, fmt.Errorf("%w %q", ErrUnknownLine, line)
	}
	return l.vehiclesAt(t), nil
}

func (l *Line) vehiclesAt(t float64) []model.TransitVehicle {
	dur := l.Duration()
	last := float64(l.Trips() - 1)
	out := []model.TransitVehicle{}
	for _, dir := range [2]int{1, -1} {
		start := len(out)
		// Trips in service departed in (t − dur, t].
		for d := math.Floor((t-dur)/MinutesPerDay) - 1; d <= math.Floor(t/MinutesPerDay); d++ {
			base := d*MinutesPerDay + l.FirstMin
			lo := math.Max(0, math.Floor((t-dur-base)/l.HeadwayMin+eps)+1)
			hi := math.Min(last, math.Floor((t-base)/l.HeadwayMin+eps))
			for k := lo; k <= hi; k++ {
				dep := base + k*l.HeadwayMin
				if dep > t+eps || dep+dur <= t+eps {
					continue
				}
				out = append(out, l.vehicle(dir, dep, t))
			}
		}
		slices.SortFunc(out[start:], func(a, b model.TransitVehicle) int { return cmp.Compare(a.Depart, b.Depart) })
	}
	return out
}

func (l *Line) vehicle(dir int, dep, t float64) model.TransitVehicle {
	s := (t - dep) * l.Speed
	progress := s / l.Length()
	if dir < 0 {
		s = l.Length() - s
	}
	x, y, dx, dy := l.pointAt(s)
	return model.TransitVehicle{
		Line: l.ID, Direction: dir, Depart: dep,
		X: x, Y: y, DX: turn(dx, dir), DY: turn(dy, dir),
		Progress: math.Min(1, progress),
	}
}

// turn flips a heading component for backward trips, without producing −0.
func turn(v float64, dir int) float64 {
	if v == 0 || dir > 0 {
		return v
	}
	return -v
}

// Vehicles answers transit.vehicles: the vehicles of the requested lines (all
// when none are named), in line order as requested.
func (n *Network) Vehicles(p model.TransitVehiclesPayload) (model.TransitVehiclesResult, error) {
	ids := p.Lines
	if len(ids) == 0 {
		for _, l := range n.lines {
			ids = append(ids, l.ID)
		}
	}
	out := model.TransitVehiclesResult{Vehicles: []model.TransitVehicle{}}
	for _, id := range ids {
		vs, err := n.VehicleAt(id, p.Time)
		if err != nil {
			return model.TransitVehiclesResult{}, err
		}
		out.Vehicles = append(out.Vehicles, vs...)
	}
	return out, nil
}
