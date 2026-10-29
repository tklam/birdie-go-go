package weather

import (
	"errors"
	"math"
	"reflect"
	"slices"
	"testing"

	"birdiegogo/core/model"
)

// allSeasons gives every season the same climate.
func allSeasons(c model.Climate) map[string]model.Climate {
	out := map[string]model.Climate{}
	for _, s := range Seasons() {
		out[s] = c
	}
	return out
}

// mild is a climate whose means are well inside the valid ranges, so
// clamping doesn't bias averages.
func mild() model.Climate {
	return model.Climate{
		Cloud:  [2]float64{0.5, 0.15},
		Precip: [2]float64{0.4, 0.1},
		Temp:   [2]float64{20, 3},
		Fog:    [2]float64{0.4, 0.1},
		Wind:   [2]float64{0.4, 0.1},
	}
}

// slice returns the three Tseung Kwan O areas from content/areas.yaml.
func slice() []model.WeatherArea {
	c := func(cl, pr, te, fo, wi [2]float64) model.Climate {
		return model.Climate{Cloud: cl, Precip: pr, Temp: te, Fog: fo, Wind: wi}
	}
	type v = [2]float64
	return []model.WeatherArea{
		{ID: "tko_town", Altitude: 0.05, Center: model.Point{X: 760, Y: 520}, Climate: map[string]model.Climate{
			"spring": c(v{0.65, 0.2}, v{0.3, 0.3}, v{22, 3}, v{0.25, 0.2}, v{0.3, 0.2}),
			"summer": c(v{0.5, 0.3}, v{0.4, 0.3}, v{31, 2}, v{0.02, 0.05}, v{0.3, 0.25}),
			"autumn": c(v{0.3, 0.2}, v{0.1, 0.15}, v{25, 3}, v{0.05, 0.05}, v{0.3, 0.2}),
			"winter": c(v{0.45, 0.2}, v{0.1, 0.1}, v{16, 4}, v{0.1, 0.1}, v{0.4, 0.2}),
		}},
		{ID: "tko_waterfront", Altitude: 0, Center: model.Point{X: 760, Y: 820}, Climate: map[string]model.Climate{
			"spring": c(v{0.65, 0.2}, v{0.3, 0.3}, v{21, 3}, v{0.45, 0.25}, v{0.4, 0.2}),
			"summer": c(v{0.5, 0.3}, v{0.4, 0.3}, v{30, 2}, v{0.05, 0.05}, v{0.4, 0.25}),
			"autumn": c(v{0.3, 0.2}, v{0.1, 0.15}, v{25, 3}, v{0.08, 0.08}, v{0.4, 0.2}),
			"winter": c(v{0.45, 0.2}, v{0.1, 0.1}, v{16, 4}, v{0.15, 0.1}, v{0.5, 0.2}),
		}},
		{ID: "tko_hillside", Altitude: 0.35, Center: model.Point{X: 760, Y: 160}, Climate: map[string]model.Climate{
			"spring": c(v{0.75, 0.2}, v{0.35, 0.3}, v{19, 3}, v{0.45, 0.25}, v{0.4, 0.2}),
			"summer": c(v{0.6, 0.3}, v{0.45, 0.3}, v{28, 2}, v{0.1, 0.1}, v{0.4, 0.25}),
			"autumn": c(v{0.35, 0.2}, v{0.12, 0.15}, v{22, 3}, v{0.1, 0.1}, v{0.4, 0.2}),
			"winter": c(v{0.5, 0.2}, v{0.12, 0.1}, v{13, 4}, v{0.25, 0.15}, v{0.55, 0.2}),
		}},
	}
}

func mustDay(t *testing.T, p model.WeatherDayPayload) model.WeatherDay {
	t.Helper()
	w, err := Day(p)
	if err != nil {
		t.Fatalf("Day(%d): %v", p.Day, err)
	}
	return w
}

