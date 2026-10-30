package model

// ContentBundle is the validated game content emitted by tools/contentbuild
// and loaded by the client at startup. Lists are never nil in a built bundle.
type ContentBundle struct {
	Game      GameInfo     `json:"game"`
	Areas     []Area       `json:"areas"`
	Birds     []Bird       `json:"birds"`
	Spots     []Spot       `json:"spots"`
	Students  []Student    `json:"students"`
	Songs     []Song       `json:"songs"`
	Events    []Event      `json:"events"`
	Dialogue  []Dialogue   `json:"dialogue"`
	Music     []Music      `json:"music"`
	Items     []Item       `json:"items"`
	Hazards   []Hazard     `json:"hazards"`
	Enemies   []Enemy      `json:"enemies"`
	Missions  []Mission    `json:"missions"`
	Shops     []Shop       `json:"shops"`
	Minigames []Minigame   `json:"minigames"`
	Ambient   []AmbientNPC `json:"ambient"`
	Transit   Transit      `json:"transit"`
	Sounds    Sounds       `json:"sounds"`
}

// GameInfo is the top-level game metadata from content/game.yaml.
type GameInfo struct {
	Title          string `json:"title"`
	ContentVersion string `json:"contentVersion"`
	// StartArea and StartSpawn place Angie when a new game begins.
	StartMap   string `json:"startMap"`
	StartSpawn string `json:"startSpawn"`
	// MissionReminderSlots is how many time slots pass between reminders
	// about an active mission (SPEC.md §9.5); 0 turns reminders off.
	MissionReminderSlots int `json:"missionReminderSlots,omitempty"`
	// BedtimeReminder nudges Angie home in the evening (SPEC.md §3.1).
	BedtimeReminder *BedtimeReminder `json:"bedtimeReminder,omitempty"`
	// Energy sets everyday Energy costs (SPEC.md §4.12); nil keeps only
	// hazards and encounters draining it.
	Energy *EnergyRules `json:"energy,omitempty"`
	// Bills are deducted from Angie's money in the morning (SPEC.md §3.2).
	Bills []Bill `json:"bills,omitempty"`
	// TransitCard pays fares (SPEC.md §4.11); nil means fares come from cash.
	TransitCard *TransitCard `json:"transitCard,omitempty"`
	// BagCapacity is how many bought supplies fit in Angie's bag (SPEC.md
	// §4.12); 0 means no limit.
	BagCapacity int `json:"bagCapacity,omitempty"`
	// CompanionAbilities tune O Boy and Kei in encounters.
	CompanionAbilities *CompanionAbilities `json:"companionAbilities,omitempty"`
	// Contributions are companions' earnings shared with Angie each morning.
	Contributions []Contribution `json:"contributions,omitempty"`
	// ClockRate is how many in-game minutes pass per real second on the map
	// and while riding (SPEC.md §4.11); 0 means 1. Energy and hazard rates
	// and transit speeds are per in-game minute, so they scale with it.
	ClockRate float64 `json:"clockRate,omitempty"`
}

// TransitCard is the rechargeable fare card: its in-game name, the balance
// a new game starts with and the amount of one top-up.
type TransitCard struct {
	Name         string `json:"name"`
	StartBalance int    `json:"startBalance"`
	TopUp        int    `json:"topUp"`
}

// EnergyRules are the everyday Energy costs outside hazards and encounters.
type EnergyRules struct {
	// WalkPerMin drains while walking outdoors, per in-game minute.
	WalkPerMin float64 `json:"walkPerMin"`
	// IndoorRecoveryPerMin restores Energy indoors, per in-game minute.
	IndoorRecoveryPerMin float64 `json:"indoorRecoveryPerMin"`
	// PhotoSession and Lesson are paid when one starts; Angie can't start
	// one with less Energy than its cost.
	PhotoSession int `json:"photoSession"`
	Lesson       int `json:"lesson"`
	// LowWarning is the level below which LowWarningText is shown once.
	LowWarning     int    `json:"lowWarning"`
	LowWarningText string `json:"lowWarningText"`
	// TooTiredText is shown when Angie is too tired to start an activity.
	TooTiredText string `json:"tooTiredText"`
	// Faint is what happens when Energy runs out (no game over); nil uses
	// the client's plain fallback.
	Faint *FaintRules `json:"faint,omitempty"`
}

// FaintRules: when Energy reaches 0 a neighbour helps Angie home, she pays
// up to Fee (never below $0) and wakes with RecoverTo Energy. Weather and
// Encounter are the notices for running out in bad weather or losing an
// encounter; "{fee}" in a line is replaced by the amount paid.
type FaintRules struct {
	Fee       int       `json:"fee"`
	RecoverTo int       `json:"recoverTo"`
	Weather   FaintText `json:"weather"`
	Encounter FaintText `json:"encounter"`
}

// FaintText is a titled notice.
type FaintText struct {
	Title string   `json:"title"`
	Lines []string `json:"lines"`
}

// CompanionAbilities are what O Boy and Kei do in encounters (SPEC.md
// §4.13): help, never automatic wins.
type CompanionAbilities struct {
	// Sing is O Boy's song: longer combo windows and a softer counter-hit.
	Sing *SingAbility `json:"sing,omitempty"`
	// Guardian is Kei's digital guardian: extra resolve damage per combo and
	// blocked counter-hits.
	Guardian *GuardianAbility `json:"guardian,omitempty"`
	// Duet: the two together give one free combo success per encounter.
	Duet bool `json:"duet,omitempty"`
	// DogWhistle is Kei's ultrasonic whistle: dogs start with less resolve.
	DogWhistle *DogWhistle `json:"dogWhistle,omitempty"`
}

