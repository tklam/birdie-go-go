// Package content validates game content. It is shared by tools/contentbuild
// (at build time) and the core worker (for downloaded update packs), so it
// must stay free of file and network access.
package content

import (
	"errors"
	"fmt"
	"regexp"
	"slices"

	"birdiegogo/core/model"
)

var (
	semver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	idRe   = regexp.MustCompile(`^[a-z0-9_]+$`)
)

// Vocabularies shared with the client (SPEC.md §5, §6, §9.4).
var (
	Seasons      = []string{"spring", "summer", "autumn", "winter"}
	TimeSlots    = []string{"morning", "afternoon", "evening"}
	Poses        = []string{"wings_spread", "perched_alert", "perched", "flying", "flapping", "back_turned"}
	Behaviors    = []string{"perch", "hop", "forage", "fly", "wade"}
	MistakeTypes = []string{
		model.MistakeWrongNote, model.MistakeMissedNote, model.MistakeExtraNote,
		model.MistakeRush, model.MistakeDrag, model.MistakeHesitation,
	}
	Companions  = []string{"oboy", "kei"}
	Instruments = []string{"square", "pulse", "triangle", "noise"}
	KeiStages   = []string{"met", "friends", "dating", "engaged", "married"}

	TriggerTypes = []string{
		"enter_area", "talk", "interact", "photo_taken", "photo_session_end", "lesson_complete",
		"ride_complete", "mission_complete", "day_start", "time_slot_start", "album_milestone",
		"item_obtained", "weather_warning", "encounter_won", "encounter_escaped", "energy_depleted",
		"new_game",
	}
	ConditionTypes = []string{
		"flag_set", "flag_not_set", "chapter_at_least", "bond_at_least", "kei_stage", "party_has",
		"party_lacks", "has_item", "money_at_least", "season", "time_slot", "weather",
		"typhoon_signal_at_least", "album_has", "mission_state", "stop_discovered",
		"energy_at_least", "has_status", "equipped",
	}
	ActionTypes = []string{
		"dialogue", "set_flag", "clear_flag", "set_chapter", "join_party", "add_bond", "set_kei_stage",
		"give_item", "give_money", "unlock_area", "unlock_line", "unlock_teleport", "start_mission",
		"start_encounter", "restore_energy", "add_status", "start_scene", "move_npc",
	}
)

// Validate reports every problem found in the bundle; nil means it's valid.
func Validate(b *model.ContentBundle) []error {
	v := &validator{}
	v.game(b.Game)

	areas := v.ids("area", len(b.Areas), func(i int) string { return b.Areas[i].ID })
	birds := v.ids("bird", len(b.Birds), func(i int) string { return b.Birds[i].ID })
	spots := v.ids("spot", len(b.Spots), func(i int) string { return b.Spots[i].ID })
	students := v.ids("student", len(b.Students), func(i int) string { return b.Students[i].ID })
	songs := v.ids("song", len(b.Songs), func(i int) string { return b.Songs[i].ID })
	v.ids("event", len(b.Events), func(i int) string { return b.Events[i].ID })
	dialogue := v.ids("dialogue", len(b.Dialogue), func(i int) string { return b.Dialogue[i].ID })
	music := v.ids("music", len(b.Music), func(i int) string { return b.Music[i].ID })

	for _, a := range b.Areas {
		v.require(a.Name != "", "area %s: name is required", a.ID)
		v.require(a.Music == "" || music[a.Music], "area %s: unknown music %q", a.ID, a.Music)
	}
	for _, m := range b.Music {
		v.tune(m)
	}
	for _, bird := range b.Birds {
		v.bird(bird)
	}
	for _, s := range b.Spots {
		v.spot(s, areas, birds)
	}
	for _, s := range b.Students {
		v.require(s.Name != "", "student %s: name is required", s.ID)
		v.require(s.Level >= 1, "student %s: level must be ≥ 1", s.ID)
		v.require(s.Fee >= 0, "student %s: fee must be ≥ 0", s.ID)
		v.require(len(s.Repertoire) > 0, "student %s: repertoire is empty", s.ID)
		for _, song := range s.Repertoire {
			v.require(songs[song], "student %s: unknown song %q", s.ID, song)
		}
		for t, w := range s.Tendencies {
			v.require(slices.Contains(MistakeTypes, t), "student %s: unknown mistake type %q", s.ID, t)
			v.require(w >= 0, "student %s: tendency %s must be ≥ 0", s.ID, t)
		}
	}
	for _, s := range b.Songs {
		v.song(s)
	}
	refs := refs{areas: areas, spots: spots, students: students, dialogue: dialogue}
	for _, e := range b.Events {
		v.event(e, refs)
	}
	for _, d := range b.Dialogue {
		v.require(len(d.Lines) > 0, "dialogue %s: no lines", d.ID)
		for i, l := range d.Lines {
			v.require(l.Speaker != "", "dialogue %s line %d: speaker is required", d.ID, i+1)
			v.require(l.Text != "", "dialogue %s line %d: text is required", d.ID, i+1)
			for _, c := range l.If {
				v.require(slices.Contains(ConditionTypes, c.Type), "dialogue %s line %d: unknown condition %q", d.ID, i+1, c.Type)
			}
		}
	}
	return v.errs
}