// series returns one area's parameter over consecutive slots of days
// first…last.
func series(t *testing.T, seed uint32, areas []model.WeatherArea, idx, first, last int, get func(model.WeatherParams) float64) []float64 {
	t.Helper()
	var out []float64
	for d := first; d <= last; d++ {
		w := mustDay(t, model.WeatherDayPayload{Seed: seed, Day: d, Areas: areas})
		for _, s := range w.Areas[idx].Slots {
			out = append(out, get(s))
		}
	}
	return out
}

func cloud(w model.WeatherParams) float64 { return w.Cloud }

func mean(xs []float64) float64 {
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

func corr(a, b []float64) float64 {
	ma, mb := mean(a), mean(b)
	var num, da, db float64
	for i := range a {
		num += (a[i] - ma) * (b[i] - mb)
		da += (a[i] - ma) * (a[i] - ma)
		db += (b[i] - mb) * (b[i] - mb)
	}
	return num / math.Sqrt(da*db)
}

func TestDayDeterministic(t *testing.T) {
	p := model.WeatherDayPayload{Seed: 42, Day: 40, Areas: slice()}
	a, b := mustDay(t, p), mustDay(t, p)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("same payload gave different weather")
	}
	p.Seed = 43
	if c := mustDay(t, p); reflect.DeepEqual(a.Areas, c.Areas) {
		t.Error("different seeds gave identical weather")
	}
}

// An area's weather doesn't depend on which other areas are requested or
// in what order, so the client can ask for any subset.
func TestDayIndependentOfOtherAreas(t *testing.T) {
	areas := slice()
	all := mustDay(t, model.WeatherDayPayload{Seed: 7, Day: 33, Areas: areas})
	reversed := slices.Clone(areas)
	slices.Reverse(reversed)
	rev := mustDay(t, model.WeatherDayPayload{Seed: 7, Day: 33, Areas: reversed})
	for i, a := range areas {
		one := mustDay(t, model.WeatherDayPayload{Seed: 7, Day: 33, Areas: []model.WeatherArea{a}})
		if !reflect.DeepEqual(one.Areas[0], all.Areas[i]) || !reflect.DeepEqual(one.Forecast[0], all.Forecast[i]) {
			t.Errorf("%s alone differs from %s among all areas", a.ID, a.ID)
		}
		if !reflect.DeepEqual(rev.Areas[len(areas)-1-i], all.Areas[i]) {
			t.Errorf("%s depends on area order", a.ID)
		}
	}
	if all.Areas[0].Area != "tko_town" || rev.Areas[0].Area != "tko_hillside" {
		t.Errorf("areas not in payload order: %s, %s", all.Areas[0].Area, rev.Areas[0].Area)
	}
}

func TestDayRanges(t *testing.T) {
	names := []string{Typhoon, Thunderstorm, Rainstorm, Rain, Drizzle, Foggy, Windy, Hazy, Cloudy, Clear}
	signals := []int{0, 1, 3, 8, 10}
	seen := map[string]bool{}
	for seed := range uint32(4) {
		for d := 1; d <= 2*DaysPerYear; d++ {
			w := mustDay(t, model.WeatherDayPayload{Seed: seed, Day: d, Areas: slice()})
			if w.Day != d || len(w.Areas) != 3 || len(w.Forecast) != 3 {
				t.Fatalf("day %d: got day %d, %d areas, %d forecasts", d, w.Day, len(w.Areas), len(w.Forecast))
			}
			for _, sig := range w.TyphoonSignal {
				if !slices.Contains(signals, sig) {
					t.Errorf("day %d: signal %d", d, sig)
				}
			}
			for _, aw := range slices.Concat(w.Areas, w.Forecast) {
				for slot, s := range aw.Slots {
					for _, v := range []float64{s.Cloud, s.Precip, s.Fog, s.Wind} {
						if v < 0 || v > 1 {
							t.Errorf("seed %d day %d %s: %+v out of 0–1", seed, d, aw.Area, s)
						}
					}
					if s.Temp < -5 || s.Temp > 42 {
						t.Errorf("seed %d day %d %s: implausible temp %.1f", seed, d, aw.Area, s.Temp)
					}
					if s.UV < 0 || s.UV > 16 {
						t.Errorf("seed %d day %d %s: uv %.1f", seed, d, aw.Area, s.UV)
					}
					if s.WindDir < 0 || s.WindDir >= 2*math.Pi+1e-9 {
						t.Errorf("seed %d day %d %s: windDir %.3f", seed, d, aw.Area, s.WindDir)
					}
					if !slices.Contains(names, aw.Named[slot]) {
						t.Errorf("seed %d day %d %s: named %q", seed, d, aw.Area, aw.Named[slot])
					}
					seen[aw.Named[slot]] = true
				}
			}
		}
	}
	for _, n := range []string{Clear, Cloudy, Drizzle, Rain, Rainstorm, Hazy, Foggy} {
		if !seen[n] {
			t.Errorf("named weather %q never occurred in the slice's climate", n)
		}
	}
}

