package rpc

import (
	"strings"
	"testing"

	"birdiegogo/core/model"
)

func transitPayload() model.TransitLoadPayload {
	return model.TransitLoadPayload{
		Transit: model.Transit{
			Stops: []model.TransitStop{{ID: "a", Name: "A"}, {ID: "b", Name: "B"}, {ID: "c", Name: "C"}, {ID: "d", Name: "D"}},
			Lines: []model.TransitLine{
				{ID: "bus", Name: "Bus", Mode: "bus", Fare: 8, Stops: []string{"a", "b", "c"}, Path: [][2]float64{{0, 0}, {600, 0}}, Speed: 60, Headway: 10, First: "06:00"},
				{ID: "ferry", Name: "Ferry", Mode: "ferry", Fare: 15, Stops: []string{"c", "d"}, Path: [][2]float64{{600, 0}, {600, 300}}, Speed: 30, Headway: 20},
			},
		},
		StopPositions: map[string]model.Point{"b": {X: 300, Y: 0}},
	}
}

func TestTransitEndToEnd(t *testing.T) {
	s := NewServer()
	var loaded model.TransitLoadResult
	if _, errMsg := call(t, s, "transit.load", transitPayload(), &loaded); errMsg != "" {
		t.Fatalf("transit.load: %s", errMsg)
	}
	if loaded != (model.TransitLoadResult{Lines: 2, Stops: 4}) {
		t.Errorf("loaded = %+v", loaded)
	}

	var it model.TransitItinerary
	if _, errMsg := call(t, s, "transit.plan", model.TransitPlanPayload{From: "b", To: "d", Time: 360}, &it); errMsg != "" {
		t.Fatalf("transit.plan: %s", errMsg)
	}
	// b at 06:05, c at 06:10, ferry leaves c at 06:20, d at 06:30.
	if it.Arrive != 390 || it.Fare != 23 || it.Transfers != 1 || len(it.Legs) != 2 || it.Legs[1].Wait != 10 || len(it.Legs[0].Path) != 2 {
		t.Errorf("itinerary = %+v", it)
	}

	var vs model.TransitVehiclesResult
	if _, errMsg := call(t, s, "transit.vehicles", model.TransitVehiclesPayload{Lines: []string{"bus"}, Time: 363}, &vs); errMsg != "" {
		t.Fatalf("transit.vehicles: %s", errMsg)
	}
	if len(vs.Vehicles) != 2 || vs.Vehicles[0].X != 180 || vs.Vehicles[1].X != 420 || vs.Vehicles[1].Direction != -1 {
		t.Errorf("vehicles = %+v", vs.Vehicles)
	}
}

func TestTransitErrors(t *testing.T) {
	broken := transitPayload()
	broken.Transit.Lines[0].Stops = []string{"a", "zz"}
	tests := []struct {
		name string
		load bool
		op   string
		p    any
		want string
	}{
		{"plan before load", false, "transit.plan", model.TransitPlanPayload{From: "a", To: "b"}, "transit.plan: no transit network loaded"},
		{"vehicles before load", false, "transit.vehicles", model.TransitVehiclesPayload{}, "transit.vehicles: no transit network loaded"},
		{"bad network", false, "transit.load", broken, "transit.load: invalid transit network: line bus: unknown stop"},
		{"bad payload", false, "transit.load", map[string]any{"transit": 3}, "decode payload"},
		{"unreachable", true, "transit.plan", model.TransitPlanPayload{From: "a", To: "d", ExcludeModes: []string{"ferry"}}, "transit.plan: destination unreachable"},
		{"unknown stop", true, "transit.plan", model.TransitPlanPayload{From: "a", To: "q"}, `transit.plan: unknown stop "q"`},
		{"unknown line", true, "transit.vehicles", model.TransitVehiclesPayload{Lines: []string{"tram"}}, `transit.vehicles: unknown line "tram"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewServer()
			if tt.load {
				if _, errMsg := call(t, s, "transit.load", transitPayload(), nil); errMsg != "" {
					t.Fatal(errMsg)
				}
			}
			_, errMsg := call(t, s, tt.op, tt.p, nil)
			if !strings.HasPrefix(errMsg, tt.want) {
				t.Errorf("error = %q, want prefix %q", errMsg, tt.want)
			}
		})
	}
}
