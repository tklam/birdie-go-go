package transit

import (
	"container/heap"
	"fmt"
	"slices"

	"birdiegogo/core/model"
)

// The planner is a multi-criteria label-setting search over stops (a
// time-dependent Dijkstra). A label is "at this stop at this time, having
// paid this much over this many rides". Labels leave the queue in order of
// arrival, then fare, then rides, then creation order, and a label is
// dropped when a settled label at its stop is at least as good in all three.
// Every ride is one leg on one vehicle from its boarding stop to any later
// stop of the line, so staying aboard through a stop is never a transfer and
// fares are paid once per boarding. The first label settled at the
// destination is the best itinerary: earliest arrival, then lowest fare,
// then fewest transfers, ties going to the line listed first in content.

type label struct {
	stop   string
	arrive float64
	fare   int
	rides  int
	seq    int
	parent int // index into the label arena, −1 for the start
	// The ride that got here: line index, direction, stop indices and the
	// time the vehicle left the boarding stop.
	line, dir, from, to int
	board               float64
}

// dominates reports whether a is at least as good as b in every criterion.
func (a *label) dominates(b *label) bool {
	return a.arrive <= b.arrive+eps && a.fare <= b.fare && a.rides <= b.rides
}

func (a *label) less(b *label) bool {
	switch {
	case a.arrive < b.arrive-eps:
		return true
	case a.arrive > b.arrive+eps:
		return false
	case a.fare != b.fare:
		return a.fare < b.fare
	case a.rides != b.rides:
		return a.rides < b.rides
	}
	return a.seq < b.seq
}

// queue is a heap of label indices into the arena.
type queue struct {
	arena *[]label
	items []int
}

func (q *queue) Len() int           { return len(q.items) }
func (q *queue) Less(i, j int) bool { return (*q.arena)[q.items[i]].less(&(*q.arena)[q.items[j]]) }
func (q *queue) Swap(i, j int)      { q.items[i], q.items[j] = q.items[j], q.items[i] }
func (q *queue) Push(x any)         { q.items = append(q.items, x.(int)) }
func (q *queue) Pop() any {
	x := q.items[len(q.items)-1]
	q.items = q.items[:len(q.items)-1]
	return x
}

// Plan finds the best itinerary from p.From to p.To leaving at p.Time, using
// only p.Lines (all lines when empty; unknown IDs are ignored) and skipping
// lines whose mode is in p.ExcludeModes. From == To gives an itinerary with
// no legs. If no allowed line connects them, the error is an
// *UnreachableError.
func (n *Network) Plan(p model.TransitPlanPayload) (model.TransitItinerary, error) {
	for _, st := range [2]string{p.From, p.To} {
		if !n.stops[st] {
			return model.TransitItinerary{}, fmt.Errorf("%w %q", ErrUnknownStop, st)
		}
	}
	allowed := n.allowedLines(p.Lines, p.ExcludeModes)
	arena := []label{{stop: p.From, arrive: p.Time, parent: -1}}
	q := &queue{arena: &arena, items: []int{0}}
	settled := map[string][]int{}
	for q.Len() > 0 {
		idx := heap.Pop(q).(int)
		cur := arena[idx]
		if slices.ContainsFunc(settled[cur.stop], func(s int) bool { return arena[s].dominates(&cur) }) {
			continue
		}
		settled[cur.stop] = append(settled[cur.stop], idx)
		if cur.stop == p.To {
			return n.itinerary(p, arena, idx), nil
		}
		for _, sv := range n.serving[cur.stop] {
			if !allowed[sv.line] {
				continue
			}
			l := n.lines[sv.line]
			for _, dir := range [2]int{1, -1} {
				board := cur.arrive
				if !p.IgnoreTimetable {
					_, board = l.NextDeparture(dir, sv.stop, cur.arrive)
				}
				for j := sv.stop + dir; j >= 0 && j < len(l.Stops); j += dir {
					if l.Stops[j] == cur.stop {
						continue
					}
					arrive := board + l.RideTime(sv.stop, j)
					next := label{
						stop: l.Stops[j], arrive: arrive, fare: cur.fare + l.Fare, rides: cur.rides + 1,
						seq: len(arena), parent: idx,
						line: sv.line, dir: dir, from: sv.stop, to: j, board: board,
					}
					if slices.ContainsFunc(settled[next.stop], func(s int) bool { return arena[s].dominates(&next) }) {
						continue
					}
					arena = append(arena, next)
					heap.Push(q, next.seq)
				}
			}
		}
	}
	return model.TransitItinerary{}, &UnreachableError{From: p.From, To: p.To}
}

// allowedLines marks the line indices the plan may use.
func (n *Network) allowedLines(ids, excludeModes []string) []bool {
	allowed := make([]bool, len(n.lines))
	for i, l := range n.lines {
		allowed[i] = (len(ids) == 0 || slices.Contains(ids, l.ID)) && !slices.Contains(excludeModes, l.Mode)
	}
	return allowed
}

// itinerary walks a destination label back to the start.
func (n *Network) itinerary(p model.TransitPlanPayload, arena []label, idx int) model.TransitItinerary {
	end := arena[idx]
	legs := []model.TransitLeg{}
	for i := idx; arena[i].parent >= 0; i = arena[i].parent {
		lb, prev := arena[i], arena[arena[i].parent]
		l := n.lines[lb.line]
		legs = append(legs, model.TransitLeg{
			Line: l.ID, Mode: l.Mode, From: prev.stop, To: lb.stop, Direction: lb.dir,
			Wait: lb.board - prev.arrive, Depart: lb.board, Arrive: lb.arrive, Ride: lb.arrive - lb.board, Fare: l.Fare,
			Path: l.subPath(l.StopDist[lb.from], l.StopDist[lb.to]),
		})
	}
	slices.Reverse(legs)
	it := model.TransitItinerary{
		From: p.From, To: p.To, Depart: p.Time, Arrive: end.arrive, Duration: end.arrive - p.Time,
		Fare: end.fare, Legs: legs,
	}
	if len(legs) > 1 {
		it.Transfers = len(legs) - 1
	}
	return it
}