// Consecutive slots change gradually, also across midnight, and much less
// than independent draws would.
func TestSmooth(t *testing.T) {
	areas := []model.WeatherArea{{ID: "a", Climate: allSeasons(mild())}}
	var within, across []float64
	for seed := range uint32(5) {
		xs := series(t, seed, areas, 0, 1, DaysPerYear, cloud)
		for i := 1; i < len(xs); i++ {
			d := math.Abs(xs[i] - xs[i-1])
			if i%SlotsPerDay == 0 {
				across = append(across, d)
			} else {
				within = append(within, d)
			}
		}
	}
	// Independent normal draws with σ = 0.15 differ by 0.17 on average.
	if m := mean(within); m > 0.08 {
		t.Errorf("mean cloud change within a day = %.3f, want ≤ 0.08", m)
	}
	if m, w := mean(across), mean(within); m > 1.5*w {
		t.Errorf("mean cloud change across midnight = %.3f, want ≤ 1.5 × within-day %.3f", m, w)
	}
	if m := mean(within); m < 0.005 {
		t.Errorf("mean cloud change = %.4f; weather barely changes", m)
	}
}

func TestAreasCorrelated(t *testing.T) {
	c := allSeasons(mild())
	areas := []model.WeatherArea{
		{ID: "a", Climate: c, Center: model.Point{X: 100, Y: 100}},
		{ID: "b", Climate: c, Center: model.Point{X: 140, Y: 120}},
	}
	for seed := range uint32(3) {
		a := series(t, seed, areas, 0, 1, DaysPerYear, cloud)
		b := series(t, seed, areas, 1, 1, DaysPerYear, cloud)
		if r := corr(a, b); r < 0.4 || r > 0.9 {
			t.Errorf("seed %d: cloud correlation of neighbouring areas = %.2f, want 0.4–0.9", seed, r)
		}
		if slices.Equal(a, b) {
			t.Errorf("seed %d: neighbouring areas have identical weather", seed)
		}
	}
}

