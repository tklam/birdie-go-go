package model

// Sounds are the synthesized sound effects and ambiences of SPEC.md §1.3:
// short cues (bird calls, a tram bell, a ferry horn) built from oscillator
// and filtered-noise notes, and soundscapes that loop noise beds and scatter
// cues for each area.
type Sounds struct {
	Cues        []SoundCue   `json:"cues"`
	Soundscapes []Soundscape `json:"soundscapes"`
}

// SoundCue is a short sound made of notes.
type SoundCue struct {
	ID string `json:"id"`
	// Caption is shown for the sound while Captions is on; empty shows none.
	Caption string      `json:"caption,omitempty"`
	Notes   []SoundNote `json:"notes"`
}

// SoundNote is one oscillator or noise burst of a cue.
type SoundNote struct {
	// Wave is sine, triangle, square, sawtooth or noise (white noise through
	// a band-pass filter at Freq).
	Wave string `json:"wave"`
	// Freq is the pitch in Hz (the band centre for noise); To, if set,
	// glides to that pitch over the note.
	Freq float64 `json:"freq"`
	To   float64 `json:"to,omitempty"`
	// At is the start in seconds after the cue starts; Dur the length.
	At  float64 `json:"at,omitempty"`
	Dur float64 `json:"dur"`
	// Gain 0–1 (default 0.3).
	Gain float64 `json:"gain,omitempty"`
	// Env is pluck (instant attack, decay; the default) or swell (fade in
	// and out).
	Env string `json:"env,omitempty"`
	// Q is the noise band's width (default 1); higher is narrower.
	Q float64 `json:"q,omitempty"`
	// Repeat plays the note this many more times (up to 64), Every seconds
	// apart.
	Repeat int     `json:"repeat,omitempty"`
	Every  float64 `json:"every,omitempty"`
}

// Soundscape is an area's ambience: looping beds and scattered cues.
type Soundscape struct {
	ID   string          `json:"id"`
	Beds []SoundBed      `json:"beds"`
	Cues []SoundscapeCue `json:"cues"`
}

// SoundBed is a loop of filtered noise whose level wobbles slowly.
type SoundBed struct {
	// Filter is lowpass, bandpass or highpass at Freq Hz.
	Filter string  `json:"filter"`
	Freq   float64 `json:"freq"`
	Q      float64 `json:"q,omitempty"`
	Gain   float64 `json:"gain"`
	// Wobble 0–1 is how much the level swells and fades, Rate how often
	// (Hz).
	Wobble float64 `json:"wobble,omitempty"`
	Rate   float64 `json:"rate,omitempty"`
}

// SoundscapeCue plays a cue at random, every Every[0]–Every[1] seconds.
type SoundscapeCue struct {
	Cue   string     `json:"cue"`
	Every [2]float64 `json:"every"`
	// Gain scales the cue (default 1); Pitch varies it by up to this
	// fraction each time.
	Gain  float64 `json:"gain,omitempty"`
	Pitch float64 `json:"pitch,omitempty"`
	// Slots and Seasons limit when it plays; empty means always.
	Slots   []string `json:"slots,omitempty"`
	Seasons []string `json:"seasons,omitempty"`
	// Dry cues (birds, insects) fall silent in rain.
	Dry bool `json:"dry,omitempty"`
}
