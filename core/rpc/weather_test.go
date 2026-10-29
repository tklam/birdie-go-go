package rpc

import (
	"reflect"
	"strings"
	"testing"

	"birdiegogo/core/model"
	"birdiegogo/core/weather"
)

func weatherPayload() model.WeatherDayPayload {
	c := model.Climate{
		Cloud: [2]float64{0.5, 0.2}, Precip: [2]float64{0.3, 0.2}, Temp: [2]float64{24, 3},
		Fog: [2]float64{0.2, 0.1}, Wind: [2]float64{0.3, 0.2},
	}
	climate := map[string]model.Climate{"spring": c, "summer": c, "autumn": c, "winter": c}
	return model.WeatherDayPayload{Seed: 11, Day: 40, Areas: []model.WeatherArea{
		{ID: "town", Climate: climate, Center: model.Point{X: 760, Y: 520}, Altitude: 0.05},
		{ID: "hill", Climate: climate, Center: model.Point{X: 760, Y: 160}, Altitude: 0.35},
	}}
}

func TestWeatherDayEndToEnd(t *testing.T) {
	p := weatherPayload()
	var got model.WeatherDay
	if _, errMsg := call(t, NewServer(), "weather.day", p, &got); errMsg != "" {
		t.Fatalf("weather.day: %s", errMsg)
	}
	want, err := weather.Day(p)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("weather.day over RPC = %+v, want %+v", got, want)
	}
	if got.Day != 40 || len(got.Areas) != 2 || got.Areas[1].Area != "hill" || len(got.Forecast) != 2 {
		t.Errorf("unexpected result shape: %+v", got)
	}
	var again model.WeatherDay
	call(t, NewServer(), "weather.day", p, &again)
	if !reflect.DeepEqual(got, again) {
		t.Error("weather.day is not deterministic across servers")
	}
}

func TestWeatherDayErrors(t *testing.T) {
	noAreas := weatherPayload()
	noAreas.Areas = nil
	tests := []struct {
		name    string
		payload any
		want    string
	}{
		{"no areas", noAreas, "weather.day: invalid weather payload: no areas"},
		{"no payload", nil, "weather.day: invalid weather payload"},
		{"bad payload", map[string]any{"day": "monday"}, "decode payload"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, errMsg := call(t, NewServer(), "weather.day", tt.payload, nil)
			if !strings.HasPrefix(errMsg, tt.want) {
				t.Errorf("error = %q, want prefix %q", errMsg, tt.want)
			}
		})
	}
}