// Areas on a line along the spring wind (easterlies, blowing west) see the
// same front later the further downwind they are.
func TestFrontFollowsWind(t *testing.T) {
	c := allSeasons(mild())
	areas := []model.WeatherArea{
		{ID: "east", Climate: c, Center: model.Point{X: 0}},
		{ID: "mid", Climate: c, Center: model.Point{X: -2 * FrontSpeed}},
		{ID: "west", Climate: c, Center: model.Point{X: -4 * FrontSpeed}},
	}
	bestLag := func(a, b []float64) int {
		best, bestR := 0, -2.0
		for k := -8; k <= 8; k++ {
			var x, y []float64
			for i := range a {
				if j := i + k; j >= 0 && j < len(b) {
					x, y = append(x, a[i]), append(y, b[j])
				}
			}
			if r := corr(x, y); r > bestR {
				best, bestR = k, r
			}
		}
		return best
	}
	var lagMid, lagWest []int
	for seed := range uint32(12) {
		for year := range 3 {
			first := year*DaysPerYear + 1
			east := series(t, seed, areas, 0, first, first+DaysPerSeason-1, cloud)
			mid := series(t, seed, areas, 1, first, first+DaysPerSeason-1, cloud)
			west := series(t, seed, areas, 2, first, first+DaysPerSeason-1, cloud)
			lagMid = append(lagMid, bestLag(east, mid))
			lagWest = append(lagWest, bestLag(east, west))
		}
	}
	slices.Sort(lagMid)
	slices.Sort(lagWest)
	// Directions drift ±0.45 rad around west, so lags are a little shorter
	// than the full 2 and 4 slots.
	if m := lagMid[len(lagMid)/2]; m < 1 || m > 2 {
		t.Errorf("median lag to mid = %d slots, want 1–2 (all: %v)", m, lagMid)
	}
	if m := lagWest[len(lagWest)/2]; m < 3 || m > 4 {
		t.Errorf("median lag to west = %d slots, want 3–4 (all: %v)", m, lagWest)
	}
}

func TestFrontLagOrder(t *testing.T) {
	// SPEC.md §4.9: with the wind blowing north-west, rain reaches the
	// islands (south-east) first, then the harbour, then the hills.
	islands, harbour, hills := model.Point{X: 3000, Y: 3000}, model.Point{X: 2000, Y: 2000}, model.Point{X: 1000, Y: 1000}
	dir := 5 * math.Pi / 4
	if !(frontLag(islands, dir) < frontLag(harbour, dir) && frontLag(harbour, dir) < frontLag(hills, dir)) {
		t.Errorf("lags islands %.2f, harbour %.2f, hills %.2f not increasing",
			frontLag(islands, dir), frontLag(harbour, dir), frontLag(hills, dir))
	}
}

func TestSeasonMeansFollowClimate(t *testing.T) {
	climates := map[string]model.Climate{}
	for i, s := range Seasons() {
		c := mild()
		c.Temp[0] = 12 + 6*float64(i)
		c.Cloud[0] = 0.3 + 0.1*float64(i)
		climates[s] = c
	}
	areas := []model.WeatherArea{{ID: "a", Climate: climates}}
	type acc struct{ cloud, precip, temp, fog, wind []float64 }
	got := map[string]*acc{}
	for seed := range uint32(6) {
		for d := 1; d <= DaysPerYear; d++ {
			w := mustDay(t, model.WeatherDayPayload{Seed: seed, Day: d, Areas: areas})
			a := got[SeasonOf(d)]
			if a == nil {
				a = &acc{}
				got[SeasonOf(d)] = a
			}
			for slot, s := range w.Areas[0].Slots {
				if w.TyphoonSignal[slot] > 0 {
					continue
				}
				a.cloud, a.precip, a.temp = append(a.cloud, s.Cloud), append(a.precip, s.Precip), append(a.temp, s.Temp)
				a.fog, a.wind = append(a.fog, s.Fog), append(a.wind, s.Wind)
			}
		}
	}
	for _, s := range Seasons() {
		c, a := climates[s], got[s]
		checks := []struct {
			name      string
			got, want float64
			tol       float64
		}{
			{"cloud", mean(a.cloud), c.Cloud[0], 0.05},
			{"precip", mean(a.precip), c.Precip[0], 0.05},
			{"temp", mean(a.temp), c.Temp[0], 0.8},
			{"fog", mean(a.fog), c.Fog[0], 0.05},
			{"wind", mean(a.wind), c.Wind[0], 0.05},
		}
		for _, ch := range checks {
			if math.Abs(ch.got-ch.want) > ch.tol {
				t.Errorf("%s mean %s = %.3f, want %.3f ± %.2f", s, ch.name, ch.got, ch.want, ch.tol)
			}
		}
	}
}

