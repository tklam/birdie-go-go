package model

// ContentBundle is the validated game content emitted by tools/contentbuild
// and loaded by the client at startup. Lists are never nil in a built bundle.
type ContentBundle struct {
	Game     GameInfo   `json:"game"`
	Areas    []Area     `json:"areas"`
	Birds    []Bird     `json:"birds"`
	Spots    []Spot     `json:"spots"`
	Students []Student  `json:"students"`
	Songs    []Song     `json:"songs"`
	Events   []Event    `json:"events"`
	Dialogue []Dialogue `json:"dialogue"`
	Music    []Music    `json:"music"`
	Items    []Item     `json:"items"`
	Hazards  []Hazard   `json:"hazards"`
	Enemies  []Enemy    `json:"enemies"`
}

// GameInfo is the top-level game metadata from content/game.yaml.
type GameInfo struct {
	Title          string `json:"title"`
	ContentVersion string `json:"contentVersion"`
	// StartArea and StartSpawn place Angie when a new game begins.
	StartMap   string `json:"startMap"`
	StartSpawn string `json:"startSpawn"`
}

// Area is a logical district of the world (SPEC.md §4.3).
type Area struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Music string `json:"music,omitempty"`
	// Climate by season (SPEC.md §4.9); every season must be present.
	Climate map[string]Climate `json:"climate"`
	// Altitude 0–1 (sea level … peaks).
	Altitude float64 `json:"altitude"`
}

// Bird is a species that can appear on the overworld and in photo scenes.
type Bird struct {
	ID              string             `json:"id"`
	Name            string             `json:"name"`
	Sprite          string             `json:"sprite"`
	OverworldSprite string             `json:"overworldSprite"`
	Skittishness    float64            `json:"skittishness"`
	SizeBand        [2]float64         `json:"sizeBand"`
	Speed           float64            `json:"speed"`
	Seasons         []string           `json:"seasons"`
	Poses           map[string]float64 `json:"poses"`
	Behaviors       []string           `json:"behaviors"`
}

// Spot is a birding spot that opens the photo scene (SPEC.md §5).
type Spot struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Area       string     `json:"area"`
	Background string     `json:"background"`
	Shots      int        `json:"shots"`
	Birds      []SpotBird `json:"birds"`
}

// SpotBird is one entry of a spot's bird table.
type SpotBird struct {
	Species      string   `json:"species"`
	Weight       float64  `json:"weight"`
	Slots        []string `json:"slots,omitempty"`
	Seasons      []string `json:"seasons,omitempty"`
	RequiresFlag string   `json:"requiresFlag,omitempty"`
	// UnlessFlag hides the entry once the flag is set (e.g. after a story
	// bird has joined the party).
	UnlessFlag string `json:"unlessFlag,omitempty"`
	// Always guarantees one appearance per session while available (story
	// birds).
	Always bool `json:"always,omitempty"`
}

// Student is a piano student (SPEC.md §6.5).
type Student struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Level      int                `json:"level"`
	Home       string             `json:"home"`
	Repertoire []string           `json:"repertoire"`
	Tendencies map[string]float64 `json:"tendencies"`
	Fee        int                `json:"fee"`
}

// Song is a lesson piece. Times are in beats.
type Song struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	Tempo         float64 `json:"tempo"`
	TimeSignature [2]int  `json:"timeSignature"`
	Difficulty    int     `json:"difficulty"`
	Notes         []Note  `json:"notes"`
}

// Note is one note of a song: MIDI pitch, start and duration in beats,
// velocity 1–127.
type Note struct {
	Pitch int     `json:"pitch"`
	Start float64 `json:"start"`
	Dur   float64 `json:"dur"`
	Vel   int     `json:"vel"`
}

// Music is a looping background tune played by the 16-bit synth
// (SPEC.md §1.3). Times are in beats.
type Music struct {
	ID        string       `json:"id"`
	Title     string       `json:"title"`
	Tempo     float64      `json:"tempo"`
	LoopBeats float64      `json:"loopBeats"`
	Tracks    []MusicTrack `json:"tracks"`
}

// MusicTrack is one voice of a tune. Instrument is "square", "pulse",
// "triangle" or "noise" (noise ignores pitch).
type MusicTrack struct {
	Instrument string  `json:"instrument"`
	Volume     float64 `json:"volume"`
	Notes      []Note  `json:"notes"`
}

// Event is a story or world event (SPEC.md §9.4).
type Event struct {
	ID         string      `json:"id"`
	Trigger    Trigger     `json:"trigger"`
	Conditions []Condition `json:"conditions"`
	Actions    []Action    `json:"actions"`
	// Once events fire at most once per save (default true).
	Once bool `json:"once"`
}

// Trigger says when an event is considered. Params narrow it down, e.g.
// {"spot": "tko_waterfront"} for a photo_session_end trigger.
type Trigger struct {
	Type   string            `json:"type"`
	Params map[string]string `json:"params"`
}

// Condition is one test against the game state. Value's shape depends on
// Type (a flag name, a number, {who, amount}, …).
type Condition struct {
	Type  string `json:"type"`
	Value any    `json:"value" tstype:"unknown"`
}

// Action is one effect of an event. Value's shape depends on Type.
type Action struct {
	Type  string `json:"type"`
	Value any    `json:"value" tstype:"unknown"`
}

// Dialogue is a sequence of lines shown in the dialogue box.
type Dialogue struct {
	ID    string         `json:"id"`
	Lines []DialogueLine `json:"lines"`
}

// DialogueLine is shown only if all its conditions hold.
type DialogueLine struct {
	Speaker  string      `json:"speaker"`
	Portrait string      `json:"portrait,omitempty"`
	Text     string      `json:"text"`
	If       []Condition `json:"if,omitempty"`
}
