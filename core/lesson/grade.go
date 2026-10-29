package lesson

import (
	"cmp"
	"math"
	"slices"

	"birdiegogo/core/model"
)

// The hit window around a mistake onset (SPEC.md §6.3), both ends inclusive.
const (
	HitWindowBeforeMs = 100
	HitWindowAfterMs  = 1000
	// FalseAlarmPenalty is the score lost per unmatched flag.
	FalseAlarmPenalty = 10
)

// Grade matches the player's flags against the answer key (SPEC.md §6.3).
// Each flag is corrected by subtracting latencyOffsetMs. Mistakes are taken
// in onset order and each gets the earliest unmatched flag inside its
// window; flags left over are false alarms. The inputs are not modified.
func Grade(mistakes []model.Mistake, flagsMs []float64, latencyOffsetMs float64) model.LessonGradeResult {
	key := slices.Clone(mistakes)
	slices.SortStableFunc(key, func(a, b model.Mistake) int { return cmp.Compare(a.OnsetMs, b.OnsetMs) })
	flags := make([]float64, len(flagsMs))
	for i, f := range flagsMs {
		flags[i] = f - latencyOffsetMs
	}
	slices.Sort(flags)
	used := make([]bool, len(flags))

	res := model.LessonGradeResult{Mistakes: make([]model.GradedMistake, 0, len(key))}
	for _, m := range key {
		hit := claimFlag(flags, used, m.OnsetMs-HitWindowBeforeMs, m.OnsetMs+HitWindowAfterMs)
		if hit {
			res.Hits++
		} else {
			res.Misses++
		}
		res.Mistakes = append(res.Mistakes, model.GradedMistake{Mistake: m, Hit: hit})
	}
	res.FalseAlarms = len(flags) - res.Hits
	res.Score = score100(res.Hits, len(key), res.FalseAlarms)
	return res
}

// claimFlag marks the earliest unused flag in [lo, hi] as used. flags must
// be sorted.
func claimFlag(flags []float64, used []bool, lo, hi float64) bool {
	for i, f := range flags {
		if f > hi {
			break
		}
		if !used[i] && f >= lo {
			used[i] = true
			return true
		}
	}
	return false
}

// score100 is 100·hits/mistakes − 10·falseAlarms, rounded and clamped to
// 0–100. With no mistakes to find, only false alarms count.
func score100(hits, mistakes, falseAlarms int) int {
	s := 100.0
	if mistakes > 0 {
		s = 100 * float64(hits) / float64(mistakes)
	}
	s -= FalseAlarmPenalty * float64(falseAlarms)
	return int(min(max(math.Round(s), 0), 100))
}