type refs struct {
	areas, spots, students, dialogue map[string]bool
}

type validator struct {
	errs []error
}

func (v *validator) require(ok bool, format string, args ...any) {
	if !ok {
		v.errs = append(v.errs, fmt.Errorf(format, args...))
	}
}

func (v *validator) game(g model.GameInfo) {
	if g.Title == "" {
		v.errs = append(v.errs, errors.New("game: title is required"))
	}
	v.require(semver.MatchString(g.ContentVersion), "game: content_version %q must be MAJOR.MINOR.PATCH", g.ContentVersion)
	v.require(g.StartMap != "", "game: start_map is required")
	v.require(g.StartSpawn != "", "game: start_spawn is required")
}

// ids checks that IDs are well-formed and unique, and returns them as a set.
func (v *validator) ids(kind string, n int, id func(int) string) map[string]bool {
	set := make(map[string]bool, n)
	for i := range n {
		s := id(i)
		switch {
		case !idRe.MatchString(s):
			v.errs = append(v.errs, fmt.Errorf("%s #%d: id %q must be snake_case", kind, i+1, s))
		case set[s]:
			v.errs = append(v.errs, fmt.Errorf("%s %s: duplicate id", kind, s))
		}
		set[s] = true
	}
	return set
}

func (v *validator) bird(b model.Bird) {
	v.require(b.Name != "", "bird %s: name is required", b.ID)
	v.require(b.Sprite != "", "bird %s: sprite is required", b.ID)
	v.require(b.OverworldSprite != "", "bird %s: overworld_sprite is required", b.ID)
	v.require(b.Skittishness >= 0 && b.Skittishness <= 1, "bird %s: skittishness must be 0–1", b.ID)
	v.require(b.SizeBand[0] > 0 && b.SizeBand[0] < b.SizeBand[1] && b.SizeBand[1] <= 1,
		"bird %s: size_band must satisfy 0 < min < max ≤ 1", b.ID)
	v.require(b.Speed > 0, "bird %s: speed must be > 0", b.ID)
	v.require(len(b.Seasons) > 0, "bird %s: seasons is empty", b.ID)
	for _, s := range b.Seasons {
		v.require(slices.Contains(Seasons, s), "bird %s: unknown season %q", b.ID, s)
	}
	v.require(len(b.Poses) > 0, "bird %s: poses is empty", b.ID)
	for p, w := range b.Poses {
		v.require(slices.Contains(Poses, p), "bird %s: unknown pose %q", b.ID, p)
		v.require(w >= 0 && w <= 1, "bird %s: pose %s value must be 0–1", b.ID, p)
	}
	for _, beh := range b.Behaviors {
		v.require(slices.Contains(Behaviors, beh), "bird %s: unknown behavior %q", b.ID, beh)
	}
}

func (v *validator) spot(s model.Spot, areas, birds map[string]bool) {
	v.require(s.Name != "", "spot %s: name is required", s.ID)
	v.require(areas[s.Area], "spot %s: unknown area %q", s.ID, s.Area)
	v.require(s.Background != "", "spot %s: background is required", s.ID)
	v.require(s.Shots > 0, "spot %s: shots must be > 0", s.ID)
	v.require(len(s.Birds) > 0, "spot %s: bird table is empty", s.ID)
	for _, sb := range s.Birds {
		v.require(birds[sb.Species], "spot %s: unknown species %q", s.ID, sb.Species)
		v.require(sb.Weight >= 0, "spot %s: %s weight must be ≥ 0", s.ID, sb.Species)
		for _, slot := range sb.Slots {
			v.require(slices.Contains(TimeSlots, slot), "spot %s: unknown time slot %q", s.ID, slot)
		}
		for _, season := range sb.Seasons {
			v.require(slices.Contains(Seasons, season), "spot %s: unknown season %q", s.ID, season)
		}
	}
}

