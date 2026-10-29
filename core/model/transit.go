package model

// TransitLine is a bus, tram, metro or ferry line (SPEC.md §4.11). Vehicles
// ride on the map along Path (world pixels), which passes through the
// line's stops in order.
type TransitLine struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Mode  string   `json:"mode"`
	Fare  int      `json:"fare"`
	Stops []string `json:"stops"`
	// Path waypoints in world pixels, from the first stop to the last; the
	// ride runs it forwards or backwards.
	Path [][2]float64 `json:"path"`
	// Speed on the map in px/s.
	Speed float64 `json:"speed"`
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
