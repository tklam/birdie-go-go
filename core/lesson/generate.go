// Package lesson generates piano-lesson performances with hidden mistakes and
// grades the player's mistake flags against them (SPEC.md §6.2–6.3). It is
// pure and deterministic: the same payload always yields the same
// performance.
package lesson

import (
	"errors"
	"math"
	"math/rand/v2"
	"slices"

	"birdiegogo/core/model"
)

// ErrInvalidSong is wrapped by every error Generate returns.
var ErrInvalidSong = errors.New("invalid song")

const (
	// MinSpacingMs is the minimum distance between two mistake onsets.
	MinSpacingMs = 1500
	// MaxMistakes caps the number of mistakes in one performance.
	MaxMistakes = 12

	// seedStream is the PCG stream constant; the payload seed is the state.
	seedStream = 0xb17d1e
	// lowestPitch and highestPitch bound injected notes to an 88-key piano.
	lowestPitch  = 21
	highestPitch = 108
)

// kinds lists the mistake types in a fixed order, so the weighted choice
// doesn't depend on map iteration order.
func kinds() []string {
	return []string{
		model.MistakeWrongNote, model.MistakeMissedNote, model.MistakeExtraNote,
		model.MistakeRush, model.MistakeDrag, model.MistakeHesitation,
	}
}

// Generate renders the song as a performance in milliseconds and injects
// mistakes into it. It returns the performance and the answer key sorted by
// onset. Difficulty is clamped to 1–5; higher difficulty means fewer, more
// subtle mistakes.
func Generate(p model.LessonGeneratePayload) (model.Performance, []model.Mistake, error) {
	sc, err := newScore(p.Song)
	if err != nil {
		return model.Performance{}, nil, err
	}
	d := clampDifficulty(p.Difficulty)
	rng := rand.New(rand.NewPCG(uint64(p.Seed), seedStream))
	plans := choosePlans(sc, levelFor(d), kindWeights(p.Tendencies), rng)
	perf, mistakes := render(sc, plans)
	return perf, mistakes, nil
}

func clampDifficulty(d int) int {
	return min(max(d, 1), 5)
}

// level holds the subtlety knobs for one difficulty.
type level struct {
	difficulty int
	// wrongMin and wrongMax bound the wrong-note interval in semitones.
	wrongMin, wrongMax int
	// preferInKey picks in-key wrong and grace notes (subtle) over
	// chromatic ones (obvious).
	preferInKey bool
	// timingMin and timingMax bound rush and drag offsets in ms.
	timingMin, timingMax float64
	// pauseMin and pauseMax bound hesitation pauses in ms.
	pauseMin, pauseMax float64
	// graceChance is the chance that an extra note is a quiet grace note
	// rather than a clear clunker.
	graceChance float64
	// intervalMs is the average song time per mistake.
	intervalMs float64
}

func levelFor(d int) level {
	obvious := float64(5 - d) // 4 at difficulty 1, 0 at difficulty 5
	l := level{
		difficulty:  d,
		preferInKey: d >= 3,
		timingMin:   60 + 30*obvious,
		pauseMin:    300 + 150*obvious,
		graceChance: float64(d-1) / 4,
		intervalMs:  float64(5+d) * 1000,
	}
	l.timingMax = l.timingMin + 70
	l.pauseMax = l.pauseMin + 300
	switch d {
	case 1:
		l.wrongMin, l.wrongMax = 5, 12
	case 2:
		l.wrongMin, l.wrongMax = 3, 7
	case 3:
		l.wrongMin, l.wrongMax = 2, 4
	case 4:
		l.wrongMin, l.wrongMax = 1, 3
	default:
		l.wrongMin, l.wrongMax = 1, 2
	}
	return l
}

// kindWeights turns student tendencies into one weight per kinds() entry.
// Types the student has no tendency for get a small base weight relative to
// the strongest tendency, so every type can appear.
func kindWeights(tendencies map[string]float64) []float64 {
	ks := kinds()
	strongest := 0.0
	for _, k := range ks {
		if v := tendencies[k]; usable(v) && v > strongest {
			strongest = v
		}
	}
	base := 1.0
	if strongest > 0 {
		base = strongest / 10
	}
	w := make([]float64, len(ks))
	for i, k := range ks {
		if v := tendencies[k]; usable(v) && v > 0 {
			w[i] = v
		} else {
			w[i] = base
		}
	}
	return w
}

func usable(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func pickKind(weights []float64, rng *rand.Rand) string {
	total := 0.0
	for _, w := range weights {
		total += w
	}
	r := rng.Float64() * total
	ks := kinds()
	for i, w := range weights {
		if r < w {
			return ks[i]
		}
		r -= w
	}
	return ks[len(ks)-1]
}

// mistakeCount scales the number of mistakes with the song length.
func mistakeCount(durationMs float64, l level) int {
	n := int(math.Round(durationMs / l.intervalMs))
	return min(max(n, 1), MaxMistakes)
}

// choosePlans picks mistake targets in random order, skipping any whose
// onset would come within MinSpacingMs of an already chosen one. Group 0
// (the very first note) is never a target.
func choosePlans(sc score, l level, weights []float64, rng *rand.Rand) []plan {
	want := mistakeCount(sc.durationMs, l)
	plans := make([]plan, 0, want)
	for _, i := range rng.Perm(len(sc.groups) - 1) {
		if len(plans) == want {
			break
		}
		kind := pickKind(weights, rng)
		pl, ok := planFor(kind, sc, i+1, l, rng)
		if !ok || !spaced(plans, pl.onsetMs) {
			continue
		}
		plans = append(plans, pl)
	}
	slices.SortFunc(plans, func(a, b plan) int { return a.group - b.group })
	return plans
}

func spaced(plans []plan, onsetMs float64) bool {
	for _, p := range plans {
		if math.Abs(p.onsetMs-onsetMs) < MinSpacingMs {
			return false
		}
	}
	return true
}

func uniform(rng *rand.Rand, lo, hi float64) float64 {
	return lo + rng.Float64()*(hi-lo)
}
