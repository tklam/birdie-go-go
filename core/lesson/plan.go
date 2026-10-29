package lesson

import (
	"cmp"
	"math/rand/v2"
	"slices"

	"birdiegogo/core/model"
)

// plan is one mistake to inject, targeting a note group.
type plan struct {
	kind  string
	group int
	// note indexes score.notes for wrong_note and missed_note.
	note int
	// pitch is the wrong or extra pitch.
	pitch int
	// offsetMs is the rush (negative) or drag (positive) shift, the
	// hesitation pause, or the extra note's start relative to the group.
	offsetMs float64
	// durMs and vel describe the extra note.
	durMs float64
	vel   int
	// onsetMs is the mistake onset before any hesitation shifts. Shifts
	// only ever widen the gaps between later onsets, so spacing checked
	// here still holds in the rendered performance.
	onsetMs float64
}

// planFor draws the parameters of one mistake of the given kind on group g.
// It reports false if the kind doesn't fit there (e.g. a rush would jump
// over the previous note).
func planFor(kind string, sc score, g int, l level, rng *rand.Rand) (plan, bool) {
	grp := sc.groups[g]
	p := plan{kind: kind, group: g, note: -1, onsetMs: grp.startMs}
	switch kind {
	case model.MistakeWrongNote:
		p.note = pickNote(grp, l, rng)
		pitch, ok := nearbyPitch(sc, grp, sc.notes[p.note].Pitch, l.wrongMin, l.wrongMax, l.preferInKey, rng)
		p.pitch = pitch
		return p, ok
	case model.MistakeMissedNote:
		p.note = pickNote(grp, l, rng)
		return p, true
	case model.MistakeExtraNote:
		return extraPlan(p, sc, l, rng)
	case model.MistakeRush:
		p.offsetMs = -uniform(rng, l.timingMin, l.timingMax)
		p.onsetMs = grp.startMs + p.offsetMs
		return p, p.onsetMs > sc.prevStart(g) && p.onsetMs >= 0
	case model.MistakeDrag:
		p.offsetMs = uniform(rng, l.timingMin, l.timingMax)
		return p, grp.startMs+p.offsetMs < sc.nextStart(g)
	case model.MistakeHesitation:
		p.offsetMs = uniform(rng, l.pauseMin, l.pauseMax)
		return p, true
	}
	return p, false
}

// pickNote chooses which note of a chord to change: the melody when
// mistakes should be obvious, an inner voice when they should be subtle.
func pickNote(grp group, l level, rng *rand.Rand) int {
	switch {
	case len(grp.notes) == 1 || l.difficulty <= 2:
		return grp.top()
	case l.difficulty >= 4:
		return grp.notes[rng.IntN(len(grp.notes)-1)]
	default:
		return grp.notes[rng.IntN(len(grp.notes))]
	}
}

// extraPlan inserts either a quiet grace note just before the group's melody
// note (subtle) or a clear note between this group and the next (obvious).
func extraPlan(p plan, sc score, l level, rng *rand.Rand) (plan, bool) {
	grp := sc.groups[p.group]
	top := sc.notes[grp.top()]
	if rng.Float64() < l.graceChance {
		p.durMs = uniform(rng, 60, 110)
		p.offsetMs = -p.durMs
		p.vel = max(top.Vel*3/5, 1)
		p.onsetMs = grp.startMs + p.offsetMs
		pitch, ok := nearbyPitch(sc, grp, top.Pitch, 1, 2, true, rng)
		p.pitch = pitch
		return p, ok && p.onsetMs > sc.prevStart(p.group) && p.onsetMs >= 0
	}
	gap := min(sc.nextStart(p.group), grp.startMs+top.DurMs) - grp.startMs
	if gap < 120 {
		return p, false
	}
	p.offsetMs = gap / 2
	p.durMs = min(gap/2, 400) * 0.9
	p.vel = top.Vel
	p.onsetMs = grp.startMs + p.offsetMs
	pitch, ok := nearbyPitch(sc, grp, top.Pitch, 3, 7, false, rng)
	p.pitch = pitch
	return p, ok
}

