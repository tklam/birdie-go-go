package model

// Mission is a task beyond the main story (SPEC.md §9.5): started by an
// event's start_mission action, completed when its objective is met.
type Mission struct {
	ID          string    `json:"id"`
	Giver       string    `json:"giver"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Objective   Objective `json:"objective"`
	Reward      Reward    `json:"reward"`
}

// Objective is what completes a mission. Type "photograph" needs Species
// (and optionally MinRating good|great|perfect, Area); "lesson" needs
// Student and MinScore.
type Objective struct {
	Type      string `json:"type"`
	Species   string `json:"species,omitempty"`
	MinRating string `json:"minRating,omitempty"`
	Area      string `json:"area,omitempty"`
	Student   string `json:"student,omitempty"`
	MinScore  int    `json:"minScore,omitempty"`
}

// Reward is given on completion.
type Reward struct {
	Money int      `json:"money"`
	Items []string `json:"items"`
}