func TestDiurnalAndAltitude(t *testing.T) {
	c := allSeasons(mild())
	areas := []model.WeatherArea{
		{ID: "low", Climate: c, Altitude: 0},
		{ID: "peak", Climate: c, Altitude: 1},
	}
	var temp, fog, uv [2][3][]float64
	var wind [2][]float64
	for seed := range uint32(3) {
		for d := 1; d <= DaysPerYear; d++ {
			w := mustDay(t, model.WeatherDayPayload{Seed: seed, Day: d, Areas: areas})
			for i, aw := range w.Areas {
				for slot, s := range aw.Slots {
					temp[i][slot] = append(temp[i][slot], s.Temp)
					fog[i][slot] = append(fog[i][slot], s.Fog)
					uv[i][slot] = append(uv[i][slot], s.UV)
					wind[i] = append(wind[i], s.Wind)
				}
			}
		}
	}
	low := 0
	if !(mean(temp[low][1]) > mean(temp[low][2]) && mean(temp[low][2]) > mean(temp[low][0])) {
		t.Errorf("temp morning %.1f, afternoon %.1f, evening %.1f: want afternoon warmest, morning coolest",
			mean(temp[low][0]), mean(temp[low][1]), mean(temp[low][2]))
	}
	if !(mean(fog[low][0]) > mean(fog[low][2]) && mean(fog[low][2]) > mean(fog[low][1])) {
		t.Errorf("fog morning %.2f, afternoon %.2f, evening %.2f: want morning foggiest",
			mean(fog[low][0]), mean(fog[low][1]), mean(fog[low][2]))
	}
	if !(mean(uv[low][1]) > mean(uv[low][0]) && mean(uv[low][0]) > mean(uv[low][2]) && mean(uv[low][2]) < 0.5) {
		t.Errorf("uv morning %.1f, afternoon %.1f, evening %.1f: want afternoon highest, evening ~0",
			mean(uv[low][0]), mean(uv[low][1]), mean(uv[low][2]))
	}
	if d := mean(temp[0][1]) - mean(temp[1][1]); math.Abs(d-lapseRate) > 0.3 {
		t.Errorf("peak is %.1f °C colder, want ~%.0f", d, lapseRate)
	}
	if mean(uv[1][1]) <= mean(uv[0][1]) || mean(fog[1][0]) <= mean(fog[0][0]) || mean(wind[1]) <= mean(wind[0]) {
		t.Errorf("peak should have more UV, fog and wind than sea level")
	}
}

func TestUV(t *testing.T) {
	clear := model.WeatherParams{Cloud: 0}
	overcast := model.WeatherParams{Cloud: 1}
	tests := []struct {
		name      string
		less, gtr float64
	}{
		{"summer beats winter", UV(clear, "winter", 1, 0), UV(clear, "summer", 1, 0)},
		{"afternoon beats morning", UV(clear, "summer", 0, 0), UV(clear, "summer", 1, 0)},
		{"morning beats evening", UV(clear, "summer", 2, 0), UV(clear, "summer", 0, 0)},
		{"cloud reduces", UV(overcast, "summer", 1, 0), UV(clear, "summer", 1, 0)},
		{"altitude raises", UV(clear, "summer", 1, 0), UV(clear, "summer", 1, 1)},
	}
	for _, tt := range tests {
		if !(tt.less < tt.gtr) {
			t.Errorf("%s: %.2f !< %.2f", tt.name, tt.less, tt.gtr)
		}
	}
	if v := UV(clear, "summer", 1, 1); v < 11 {
		t.Errorf("clear summer afternoon on a peak: uv %.1f, want 11+", v)
	}
	if v := UV(clear, "summer", 2, 0); v > 1 {
		t.Errorf("summer evening: uv %.1f, want ~0", v)
	}
}

