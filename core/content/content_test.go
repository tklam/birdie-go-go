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
		Areas: []model.Area{{ID: "tko_town", Name: "Tseung Kwan O", Climate: climate(), Soundscape: "park"}},
		Birds: []model.Bird{{
			Call: "chirp", CallPitch: 1.2,
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
		Sounds: model.Sounds{
			Cues: []model.SoundCue{{ID: "chirp", Notes: []model.SoundNote{{Wave: "sine", Freq: 3000, To: 3600, Dur: 0.1, Repeat: 1, Every: 0.2}}}},
			Soundscapes: []model.Soundscape{{
				ID:   "park",
				Beds: []model.SoundBed{{Filter: "lowpass", Freq: 300, Gain: 0.1, Wobble: 0.5, Rate: 0.1}},
				Cues: []model.SoundscapeCue{{Cue: "chirp", Every: [2]float64{4, 9}, Slots: []string{"morning"}, Dry: true}},
			}},
		},
	}
}

func climate() map[string]model.Climate {
	c := model.Climate{Cloud: [2]float64{0.5, 0.2}, Precip: [2]float64{0.2, 0.2}, Temp: [2]float64{22, 3}, Fog: [2]float64{0.1, 0.1}, Wind: [2]float64{0.3, 0.2}}
	return map[string]model.Climate{"spring": c, "summer": c, "autumn": c, "winter": c}
}

// transitWith returns a valid one-line network after mutate.
func transitWith(mutate func(*model.TransitLine)) model.Transit {
	l := model.TransitLine{
		ID: "bus", Name: "Bus", Mode: "bus", Fare: 5, Stops: []string{"s1", "s2"},
		Path: [][2]float64{{0, 0}, {10, 0}}, Speed: 50, Headway: 12, First: "05:30", Last: "25:00",
	}
	mutate(&l)
	return model.Transit{Lines: []model.TransitLine{l}, Stops: []model.TransitStop{{ID: "s1", Name: "S1"}, {ID: "s2", Name: "S2"}}}
}

