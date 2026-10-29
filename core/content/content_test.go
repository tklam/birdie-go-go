package content

import (
	"strings"
	"testing"

	"birdiegogo/core/model"
)

// validBundle returns a small bundle that passes validation; tests break one
// thing at a time.
func validBundle() *model.ContentBundle {
	return &model.ContentBundle{
		Game:  model.GameInfo{Title: "Birdie Go Go", ContentVersion: "0.1.0", StartMap: "tko", StartSpawn: "home"},
		Areas: []model.Area{{ID: "tko_town", Name: "Tseung Kwan O"}},
		Birds: []model.Bird{{
			ID: "bulbul", Name: "Red-whiskered Bulbul", Sprite: "bird_bulbul", OverworldSprite: "owbird_bulbul",
			Skittishness: 0.3, SizeBand: [2]float64{0.08, 0.3}, Speed: 120,
			Seasons: []string{"spring"}, Poses: map[string]float64{"perched": 0.8}, Behaviors: []string{"perch"},
		}},
		Spots: []model.Spot{{
			ID: "park", Name: "Park", Area: "tko_town", Background: "bg_park", Shots: 12,
			Birds: []model.SpotBird{{Species: "bulbul", Weight: 1, Slots: []string{"morning"}}},
		}},
		Students: []model.Student{{
			ID: "mina", Name: "Mina", Level: 1, Repertoire: []string{"twinkle"},
			Tendencies: map[string]float64{"rush": 2}, Fee: 20,
		}},
		Songs: []model.Song{{
			ID: "twinkle", Title: "Twinkle", Tempo: 96, TimeSignature: [2]int{4, 4},
			Notes: []model.Note{{Pitch: 60, Start: 0, Dur: 1, Vel: 80}},
		}},
		Events: []model.Event{{
			ID:         "intro",
			Trigger:    model.Trigger{Type: "new_game", Params: map[string]string{}},
			Conditions: []model.Condition{{Type: "flag_not_set", Value: "intro_done"}},
			Actions:    []model.Action{{Type: "dialogue", Value: "intro_lines"}, {Type: "set_flag", Value: "intro_done"}},
			Once:       true,
		}},
		Dialogue: []model.Dialogue{{ID: "intro_lines", Lines: []model.DialogueLine{{Speaker: "angie", Text: "Hi!"}}}},
	}
}

func TestValidBundle(t *testing.T) {
	if errs := Validate(validBundle()); len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
}

func TestValidateErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(b *model.ContentBundle)
		want   string
	}{
		{"missing title", func(b *model.ContentBundle) { b.Game.Title = "" }, "title is required"},
		{"bad version", func(b *model.ContentBundle) { b.Game.ContentVersion = "v1" }, "MAJOR.MINOR.PATCH"},
		{"missing start", func(b *model.ContentBundle) { b.Game.StartMap = "" }, "start_map"},
		{"bad id", func(b *model.ContentBundle) { b.Areas[0].ID = "TKO Town" }, "snake_case"},
		{"duplicate id", func(b *model.ContentBundle) { b.Areas = append(b.Areas, b.Areas[0]) }, "duplicate id"},
		{"bird skittishness", func(b *model.ContentBundle) { b.Birds[0].Skittishness = 2 }, "skittishness"},
		{"bird size band", func(b *model.ContentBundle) { b.Birds[0].SizeBand = [2]float64{0.5, 0.1} }, "size_band"},
		{"bird season", func(b *model.ContentBundle) { b.Birds[0].Seasons = []string{"monsoon"} }, "unknown season"},
		{"bird pose", func(b *model.ContentBundle) { b.Birds[0].Poses = map[string]float64{"dancing": 1} }, "unknown pose"},
		{"spot area", func(b *model.ContentBundle) { b.Spots[0].Area = "nowhere" }, "unknown area"},
		{"spot species", func(b *model.ContentBundle) { b.Spots[0].Birds[0].Species = "dodo" }, "unknown species"},
		{"spot slot", func(b *model.ContentBundle) { b.Spots[0].Birds[0].Slots = []string{"night"} }, "unknown time slot"},
		{"student song", func(b *model.ContentBundle) { b.Students[0].Repertoire = []string{"missing"} }, "unknown song"},
		{"student tendency", func(b *model.ContentBundle) { b.Students[0].Tendencies = map[string]float64{"sneeze": 1} }, "unknown mistake type"},
		{"song pitch", func(b *model.ContentBundle) { b.Songs[0].Notes[0].Pitch = 200 }, "piano range"},
		{"song duration", func(b *model.ContentBundle) { b.Songs[0].Notes[0].Dur = 0 }, "dur must be"},
		{"trigger type", func(b *model.ContentBundle) { b.Events[0].Trigger.Type = "sneeze" }, "unknown trigger"},
		{"trigger spot", func(b *model.ContentBundle) {
			b.Events[0].Trigger = model.Trigger{Type: "photo_session_end", Params: map[string]string{"spot": "nope"}}
		}, "trigger spot"},
		{"condition type", func(b *model.ContentBundle) { b.Events[0].Conditions[0].Type = "is_raining" }, "unknown condition"},
		{"action type", func(b *model.ContentBundle) { b.Events[0].Actions[0].Type = "explode" }, "unknown action"},
		{"dialogue ref", func(b *model.ContentBundle) { b.Events[0].Actions[0].Value = "missing" }, "unknown dialogue"},
		{"companion", func(b *model.ContentBundle) {
			b.Events[0].Actions = append(b.Events[0].Actions, model.Action{Type: "join_party", Value: "bob"})
		}, "unknown companion"},
		{"kei stage", func(b *model.ContentBundle) {
			b.Events[0].Actions = append(b.Events[0].Actions, model.Action{Type: "set_kei_stage", Value: "besties"})
		}, "unknown Kei stage"},
		{"empty dialogue", func(b *model.ContentBundle) { b.Dialogue[0].Lines = nil }, "no lines"},
		{"dialogue condition", func(b *model.ContentBundle) {
			b.Dialogue[0].Lines[0].If = []model.Condition{{Type: "vibes"}}
		}, "unknown condition"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := validBundle()
			tt.mutate(b)
			errs := Validate(b)
			for _, err := range errs {
				if strings.Contains(err.Error(), tt.want) {
					return
				}
			}
			t.Errorf("want an error containing %q, got %v", tt.want, errs)
		})
	}
}
