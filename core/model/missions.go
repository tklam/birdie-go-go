package model

// Mission is a task beyond the main story (SPEC.md §9.5): started by an
// event's start_mission action, or offered on its own at the start of a day
// while Available holds and the real date is inside Window; completed when
// its objective is met.
type Mission struct {
	ID          string    `json:"id"`
	Giver       string    `json:"giver"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Objective   Objective `json:"objective"`
	Reward      Reward    `json:"reward"`
	// Available are conditions (as in events) under which the mission is
	// offered at day start. Missions with neither Available nor Window are
	// only started by events.
	Available []Condition `json:"available,omitempty"`
	// Window limits a live mission to real-world dates; it expires after To.
	Window *MissionWindow `json:"window,omitempty"`
}

// MissionWindow is an inclusive range of real dates, "YYYY-MM-DD".
type MissionWindow struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Objective is what completes a mission. Type "photograph" needs Species
// (and optionally MinRating good|great|perfect, Area); "lesson" needs
// Student and MinScore; "ride" needs Line and/or Stop (ride that line, or
// arrive at that stop); "visit" needs Area.
type Objective struct {
	Type      string `json:"type"`
	Species   string `json:"species,omitempty"`
	MinRating string `json:"minRating,omitempty"`
	Area      string `json:"area,omitempty"`
	Student   string `json:"student,omitempty"`
	MinScore  int    `json:"minScore,omitempty"`
	Line      string `json:"line,omitempty"`
	Stop      string `json:"stop,omitempty"`
}

// Reward is given on completion.
type Reward struct {
	Money int      `json:"money"`
	Items []string `json:"items"`
}
