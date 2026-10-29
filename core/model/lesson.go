package model

// Mistake types injected into lesson performances (SPEC.md §6.2).
const (
	// MistakeWrongNote: a note's pitch is replaced.
	MistakeWrongNote = "wrong_note"
	// MistakeMissedNote: a note is omitted.
	MistakeMissedNote = "missed_note"
	// MistakeExtraNote: a note is inserted.
	MistakeExtraNote = "extra_note"
	// MistakeRush: a note (and its chord) starts early.
	MistakeRush = "rush"
	// MistakeDrag: a note (and its chord) starts late.
	MistakeDrag = "drag"
	// MistakeHesitation: a pause before a note delays the rest of the piece.
	MistakeHesitation = "hesitation"
)

// LessonGeneratePayload is the payload of the "lesson.generate" op.
type LessonGeneratePayload struct {
	// Song is the reference score; times in beats, tempo in BPM.
	Song Song `json:"song"`
	// Tendencies biases the mistake types, keyed by mistake type. Types not
	// listed still appear now and then.
	Tendencies map[string]float64 `json:"tendencies"`
	// Difficulty is 1–5; higher means fewer, more subtle mistakes. Values
	// outside the range are clamped.
	Difficulty int `json:"difficulty"`
	// Seed makes the performance reproducible.
	Seed uint32 `json:"seed"`
}

// LessonGenerateResult is the result of the "lesson.generate" op. The answer
// key stays in the core until the lesson is graded.
type LessonGenerateResult struct {
	LessonID    string      `json:"lessonId"`
	Performance Performance `json:"performance"`
}

// Performance is the student's playing as note events in milliseconds from
// the start of the audio.
type Performance struct {
	// Notes are sorted by StartMs. Never nil.
	Notes      []PerfNote `json:"notes"`
	DurationMs float64    `json:"durationMs"`
}

// PerfNote is one performed note: MIDI pitch, start and duration in
// milliseconds, velocity 1–127.
type PerfNote struct {
	Pitch   int     `json:"pitch"`
	StartMs float64 `json:"startMs"`
	DurMs   float64 `json:"durMs"`
	Vel     int     `json:"vel"`
}

// Mistake is one entry of a lesson's answer key. OnsetMs is when the
// mistake can first be heard (SPEC.md §6.2). Pitch is the pitch that
// sounded and ExpectedPitch the one the score asks for; either is 0 when it
// doesn't apply (no note sounded for missed_note, none was expected for
// extra_note).
type Mistake struct {
	Type          string  `json:"type"`
	OnsetMs       float64 `json:"onsetMs"`
	Pitch         int     `json:"pitch"`
	ExpectedPitch int     `json:"expectedPitch"`
}

// LessonGradePayload is the payload of the "lesson.grade" op.
type LessonGradePayload struct {
	LessonID string `json:"lessonId"`
	// FlagsMs are the player's Mistake! presses in milliseconds from the
	// start of the audio, before latency correction.
	FlagsMs []float64 `json:"flagsMs"`
	// LatencyOffsetMs is subtracted from every flag (SPEC.md §6.4).
	LatencyOffsetMs float64 `json:"latencyOffsetMs"`
}

// LessonGradeResult is the result of the "lesson.grade" op (SPEC.md §6.3).
type LessonGradeResult struct {
	Score       int `json:"score"`
	Hits        int `json:"hits"`
	Misses      int `json:"misses"`
	FalseAlarms int `json:"falseAlarms"`
	// Mistakes is the revealed answer key, sorted by onset. Never nil.
	Mistakes []GradedMistake `json:"mistakes"`
}

// GradedMistake is an answer-key mistake and whether the player caught it.
// The embedded Mistake's fields are flattened in JSON (and in TypeScript via
// `extends`).
type GradedMistake struct {
	Mistake `tstype:",extends"`
	Hit     bool `json:"hit"`
}