func TestValidBundle(t *testing.T) {
	if errs := Validate(validBundle()); len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	b := validBundle()
	b.Transit = transitWith(func(*model.TransitLine) {})
	if errs := Validate(b); len(errs) != 0 {
		t.Fatalf("unexpected transit errors: %v", errs)
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
		{"negative mission reminder", func(b *model.ContentBundle) { b.Game.MissionReminderSlots = -1 }, "mission_reminder_slots"},
		{"bedtime reminder without lines", func(b *model.ContentBundle) {
			b.Game.BedtimeReminder = &model.BedtimeReminder{EverySeconds: 60}
		}, "needs lines"},
		{"free bill", func(b *model.ContentBundle) { b.Game.Bills = []model.Bill{{Name: "Phone", EveryDays: 1}} }, "must be positive"},
		{"energy without warning text", func(b *model.ContentBundle) { b.Game.Energy = &model.EnergyRules{LowWarning: 20} }, "low_warning_text"},
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
		{"area music", func(b *model.ContentBundle) { b.Areas[0].Music = "bgm_missing" }, "unknown music"},
		{"area soundscape", func(b *model.ContentBundle) { b.Areas[0].Soundscape = "jungle" }, "unknown soundscape"},
		{"bird call", func(b *model.ContentBundle) { b.Birds[0].Call = "call_roar" }, "unknown call cue"},
		{"bird call pitch", func(b *model.ContentBundle) { b.Birds[0].CallPitch = 9 }, "call_pitch"},
		{"line bell", func(b *model.ContentBundle) {
			b.Transit = transitWith(func(l *model.TransitLine) { l.Bell = "gong" })
		}, "unknown bell cue"},
		{"cue without notes", func(b *model.ContentBundle) { b.Sounds.Cues = []model.SoundCue{{ID: "c"}} }, "at least one note"},
		{"cue wave", func(b *model.ContentBundle) { b.Sounds.Cues[0].Notes[0].Wave = "kazoo" }, "unknown wave"},
		{"cue env", func(b *model.ContentBundle) { b.Sounds.Cues[0].Notes[0].Env = "boing" }, "env must be"},
		{"cue freq", func(b *model.ContentBundle) { b.Sounds.Cues[0].Notes[0].To = 30000 }, "20–16000 Hz"},
		{"cue dur", func(b *model.ContentBundle) { b.Sounds.Cues[0].Notes[0].Dur = 0 }, "dur must be"},
		{"cue repeat without every", func(b *model.ContentBundle) { b.Sounds.Cues[0].Notes[0].Every = 0 }, "repeat must be"},
		{"bed filter", func(b *model.ContentBundle) { b.Sounds.Soundscapes[0].Beds[0].Filter = "comb" }, "unknown filter"},
		{"bed wobble", func(b *model.ContentBundle) { b.Sounds.Soundscapes[0].Beds[0].Wobble = 2 }, "wobble"},
		{"soundscape cue", func(b *model.ContentBundle) { b.Sounds.Soundscapes[0].Cues[0].Cue = "nope" }, "unknown cue"},
		{"soundscape every", func(b *model.ContentBundle) { b.Sounds.Soundscapes[0].Cues[0].Every = [2]float64{5, 2} }, "every must be"},
		{"soundscape slot", func(b *model.ContentBundle) { b.Sounds.Soundscapes[0].Cues[0].Slots = []string{"night"} }, "unknown time slot"},
		{"item kind", func(b *model.ContentBundle) { b.Items = []model.Item{{ID: "x", Name: "X", Kind: "food"}} }, "kind must be"},
		{"gear slot", func(b *model.ContentBundle) { b.Items = []model.Item{{ID: "x", Name: "X", Kind: "gear", Slot: "feet"}} }, "gear slot"},
		{"item counters unknown hazard", func(b *model.ContentBundle) {
			b.Items = []model.Item{{ID: "x", Name: "X", Kind: "consumable", Counters: []string{"meteor"}}}
		}, "unknown hazard"},
		{"hazard param", func(b *model.ContentBundle) {
			one := 1.0
			b.Hazards = []model.Hazard{{ID: "h", Name: "H", Status: "s", When: model.HazardWhen{Param: "vibes", Min: &one}}}
		}, "unknown weather parameter"},
		{"hazard item", func(b *model.ContentBundle) {
			one := 1.0
			b.Hazards = []model.Hazard{{ID: "h", Name: "H", Status: "s", When: model.HazardWhen{Param: "uv", Min: &one}, CounteredBy: []string{"cape"}}}
		}, "unknown item"},
		{"missing season", func(b *model.ContentBundle) { delete(b.Areas[0].Climate, "winter") }, "climate for winter is missing"},
		{"climate range", func(b *model.ContentBundle) {
			c := b.Areas[0].Climate["spring"]
			c.Fog = [2]float64{2, 0}
			b.Areas[0].Climate["spring"] = c
		}, "fog mean"},
		{"instrument", func(b *model.ContentBundle) {
			b.Music = []model.Music{{ID: "bgm", Title: "T", Tempo: 100, LoopBeats: 4, Tracks: []model.MusicTrack{{Instrument: "kazoo", Volume: 0.5}}}}
		}, "unknown instrument"},
		{"note outside loop", func(b *model.ContentBundle) {
			b.Music = []model.Music{{ID: "bgm", Title: "T", Tempo: 100, LoopBeats: 4, Tracks: []model.MusicTrack{{Instrument: "square", Volume: 0.5, Notes: []model.Note{{Pitch: 60, Start: 4, Dur: 1, Vel: 80}}}}}}
		}, "outside the loop"},
		{"line headway", func(b *model.ContentBundle) { b.Transit = transitWith(func(l *model.TransitLine) { l.Headway = -5 }) }, "headway must be ≥ 0"},
		{"line first", func(b *model.ContentBundle) { b.Transit = transitWith(func(l *model.TransitLine) { l.First = "6am" }) }, "line bus: first: time \"6am\""},
		{"line last", func(b *model.ContentBundle) { b.Transit = transitWith(func(l *model.TransitLine) { l.Last = "99:00" }) }, "line bus: last:"},
		{"line service order", func(b *model.ContentBundle) {
			b.Transit = transitWith(func(l *model.TransitLine) { l.First, l.Last = "10:00", "09:00" })
		}, "last departure must be after the first"},
		{"line last default", func(b *model.ContentBundle) {
			b.Transit = transitWith(func(l *model.TransitLine) { l.First, l.Last = "23:45", "" })
		}, "last departure"},
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
