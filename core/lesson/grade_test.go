package lesson

import (
	"reflect"
	"testing"

	"birdiegogo/core/model"
)

func TestGrade(t *testing.T) {
	m := func(onset float64) model.Mistake {
		return model.Mistake{Type: "rush", OnsetMs: onset, Pitch: 60, ExpectedPitch: 60}
	}
	tests := []struct {
		name     string
		mistakes []model.Mistake
		flags    []float64
		latency  float64
		wantHits []bool
		wantFA   int
		wantScr  int
	}{
		{name: "nothing flagged", mistakes: []model.Mistake{m(1000), m(3000)}, wantHits: []bool{false, false}, wantScr: 0},
		{name: "all found", mistakes: []model.Mistake{m(1000), m(3000)}, flags: []float64{1200, 3500}, wantHits: []bool{true, true}, wantScr: 100},
		{name: "window start inclusive", mistakes: []model.Mistake{m(1000)}, flags: []float64{900}, wantHits: []bool{true}, wantScr: 100},
		{name: "window end inclusive", mistakes: []model.Mistake{m(1000)}, flags: []float64{2000}, wantHits: []bool{true}, wantScr: 100},
		{name: "just before window", mistakes: []model.Mistake{m(1000)}, flags: []float64{899.9}, wantHits: []bool{false}, wantFA: 1, wantScr: 0},
		{name: "just after window", mistakes: []model.Mistake{m(1000)}, flags: []float64{2000.1}, wantHits: []bool{false}, wantFA: 1, wantScr: 0},
		{name: "double flag counts one false alarm", mistakes: []model.Mistake{m(1000), m(5000)}, flags: []float64{1100, 1200}, wantHits: []bool{true, false}, wantFA: 1, wantScr: 40},
		{name: "latency offset subtracted", mistakes: []model.Mistake{m(1000)}, flags: []float64{2150}, latency: 200, wantHits: []bool{true}, wantScr: 100},
		{name: "latency offset pushes out of window", mistakes: []model.Mistake{m(1000)}, flags: []float64{950}, latency: 100, wantHits: []bool{false}, wantFA: 1, wantScr: 0},
		{name: "negative latency offset", mistakes: []model.Mistake{m(1000)}, flags: []float64{2050}, latency: -100, wantHits: []bool{false}, wantFA: 1, wantScr: 0},
		{
			// Windows [1400, 2500] and [1900, 3000] overlap; the first mistake
			// takes the earliest flag, leaving the second flag for the second.
			name: "overlapping windows share flags in order", mistakes: []model.Mistake{m(1500), m(2000)},
			flags: []float64{2100, 1950}, wantHits: []bool{true, true}, wantScr: 100,
		},
		{
			// The first mistake greedily takes the only flag both could use.
			name: "overlapping windows one flag", mistakes: []model.Mistake{m(2000), m(1500)},
			flags: []float64{2100}, wantHits: []bool{true, false}, wantScr: 50,
		},
		{name: "unsorted flags", mistakes: []model.Mistake{m(1000), m(4000)}, flags: []float64{4100, 1100}, wantHits: []bool{true, true}, wantScr: 100},
		{name: "rounding", mistakes: []model.Mistake{m(1000), m(3000), m(5000)}, flags: []float64{1000, 3000}, wantHits: []bool{true, true, false}, wantScr: 67},
		{name: "clamped at zero", mistakes: []model.Mistake{m(1000)}, flags: []float64{5000, 6000, 7000}, wantHits: []bool{false}, wantFA: 3, wantScr: 0},
		{name: "false alarm with all hits", mistakes: []model.Mistake{m(1000)}, flags: []float64{1000, 9000}, wantHits: []bool{true}, wantFA: 1, wantScr: 90},
		{name: "zero mistakes, no flags", wantScr: 100},
		{name: "zero mistakes, two flags", flags: []float64{1, 2}, wantFA: 2, wantScr: 80},
		{name: "zero mistakes, many flags", flags: make([]float64, 11), wantFA: 11, wantScr: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := Grade(tt.mistakes, tt.flags, tt.latency)
			hits := make([]bool, 0)
			for i, g := range res.Mistakes {
				hits = append(hits, g.Hit)
				if i > 0 && g.OnsetMs < res.Mistakes[i-1].OnsetMs {
					t.Errorf("mistakes not sorted by onset: %+v", res.Mistakes)
				}
			}
			wantHits := tt.wantHits
			if wantHits == nil {
				wantHits = []bool{}
			}
			if !reflect.DeepEqual(hits, wantHits) {
				t.Errorf("hits = %v, want %v", hits, wantHits)
			}
			nHits := 0
			for _, h := range wantHits {
				if h {
					nHits++
				}
			}
			if res.Hits != nHits || res.Misses != len(wantHits)-nHits {
				t.Errorf("hits/misses = %d/%d, want %d/%d", res.Hits, res.Misses, nHits, len(wantHits)-nHits)
			}
			if res.FalseAlarms != tt.wantFA {
				t.Errorf("false alarms = %d, want %d", res.FalseAlarms, tt.wantFA)
			}
			if res.Score != tt.wantScr {
				t.Errorf("score = %d, want %d", res.Score, tt.wantScr)
			}
			if res.Mistakes == nil {
				t.Error("mistakes is nil")
			}
		})
	}
}

func TestGradeKeepsInputs(t *testing.T) {
	mistakes := []model.Mistake{{Type: "drag", OnsetMs: 3000}, {Type: "rush", OnsetMs: 1000}}
	flags := []float64{3100, 1100}
	res := Grade(mistakes, flags, 50)
	if mistakes[0].OnsetMs != 3000 || flags[0] != 3100 {
		t.Error("Grade modified its inputs")
	}
	if res.Mistakes[0].Type != "rush" || res.Mistakes[0].Mistake != mistakes[1] {
		t.Errorf("revealed mistakes = %+v", res.Mistakes)
	}
}

func TestGradeGenerated(t *testing.T) {
	_, key, err := Generate(model.LessonGeneratePayload{Song: chorale(12), Difficulty: 3, Seed: 5})
	if err != nil {
		t.Fatal(err)
	}
	flags := make([]float64, 0, len(key))
	for _, m := range key {
		flags = append(flags, m.OnsetMs+300+120) // reaction time plus latency
	}
	res := Grade(key, flags, 120)
	if res.Score != 100 || res.Hits != len(key) || res.FalseAlarms != 0 {
		t.Errorf("perfect flagging graded %+v", res)
	}
}
