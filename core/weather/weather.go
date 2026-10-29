// Package weather simulates the regional weather (SPEC.md §4.9): every area
// gets continuous weather parameters per day and time slot, built from its
// seasonal climate, a regional front shared by all areas that drifts along
// the wind, and per-area local variation, smoothed over time. It also
// derives UV (§4.12), typhoon signals, named weather and the radio forecast.
//
// The package is pure and deterministic: the same payload always yields the
// same WeatherDay, and any day can be computed on its own without state.
package weather

import (
	"errors"
	"fmt"
	"math"

	"birdiegogo/core/model"
)

// ErrInvalidPayload is wrapped by every error Day returns.
var ErrInvalidPayload = errors.New("invalid weather payload")

const (
	// DaysPerSeason is the length of a season; day 1 is the first day of
	// spring (SPEC.md §3.1).
	DaysPerSeason = 14
	// DaysPerYear is four seasons.
	DaysPerYear = 4 * DaysPerSeason
	// SlotsPerDay is morning, afternoon and evening.
	SlotsPerDay = 3

	// FrontSpeed is how fast the regional front drifts along the wind, in
	// world pixels per time slot: an area 512 px further downwind sees the
	// same front one slot later.
	FrontSpeed = 512.0

	// smoothSlots is how many slots before a day's morning the time
	// smoothing starts, from the climate mean.
	smoothSlots = 6
	// smoothKeep is the weight of the previous slot in the smoothing.
	smoothKeep = 0.5
	// gain compensates the variance the smoothing removes, so the spread
	// of the output roughly matches the climate's variability.
	gain = 1.25
	// frontWeight and localWeight split each parameter's variability
	// between the shared front and local variation (squares sum to 1).
	frontWeight = 0.8
	localWeight = 0.6

	frontTaps, frontPhi = 8, 0.8 // fronts persist for a couple of days
	localTaps, localPhi = 6, 0.6 // local variation is shorter-lived
	dirTaps, dirPhi     = 4, 0.7 // daily wind direction drift
	dirSpread           = 0.45   // radians of daily drift around prevailing
	localDirSpread      = 0.2    // radians of per-area/slot direction jitter

	// Altitude effects per 1.0 of altitude.
	lapseRate   = 6.0 // °C colder
	altitudeFog = 0.1
	altitudeWnd = 0.15
	altitudeUV  = 0.4 // relative UV increase

	minTemp, maxTemp = -10.0, 45.0
)

// Seasons lists the season names in order, starting with day 1.
func Seasons() [4]string {
	return [4]string{"spring", "summer", "autumn", "winter"}
}

// SeasonOf returns the season of a day (day 1 is the first day of spring;
// the year cycles every DaysPerYear days).
func SeasonOf(day int) string {
	return Seasons()[seasonIndex(day)]
}

func seasonIndex(day int) int {
	return floorMod(day-1, DaysPerYear) / DaysPerSeason
}

// dayOfYear returns 1…DaysPerYear.
func dayOfYear(day int) int {
	return floorMod(day-1, DaysPerYear) + 1
}

