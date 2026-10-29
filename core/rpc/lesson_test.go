package rpc

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"birdiegogo/core/lesson"
	"birdiegogo/core/model"
)

func testSong() model.Song {
	s := model.Song{ID: "test", Title: "Test", Tempo: 120, TimeSignature: [2]int{4, 4}, Difficulty: 1}
	for i := range 48 {
		s.Notes = append(s.Notes, model.Note{Pitch: 60 + i%8, Start: float64(i), Dur: 1, Vel: 80})
	}
	return s
}

// call sends one request and decodes the result into result (if non-nil).
// It returns the raw response and its error message.
func call(t *testing.T, s *Server, op string, payload, result any) (string, string) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	raw := s.Handle([]byte(fmt.Sprintf(`{"id":9,"op":%q,"payload":%s}`, op, body)))
	var resp struct {
		model.Response
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if resp.ID != 9 {
		t.Errorf("id = %d, want 9", resp.ID)
	}
	if resp.OK && result != nil {
		if err := json.Unmarshal(resp.Result, result); err != nil {
			t.Fatalf("decode result: %v", err)
		}
	}
	return string(raw), resp.Error
}

func TestLessonEndToEnd(t *testing.T) {
	s := NewServer()
	payload := model.LessonGeneratePayload{Song: testSong(), Tendencies: map[string]float64{"rush": 2}, Difficulty: 2, Seed: 99}
	var gen model.LessonGenerateResult
	raw, errMsg := call(t, s, "lesson.generate", payload, &gen)
	if errMsg != "" {
		t.Fatalf("generate: %s", errMsg)
	}
	if gen.LessonID != "lesson-1" || len(gen.Performance.Notes) == 0 || gen.Performance.DurationMs <= 0 {
		t.Fatalf("generate result = %+v", gen)
	}
	if strings.Contains(raw, "onsetMs") || strings.Contains(raw, "mistakes") {
		t.Errorf("generate leaked the answer key: %s", raw)
	}

	// The core is deterministic, so the test can rebuild the key and flag
	// every mistake plus one false alarm.
	_, key, err := lesson.Generate(payload)
	if err != nil {
		t.Fatal(err)
	}
	flags := []float64{-5000}
	for _, m := range key {
		flags = append(flags, m.OnsetMs+400+50)
	}
	var res model.LessonGradeResult
	raw, errMsg = call(t, s, "lesson.grade", model.LessonGradePayload{LessonID: gen.LessonID, FlagsMs: flags, LatencyOffsetMs: 50}, &res)
	if errMsg != "" {
		t.Fatalf("grade: %s", errMsg)
	}
	if res.Hits != len(key) || res.Misses != 0 || res.FalseAlarms != 1 || res.Score != 90 {
		t.Errorf("grade result = %+v, want %d hits, 1 false alarm, score 90", res, len(key))
	}
	if len(res.Mistakes) != len(key) {
		t.Fatalf("revealed %d mistakes, want %d", len(res.Mistakes), len(key))
	}
	for i, g := range res.Mistakes {
		if g.Mistake != key[i] || !g.Hit {
			t.Errorf("mistake %d = %+v, want %+v hit", i, g, key[i])
		}
	}
	if strings.Contains(raw, `"Mistake"`) || !strings.Contains(raw, `"hit":true`) {
		t.Errorf("graded mistakes not flattened: %s", raw)
	}

	if _, errMsg := call(t, s, "lesson.grade", model.LessonGradePayload{LessonID: gen.LessonID}, nil); errMsg == "" {
		t.Error("grading the same lesson twice succeeded")
	}
}

func TestLessonGradeEmptyFlags(t *testing.T) {
	s := NewServer()
	var gen model.LessonGenerateResult
	if _, errMsg := call(t, s, "lesson.generate", model.LessonGeneratePayload{Song: testSong(), Difficulty: 5, Seed: 1}, &gen); errMsg != "" {
		t.Fatal(errMsg)
	}
	var res model.LessonGradeResult
	raw, errMsg := call(t, s, "lesson.grade", map[string]string{"lessonId": gen.LessonID}, &res)
	if errMsg != "" {
		t.Fatal(errMsg)
	}
	if res.Score != 0 || res.Hits != 0 || res.Misses == 0 || res.Misses != len(res.Mistakes) {
		t.Errorf("no flags graded %+v", res)
	}
	if strings.Contains(raw, "null") {
		t.Errorf("response has null: %s", raw)
	}
}

func TestLessonErrors(t *testing.T) {
	bad := testSong()
	bad.Tempo = 0
	tests := []struct {
		name    string
		op      string
		payload any
		want    string
	}{
		{"invalid song", "lesson.generate", model.LessonGeneratePayload{Song: bad}, "invalid song"},
		{"missing song", "lesson.generate", map[string]int{"seed": 1}, "invalid song"},
		{"bad generate payload", "lesson.generate", map[string]string{"seed": "x"}, "decode payload"},
		{"unknown lesson", "lesson.grade", model.LessonGradePayload{LessonID: "lesson-77"}, "unknown lesson"},
		{"no lesson id", "lesson.grade", nil, "unknown lesson"},
		{"bad grade payload", "lesson.grade", map[string]any{"flagsMs": "soon"}, "decode payload"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, errMsg := call(t, NewServer(), tt.op, tt.payload, nil)
			if !strings.Contains(errMsg, tt.want) {
				t.Errorf("error = %q, want it to contain %q", errMsg, tt.want)
			}
			if strings.Contains(raw, `"ok":true`) {
				t.Errorf("response ok: %s", raw)
			}
		})
	}
}

func TestLessonEviction(t *testing.T) {
	s := NewServer()
	for i := 1; i <= MaxLessons+2; i++ {
		var gen model.LessonGenerateResult
		if _, errMsg := call(t, s, "lesson.generate", model.LessonGeneratePayload{Song: testSong(), Seed: uint32(i)}, &gen); errMsg != "" {
			t.Fatal(errMsg)
		}
		if want := fmt.Sprintf("lesson-%d", i); gen.LessonID != want {
			t.Fatalf("lesson id = %q, want %q", gen.LessonID, want)
		}
	}
	if len(s.lessons) != MaxLessons || len(s.order) != MaxLessons {
		t.Errorf("server keeps %d/%d lessons, want %d", len(s.lessons), len(s.order), MaxLessons)
	}
	for _, tt := range []struct {
		id   string
		want bool
	}{{"lesson-1", false}, {"lesson-2", false}, {"lesson-3", true}, {"lesson-18", true}} {
		_, errMsg := call(t, s, "lesson.grade", model.LessonGradePayload{LessonID: tt.id}, nil)
		if (errMsg == "") != tt.want {
			t.Errorf("grade %s: error %q, want ok %v", tt.id, errMsg, tt.want)
		}
	}
	// Grading freed a slot without evicting anything else.
	if len(s.order) != MaxLessons-2 {
		t.Errorf("order has %d entries after two grades, want %d", len(s.order), MaxLessons-2)
	}
}