func (v *validator) song(s model.Song) {
	v.require(s.Title != "", "song %s: title is required", s.ID)
	v.require(s.Tempo > 0, "song %s: tempo must be > 0", s.ID)
	v.require(s.TimeSignature[0] > 0 && s.TimeSignature[1] > 0, "song %s: invalid time signature", s.ID)
	v.require(len(s.Notes) > 0, "song %s: no notes", s.ID)
	for i, n := range s.Notes {
		v.require(n.Pitch >= 21 && n.Pitch <= 108, "song %s note %d: pitch %d outside the piano range 21–108", s.ID, i+1, n.Pitch)
		v.require(n.Start >= 0, "song %s note %d: start must be ≥ 0", s.ID, i+1)
		v.require(n.Dur > 0, "song %s note %d: dur must be > 0", s.ID, i+1)
		v.require(n.Vel >= 1 && n.Vel <= 127, "song %s note %d: vel must be 1–127", s.ID, i+1)
	}
}

func (v *validator) tune(m model.Music) {
	v.require(m.Title != "", "music %s: title is required", m.ID)
	v.require(m.Tempo > 0, "music %s: tempo must be > 0", m.ID)
	v.require(m.LoopBeats > 0, "music %s: loop_beats must be > 0", m.ID)
	v.require(len(m.Tracks) > 0, "music %s: no tracks", m.ID)
	for i, t := range m.Tracks {
		v.require(slices.Contains(Instruments, t.Instrument), "music %s track %d: unknown instrument %q", m.ID, i+1, t.Instrument)
		v.require(t.Volume > 0 && t.Volume <= 1, "music %s track %d: volume must be in (0, 1]", m.ID, i+1)
		for j, n := range t.Notes {
			v.require(t.Instrument == "noise" || n.Pitch >= 21 && n.Pitch <= 108, "music %s track %d note %d: pitch %d outside 21–108", m.ID, i+1, j+1, n.Pitch)
			v.require(n.Start >= 0 && n.Start < m.LoopBeats, "music %s track %d note %d: start outside the loop", m.ID, i+1, j+1)
			v.require(n.Dur > 0, "music %s track %d note %d: dur must be > 0", m.ID, i+1, j+1)
			v.require(n.Vel >= 1 && n.Vel <= 127, "music %s track %d note %d: vel must be 1–127", m.ID, i+1, j+1)
		}
	}
}

func (v *validator) event(e model.Event, r refs) {
	t := e.Trigger
	v.require(slices.Contains(TriggerTypes, t.Type), "event %s: unknown trigger %q", e.ID, t.Type)
	if area, ok := t.Params["area"]; ok {
		v.require(r.areas[area], "event %s: trigger area %q is unknown", e.ID, area)
	}
	if spot, ok := t.Params["spot"]; ok {
		v.require(r.spots[spot], "event %s: trigger spot %q is unknown", e.ID, spot)
	}
	if student, ok := t.Params["student"]; ok {
		v.require(r.students[student], "event %s: trigger student %q is unknown", e.ID, student)
	}
	for _, c := range e.Conditions {
		v.require(slices.Contains(ConditionTypes, c.Type), "event %s: unknown condition %q", e.ID, c.Type)
	}
	v.require(len(e.Actions) > 0, "event %s: no actions", e.ID)
	for _, a := range e.Actions {
		v.require(slices.Contains(ActionTypes, a.Type), "event %s: unknown action %q", e.ID, a.Type)
		switch a.Type {
		case "dialogue":
			id, _ := a.Value.(string)
			v.require(r.dialogue[id], "event %s: unknown dialogue %q", e.ID, id)
		case "join_party":
			who, _ := a.Value.(string)
			v.require(slices.Contains(Companions, who), "event %s: unknown companion %q", e.ID, who)
		case "set_kei_stage":
			stage, _ := a.Value.(string)
			v.require(slices.Contains(KeiStages, stage), "event %s: unknown Kei stage %q", e.ID, stage)
		case "unlock_area":
			area, _ := a.Value.(string)
			v.require(r.areas[area], "event %s: unknown area %q", e.ID, area)
		}
	}
}
