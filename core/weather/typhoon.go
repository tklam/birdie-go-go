package weather

import "birdiegogo/core/model"

const (
	// TyphoonFirstDay and TyphoonLastDay bound the typhoon season as days
	// of the year (summer and early autumn). A typhoon starts and ends
	// inside this window.
	TyphoonFirstDay = DaysPerSeason + 1
	TyphoonLastDay  = 2*DaysPerSeason + DaysPerSeason/2
	// TyphoonChance is the chance per day in the window that a typhoon
	// starts (unless a draw fired in the previous three days).
	TyphoonChance = 0.04
)

// typhoonPatterns are the signal levels per slot from the onset morning:
// a two-day signal 8, a three-day signal 8 and a three-day signal 10.
func typhoonPatterns() [3][]int {
	return [3][]int{
		{1, 3, 8, 8, 3, 1},
		{1, 1, 3, 8, 8, 8, 3, 1, 1},
		{1, 3, 8, 10, 10, 8, 3, 1, 1},
	}
}

// typhoonDraw is the raw onset test of a day and the pattern it would use.
func typhoonDraw(s *sampler, day int) (bool, []int) {
	r := s.at(streamTyphoon, int64(day))
	start := r.Float64() < TyphoonChance
	kind := r.Float64()
	pats := typhoonPatterns()
	switch {
	case kind < 0.45:
		return start, pats[0]
	case kind < 0.8:
		return start, pats[1]
	default:
		return start, pats[2]
	}
}

// typhoonOnset reports whether a typhoon starts on day and returns its
// pattern. Onsets are suppressed when the draw fired on any of the three
// previous days (so typhoons never overlap or touch) and when the typhoon
// wouldn't end inside the window.
func typhoonOnset(s *sampler, day int) ([]int, bool) {
	start, pat := typhoonDraw(s, day)
	if !start {
		return nil, false
	}
	doy := dayOfYear(day)
	days := (len(pat) + SlotsPerDay - 1) / SlotsPerDay
	if doy < TyphoonFirstDay || doy+days-1 > TyphoonLastDay {
		return nil, false
	}
	for back := 1; back <= 3; back++ {
		if prev, _ := typhoonDraw(s, day-back); prev {
			return nil, false
		}
	}
	return pat, true
}

// typhoonSignals returns the signal per slot of a day (0 = none).
func typhoonSignals(s *sampler, day int) [3]int {
	var out [3]int
	for onset := day - 2; onset <= day; onset++ {
		pat, ok := typhoonOnset(s, onset)
		if !ok {
			continue
		}
		off := (day - onset) * SlotsPerDay
		for slot := range SlotsPerDay {
			if off+slot < len(pat) {
				out[slot] = max(out[slot], pat[off+slot])
			}
		}
	}
	return out
}

// applyTyphoon forces stormy weather in every area while a signal is up;
// at signal 8 and above it overrides the regular weather.
func applyTyphoon(w *model.WeatherParams, signal int) {
	switch {
	case signal >= 10:
		w.Cloud = 1
		w.Precip = max(w.Precip, 0.9)
		w.Wind = max(w.Wind, 0.97)
		w.Fog = min(w.Fog, 0.15)
	case signal >= 8:
		w.Cloud = max(w.Cloud, 0.95)
		w.Precip = max(w.Precip, 0.8)
		w.Wind = max(w.Wind, 0.85)
		w.Fog = min(w.Fog, 0.2)
	case signal >= 3:
		w.Cloud = max(w.Cloud, 0.7)
		w.Precip = max(w.Precip, 0.25)
		w.Wind = max(w.Wind, 0.55)
	case signal >= 1:
		w.Cloud = max(w.Cloud, 0.5)
		w.Wind += 0.1
	}
}
