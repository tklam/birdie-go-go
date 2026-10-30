package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"

	"birdiegogo/core/model"
)

func TestRunWritesBundle(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "game.yaml"), "title: Birdie Go Go\ncontent_version: 0.1.0\nstart_map: tko\nstart_spawn: home\n")
	out := filepath.Join(dir, "out", "base.json")

	if err := run(dir, out); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var b model.ContentBundle
	if err := json.Unmarshal(data, &b); err != nil {
		t.Fatal(err)
	}
	if b.Game.Title != "Birdie Go Go" || b.Game.ContentVersion != "0.1.0" || b.Game.StartMap != "tko" {
		t.Errorf("bundle = %+v", b)
	}
	if b.Birds == nil || b.Events == nil {
		t.Error("lists must be non-nil so the client never sees null")
	}
}

func TestRunRejectsInvalidContent(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "game.yaml"), "title: \"\"\ncontent_version: one\n")
	if err := run(dir, ""); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestSounds(t *testing.T) {
	game := "title: Birdie Go Go\ncontent_version: 0.1.0\nstart_map: tko\nstart_spawn: home\n"
	tests := []struct {
		name, sounds string
		wantErr      bool
	}{
		{"ok", "cues:\n  - { id: ding, notes: [ { wave: triangle, freq: 1318, dur: 0.9, repeat: 1, every: 0.28 } ] }\nsoundscapes:\n  - { id: quiet }\n", false},
		{"typo", "cues:\n  - { id: ding, notes: [ { wave: triangle, frq: 1318, dur: 0.9 } ] }\n", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			writeFile(t, filepath.Join(dir, "game.yaml"), game)
			writeFile(t, filepath.Join(dir, "sounds.yaml"), tt.sounds)
			b, err := load(dir)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected an error for an unknown field")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if n := b.Sounds.Cues[0].Notes[0]; n.Freq != 1318 || n.Repeat != 1 || n.Every != 0.28 {
				t.Errorf("note = %+v", n)
			}
			if sc := b.Sounds.Soundscapes[0]; sc.Beds == nil || sc.Cues == nil {
				t.Error("soundscape lists must be non-nil")
			}
		})
	}
}

func TestRepoContentIsValid(t *testing.T) {
	if err := run(filepath.Join("..", "..", "content"), ""); err != nil {
		t.Fatal(err)
	}
}

func TestConvertEvent(t *testing.T) {
	var events []eventYAML
	src := `
- id: e
  trigger: { type: photo_session_end, spot: park }
  conditions: [ { flag_not_set: seen } ]
  actions: [ { dialogue: hi }, { add_bond: { who: oboy, amount: 10 } } ]
  once: false
`
	if err := yaml.Unmarshal([]byte(src), &events); err != nil {
		t.Fatal(err)
	}
	e, err := convertEvent(events[0])
	if err != nil {
		t.Fatal(err)
	}
	if e.Trigger.Type != "photo_session_end" || e.Trigger.Params["spot"] != "park" {
		t.Errorf("trigger = %+v", e.Trigger)
	}
	if len(e.Conditions) != 1 || e.Conditions[0].Type != "flag_not_set" || e.Conditions[0].Value != "seen" {
		t.Errorf("conditions = %+v", e.Conditions)
	}
	if len(e.Actions) != 2 || e.Actions[1].Type != "add_bond" {
		t.Errorf("actions = %+v", e.Actions)
	}
	if e.Once {
		t.Error("once: false was ignored")
	}

	events[0].Actions = append(events[0].Actions, map[string]any{"a": 1, "b": 2})
	if _, err := convertEvent(events[0]); err == nil {
		t.Error("expected an error for a two-key action")
	}
}

func writeFile(t *testing.T, path, data string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}
