package weather

import "birdiegogo/core/model"

// Named weather values (SPEC.md §4.9).
const (
	Typhoon      = "typhoon"
	Thunderstorm = "thunderstorm"
	Rainstorm    = "rainstorm"
	Rain         = "rain"
	Drizzle      = "drizzle"
	Foggy        = "foggy"
	Windy        = "windy"
	Hazy         = "hazy"
	Cloudy       = "cloudy"
	Clear        = "clear"
)

// Named derives the named weather from the parameters; the first matching
// rule wins.
func Named(p model.WeatherParams, season string, signal int) string {
	switch {
	case signal >= 8:
		return Typhoon
	case p.Precip >= 0.8 && p.Cloud >= 0.8 && season == "summer":
		return Thunderstorm
	case p.Precip >= 0.7:
		return Rainstorm
	case p.Precip >= 0.4:
		return Rain
	case p.Precip >= 0.15:
		return Drizzle
	case p.Fog >= 0.5:
		return Foggy
	case p.Wind >= 0.7:
		return Windy
	case p.Temp >= 30 && p.Cloud < 0.4:
		return Hazy
	case p.Cloud >= 0.6:
		return Cloudy
	default:
		return Clear
	}
}