func floorMod(a, b int) int {
	return ((a % b) + b) % b
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// Parameter indices for the smoothed parameters.
const (
	pCloud = iota
	pPrecip
	pTemp
	pFog
	pWind
	numParams
)

func climateOf(c model.Climate, p int) (mean, variability float64) {
	var v [2]float64
	switch p {
	case pCloud:
		v = c.Cloud
	case pPrecip:
		v = c.Precip
	case pTemp:
		v = c.Temp
	case pFog:
		v = c.Fog
	default:
		v = c.Wind
	}
	return v[0], v[1]
}

func clampParam(p int, v float64) float64 {
	if p == pTemp {
		return min(max(v, minTemp), maxTemp)
	}
	return min(max(v, 0), 1)
}

// prevailing is the season's prevailing wind direction (radians, the way
// the wind blows; 0 = east, π/2 = south): easterlies in spring and autumn,
// the south-west monsoon in summer, the north-east monsoon in winter.
func prevailing(season int) float64 {
	return [4]float64{math.Pi, 7 * math.Pi / 4, 7 * math.Pi / 8, 3 * math.Pi / 4}[season]
}

// Diurnal offsets per slot (morning, afternoon, evening); each averages 0.
func diurnalTemp() [3]float64 { return [3]float64{-1.5, 2, -0.5} }
func diurnalFog() [3]float64  { return [3]float64{0.15, -0.12, -0.03} }
func diurnalWind() [3]float64 { return [3]float64{-0.03, 0.05, -0.02} }

// uvPeak is the clear-sky afternoon UV at sea level per season; uvSlot
// scales it per slot.
func uvPeak() [4]float64 { return [4]float64{7.5, 11, 8, 5} }
func uvSlot() [3]float64 { return [3]float64{0.45, 1, 0.05} }

// area is a validated model.WeatherArea with its stream hash.
type area struct {
	model.WeatherArea
	hash uint64
}

// sim computes weather for one payload.
type sim struct {
	s *sampler
}

// Day computes one day's weather for every area in the payload, in payload
// order, plus the typhoon signal and tomorrow's forecast.
func Day(p model.WeatherDayPayload) (model.WeatherDay, error) {
	areas, err := validate(p)
	if err != nil {
		return model.WeatherDay{}, err
	}
	sm := &sim{s: newSampler(p.Seed)}
	out := model.WeatherDay{
		Day:           p.Day,
		TyphoonSignal: typhoonSignals(sm.s, p.Day),
		Areas:         make([]model.AreaWeather, len(areas)),
		Forecast:      make([]model.AreaWeather, len(areas)),
	}
	tomorrowSignal := typhoonSignals(sm.s, p.Day+1)
	for i, a := range areas {
		out.Areas[i] = sm.areaDay(a, p.Day, out.TyphoonSignal)
		out.Forecast[i] = sm.forecast(a, p.Day+1, sm.areaDay(a, p.Day+1, tomorrowSignal), tomorrowSignal)
	}
	return out, nil
}

func validate(p model.WeatherDayPayload) ([]area, error) {
	if p.Day < 1 {
		return nil, fmt.Errorf("%w: day %d, want ≥ 1", ErrInvalidPayload, p.Day)
	}
	if len(p.Areas) == 0 {
		return nil, fmt.Errorf("%w: no areas", ErrInvalidPayload)
	}
	season := SeasonOf(p.Day)
	seen := make(map[string]bool, len(p.Areas))
	areas := make([]area, len(p.Areas))
	for i, a := range p.Areas {
		if a.ID == "" {
			return nil, fmt.Errorf("%w: area %d has no id", ErrInvalidPayload, i)
		}
		if seen[a.ID] {
			return nil, fmt.Errorf("%w: duplicate area %q", ErrInvalidPayload, a.ID)
		}
		seen[a.ID] = true
		if _, ok := a.Climate[season]; !ok {
			return nil, fmt.Errorf("%w: area %q has no %s climate", ErrInvalidPayload, a.ID, season)
		}
		a.Altitude = min(max(a.Altitude, 0), 1)
		areas[i] = area{WeatherArea: a, hash: hashString(a.ID)}
	}
	return areas, nil
}

// climate returns the area's climate for a day, falling back to fallback's
// season when that season is missing (only the requested day's season is
// required).
func (a area) climate(day, fallback int) model.Climate {
	if c, ok := a.Climate[SeasonOf(day)]; ok {
		return c
	}
	return a.Climate[SeasonOf(fallback)]
}

// dayDir is the regional wind direction of a day: the season's prevailing
// direction plus a slowly drifting deviation.
func (sm *sim) dayDir(day int) float64 {
	return prevailing(seasonIndex(day)) + dirSpread*sm.s.process(streamDir, int64(day), dirTaps, dirPhi)
}

// frontLag is how many slots after the map origin's front an area sees it,
// given the wind direction.
func frontLag(c model.Point, dir float64) float64 {
	return (c.X*math.Cos(dir) + c.Y*math.Sin(dir)) / FrontSpeed
}

// raw is the unsmoothed, clamped value of every parameter for an area at
// absolute slot t (t = (day−1)·3 + slot).
func (sm *sim) raw(a area, t int64, fallbackDay int) [numParams]float64 {
	day := int(floorDiv(t, SlotsPerDay)) + 1
	c := a.climate(day, fallbackDay)
	tau := float64(t) - frontLag(a.Center, sm.dayDir(day))
	wet := sm.s.processAt(streamWet, tau, frontTaps, frontPhi)
	tmp := sm.s.processAt(streamTemp, tau, frontTaps, frontPhi)
	fog := sm.s.processAt(streamFog, tau, frontTaps, frontPhi)
	wnd := sm.s.processAt(streamWind, tau, frontTaps, frontPhi)
	// Fronts are coupled: wet fronts are cloudy, rainy, cooler, mistier
	// and windier. Each combination has unit variance.
	fronts := [numParams]float64{
		wet,
		wet,
		-0.5*wet + 0.866*tmp,
		0.5*wet + 0.866*fog,
		0.4*wet + 0.917*wnd,
	}
	var out [numParams]float64
	for p := range numParams {
		mean, v := climateOf(c, p)
		local := sm.s.process(streamLocal^a.hash^uint64(p+1)<<56, t, localTaps, localPhi)
		out[p] = clampParam(p, mean+gain*v*(frontWeight*fronts[p]+localWeight*local))
	}
	return out
}

// areaDay computes an area's three slots for a day.
func (sm *sim) areaDay(a area, day int, signal [3]int) model.AreaWeather {
	t0 := int64(day-1) * SlotsPerDay
	// Smooth from the climate mean smoothSlots before the morning.
	var x [numParams]float64
	start := a.climate(int(floorDiv(t0-smoothSlots-1, SlotsPerDay))+1, day)
	for p := range numParams {
		x[p], _ = climateOf(start, p)
	}
	season := SeasonOf(day)
	dir := sm.dayDir(day)
	out := model.AreaWeather{Area: a.ID}
	for t := t0 - smoothSlots; t < t0+SlotsPerDay; t++ {
		r := sm.raw(a, t, day)
		for p := range numParams {
			x[p] = smoothKeep*x[p] + (1-smoothKeep)*r[p]
		}
		if t < t0 {
			continue
		}
		slot := int(t - t0)
		w := model.WeatherParams{
			Cloud:  x[pCloud],
			Precip: x[pPrecip],
			Temp:   x[pTemp] + diurnalTemp()[slot] - lapseRate*a.Altitude,
			Fog:    x[pFog] + diurnalFog()[slot] + altitudeFog*a.Altitude,
			Wind:   x[pWind] + diurnalWind()[slot] + altitudeWnd*a.Altitude,
		}
		w.WindDir = dir + localDirSpread*sm.s.normal(streamLocalDir^a.hash, t)
		applyTyphoon(&w, signal[slot])
		w = finish(w, season, slot, a.Altitude)
		out.Slots[slot] = w
		out.Named[slot] = Named(w, season, signal[slot])
	}
	return out
}

// finish clamps every parameter, computes UV and rounds for the wire.
func finish(w model.WeatherParams, season string, slot int, altitude float64) model.WeatherParams {
	w.Cloud = clampParam(pCloud, w.Cloud)
	w.Precip = clampParam(pPrecip, w.Precip)
	w.Temp = clampParam(pTemp, w.Temp)
	w.Fog = clampParam(pFog, w.Fog)
	w.Wind = clampParam(pWind, w.Wind)
	w.WindDir = math.Mod(w.WindDir, 2*math.Pi)
	if w.WindDir < 0 {
		w.WindDir += 2 * math.Pi
	}
	w.UV = UV(w, season, slot, altitude)
	w.Cloud = round(w.Cloud, 1000)
	w.Precip = round(w.Precip, 1000)
	w.Fog = round(w.Fog, 1000)
	w.Wind = round(w.Wind, 1000)
	w.WindDir = round(w.WindDir, 1000)
	w.Temp = round(w.Temp, 10)
	w.UV = round(w.UV, 10)
	return w
}

func round(v, scale float64) float64 {
	return math.Round(v*scale) / scale
}

// UV is the UV index (0–11+) for weather in a season, slot (0 morning,
// 1 afternoon, 2 evening) and altitude: highest on clear summer afternoons
// on the peaks, near 0 in the evening, reduced by cloud and fog.
func UV(w model.WeatherParams, season string, slot int, altitude float64) float64 {
	si := 0
	for i, s := range Seasons() {
		if s == season {
			si = i
		}
	}
	slot = min(max(slot, 0), SlotsPerDay-1)
	uv := uvPeak()[si] * uvSlot()[slot] *
		(1 - 0.75*min(max(w.Cloud, 0), 1)) *
		(1 - 0.3*min(max(w.Fog, 0), 1)) *
		(1 + altitudeUV*min(max(altitude, 0), 1))
	return max(uv, 0)
}

// forecast is the radio's version of an area's weather: the real day with a
// little deterministic noise, named again from the noisy values.
func (sm *sim) forecast(a area, day int, real model.AreaWeather, signal [3]int) model.AreaWeather {
	season := SeasonOf(day)
	out := model.AreaWeather{Area: a.ID}
	for slot, w := range real.Slots {
		r := sm.s.at(streamForecast^a.hash, int64(day-1)*SlotsPerDay+int64(slot))
		f := w
		f.Cloud += 0.06 * r.NormFloat64()
		f.Precip += 0.06 * r.NormFloat64()
		f.Temp += 0.8 * r.NormFloat64()
		f.Fog += 0.05 * r.NormFloat64()
		f.Wind += 0.06 * r.NormFloat64()
		f.WindDir += 0.15 * r.NormFloat64()
		f = finish(f, season, slot, a.Altitude)
		out.Slots[slot] = f
		out.Named[slot] = Named(f, season, signal[slot])
	}
	return out
}
