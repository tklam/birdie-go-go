package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"gopkg.in/yaml.v3"

	"birdiegogo/core/model"
)

// The on-disk YAML shapes. They use snake_case keys and the compact forms
// shown in developer_guide.md §5; load converts them to the shared model.

type gameYAML struct {
	Title          string `yaml:"title"`
	ContentVersion string `yaml:"content_version"`
	StartMap       string `yaml:"start_map"`
	StartSpawn     string `yaml:"start_spawn"`
	// Slots between active-mission reminders; 0 turns them off.
	MissionReminderSlots int `yaml:"mission_reminder_slots"`
	BedtimeReminder      struct {
		EverySeconds int      `yaml:"every_seconds"`
		Lines        []string `yaml:"lines"`
	} `yaml:"bedtime_reminder"`
	Energy *struct {
		WalkPerMin           float64 `yaml:"walk_per_min"`
		IndoorRecoveryPerMin float64 `yaml:"indoor_recovery_per_min"`
		PhotoSession         int     `yaml:"photo_session"`
		Lesson               int     `yaml:"lesson"`
		LowWarning           int     `yaml:"low_warning"`
		LowWarningText       string  `yaml:"low_warning_text"`
		TooTiredText         string  `yaml:"too_tired_text"`
	} `yaml:"energy"`
	Bills []struct {
		Name      string `yaml:"name"`
		Amount    int    `yaml:"amount"`
		EveryDays int    `yaml:"every_days"`
	} `yaml:"bills"`
	TransitCard *struct {
		Name         string `yaml:"name"`
		StartBalance int    `yaml:"start_balance"`
		TopUp        int    `yaml:"top_up"`
	} `yaml:"transit_card"`
	BagCapacity int `yaml:"bag_capacity"`
}

type areaYAML struct {
	ID         string                 `yaml:"id"`
	Name       string                 `yaml:"name"`
	Music      string                 `yaml:"music"`
	Climate    map[string]climateYAML `yaml:"climate"`
	Altitude   float64                `yaml:"altitude"`
	WalkEffort float64                `yaml:"walk_effort"`
}

type climateYAML struct {
	Cloud  [2]float64 `yaml:"cloud"`
	Precip [2]float64 `yaml:"precip"`
	Temp   [2]float64 `yaml:"temp"`
	Fog    [2]float64 `yaml:"fog"`
	Wind   [2]float64 `yaml:"wind"`
}

type birdYAML struct {
	ID              string             `yaml:"id"`
	Name            string             `yaml:"name"`
	Sprite          string             `yaml:"sprite"`
	OverworldSprite string             `yaml:"overworld_sprite"`
	Skittishness    float64            `yaml:"skittishness"`
	SizeBand        [2]float64         `yaml:"size_band"`
	Speed           float64            `yaml:"speed"`
	Seasons         []string           `yaml:"seasons"`
	Poses           map[string]float64 `yaml:"poses"`
	Behaviors       []string           `yaml:"behaviors"`
}

type spotYAML struct {
	ID           string   `yaml:"id"`
	Name         string   `yaml:"name"`
	Area         string   `yaml:"area"`
	Background   string   `yaml:"background"`
	Shots        int      `yaml:"shots"`
	RequiresItem string   `yaml:"requires_item"`
	Slots        []string `yaml:"slots"`
	Birds        []struct {
		Species      string   `yaml:"species"`
		Weight       float64  `yaml:"weight"`
		Slots        []string `yaml:"slots"`
		Seasons      []string `yaml:"seasons"`
		RequiresFlag string   `yaml:"requires_flag"`
		UnlessFlag   string   `yaml:"unless_flag"`
		Always       bool     `yaml:"always"`
		Weather      []string `yaml:"weather"`
	} `yaml:"birds"`
}

type studentYAML struct {
	ID         string             `yaml:"id"`
	Name       string             `yaml:"name"`
	Level      int                `yaml:"level"`
	Home       string             `yaml:"home"`
	Repertoire []string           `yaml:"repertoire"`
	Tendencies map[string]float64 `yaml:"tendencies"`
	Fee        int                `yaml:"fee"`
}

