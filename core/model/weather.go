package model

// Weather parameters (SPEC.md §4.9). Ranges: Cloud, Precip, Fog, Wind 0–1;
// Temp in °C; UV 0–11+; WindDir in radians (0 = blowing east, π/2 = south).
type WeatherParams struct {
	Cloud   float64 `json:"cloud"`
	Precip  float64 `json:"precip"`
	Temp    float64 `json:"temp"`
	Fog     float64 `json:"fog"`
	Wind    float64 `json:"wind"`
	WindDir float64 `json:"windDir"`
	UV      float64 `json:"uv"`
}

// Climate is an area's per-parameter [mean, variability] for one season.
type Climate struct {
	Cloud  [2]float64 `json:"cloud"`
	Precip [2]float64 `json:"precip"`
	Temp   [2]float64 `json:"temp"`
	Fog    [2]float64 `json:"fog"`
	Wind   [2]float64 `json:"wind"`
}

// WeatherArea is what the weather simulation needs to know about an area.
type WeatherArea struct {
	ID string `json:"id"`
	// Climate by season name (spring, summer, autumn, winter).
	Climate map[string]Climate `json:"climate"`
	// Center is the area's centroid in world pixels (for the drifting front).
	Center Point `json:"center"`
	// Altitude 0–1 (sea level … peaks) raises UV and lowers temperature.
	Altitude float64 `json:"altitude"`
}

// WeatherDayPayload asks the core for one day's weather.
type WeatherDayPayload struct {
	Seed  uint32        `json:"seed"`
	Day   int           `json:"day"`
	Areas []WeatherArea `json:"areas"`
}

// AreaWeather is one area's weather for each time slot of a day.
type AreaWeather struct {
	Area string `json:"area"`
	// Slots holds morning, afternoon and evening, in that order.
	Slots [3]WeatherParams `json:"slots"`
	// Named holds the derived named weather per slot (clear, cloudy, …).
	Named [3]string `json:"named"`
}

// WeatherDay is the core's answer to weather.day.
type WeatherDay struct {
	Day   int           `json:"day"`
	Areas []AreaWeather `json:"areas"`
	// TyphoonSignal per slot (0 = none, 1, 3, 8, 10), shared by all areas.
	TyphoonSignal [3]int `json:"typhoonSignal"`
	// Forecast is tomorrow's weather as the radio reports it: the real
	// generated weather with a little noise, morning-afternoon-evening.
	Forecast []AreaWeather `json:"forecast"`
}