// SingAbility is O Boy's song: Uses per encounter; for Turns combos the
// time windows are WindowScale× longer; the next counter-hit does
// DamageScale× damage.
type SingAbility struct {
	Uses        int     `json:"uses"`
	Turns       int     `json:"turns"`
	WindowScale float64 `json:"windowScale"`
	DamageScale float64 `json:"damageScale"`
}

// GuardianAbility is Kei's digital guardian, from MinStage on: Uses per
// encounter; for Turns combos each completed one adds BonusHit resolve
// damage, and it blocks up to Guards counter-hits.
type GuardianAbility struct {
	MinStage string `json:"minStage"`
	Uses     int    `json:"uses"`
	Turns    int    `json:"turns"`
	BonusHit int    `json:"bonusHit"`
	Guards   int    `json:"guards"`
}

// DogWhistle scales dogs' starting resolve while Kei (MinStage on) is along.
type DogWhistle struct {
	MinStage     string  `json:"minStage"`
	ResolveScale float64 `json:"resolveScale"`
}

// Contribution is part of a companion's earnings that he chips in each
// morning while he's in Angie's party (SPEC.md §3.2): Income × the share,
// rounded. ByStage, for Kei, sets the share by relationship stage (stages
// not listed use Share).
type Contribution struct {
	Companion string             `json:"companion"`
	From      string             `json:"from"`
	Income    int                `json:"income"`
	Share     float64            `json:"share"`
	ByStage   map[string]float64 `json:"byStage,omitempty"`
}

// Bill is a regular cost paid in the morning of every EveryDays-th day
// (1 = every day).
type Bill struct {
	Name      string `json:"name"`
	Amount    int    `json:"amount"`
	EveryDays int    `json:"everyDays"`
}

// BedtimeReminder is a toast shown every EverySeconds of real time while
// Angie is away from home in the evening; Lines take turns. EverySeconds 0
// turns it off.
type BedtimeReminder struct {
	EverySeconds int      `json:"everySeconds,omitempty"`
	Lines        []string `json:"lines"`
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
	// WalkEffort multiplies the Energy walking costs here (SPEC.md §4.12):
	// above 1 on hills, sand and other hard going. 0 means 1.
	WalkEffort float64 `json:"walkEffort,omitempty"`
	// Soundscape is the ambience heard here (SPEC.md §1.3); empty is quiet.
	Soundscape string `json:"soundscape,omitempty"`
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
	// Call is the sound cue of its call (SPEC.md §1.3), played at CallPitch
	// times the cue's pitch (0 means 1); empty is silent.
	Call      string  `json:"call,omitempty"`
	CallPitch float64 `json:"callPitch,omitempty"`
}

// Spot is a birding spot that opens the photo scene (SPEC.md §5).
type Spot struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Area       string     `json:"area"`
	Background string     `json:"background"`
	Shots      int        `json:"shots"`
	Birds      []SpotBird `json:"birds"`
	// RequiresItem is gear Angie must own to shoot here (SPEC.md §4.6),
	// e.g. a night lens.
	RequiresItem string `json:"requiresItem,omitempty"`
	// Slots limits the spot to these time slots (e.g. night-only spots);
	// empty means any.
	Slots []string `json:"slots,omitempty"`
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
	// Weather limits the entry to these named weathers (e.g. storm birds
	// in rain); empty means any weather.
	Weather []string `json:"weather,omitempty"`
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

// Shop is a shop's name and what it sells (SPEC.md §4.12); shop objects in
// the world name it by shop_id.
type Shop struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Stock []string `json:"stock"`
}

// Minigame is a favour played as a short mini game (SPEC.md §4.14). Type
// picks the game; the other fields configure it (each type uses some).
type Minigame struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Title string `json:"title"`
	// Intro explains the task in the story's words before play.
	Intro string `json:"intro"`
	// Quiz questions (quiz).
	Quiz []QuizQuestion `json:"quiz,omitempty"`
	// Icons are pictures: "bird:<species>" or "prop:<name>" (memory: the
	// cards; catch: things to catch; find: the hidden birds).
	Icons []string `json:"icons,omitempty"`
	// Avoid are pictures not to catch (catch).
	Avoid []string `json:"avoid,omitempty"`
	// Pairs of cards (memory).
	Pairs int `json:"pairs,omitempty"`
	// Target is what wins: right answers (quiz), catches (catch), birds found
	// (find), hits on the beat (rhythm).
	Target int `json:"target,omitempty"`
	// Seconds is the time limit (catch, find; 0 = none).
	Seconds int `json:"seconds,omitempty"`
	// Tempo in beats per minute and Pattern, the beats to strike (rhythm).
	Tempo   float64   `json:"tempo,omitempty"`
	Pattern []float64 `json:"pattern,omitempty"`
	// Image is the picture to restore (slide: a manifest image id) and Size
	// the puzzle's grid (3 or 4).
	Image string `json:"image,omitempty"`
	Size  int    `json:"size,omitempty"`
}

// QuizQuestion is one multiple-choice question; Correct indexes Answers.
type QuizQuestion struct {
	Question string   `json:"question"`
	Answers  []string `json:"answers"`
	Correct  int      `json:"correct"`
}