type musicYAML struct {
	ID        string  `yaml:"id"`
	Title     string  `yaml:"title"`
	Tempo     float64 `yaml:"tempo"`
	LoopBeats float64 `yaml:"loop_beats"`
	Tracks    []struct {
		Instrument string  `yaml:"instrument"`
		Volume     float64 `yaml:"volume"`
		Notes      []struct {
			Pitch int     `yaml:"pitch"`
			Start float64 `yaml:"start"`
			Dur   float64 `yaml:"dur"`
			Vel   int     `yaml:"vel"`
		} `yaml:"notes"`
	} `yaml:"tracks"`
}

type itemYAML struct {
	ID            string   `yaml:"id"`
	Name          string   `yaml:"name"`
	Kind          string   `yaml:"kind"`
	Slot          string   `yaml:"slot"`
	Price         int      `yaml:"price"`
	Counters      []string `yaml:"counters"`
	Restores      int      `yaml:"restores"`
	DurationSlots int      `yaml:"duration_slots"`
	Description   string   `yaml:"description"`
	Build         *struct {
		Parts    int    `yaml:"parts"`
		KeiStage string `yaml:"kei_stage"`
	} `yaml:"build"`
	Assist *struct {
		ResolveScale  float64 `yaml:"resolve_scale"`
		Block         bool    `yaml:"block"`
		BlockWindowMs int     `yaml:"block_window_ms"`
	} `yaml:"assist"`
}

type hazardYAML struct {
	ID     string `yaml:"id"`
	Name   string `yaml:"name"`
	Status string `yaml:"status"`
	When   struct {
		Param string   `yaml:"param"`
		Min   *float64 `yaml:"min"`
		Max   *float64 `yaml:"max"`
	} `yaml:"when"`
	DrainPerMin float64 `yaml:"drain_per_min"`
	Severe      *struct {
		Min         float64 `yaml:"min"`
		DrainPerMin float64 `yaml:"drain_per_min"`
	} `yaml:"severe"`
	Push   float64 `yaml:"push"`
	Breaks *struct {
		Item string  `yaml:"item"`
		Min  float64 `yaml:"min"`
	} `yaml:"breaks"`
	CounteredBy []string `yaml:"countered_by"`
	Photo       *struct {
		FocusScale     float64 `yaml:"focus_scale"`
		SharpnessScale float64 `yaml:"sharpness_scale"`
	} `yaml:"photo"`
}

type enemyYAML struct {
	ID          string   `yaml:"id"`
	Name        string   `yaml:"name"`
	Kind        string   `yaml:"kind"`
	Sprite      string   `yaml:"sprite"`
	Portrait    string   `yaml:"portrait"`
	Areas       []string `yaml:"areas"`
	Slots       []string `yaml:"slots"`
	Sight       float64  `yaml:"sight"`
	Speed       float64  `yaml:"speed"`
	Resolve     int      `yaml:"resolve"`
	Damage      int      `yaml:"damage"`
	ComboLength [2]int   `yaml:"combo_length"`
	WindowMs    [2]int   `yaml:"window_ms"`
	MashRate    float64  `yaml:"mash_rate"`
	Weakness    string   `yaml:"weakness"`
	Drops       []struct {
		Item   string  `yaml:"item"`
		Chance float64 `yaml:"chance"`
	} `yaml:"drops"`
	Lore string `yaml:"lore"`
}

type missionYAML struct {
	ID          string `yaml:"id"`
	Giver       string `yaml:"giver"`
	Title       string `yaml:"title"`
	Description string `yaml:"description"`
	Objective   struct {
		Type      string `yaml:"type"`
		Species   string `yaml:"species"`
		MinRating string `yaml:"min_rating"`
		Area      string `yaml:"area"`
		Student   string `yaml:"student"`
		MinScore  int    `yaml:"min_score"`
		Line      string `yaml:"line"`
		Stop      string `yaml:"stop"`
	} `yaml:"objective"`
	Reward struct {
		Money int      `yaml:"money"`
		Items []string `yaml:"items"`
	} `yaml:"reward"`
	Available map[string]any `yaml:"available"`
	Window    *struct {
		From string `yaml:"from"`
		To   string `yaml:"to"`
	} `yaml:"window"`
}