func TestTyphoons(t *testing.T) {
	areas := slice()
	var typhoons, years int
	for seed := range uint32(20) {
		for year := range 5 {
			years++
			var run []int
			flush := func(d int) {
				if len(run) == 0 {
					return
				}
				typhoons++
				ok := false
				for _, p := range typhoonPatterns() {
					ok = ok || slices.Equal(run, p)
				}
				if !ok {
					t.Errorf("seed %d day %d: typhoon signals %v aren't a rise/fall pattern", seed, d, run)
				}
				run = nil
			}
			for d := year*DaysPerYear + 1; d <= (year+1)*DaysPerYear; d++ {
				w := mustDay(t, model.WeatherDayPayload{Seed: seed, Day: d, Areas: areas})
				for slot, sig := range w.TyphoonSignal {
					if sig == 0 {
						flush(d)
						continue
					}
					if doy := dayOfYear(d); doy < TyphoonFirstDay || doy > TyphoonLastDay {
						t.Errorf("seed %d day %d (day of year %d): signal %d outside the typhoon window", seed, d, doy, sig)
					}
					run = append(run, sig)
					for _, aw := range w.Areas {
						s := aw.Slots[slot]
						if sig >= 8 && (aw.Named[slot] != Typhoon || s.Wind < 0.85 || s.Precip < 0.8 || s.Cloud < 0.95) {
							t.Errorf("seed %d day %d %s: signal %d but %+v %s", seed, d, aw.Area, sig, s, aw.Named[slot])
						}
					}
				}
			}
			flush((year + 1) * DaysPerYear)
		}
	}
	// 42 days × 4% is about 1.7 draws a year, a little fewer after
	// suppression.
	if rate := float64(typhoons) / float64(years); rate < 0.5 || rate > 2.5 {
		t.Errorf("%.2f typhoons per year, want 0.5–2.5", rate)
	}
}

func TestNamed(t *testing.T) {
	tests := []struct {
		name   string
		p      model.WeatherParams
		season string
		signal int
		want   string
	}{
		{"typhoon beats everything", model.WeatherParams{Precip: 0.9, Cloud: 0.9}, "summer", 8, Typhoon},
		{"signal 10", model.WeatherParams{}, "autumn", 10, Typhoon},
		{"signal 3 is just weather", model.WeatherParams{Cloud: 0.7}, "summer", 3, Cloudy},
		{"thunderstorm in summer", model.WeatherParams{Precip: 0.85, Cloud: 0.85}, "summer", 0, Thunderstorm},
		{"no thunderstorm in winter", model.WeatherParams{Precip: 0.85, Cloud: 0.85}, "winter", 0, Rainstorm},
		{"rainstorm", model.WeatherParams{Precip: 0.7, Cloud: 0.5}, "summer", 0, Rainstorm},
		{"rain", model.WeatherParams{Precip: 0.4}, "spring", 0, Rain},
		{"drizzle", model.WeatherParams{Precip: 0.15, Fog: 0.9}, "spring", 0, Drizzle},
		{"foggy", model.WeatherParams{Precip: 0.1, Fog: 0.5, Wind: 0.9}, "spring", 0, Foggy},
		{"windy", model.WeatherParams{Wind: 0.7, Temp: 33}, "winter", 0, Windy},
		{"hazy", model.WeatherParams{Temp: 30, Cloud: 0.3}, "summer", 0, Hazy},
		{"hot but cloudy", model.WeatherParams{Temp: 32, Cloud: 0.6}, "summer", 0, Cloudy},
		{"cloudy", model.WeatherParams{Cloud: 0.6}, "autumn", 0, Cloudy},
		{"clear", model.WeatherParams{Cloud: 0.59, Precip: 0.14, Fog: 0.49, Wind: 0.69, Temp: 29}, "autumn", 0, Clear},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Named(tt.p, tt.season, tt.signal); got != tt.want {
				t.Errorf("Named(%+v, %s, %d) = %s, want %s", tt.p, tt.season, tt.signal, got, tt.want)
			}
		})
	}
}

