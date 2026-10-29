package lesson

import (
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"reflect"
	"slices"
	"testing"

	"birdiegogo/core/model"
)

// melody is n quarter notes of a C major scale at 120 BPM (500 ms apart).
func melody(n int) model.Song {
	scale := []int{60, 62, 64, 65, 67, 69, 71, 72}
	s := model.Song{ID: "scale", Tempo: 120, TimeSignature: [2]int{4, 4}}
	for i := range n {
		s.Notes = append(s.Notes, model.Note{Pitch: scale[i%len(scale)], Start: float64(i), Dur: 1, Vel: 80})
	}
	return s
}

// chorale is a melody over a bass note every bar, like the content songs,
// at 92 BPM.
func chorale(bars int) model.Song {
	melodyPitches := []int{64, 67, 72, 71, 69, 67, 64, 62}
	bass := []int{48, 45, 41, 43}
	s := model.Song{ID: "chorale", Tempo: 92, TimeSignature: [2]int{4, 4}}
	for b := range bars {
		s.Notes = append(s.Notes, model.Note{Pitch: bass[b%len(bass)], Start: float64(4 * b), Dur: 4, Vel: 60})
		for beat := range 4 {
			p := melodyPitches[(4*b+beat)%len(melodyPitches)]
			s.Notes = append(s.Notes, model.Note{Pitch: p, Start: float64(4*b + beat), Dur: 1, Vel: 80})
		}
	}
	return s
}

func mustScore(t *testing.T, s model.Song) score {
	t.Helper()
	sc, err := newScore(s)
	if err != nil {
		t.Fatalf("newScore: %v", err)
	}
	return sc
}

func TestGenerateDeterministic(t *testing.T) {
	p := model.LessonGeneratePayload{Song: chorale(8), Tendencies: map[string]float64{"rush": 2, "wrong_note": 1}, Difficulty: 3, Seed: 42}
	perf1, key1, err := Generate(p)
	if err != nil {
		t.Fatal(err)
	}
	perf2, key2, _ := Generate(p)
	if !reflect.DeepEqual(perf1, perf2) || !reflect.DeepEqual(key1, key2) {
		t.Fatal("same payload gave different output")
	}

	distinct := map[string]bool{}
	for seed := range uint32(20) {
		p.Seed = seed
		_, key, _ := Generate(p)
		distinct[fmt.Sprint(key)] = true
	}
	if len(distinct) < 15 {
		t.Errorf("20 seeds gave only %d distinct answer keys", len(distinct))
	}
}

func TestGenerateInvariants(t *testing.T) {
	songs := []model.Song{melody(40), chorale(12), melody(3)}
	for _, song := range songs {
		ref := mustScore(t, song)
		for d := 1; d <= 5; d++ {
			for seed := range uint32(100) {
				perf, key, err := Generate(model.LessonGeneratePayload{Song: song, Difficulty: d, Seed: seed})
				if err != nil {
					t.Fatal(err)
				}
				want := mistakeCount(ref.durationMs, levelFor(d))
				if len(key) < 1 || len(key) > want {
					t.Errorf("%s d%d seed %d: %d mistakes, want 1–%d", song.ID, d, seed, len(key), want)
				}
				for i, m := range key {
					if m.OnsetMs <= ref.groups[0].startMs {
						t.Errorf("%s d%d seed %d: mistake %+v on the first note", song.ID, d, seed, m)
					}
					if i > 0 && m.OnsetMs-key[i-1].OnsetMs < MinSpacingMs {
						t.Errorf("%s d%d seed %d: mistakes %v and %v closer than %d ms", song.ID, d, seed, key[i-1], m, MinSpacingMs)
					}
				}
				for i := 1; i < len(perf.Notes); i++ {
					if perf.Notes[i].StartMs < perf.Notes[i-1].StartMs {
						t.Fatalf("%s d%d seed %d: notes not sorted", song.ID, d, seed)
					}
				}
				for _, ni := range ref.groups[0].notes {
					if !hasNote(perf, ref.notes[ni].Pitch, ref.notes[ni].StartMs) {
						t.Errorf("%s d%d seed %d: first note %+v changed", song.ID, d, seed, ref.notes[ni])
					}
				}
			}
		}
	}
}