type ambientYAML struct {
	ID       string   `yaml:"id"`
	Name     string   `yaml:"name"`
	Sprite   string   `yaml:"sprite"`
	Kind     string   `yaml:"kind"`
	Areas    []string `yaml:"areas"`
	Slots    []string `yaml:"slots"`
	PerChunk int      `yaml:"per_chunk"`
	Lines    []string `yaml:"lines"`
}

type transitYAML struct {
	Lines []struct {
		ID      string       `yaml:"id"`
		Name    string       `yaml:"name"`
		Mode    string       `yaml:"mode"`
		Fare    int          `yaml:"fare"`
		Stops   []string     `yaml:"stops"`
		Path    [][2]float64 `yaml:"path"`
		Speed   float64      `yaml:"speed"`
		Headway float64      `yaml:"headway"`
		First   string       `yaml:"first"`
		Last    string       `yaml:"last"`
		Locked  bool         `yaml:"locked"`
	} `yaml:"lines"`
	Stops []struct {
		ID   string `yaml:"id"`
		Name string `yaml:"name"`
	} `yaml:"stops"`
}

type songYAML struct {
	ID            string  `yaml:"id"`
	Title         string  `yaml:"title"`
	Tempo         float64 `yaml:"tempo"`
	TimeSignature [2]int  `yaml:"time_signature"`
	Difficulty    int     `yaml:"difficulty"`
	Notes         []struct {
		Pitch int     `yaml:"pitch"`
		Start float64 `yaml:"start"`
		Dur   float64 `yaml:"dur"`
		Vel   int     `yaml:"vel"`
	} `yaml:"notes"`
}

// eventYAML uses the compact forms from SPEC.md §9.4:
//
//	trigger: { type: photo_session_end, spot: park_fountain }
//	conditions: [ { flag_not_set: oboy_found } ]
//	actions:    [ { dialogue: oboy_found_scene } ]
type eventYAML struct {
	ID         string            `yaml:"id"`
	Trigger    map[string]string `yaml:"trigger"`
	Conditions []map[string]any  `yaml:"conditions"`
	Actions    []map[string]any  `yaml:"actions"`
	Once       *bool             `yaml:"once"`
}

type dialogueYAML struct {
	ID    string `yaml:"id"`
	Lines []struct {
		Speaker  string         `yaml:"speaker"`
		Portrait string         `yaml:"portrait"`
		Text     string         `yaml:"text"`
		If       map[string]any `yaml:"if"`
	} `yaml:"lines"`
}

