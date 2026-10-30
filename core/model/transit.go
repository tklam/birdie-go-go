package model

// TransitLine is a bus, tram, metro or ferry line (SPEC.md §4.11). Vehicles
// ride on the map along Path (world pixels), which passes through the
// line's stops in order.
//
// Transit times are in-game minutes. On the map the clock advances
// GameInfo.ClockRate in-game minutes per real second, so a vehicle moves
// Speed × ClockRate px per real second.
type TransitLine struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Mode  string   `json:"mode"`
	Fare  int      `json:"fare"`
	Stops []string `json:"stops"`
	// Path waypoints in world pixels, from the first stop to the last; the
	// ride runs it forwards or backwards.
	Path [][2]float64 `json:"path"`
	// Speed in px per in-game minute.
	Speed float64 `json:"speed"`
	// Headway is the minutes between departures from each terminus (default
	// 15).
	Headway float64 `json:"headway,omitempty"`
	// First and Last are the first and last departure times from each
	// terminus as "HH:MM" (defaults 06:00 and 23:30). First is before
	// 24:00; Last may pass midnight (e.g. "25:30") but stays within a day
	// of First.
	First string `json:"first,omitempty"`
	Last  string `json:"last,omitempty"`
	// Locked lines can't be ridden until an unlock_line event opens them
	// (SPEC.md §4.11).
	Locked bool `json:"locked,omitempty"`
	// Bell is the sound cue its vehicles make leaving a stop and passing
	// Angie (SPEC.md §4.11), e.g. the tram's ding-ding; empty is silent.
	Bell string `json:"bell,omitempty"`
}

// TransitStop is a named stop; its position comes from the world index.
type TransitStop struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Transit is the whole network.
type Transit struct {
	Lines []TransitLine `json:"lines"`
	Stops []TransitStop `json:"stops"`
}

// TransitLoadPayload gives the core worker the network for later
// transit.plan and transit.vehicles calls.
type TransitLoadPayload struct {
	Transit Transit `json:"transit"`
	// StopPositions are the stops' world-pixel positions from the world
	// index. They place intermediate stops along their lines' paths; a
	// line's first and last stops are always its path's end points.
	StopPositions map[string]Point `json:"stopPositions,omitempty"`
}

// TransitLoadResult summarizes the loaded network.
type TransitLoadResult struct {
	Lines int `json:"lines"`
	Stops int `json:"stops"`
}

// TransitPlanPayload asks for the best itinerary between two stops.
type TransitPlanPayload struct {
	From string `json:"from"`
	To   string `json:"to"`
	// Time is the departure time in absolute in-game minutes (day × 1440 +
	// minutes since midnight).
	Time float64 `json:"time"`
	// Lines limits the plan to these lines (the unlocked ones); empty means
	// all.
	Lines []string `json:"lines,omitempty"`
	// ExcludeModes leaves out suspended modes (e.g. ferry at typhoon signal
	// 8+).
	ExcludeModes []string `json:"excludeModes,omitempty"`
	// IgnoreTimetable boards every leg on arrival (no waits).
	IgnoreTimetable bool `json:"ignoreTimetable,omitempty"`
}

// TransitLeg is one ride on one vehicle.
type TransitLeg struct {
	Line string `json:"line"`
	Mode string `json:"mode"`
	From string `json:"from"`
	To   string `json:"to"`
	// Direction is 1 along the line's stop order, -1 against it.
	Direction int `json:"direction"`
	// Wait is the minutes spent at From before boarding.
	Wait   float64 `json:"wait"`
	Depart float64 `json:"depart"`
	Arrive float64 `json:"arrive"`
	// Ride is Arrive − Depart.
	Ride float64 `json:"ride"`
	Fare int     `json:"fare"`
	// Path is the world-pixel polyline of this ride, from From to To.
	Path [][2]float64 `json:"path"`
}

// TransitItinerary is the planner's answer: legs in travel order.
type TransitItinerary struct {
	From      string       `json:"from"`
	To        string       `json:"to"`
	Depart    float64      `json:"depart"`
	Arrive    float64      `json:"arrive"`
	Duration  float64      `json:"duration"`
	Fare      int          `json:"fare"`
	Transfers int          `json:"transfers"`
	Legs      []TransitLeg `json:"legs"`
}

// TransitVehiclesPayload asks where the vehicles of some lines are.
type TransitVehiclesPayload struct {
	// Lines to report; empty means every line.
	Lines []string `json:"lines,omitempty"`
	// Time in absolute in-game minutes.
	Time float64 `json:"time"`
}

// TransitVehicle is one vehicle's timetabled position.
type TransitVehicle struct {
	Line string `json:"line"`
	// Direction is 1 along the line's stop order, -1 against it.
	Direction int `json:"direction"`
	// Depart is when this trip left its first terminus (absolute minutes);
	// with Line and Direction it identifies the vehicle.
	Depart float64 `json:"depart"`
	// X and Y in world pixels; DX and DY the unit heading.
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	DX float64 `json:"dx"`
	DY float64 `json:"dy"`
	// Progress along the trip, 0–1.
	Progress float64 `json:"progress"`
}

// TransitVehiclesResult lists the vehicles in service, by line then trip.
type TransitVehiclesResult struct {
	Vehicles []TransitVehicle `json:"vehicles"`
}
