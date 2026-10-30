// Package content validates game content. It is shared by tools/contentbuild
// (at build time) and the core worker (for downloaded update packs), so it
// must stay free of file and network access.
package content

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"birdiegogo/core/model"
	"birdiegogo/core/transit"
)

var (
	semver = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	idRe   = regexp.MustCompile(`^[a-z0-9_]+$`)
	// isoDate is a real-world date, YYYY-MM-DD.
	isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
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
	Companions    = []string{"oboy", "kei"}
	Instruments   = []string{"square", "pulse", "triangle", "noise"}
	ItemKinds     = []string{"gear", "consumable", "gadget"}
	GearSlots     = []string{"head", "body", "hand"}
	EnemyKinds    = []string{"dog", "monster"}
	Ratings       = []string{"good", "great", "perfect"}
	AmbientKinds  = []string{"walker", "birder"}
	TransitModes  = []string{"bus", "tram", "metro", "ferry"}
	WeatherKeys   = []string{"cloud", "precip", "temp", "fog", "wind", "uv", "signal"}
	KeiStages     = []string{"met", "friends", "dating", "engaged", "married"}
	MinigameTypes = []string{"quiz", "memory", "rhythm", "catch", "find", "slide"}
	NamedWeather  = []string{"typhoon", "thunderstorm", "rainstorm", "rain", "drizzle", "foggy", "windy", "hazy", "cloudy", "clear"}

	TriggerTypes = []string{
		"enter_area", "talk", "interact", "photo_taken", "photo_session_end", "lesson_complete",
		"ride_complete", "mission_complete", "day_start", "time_slot_start", "album_milestone",
		"item_obtained", "weather_warning", "encounter_won", "encounter_escaped", "energy_depleted",
		"new_game", "minigame_complete",
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
		"start_encounter", "restore_energy", "add_status", "start_scene", "move_npc", "start_minigame",
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
	items := v.ids("item", len(b.Items), func(i int) string { return b.Items[i].ID })
	hazards := v.ids("hazard", len(b.Hazards), func(i int) string { return b.Hazards[i].ID })
	v.ids("enemy", len(b.Enemies), func(i int) string { return b.Enemies[i].ID })
	missions := v.ids("mission", len(b.Missions), func(i int) string { return b.Missions[i].ID })
	v.ids("ambient", len(b.Ambient), func(i int) string { return b.Ambient[i].ID })
	v.ids("shop", len(b.Shops), func(i int) string { return b.Shops[i].ID })
	games := v.ids("minigame", len(b.Minigames), func(i int) string { return b.Minigames[i].ID })
	for _, g := range b.Minigames {
		v.minigame(g, birds)
	}

	for _, a := range b.Areas {
		v.require(a.Name != "", "area %s: name is required", a.ID)
		v.require(a.Music == "" || music[a.Music], "area %s: unknown music %q", a.ID, a.Music)
		v.require(a.Altitude >= 0 && a.Altitude <= 1, "area %s: altitude must be 0–1", a.ID)
		v.require(a.WalkEffort >= 0, "area %s: walk_effort must not be negative", a.ID)
		for _, season := range Seasons {
			c, ok := a.Climate[season]
			if !ok {
				v.errs = append(v.errs, fmt.Errorf("area %s: climate for %s is missing", a.ID, season))
				continue
			}
			for name, r := range map[string][2]float64{"cloud": c.Cloud, "precip": c.Precip, "fog": c.Fog, "wind": c.Wind} {
				v.require(r[0] >= 0 && r[0] <= 1 && r[1] >= 0, "area %s %s: %s mean must be 0–1 and variability ≥ 0", a.ID, season, name)
			}
			v.require(c.Temp[1] >= 0, "area %s %s: temp variability must be ≥ 0", a.ID, season)
		}
		for season := range a.Climate {
			v.require(slices.Contains(Seasons, season), "area %s: unknown season %q in climate", a.ID, season)
		}
	}
	for _, m := range b.Music {
		v.tune(m)
	}
	for _, it := range b.Items {
		v.item(it, hazards)
	}
	for _, h := range b.Hazards {
		v.hazard(h, items)
	}
	for _, e := range b.Enemies {
		v.enemy(e, areas, items)
	}
	for _, a := range b.Ambient {
		v.require(a.Name != "" && a.Sprite != "", "ambient %s: name and sprite are required", a.ID)
		v.require(slices.Contains(AmbientKinds, a.Kind), "ambient %s: kind must be walker or birder", a.ID)
		v.require(a.PerChunk >= 1 && a.PerChunk <= 6, "ambient %s: per_chunk must be 1–6", a.ID)
		v.require(len(a.Lines) > 0, "ambient %s: needs at least one line", a.ID)
		for _, ar := range a.Areas {
			v.require(areas[ar], "ambient %s: unknown area %q", a.ID, ar)
		}
		for _, sl := range a.Slots {
			v.require(slices.Contains(TimeSlots, sl), "ambient %s: unknown time slot %q", a.ID, sl)
		}
	}
	stops := v.ids("stop", len(b.Transit.Stops), func(i int) string { return b.Transit.Stops[i].ID })
	lines := v.ids("line", len(b.Transit.Lines), func(i int) string { return b.Transit.Lines[i].ID })
	for _, l := range b.Transit.Lines {
		v.require(l.Name != "", "line %s: name is required", l.ID)
		v.require(slices.Contains(TransitModes, l.Mode), "line %s: unknown mode %q", l.ID, l.Mode)
		v.require(l.Fare >= 0 && l.Speed > 0, "line %s: fare must be ≥ 0 and speed > 0", l.ID)
		v.require(len(l.Stops) >= 2, "line %s: needs at least two stops", l.ID)
		for _, st := range l.Stops {
			v.require(stops[st], "line %s: unknown stop %q", l.ID, st)
		}
		v.require(len(l.Path) >= 2, "line %s: path needs at least two points", l.ID)
		v.service(l)
	}
	for _, st := range b.Transit.Stops {
		v.require(st.Name != "", "stop %s: name is required", st.ID)
	}
	for _, m := range b.Missions {
		v.mission(m, refs{areas: areas, students: students, lines: lines, stops: stops, games: games}, birds, items)
	}
	for _, bird := range b.Birds {
		v.bird(bird)
	}
	for _, sh := range b.Shops {
		v.require(sh.Title != "" && len(sh.Stock) > 0, "shop %s: title and stock are required", sh.ID)
		for _, it := range sh.Stock {
			v.require(items[it], "shop %s: unknown item %q", sh.ID, it)
		}
	}
	for _, s := range b.Spots {
		v.spot(s, areas, birds)
		v.require(s.RequiresItem == "" || items[s.RequiresItem], "spot %s: requires unknown item %q", s.ID, s.RequiresItem)
		for _, sl := range s.Slots {
			v.require(slices.Contains(TimeSlots, sl), "spot %s: unknown time slot %q", s.ID, sl)
		}
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
	refs := refs{areas: areas, spots: spots, students: students, dialogue: dialogue, missions: missions}
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
	areas, spots, students, dialogue, missions, lines, stops, games map[string]bool
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
	v.require(g.BagCapacity >= 0, "game: bag_capacity %d must not be negative", g.BagCapacity)
	v.require(g.MissionReminderSlots >= 0, "game: mission_reminder_slots %d must not be negative", g.MissionReminderSlots)
	if br := g.BedtimeReminder; br != nil {
		v.require(br.EverySeconds >= 0, "game: bedtime_reminder.every_seconds %d must not be negative", br.EverySeconds)
		v.require(br.EverySeconds == 0 || len(br.Lines) > 0, "game: bedtime_reminder needs lines when every_seconds is set")
	}
	if e := g.Energy; e != nil {
		v.require(e.WalkPerMin >= 0 && e.IndoorRecoveryPerMin >= 0 && e.PhotoSession >= 0 && e.Lesson >= 0 && e.LowWarning >= 0,
			"game: energy values must not be negative")
		v.require(e.LowWarning == 0 || e.LowWarningText != "", "game: energy.low_warning needs low_warning_text")
		v.require(e.PhotoSession+e.Lesson == 0 || e.TooTiredText != "", "game: energy activity costs need too_tired_text")
		if f := e.Faint; f != nil {
			v.require(f.Fee >= 0, "game: energy.faint.fee %d must not be negative", f.Fee)
			v.require(f.RecoverTo > 0 && f.RecoverTo <= 100, "game: energy.faint.recover_to %d must be 1–100", f.RecoverTo)
			v.require(f.Weather.Title != "" && len(f.Weather.Lines) > 0, "game: energy.faint.weather needs a title and lines")
			v.require(f.Encounter.Title != "" && len(f.Encounter.Lines) > 0, "game: energy.faint.encounter needs a title and lines")
		}
	}
	if c := g.TransitCard; c != nil {
		v.require(c.Name != "" && c.StartBalance >= 0 && c.TopUp > 0, "game: transit_card needs a name, a start_balance ≥ 0 and a top_up > 0")
	}
	for i, b := range g.Bills {
		v.require(b.Name != "", "game: bill %d needs a name", i)
		v.require(b.Amount > 0, "game: bill %q amount must be positive", b.Name)
		v.require(b.EveryDays >= 1, "game: bill %q every_days must be at least 1", b.Name)
	}
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
		for _, w := range sb.Weather {
			v.require(slices.Contains(NamedWeather, w), "spot %s: unknown weather %q", s.ID, w)
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

func (v *validator) item(it model.Item, hazards map[string]bool) {
	v.require(it.Name != "", "item %s: name is required", it.ID)
	v.require(slices.Contains(ItemKinds, it.Kind), "item %s: kind must be gear or consumable", it.ID)
	if it.Kind == "gear" {
		v.require(slices.Contains(GearSlots, it.Slot), "item %s: gear slot must be head, body or hand", it.ID)
	}
	v.require(it.Price >= 0, "item %s: price must be ≥ 0", it.ID)
	v.require(it.Restores >= 0 && it.DurationSlots >= 0, "item %s: restores and duration must be ≥ 0", it.ID)
	if it.Build != nil {
		v.require(it.Build.Parts >= 1, "item %s: build needs at least one part", it.ID)
		v.require(slices.Contains(KeiStages, it.Build.KeiStage), "item %s: unknown Kei stage %q", it.ID, it.Build.KeiStage)
	}
	if a := it.Assist; a != nil {
		v.require(a.ResolveScale >= 0 && a.ResolveScale <= 1, "item %s: assist resolve_scale must be 0–1", it.ID)
		v.require(!a.Block || (it.Kind == "gear" && a.BlockWindowMs > 0), "item %s: a block assist needs worn gear and block_window_ms", it.ID)
	}
	for _, h := range it.Counters {
		v.require(hazards[h], "item %s: unknown hazard %q", it.ID, h)
	}
}

func (v *validator) hazard(h model.Hazard, items map[string]bool) {
	v.require(h.Name != "" && h.Status != "", "hazard %s: name and status are required", h.ID)
	v.require(slices.Contains(WeatherKeys, h.When.Param), "hazard %s: unknown weather parameter %q", h.ID, h.When.Param)
	v.require(h.When.Min != nil || h.When.Max != nil, "hazard %s: when needs min or max", h.ID)
	if p := h.Photo; p != nil {
		v.require(p.FocusScale >= 0 && p.SharpnessScale >= 0, "hazard %s: photo scales must be ≥ 0", h.ID)
	}
	v.require(h.DrainPerMin >= 0, "hazard %s: drain must be ≥ 0", h.ID)
	if h.Severe != nil {
		v.require(h.Severe.DrainPerMin >= h.DrainPerMin, "hazard %s: severe drain must be ≥ the normal drain", h.ID)
	}
	if h.Breaks != nil {
		v.require(items[h.Breaks.Item], "hazard %s: breaks unknown item %q", h.ID, h.Breaks.Item)
	}
	for _, it := range h.CounteredBy {
		v.require(items[it], "hazard %s: countered by unknown item %q", h.ID, it)
	}
}

func (v *validator) enemy(e model.Enemy, areas, items map[string]bool) {
	v.require(e.Name != "" && e.Sprite != "" && e.Portrait != "", "enemy %s: name, sprite and portrait are required", e.ID)
	v.require(slices.Contains(EnemyKinds, e.Kind), "enemy %s: kind must be dog or monster", e.ID)
	v.require(len(e.Areas) > 0, "enemy %s: areas is empty", e.ID)
	for _, a := range e.Areas {
		v.require(areas[a], "enemy %s: unknown area %q", e.ID, a)
	}
	for _, s := range e.Slots {
		v.require(slices.Contains(TimeSlots, s), "enemy %s: unknown time slot %q", e.ID, s)
	}
	v.require(e.Sight > 0 && e.Speed > 0, "enemy %s: sight and speed must be > 0", e.ID)
	v.require(e.Resolve > 0 && e.Damage >= 0, "enemy %s: resolve must be > 0 and damage ≥ 0", e.ID)
	v.require(e.ComboLength[0] >= 1 && e.ComboLength[0] <= e.ComboLength[1] && e.ComboLength[1] <= 8, "enemy %s: combo_length must be 1 ≤ min ≤ max ≤ 8", e.ID)
	v.require(e.WindowMs[0] >= e.WindowMs[1] && e.WindowMs[1] >= 300, "enemy %s: window_ms must go from easy (long) to hard (short), ≥ 300", e.ID)
	v.require(e.MashRate > 0, "enemy %s: mash_rate must be > 0", e.ID)
	v.require(e.Weakness == "" || items[e.Weakness], "enemy %s: unknown weakness item %q", e.ID, e.Weakness)
	v.require(e.Kind == "monster" || len(e.Drops) == 0, "enemy %s: only monsters drop items", e.ID)
	for _, d := range e.Drops {
		v.require(items[d.Item], "enemy %s: unknown drop %q", e.ID, d.Item)
		v.require(d.Chance > 0 && d.Chance <= 1, "enemy %s: drop chance must be in (0, 1]", e.ID)
	}
}

func (v *validator) mission(m model.Mission, r refs, birds, items map[string]bool) {
	v.require(m.Title != "" && m.Description != "", "mission %s: title and description are required", m.ID)
	o := m.Objective
	switch o.Type {
	case "photograph":
		v.require(birds[o.Species], "mission %s: unknown species %q", m.ID, o.Species)
		v.require(o.MinRating == "" || slices.Contains(Ratings, o.MinRating), "mission %s: min_rating must be good, great or perfect", m.ID)
		v.require(o.Area == "" || r.areas[o.Area], "mission %s: unknown area %q", m.ID, o.Area)
	case "lesson":
		v.require(r.students[o.Student], "mission %s: unknown student %q", m.ID, o.Student)
		v.require(o.MinScore >= 0 && o.MinScore <= 100, "mission %s: min_score must be 0–100", m.ID)
	case "ride":
		v.require(o.Line != "" || o.Stop != "", "mission %s: a ride needs a line or a stop", m.ID)
		v.require(o.Line == "" || r.lines[o.Line], "mission %s: unknown line %q", m.ID, o.Line)
		v.require(o.Stop == "" || r.stops[o.Stop], "mission %s: unknown stop %q", m.ID, o.Stop)
	case "visit":
		v.require(r.areas[o.Area], "mission %s: unknown area %q", m.ID, o.Area)
	case "minigame":
		v.require(r.games[o.Game], "mission %s: unknown minigame %q", m.ID, o.Game)
	default:
		v.errs = append(v.errs, fmt.Errorf("mission %s: unknown objective type %q", m.ID, o.Type))
	}
	for _, c := range m.Available {
		v.require(slices.Contains(ConditionTypes, c.Type), "mission %s: unknown condition %q", m.ID, c.Type)
	}
	if w := m.Window; w != nil {
		v.require(isoDate.MatchString(w.From) && isoDate.MatchString(w.To) && w.From <= w.To, "mission %s: window needs from ≤ to as YYYY-MM-DD", m.ID)
	}
	v.require(m.Reward.Money >= 0, "mission %s: reward money must be ≥ 0", m.ID)
	for _, it := range m.Reward.Items {
		v.require(items[it], "mission %s: unknown reward item %q", m.ID, it)
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
		case "start_scene":
			m, _ := a.Value.(map[string]any)
			_, named := m["scene"].(string)
			v.require(named, "event %s: start_scene needs a scene", e.ID)
			if id, ok := m["dialogue"].(string); ok {
				v.require(r.dialogue[id], "event %s: unknown dialogue %q", e.ID, id)
			}
		case "join_party":
			who, _ := a.Value.(string)
			v.require(slices.Contains(Companions, who), "event %s: unknown companion %q", e.ID, who)
		case "set_kei_stage":
			stage, _ := a.Value.(string)
			v.require(slices.Contains(KeiStages, stage), "event %s: unknown Kei stage %q", e.ID, stage)
		case "start_mission":
			id, _ := a.Value.(string)
			v.require(r.missions[id], "event %s: unknown mission %q", e.ID, id)
		case "unlock_area":
			area, _ := a.Value.(string)
			v.require(r.areas[area], "event %s: unknown area %q", e.ID, area)
		}
	}
}

// service checks a line's timetable fields; empty ones take the defaults of
// core/transit.
func (v *validator) service(l model.TransitLine) {
	v.require(l.Headway >= 0, "line %s: headway must be ≥ 0", l.ID)
	first, last := float64(transit.DefaultFirst), float64(transit.DefaultLast)
	var err error
	if l.First != "" {
		if first, err = transit.ParseClock(l.First); err != nil {
			v.require(false, "line %s: first: %v", l.ID, err)
			return
		}
	}
	if l.Last != "" {
		if last, err = transit.ParseClock(l.Last); err != nil {
			v.require(false, "line %s: last: %v", l.ID, err)
			return
		}
	}
	if err := transit.CheckService(first, last); err != nil {
		v.require(false, "line %s: %v", l.ID, err)
	}
}

// Props are the pictures mini games can draw without art: "prop:<name>".
var Props = []string{"bun", "fish", "shrimp", "crab", "shell", "leaf", "flower", "mooncake", "can", "bottle", "bag", "lantern", "tram", "junk"}

func (v *validator) minigame(g model.Minigame, birds map[string]bool) {
	v.require(slices.Contains(MinigameTypes, g.Type), "minigame %s: unknown type %q", g.ID, g.Type)
	v.require(g.Title != "" && g.Intro != "", "minigame %s: title and intro are required", g.ID)
	for _, icon := range append(append([]string{}, g.Icons...), g.Avoid...) {
		kind, name, _ := strings.Cut(icon, ":")
		v.require((kind == "bird" && birds[name]) || (kind == "prop" && slices.Contains(Props, name)), "minigame %s: unknown icon %q", g.ID, icon)
	}
	switch g.Type {
	case "quiz":
		v.require(len(g.Quiz) > 0 && g.Target >= 1 && g.Target <= len(g.Quiz), "minigame %s: a quiz needs questions and a target of 1–%d", g.ID, len(g.Quiz))
		for i, q := range g.Quiz {
			v.require(q.Question != "" && len(q.Answers) >= 2 && q.Correct >= 0 && q.Correct < len(q.Answers), "minigame %s: question %d needs 2+ answers and a valid correct index", g.ID, i+1)
		}
	case "memory":
		v.require(g.Pairs >= 2 && len(g.Icons) >= g.Pairs, "minigame %s: memory needs pairs ≥ 2 and as many icons", g.ID)
	case "rhythm":
		v.require(g.Tempo > 0 && len(g.Pattern) > 0 && g.Target >= 1 && g.Target <= len(g.Pattern), "minigame %s: rhythm needs tempo, a pattern and a target", g.ID)
	case "catch":
		v.require(len(g.Icons) > 0 && g.Target >= 1 && g.Seconds > 0, "minigame %s: catch needs icons, a target and seconds", g.ID)
	case "find":
		v.require(len(g.Icons) > 0 && g.Target >= 1 && g.Target <= len(g.Icons), "minigame %s: find needs icons and a target", g.ID)
	case "slide":
		v.require(g.Image != "" && (g.Size == 3 || g.Size == 4), "minigame %s: slide needs an image and size 3 or 4", g.ID)
	}
}