func readYAML(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(data, v); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

// load reads content/ into a bundle. Every list is non-nil so the client
// never has to check for null.
func load(dir string) (*model.ContentBundle, error) {
	b := &model.ContentBundle{
		Areas: []model.Area{}, Birds: []model.Bird{}, Spots: []model.Spot{}, Students: []model.Student{},
		Songs: []model.Song{}, Events: []model.Event{}, Dialogue: []model.Dialogue{}, Music: []model.Music{},
		Items: []model.Item{}, Hazards: []model.Hazard{}, Enemies: []model.Enemy{}, Missions: []model.Mission{}, Ambient: []model.AmbientNPC{}, Shops: []model.Shop{},
		Transit: model.Transit{Lines: []model.TransitLine{}, Stops: []model.TransitStop{}},
	}

	var g gameYAML
	if err := readYAML(filepath.Join(dir, "game.yaml"), &g); err != nil {
		return nil, err
	}
	b.Game = model.GameInfo{
		Title: g.Title, ContentVersion: g.ContentVersion, StartMap: g.StartMap, StartSpawn: g.StartSpawn,
		MissionReminderSlots: g.MissionReminderSlots, BagCapacity: g.BagCapacity,
	}
	if br := g.BedtimeReminder; br.EverySeconds != 0 || len(br.Lines) > 0 {
		b.Game.BedtimeReminder = &model.BedtimeReminder{EverySeconds: br.EverySeconds, Lines: append([]string{}, br.Lines...)}
	}
	if e := g.Energy; e != nil {
		b.Game.Energy = &model.EnergyRules{
			WalkPerMin: e.WalkPerMin, IndoorRecoveryPerMin: e.IndoorRecoveryPerMin,
			PhotoSession: e.PhotoSession, Lesson: e.Lesson,
			LowWarning: e.LowWarning, LowWarningText: e.LowWarningText, TooTiredText: e.TooTiredText,
		}
	}
	if c := g.TransitCard; c != nil {
		b.Game.TransitCard = &model.TransitCard{Name: c.Name, StartBalance: c.StartBalance, TopUp: c.TopUp}
	}
	for _, bill := range g.Bills {
		every := bill.EveryDays
		if every == 0 {
			every = 1
		}
		b.Game.Bills = append(b.Game.Bills, model.Bill{Name: bill.Name, Amount: bill.Amount, EveryDays: every})
	}

	var areas []areaYAML
	if err := readOptional(filepath.Join(dir, "areas.yaml"), &areas); err != nil {
		return nil, err
	}
	for _, a := range areas {
		area := model.Area{ID: a.ID, Name: a.Name, Music: a.Music, Altitude: a.Altitude, WalkEffort: a.WalkEffort, Climate: map[string]model.Climate{}}
		for season, c := range a.Climate {
			area.Climate[season] = model.Climate(c)
		}
		b.Areas = append(b.Areas, area)
	}

	var items []itemYAML
	if err := readOptional(filepath.Join(dir, "items.yaml"), &items); err != nil {
		return nil, err
	}
	for _, x := range items {
		it := model.Item{
			ID: x.ID, Name: x.Name, Kind: x.Kind, Slot: x.Slot, Price: x.Price, Counters: orEmpty(x.Counters),
			Restores: x.Restores, DurationSlots: x.DurationSlots, Description: x.Description,
		}
		if x.Build != nil {
			it.Build = &model.Build{Parts: x.Build.Parts, KeiStage: x.Build.KeiStage}
		}
		if a := x.Assist; a != nil {
			it.Assist = &model.ItemAssist{ResolveScale: a.ResolveScale, Block: a.Block, BlockWindowMs: a.BlockWindowMs}
		}
		b.Items = append(b.Items, it)
	}

	var hazards []hazardYAML
	if err := readOptional(filepath.Join(dir, "hazards.yaml"), &hazards); err != nil {
		return nil, err
	}
	for _, x := range hazards {
		h := model.Hazard{
			ID: x.ID, Name: x.Name, Status: x.Status, DrainPerMin: x.DrainPerMin, Push: x.Push,
			When:        model.HazardWhen{Param: x.When.Param, Min: x.When.Min, Max: x.When.Max},
			CounteredBy: orEmpty(x.CounteredBy),
		}
		if x.Severe != nil {
			h.Severe = &model.HazardSevere{Min: x.Severe.Min, DrainPerMin: x.Severe.DrainPerMin}
		}
		if x.Breaks != nil {
			h.Breaks = &model.HazardBreak{Item: x.Breaks.Item, Min: x.Breaks.Min}
		}
		if x.Photo != nil {
			h.Photo = &model.HazardPhoto{FocusScale: x.Photo.FocusScale, SharpnessScale: x.Photo.SharpnessScale}
		}
		b.Hazards = append(b.Hazards, h)
	}

	var transit transitYAML
	if err := readOptional(filepath.Join(dir, "transit.yaml"), &transit); err != nil {
		return nil, err
	}
	for _, l := range transit.Lines {
		b.Transit.Lines = append(b.Transit.Lines, model.TransitLine{
			ID: l.ID, Name: l.Name, Mode: l.Mode, Fare: l.Fare, Stops: orEmpty(l.Stops), Path: l.Path, Speed: l.Speed,
			Headway: l.Headway, First: l.First, Last: l.Last, Locked: l.Locked,
		})
	}
	for _, st := range transit.Stops {
		b.Transit.Stops = append(b.Transit.Stops, model.TransitStop{ID: st.ID, Name: st.Name})
	}

	var ambient []ambientYAML
	if err := readOptional(filepath.Join(dir, "ambient.yaml"), &ambient); err != nil {
		return nil, err
	}
	for _, x := range ambient {
		b.Ambient = append(b.Ambient, model.AmbientNPC{
			ID: x.ID, Name: x.Name, Sprite: x.Sprite, Kind: x.Kind, Areas: orEmpty(x.Areas),
			Slots: orEmpty(x.Slots), PerChunk: x.PerChunk, Lines: orEmpty(x.Lines),
		})
	}

	var shops []struct {
		ID    string   `yaml:"id"`
		Title string   `yaml:"title"`
		Stock []string `yaml:"stock"`
	}
	if err := readOptional(filepath.Join(dir, "shops.yaml"), &shops); err != nil {
		return nil, err
	}
	for _, x := range shops {
		b.Shops = append(b.Shops, model.Shop{ID: x.ID, Title: x.Title, Stock: orEmpty(x.Stock)})
	}

	var missions []missionYAML
	if err := readOptional(filepath.Join(dir, "missions.yaml"), &missions); err != nil {
		return nil, err
	}
	for _, x := range missions {
		b.Missions = append(b.Missions, model.Mission{
			ID: x.ID, Giver: x.Giver, Title: x.Title, Description: x.Description,
			Objective: model.Objective(x.Objective),
			Reward:    model.Reward{Money: x.Reward.Money, Items: orEmpty(x.Reward.Items)},
			Available: conditionsFromMap(x.Available),
			Window:    window(x.Window),
		})
	}

	var enemies []enemyYAML
	if err := readOptional(filepath.Join(dir, "enemies.yaml"), &enemies); err != nil {
		return nil, err
	}
	for _, x := range enemies {
		e := model.Enemy{
			ID: x.ID, Name: x.Name, Kind: x.Kind, Sprite: x.Sprite, Portrait: x.Portrait,
			Areas: orEmpty(x.Areas), Slots: orEmpty(x.Slots), Sight: x.Sight, Speed: x.Speed,
			Resolve: x.Resolve, Damage: x.Damage, ComboLength: x.ComboLength, WindowMs: x.WindowMs,
			MashRate: x.MashRate, Weakness: x.Weakness, Drops: []model.Drop{}, Lore: x.Lore,
		}
		for _, d := range x.Drops {
			e.Drops = append(e.Drops, model.Drop(d))
		}
		b.Enemies = append(b.Enemies, e)
	}

	var birds []birdYAML
	if err := readOptional(filepath.Join(dir, "birds.yaml"), &birds); err != nil {
		return nil, err
	}
	for _, x := range birds {
		b.Birds = append(b.Birds, model.Bird{
			ID: x.ID, Name: x.Name, Sprite: x.Sprite, OverworldSprite: x.OverworldSprite,
			Skittishness: x.Skittishness, SizeBand: x.SizeBand, Speed: x.Speed,
			Seasons: orEmpty(x.Seasons), Poses: x.Poses, Behaviors: orEmpty(x.Behaviors),
		})
	}

	var spots []spotYAML
	if err := readOptional(filepath.Join(dir, "spots.yaml"), &spots); err != nil {
		return nil, err
	}
	for _, x := range spots {
		s := model.Spot{ID: x.ID, Name: x.Name, Area: x.Area, Background: x.Background, Shots: x.Shots, Birds: []model.SpotBird{}, RequiresItem: x.RequiresItem, Slots: x.Slots}
		for _, sb := range x.Birds {
			s.Birds = append(s.Birds, model.SpotBird{
				Species: sb.Species, Weight: sb.Weight, Slots: sb.Slots, Seasons: sb.Seasons,
				RequiresFlag: sb.RequiresFlag, UnlessFlag: sb.UnlessFlag, Always: sb.Always, Weather: sb.Weather,
			})
		}
		b.Spots = append(b.Spots, s)
	}

	var students []studentYAML
	if err := readOptional(filepath.Join(dir, "students.yaml"), &students); err != nil {
		return nil, err
	}
	for _, x := range students {
		if x.Tendencies == nil {
			x.Tendencies = map[string]float64{}
		}
		b.Students = append(b.Students, model.Student{
			ID: x.ID, Name: x.Name, Level: x.Level, Home: x.Home,
			Repertoire: orEmpty(x.Repertoire), Tendencies: x.Tendencies, Fee: x.Fee,
		})
	}

	err := readDir(filepath.Join(dir, "songs"), func(path string) error {
		var x songYAML
		if err := readYAML(path, &x); err != nil {
			return err
		}
		s := model.Song{ID: x.ID, Title: x.Title, Tempo: x.Tempo, TimeSignature: x.TimeSignature, Difficulty: x.Difficulty, Notes: []model.Note{}}
		for _, n := range x.Notes {
			s.Notes = append(s.Notes, model.Note(n))
		}
		b.Songs = append(b.Songs, s)
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readDir(filepath.Join(dir, "music"), func(path string) error {
		var x musicYAML
		if err := readYAML(path, &x); err != nil {
			return err
		}
		m := model.Music{ID: x.ID, Title: x.Title, Tempo: x.Tempo, LoopBeats: x.LoopBeats, Tracks: []model.MusicTrack{}}
		for _, t := range x.Tracks {
			track := model.MusicTrack{Instrument: t.Instrument, Volume: t.Volume, Notes: []model.Note{}}
			for _, n := range t.Notes {
				track.Notes = append(track.Notes, model.Note(n))
			}
			m.Tracks = append(m.Tracks, track)
		}
		b.Music = append(b.Music, m)
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readDir(filepath.Join(dir, "events"), func(path string) error {
		var events []eventYAML
		if err := readYAML(path, &events); err != nil {
			return err
		}
		for _, x := range events {
			e, err := convertEvent(x)
			if err != nil {
				return fmt.Errorf("%s: event %s: %w", path, x.ID, err)
			}
			b.Events = append(b.Events, e)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	err = readDir(filepath.Join(dir, "dialogue"), func(path string) error {
		var dialogue []dialogueYAML
		if err := readYAML(path, &dialogue); err != nil {
			return err
		}
		for _, x := range dialogue {
			d := model.Dialogue{ID: x.ID, Lines: []model.DialogueLine{}}
			for _, l := range x.Lines {
				d.Lines = append(d.Lines, model.DialogueLine{
					Speaker: l.Speaker, Portrait: l.Portrait, Text: l.Text, If: conditionsFromMap(l.If),
				})
			}
			b.Dialogue = append(b.Dialogue, d)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return b, nil
}

func convertEvent(x eventYAML) (model.Event, error) {
	e := model.Event{
		ID:         x.ID,
		Trigger:    model.Trigger{Type: x.Trigger["type"], Params: map[string]string{}},
		Conditions: []model.Condition{},
		Actions:    []model.Action{},
		Once:       x.Once == nil || *x.Once,
	}
	for k, v := range x.Trigger {
		if k != "type" {
			e.Trigger.Params[k] = v
		}
	}
	for _, m := range x.Conditions {
		typ, val, err := single(m)
		if err != nil {
			return e, fmt.Errorf("condition: %w", err)
		}
		e.Conditions = append(e.Conditions, model.Condition{Type: typ, Value: val})
	}
	for _, m := range x.Actions {
		typ, val, err := single(m)
		if err != nil {
			return e, fmt.Errorf("action: %w", err)
		}
		e.Actions = append(e.Actions, model.Action{Type: typ, Value: val})
	}
	return e, nil
}

// single unpacks a one-key map like {flag_set: x}.
func single(m map[string]any) (string, any, error) {
	if len(m) != 1 {
		return "", nil, fmt.Errorf("want exactly one key, got %d", len(m))
	}
	for k, v := range m {
		return k, v, nil
	}
	panic("unreachable")
}

// conditionsFromMap turns {party_has: oboy, season: spring} into conditions,
// sorted by type so output is deterministic.
func conditionsFromMap(m map[string]any) []model.Condition {
	if len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]model.Condition, 0, len(keys))
	for _, k := range keys {
		out = append(out, model.Condition{Type: k, Value: m[k]})
	}
	return out
}

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func window(w *struct {
	From string `yaml:"from"`
	To   string `yaml:"to"`
}) *model.MissionWindow {
	if w == nil {
		return nil
	}
	return &model.MissionWindow{From: w.From, To: w.To}
}