// nearbyPitch picks a pitch lo–hi semitones from near that isn't already in
// the chord, preferring in-key pitches when inKey is set (subtle) and
// chromatic ones otherwise (obvious).
func nearbyPitch(sc score, grp group, near, lo, hi int, inKey bool, rng *rand.Rand) (int, bool) {
	var preferred, other []int
	for k := lo; k <= hi; k++ {
		for _, cand := range []int{near - k, near + k} {
			if cand < lowestPitch || cand > highestPitch || sounds(sc, grp, cand) {
				continue
			}
			if sc.inKey[cand%12] == inKey {
				preferred = append(preferred, cand)
			} else {
				other = append(other, cand)
			}
		}
	}
	return pickPitch(preferred, other, rng)
}

func pickPitch(preferred, other []int, rng *rand.Rand) (int, bool) {
	switch {
	case len(preferred) > 0:
		return preferred[rng.IntN(len(preferred))], true
	case len(other) > 0:
		return other[rng.IntN(len(other))], true
	}
	return 0, false
}

// sounds reports whether the group already contains the pitch.
func sounds(sc score, grp group, pitch int) bool {
	for _, i := range grp.notes {
		if sc.notes[i].Pitch == pitch {
			return true
		}
	}
	return false
}

// render plays the score with the planned mistakes. Plans must be sorted by
// group with at most one per group.
func render(sc score, plans []plan) (model.Performance, []model.Mistake) {
	notes := make([]model.PerfNote, 0, len(sc.notes)+len(plans))
	mistakes := make([]model.Mistake, 0, len(plans))
	shift := 0.0 // accumulated hesitation pauses
	next := 0
	for gi, grp := range sc.groups {
		var pl *plan
		if next < len(plans) && plans[next].group == gi {
			pl = &plans[next]
			next++
		}
		start := grp.startMs + shift
		top := sc.notes[grp.top()].Pitch
		offset := 0.0
		if pl != nil {
			switch pl.kind {
			case model.MistakeHesitation:
				mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: start, Pitch: top, ExpectedPitch: top})
				shift += pl.offsetMs
				start += pl.offsetMs
			case model.MistakeRush:
				offset = pl.offsetMs
				mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: start + offset, Pitch: top, ExpectedPitch: top})
			case model.MistakeDrag:
				offset = pl.offsetMs
				mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: start, Pitch: top, ExpectedPitch: top})
			case model.MistakeExtraNote:
				extra := model.PerfNote{Pitch: pl.pitch, StartMs: start + pl.offsetMs, DurMs: pl.durMs, Vel: pl.vel}
				notes = append(notes, extra)
				mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: extra.StartMs, Pitch: pl.pitch})
			}
		}
		for _, ni := range grp.notes {
			n := sc.notes[ni]
			n.StartMs = start + offset
			if pl != nil && pl.note == ni {
				switch pl.kind {
				case model.MistakeMissedNote:
					mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: start, ExpectedPitch: n.Pitch})
					continue
				case model.MistakeWrongNote:
					mistakes = append(mistakes, model.Mistake{Type: pl.kind, OnsetMs: start, Pitch: pl.pitch, ExpectedPitch: n.Pitch})
					n.Pitch = pl.pitch
				}
			}
			notes = append(notes, n)
		}
	}
	slices.SortStableFunc(notes, func(a, b model.PerfNote) int { return cmp.Compare(a.StartMs, b.StartMs) })
	slices.SortStableFunc(mistakes, func(a, b model.Mistake) int { return cmp.Compare(a.OnsetMs, b.OnsetMs) })
	duration := 0.0
	for _, n := range notes {
		duration = max(duration, n.StartMs+n.DurMs)
	}
	return model.Performance{Notes: notes, DurationMs: duration}, mistakes
}