func hasNote(perf model.Performance, pitch int, startMs float64) bool {
	for _, n := range perf.Notes {
		if n.Pitch == pitch && math.Abs(n.StartMs-startMs) < 1e-9 {
			return true
		}
	}
	return false
}

func TestGenerateBeatsToMs(t *testing.T) {
	song := model.Song{Tempo: 60, Notes: []model.Note{
		{Pitch: 60, Start: 0, Dur: 1, Vel: 80},
		{Pitch: 62, Start: 1.5, Dur: 0.5, Vel: 70},
	}}
	sc := mustScore(t, song)
	perf, key := render(sc, nil)
	want := []model.PerfNote{{Pitch: 60, StartMs: 0, DurMs: 1000, Vel: 80}, {Pitch: 62, StartMs: 1500, DurMs: 500, Vel: 70}}
	if !reflect.DeepEqual(perf.Notes, want) || perf.DurationMs != 2000 {
		t.Errorf("perf = %+v, want notes %+v and duration 2000", perf, want)
	}
	if key == nil || len(key) != 0 {
		t.Errorf("key = %#v, want empty non-nil", key)
	}
}

// TestRenderOnsets checks the onset rule of every mistake type on a melody
// whose notes start every 500 ms; group 4 starts at 2000 ms.
func TestRenderOnsets(t *testing.T) {
	sc := mustScore(t, melody(8)) // pitches 60 62 64 65 67 69 71 72
	tests := []struct {
		name  string
		plan  plan
		want  model.Mistake
		check func(t *testing.T, perf model.Performance)
	}{
		{
			name: "wrong_note sounds on time with the new pitch",
			plan: plan{kind: model.MistakeWrongNote, group: 4, note: 4, pitch: 66},
			want: model.Mistake{Type: "wrong_note", OnsetMs: 2000, Pitch: 66, ExpectedPitch: 67},
			check: func(t *testing.T, perf model.Performance) {
				if !hasNote(perf, 66, 2000) || hasNote(perf, 67, 2000) {
					t.Error("pitch 67 at 2000 ms not replaced by 66")
				}
			},
		},
		{
			name: "missed_note onset is when it should have started",
			plan: plan{kind: model.MistakeMissedNote, group: 4, note: 4},
			want: model.Mistake{Type: "missed_note", OnsetMs: 2000, ExpectedPitch: 67},
			check: func(t *testing.T, perf model.Performance) {
				if len(perf.Notes) != 7 || hasNote(perf, 67, 2000) {
					t.Errorf("note not omitted: %+v", perf.Notes)
				}
			},
		},
		{
			name: "extra_note onset is when the extra note sounds",
			plan: plan{kind: model.MistakeExtraNote, group: 4, offsetMs: 250, durMs: 200, vel: 80, pitch: 61},
			want: model.Mistake{Type: "extra_note", OnsetMs: 2250, Pitch: 61},
			check: func(t *testing.T, perf model.Performance) {
				if len(perf.Notes) != 9 || !hasNote(perf, 61, 2250) || !hasNote(perf, 67, 2000) {
					t.Errorf("extra note not inserted: %+v", perf.Notes)
				}
			},
		},
		{
			name: "grace extra_note before the note",
			plan: plan{kind: model.MistakeExtraNote, group: 4, offsetMs: -80, durMs: 80, vel: 48, pitch: 69},
			want: model.Mistake{Type: "extra_note", OnsetMs: 1920, Pitch: 69},
			check: func(t *testing.T, perf model.Performance) {
				if !hasNote(perf, 69, 1920) {
					t.Error("grace note missing")
				}
			},
		},
		{
			name: "rush onset is the early start",
			plan: plan{kind: model.MistakeRush, group: 4, offsetMs: -120},
			want: model.Mistake{Type: "rush", OnsetMs: 1880, Pitch: 67, ExpectedPitch: 67},
			check: func(t *testing.T, perf model.Performance) {
				if !hasNote(perf, 67, 1880) || !hasNote(perf, 69, 2500) {
					t.Errorf("rush wrong: %+v", perf.Notes)
				}
			},
		},
		{
			name: "drag onset is the expected start",
			plan: plan{kind: model.MistakeDrag, group: 4, offsetMs: 150},
			want: model.Mistake{Type: "drag", OnsetMs: 2000, Pitch: 67, ExpectedPitch: 67},
			check: func(t *testing.T, perf model.Performance) {
				if !hasNote(perf, 67, 2150) || !hasNote(perf, 69, 2500) {
					t.Errorf("drag wrong: %+v", perf.Notes)
				}
			},
		},
		{
			name: "hesitation onset is the expected start and later notes shift",
			plan: plan{kind: model.MistakeHesitation, group: 4, offsetMs: 700},
			want: model.Mistake{Type: "hesitation", OnsetMs: 2000, Pitch: 67, ExpectedPitch: 67},
			check: func(t *testing.T, perf model.Performance) {
				if !hasNote(perf, 65, 1500) || !hasNote(perf, 67, 2700) || !hasNote(perf, 72, 4200) {
					t.Errorf("hesitation wrong: %+v", perf.Notes)
				}
				if perf.DurationMs != 4700 {
					t.Errorf("duration = %v, want 4700", perf.DurationMs)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.plan.kind != model.MistakeWrongNote && tt.plan.kind != model.MistakeMissedNote {
				tt.plan.note = -1
			}
			perf, key := render(sc, []plan{tt.plan})
			if len(key) != 1 || key[0] != tt.want {
				t.Errorf("key = %+v, want [%+v]", key, tt.want)
			}
			tt.check(t, perf)
		})
	}
}

func TestRenderHesitationsAccumulate(t *testing.T) {
	sc := mustScore(t, melody(10))
	plans := []plan{
		{kind: model.MistakeHesitation, group: 3, note: -1, offsetMs: 400},
		{kind: model.MistakeRush, group: 5, note: -1, offsetMs: -100},
		{kind: model.MistakeHesitation, group: 7, note: -1, offsetMs: 600},
	}
	perf, key := render(sc, plans)
	wantPauses := []model.Pause{{ScoreMs: 1500, Ms: 400}, {ScoreMs: 3500, Ms: 600}}
	if !slices.Equal(perf.Pauses, wantPauses) {
		t.Errorf("pauses = %+v, want %+v", perf.Pauses, wantPauses)
	}
	wantKey := []float64{1500, 2500 + 400 - 100, 3500 + 400}
	if len(key) != len(wantKey) {
		t.Fatalf("key = %+v, want %d mistakes", key, len(wantKey))
	}
	for i, m := range key {
		if m.OnsetMs != wantKey[i] {
			t.Errorf("mistake %d onset = %v, want %v", i, m.OnsetMs, wantKey[i])
		}
	}
	for i, n := range perf.Notes {
		want := float64(500 * i)
		switch {
		case i >= 7:
			want += 1000
		case i == 5:
			want += 300
		case i >= 3:
			want += 400
		}
		if n.StartMs != want {
			t.Errorf("note %d starts at %v, want %v", i, n.StartMs, want)
		}
	}
}

// oneKind runs choosePlans with only the given kind enabled.
func oneKind(t *testing.T, kind string, song model.Song, d int, seeds int) []plan {
	t.Helper()
	sc := mustScore(t, song)
	weights := make([]float64, len(kinds()))
	for i, k := range kinds() {
		if k == kind {
			weights[i] = 1
		}
	}
	var all []plan
	for seed := range seeds {
		rng := rand.New(rand.NewPCG(uint64(seed), seedStream))
		all = append(all, choosePlans(sc, levelFor(d), weights, rng)...)
	}
	return all
}

func TestPlanRangesByDifficulty(t *testing.T) {
	song := chorale(12)
	sc := mustScore(t, song)
	for d := 1; d <= 5; d++ {
		l := levelFor(d)
		for _, kind := range kinds() {
			plans := oneKind(t, kind, song, d, 30)
			if len(plans) == 0 {
				t.Errorf("d%d %s: no mistakes placed", d, kind)
			}
			for _, p := range plans {
				orig := 0
				if p.note >= 0 {
					orig = sc.notes[p.note].Pitch
				}
				switch kind {
				case model.MistakeWrongNote:
					if iv := abs(p.pitch - orig); iv < l.wrongMin || iv > l.wrongMax {
						t.Errorf("d%d wrong interval %d outside %d–%d", d, iv, l.wrongMin, l.wrongMax)
					}
				case model.MistakeRush, model.MistakeDrag:
					if o := math.Abs(p.offsetMs); o < l.timingMin || o > l.timingMax || o < 60 || o > 250 {
						t.Errorf("d%d %s offset %v outside %v–%v", d, kind, o, l.timingMin, l.timingMax)
					}
				case model.MistakeHesitation:
					if p.offsetMs < l.pauseMin || p.offsetMs > l.pauseMax || p.offsetMs < 300 || p.offsetMs > 1200 {
						t.Errorf("d%d pause %v outside %v–%v", d, p.offsetMs, l.pauseMin, l.pauseMax)
					}
				}
			}
		}
	}
}

func TestDifficultySubtlety(t *testing.T) {
	song := chorale(12)
	sc := mustScore(t, song)
	mean := func(kind string, d int, f func(p plan) float64) float64 {
		plans := oneKind(t, kind, song, d, 50)
		sum := 0.0
		for _, p := range plans {
			sum += f(p)
		}
		return sum / float64(len(plans))
	}
	interval := func(p plan) float64 { return float64(abs(p.pitch - sc.notes[p.note].Pitch)) }
	offset := func(p plan) float64 { return math.Abs(p.offsetMs) }
	tests := []struct {
		kind string
		f    func(p plan) float64
	}{
		{model.MistakeWrongNote, interval},
		{model.MistakeRush, offset},
		{model.MistakeDrag, offset},
		{model.MistakeHesitation, offset},
	}
	for _, tt := range tests {
		prev := math.Inf(1)
		for d := 1; d <= 5; d++ {
			m := mean(tt.kind, d, tt.f)
			if m >= prev {
				t.Errorf("%s: difficulty %d mean %v not smaller than difficulty %d mean %v", tt.kind, d, m, d-1, prev)
			}
			prev = m
		}
	}

	// Subtle wrong notes stay in key; obvious ones are chromatic.
	inKeyShare := func(d int) float64 {
		plans := oneKind(t, model.MistakeWrongNote, song, d, 50)
		n := 0
		for _, p := range plans {
			if sc.inKey[p.pitch%12] {
				n++
			}
		}
		return float64(n) / float64(len(plans))
	}
	if s := inKeyShare(5); s != 1 {
		t.Errorf("difficulty 5 in-key share = %v, want 1", s)
	}
	if s := inKeyShare(1); s > 0.5 {
		t.Errorf("difficulty 1 in-key share = %v, want mostly chromatic", s)
	}

	// Subtle extra notes are mostly grace notes, obvious ones never.
	graces := func(d int) int {
		n := 0
		for _, p := range oneKind(t, model.MistakeExtraNote, song, d, 50) {
			if p.offsetMs < 0 {
				n++
			}
		}
		return n
	}
	if g1, g5 := graces(1), graces(5); g1 != 0 || g5 == 0 {
		t.Errorf("grace notes: difficulty 1 = %d (want 0), difficulty 5 = %d (want > 0)", g1, g5)
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func TestMistakeCount(t *testing.T) {
	tests := []struct {
		name       string
		durationMs float64
		d          int
		want       int
	}{
		{"short song still has one", 1000, 3, 1},
		{"60 s at difficulty 1", 60000, 1, 10},
		{"60 s at difficulty 5", 60000, 5, 6},
		{"capped", 600000, 1, MaxMistakes},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := mistakeCount(tt.durationMs, levelFor(tt.d)); got != tt.want {
				t.Errorf("mistakeCount = %d, want %d", got, tt.want)
			}
		})
	}

	// A long song gets the full count at difficulty 1 (60 s → 10).
	_, key, err := Generate(model.LessonGeneratePayload{Song: melody(120), Difficulty: 1, Seed: 7})
	if err != nil {
		t.Fatal(err)
	}
	if len(key) < 8 || len(key) > 10 {
		t.Errorf("60 s song at difficulty 1: %d mistakes, want 8–10", len(key))
	}
}

func TestKindWeights(t *testing.T) {
	tests := []struct {
		name       string
		tendencies map[string]float64
		want       []float64
	}{
		{"none is uniform", nil, []float64{1, 1, 1, 1, 1, 1}},
		{"tendencies plus base", map[string]float64{"rush": 2, "wrong_note": 1}, []float64{1, 0.2, 0.2, 2, 0.2, 0.2}},
		{"unknown and non-positive ignored", map[string]float64{"sneeze": 50, "drag": -1, "hesitation": 0, "missed_note": 4}, []float64{0.4, 4, 0.4, 0.4, 0.4, 0.4}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := kindWeights(tt.tendencies); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("kindWeights = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTendenciesBiasTypes(t *testing.T) {
	counts := map[string]int{}
	for seed := range uint32(200) {
		_, key, err := Generate(model.LessonGeneratePayload{Song: chorale(12), Tendencies: map[string]float64{"rush": 3}, Difficulty: 2, Seed: seed})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range key {
			counts[m.Type]++
		}
	}
	for _, k := range kinds() {
		if counts[k] == 0 {
			t.Errorf("type %s never appeared: %v", k, counts)
		}
		if k != model.MistakeRush && counts[k] >= counts[model.MistakeRush] {
			t.Errorf("%s (%d) as common as rush (%d)", k, counts[k], counts[model.MistakeRush])
		}
	}
}

func TestGenerateValidation(t *testing.T) {
	ok := melody(4)
	with := func(f func(s *model.Song)) model.Song {
		s := ok
		s.Notes = append([]model.Note(nil), ok.Notes...)
		f(&s)
		return s
	}
	tests := []struct {
		name string
		song model.Song
	}{
		{"zero tempo", with(func(s *model.Song) { s.Tempo = 0 })},
		{"negative tempo", with(func(s *model.Song) { s.Tempo = -90 })},
		{"NaN tempo", with(func(s *model.Song) { s.Tempo = math.NaN() })},
		{"no notes", with(func(s *model.Song) { s.Notes = nil })},
		{"one onset", with(func(s *model.Song) { s.Notes = s.Notes[:1] })},
		{"chord only", with(func(s *model.Song) {
			s.Notes = []model.Note{{Pitch: 60, Dur: 1, Vel: 80}, {Pitch: 64, Dur: 1, Vel: 80}}
		})},
		{"pitch too high", with(func(s *model.Song) { s.Notes[1].Pitch = 128 })},
		{"negative start", with(func(s *model.Song) { s.Notes[1].Start = -1 })},
		{"zero duration", with(func(s *model.Song) { s.Notes[1].Dur = 0 })},
		{"zero velocity", with(func(s *model.Song) { s.Notes[1].Vel = 0 })},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := Generate(model.LessonGeneratePayload{Song: tt.song, Difficulty: 3})
			if !errors.Is(err, ErrInvalidSong) {
				t.Errorf("err = %v, want ErrInvalidSong", err)
			}
		})
	}
}

func TestGenerateClampsDifficulty(t *testing.T) {
	tests := []struct{ in, same int }{{0, 1}, {-4, 1}, {6, 5}, {99, 5}}
	for _, tt := range tests {
		gen := func(d int) []model.Mistake {
			_, key, err := Generate(model.LessonGeneratePayload{Song: chorale(8), Difficulty: d, Seed: 3})
			if err != nil {
				t.Fatal(err)
			}
			return key
		}
		if !reflect.DeepEqual(gen(tt.in), gen(tt.same)) {
			t.Errorf("difficulty %d not treated as %d", tt.in, tt.same)
		}
	}
}

func TestGenerateUnsortedInput(t *testing.T) {
	song := melody(16)
	rev := song
	rev.Notes = nil
	for i := len(song.Notes) - 1; i >= 0; i-- {
		rev.Notes = append(rev.Notes, song.Notes[i])
	}
	p := model.LessonGeneratePayload{Song: song, Difficulty: 2, Seed: 11}
	perf1, key1, _ := Generate(p)
	p.Song = rev
	perf2, key2, _ := Generate(p)
	if !reflect.DeepEqual(perf1, perf2) || !reflect.DeepEqual(key1, key2) {
		t.Error("note order in the song changed the output")
	}
}