func TestForecastCloseButNotExact(t *testing.T) {
	areas := slice()
	var dCloud, dTemp []float64
	exact := 0
	for d := 1; d <= DaysPerYear; d++ {
		today := mustDay(t, model.WeatherDayPayload{Seed: 5, Day: d, Areas: areas})
		tomorrow := mustDay(t, model.WeatherDayPayload{Seed: 5, Day: d + 1, Areas: areas})
		for i, f := range today.Forecast {
			if f.Area != tomorrow.Areas[i].Area {
				t.Fatalf("forecast area %s, want %s", f.Area, tomorrow.Areas[i].Area)
			}
			if reflect.DeepEqual(f.Slots, tomorrow.Areas[i].Slots) {
				exact++
			}
			for slot, s := range f.Slots {
				real := tomorrow.Areas[i].Slots[slot]
				dCloud = append(dCloud, math.Abs(s.Cloud-real.Cloud))
				dTemp = append(dTemp, math.Abs(s.Temp-real.Temp))
			}
		}
	}
	if exact > 0 {
		t.Errorf("%d forecasts were exactly right", exact)
	}
	if m := mean(dCloud); m < 0.01 || m > 0.08 {
		t.Errorf("mean forecast cloud error = %.3f, want 0.01–0.08", m)
	}
	if m := mean(dTemp); m < 0.2 || m > 1.2 {
		t.Errorf("mean forecast temp error = %.2f °C, want 0.2–1.2", m)
	}
}

func TestSeasonOf(t *testing.T) {
	tests := []struct {
		day  int
		want string
	}{
		{1, "spring"}, {14, "spring"}, {15, "summer"}, {28, "summer"}, {29, "autumn"},
		{42, "autumn"}, {43, "winter"}, {56, "winter"}, {57, "spring"}, {71, "summer"},
	}
	for _, tt := range tests {
		if got := SeasonOf(tt.day); got != tt.want {
			t.Errorf("SeasonOf(%d) = %s, want %s", tt.day, got, tt.want)
		}
	}
}

func TestDayErrors(t *testing.T) {
	springOnly := map[string]model.Climate{"spring": mild()}
	ok := model.WeatherArea{ID: "a", Climate: allSeasons(mild())}
	tests := []struct {
		name string
		p    model.WeatherDayPayload
	}{
		{"no areas", model.WeatherDayPayload{Day: 1}},
		{"day 0", model.WeatherDayPayload{Day: 0, Areas: []model.WeatherArea{ok}}},
		{"missing season", model.WeatherDayPayload{Day: DaysPerSeason + 2, Areas: []model.WeatherArea{{ID: "a", Climate: springOnly}}}},
		{"no climate", model.WeatherDayPayload{Day: 1, Areas: []model.WeatherArea{{ID: "a"}}}},
		{"no id", model.WeatherDayPayload{Day: 1, Areas: []model.WeatherArea{{Climate: allSeasons(mild())}}}},
		{"duplicate id", model.WeatherDayPayload{Day: 1, Areas: []model.WeatherArea{ok, ok}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Day(tt.p); !errors.Is(err, ErrInvalidPayload) {
				t.Errorf("err = %v, want ErrInvalidPayload", err)
			}
		})
	}
	// Only the requested day's season is required; neighbouring seasons
	// (smoothing look-back, tomorrow's forecast) fall back to it.
	for _, d := range []int{1, DaysPerSeason} {
		if _, err := Day(model.WeatherDayPayload{Day: d, Areas: []model.WeatherArea{{ID: "a", Climate: springOnly}}}); err != nil {
			t.Errorf("spring-only area on day %d: %v", d, err)
		}
	}
}
