// Command assetgen manages placeholder assets.
//
//	go run ./tools/assetgen gen   -assets web/public/assets -tilesets content/world/tilesets
//	go run ./tools/assetgen check -assets web/public/assets
//
// gen draws every placeholder (tiles, characters, birds, photo backgrounds)
// with the master palette and writes manifest.json and palette.gpl. check
// verifies the manifest and the 16-bit palette rules for all assets,
// including final art (SPEC.md §1.3, developer_guide.md §6).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: assetgen check|gen [flags]")
		os.Exit(2)
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	assets := fs.String("assets", "web/public/assets", "assets directory")
	tilesets := fs.String("tilesets", "content/world/tilesets", "Tiled tileset directory (gen only)")
	_ = fs.Parse(os.Args[2:])

	var err error
	switch os.Args[1] {
	case "check":
		err = check(*assets)
	case "gen":
		err = gen(*assets, *tilesets)
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "assetgen:", err)
		os.Exit(1)
	}
}

// manifestEntry is one asset. Type is "image", "spritesheet" or "background"
// (a composite of image layers with perch metadata, no file of its own).
type manifestEntry struct {
	Type        string   `json:"type"`
	File        string   `json:"file,omitempty"`
	FrameWidth  int      `json:"frameWidth,omitempty"`
	FrameHeight int      `json:"frameHeight,omitempty"`
	Frames      []string `json:"frames,omitempty"`
	Layers      []string `json:"layers,omitempty"`
	Perches     [][2]int `json:"perches,omitempty"`
	Ground      *[2]int  `json:"ground,omitempty"`
	GroundX     *[2]int  `json:"groundX,omitempty"`
	Placeholder bool     `json:"placeholder,omitempty"`
}

func gen(assets, tilesets string) error {
	steps := []func(string) error{genAngie, genOBoy, genPeople, genPhotographer, genBirds, genBackgrounds, genEnemies, genVehicles}
	for _, step := range steps {
		if err := step(assets); err != nil {
			return err
		}
	}
	if err := genTiles(assets, tilesets); err != nil {
		return err
	}
	if err := writeGPL(filepath.Join(assets, "palette.gpl")); err != nil {
		return err
	}

	m := map[string]manifestEntry{
		"tiles_tko":  {Type: "spritesheet", File: "tiles/tko.png", FrameWidth: tile, FrameHeight: tile, Placeholder: true},
		"char_angie": {Type: "spritesheet", File: "chars/angie.png", FrameWidth: 16, FrameHeight: 24, Placeholder: true},
		"char_oboy":  {Type: "spritesheet", File: "chars/oboy.png", FrameWidth: 8, FrameHeight: 8, Placeholder: true},
	}
	for _, b := range birdLooks {
		photo := fileExists(filepath.Join(photoBirds, b.id+".png"))
		m["bird_"+b.id] = manifestEntry{Type: "spritesheet", File: "birds/" + b.id + ".png", FrameWidth: 32, FrameHeight: 32, Frames: birdFrames, Placeholder: !photo}
		if fileExists(filepath.Join(assets, "birds", "album_"+b.id+".png")) {
			m["album_"+b.id] = manifestEntry{Type: "image", File: "birds/album_" + b.id + ".png"}
		}
		m["owbird_"+b.id] = manifestEntry{Type: "spritesheet", File: "birds/ow_" + b.id + ".png", FrameWidth: 8, FrameHeight: 8, Placeholder: true}
	}
	for _, p := range people {
		m["char_"+p.id] = manifestEntry{Type: "spritesheet", File: "chars/" + p.id + ".png", FrameWidth: 16, FrameHeight: 24, Placeholder: true}
	}
	m["vehicle_bus"] = manifestEntry{Type: "spritesheet", File: "vehicles/minibus.png", FrameWidth: 32, FrameHeight: 20, Placeholder: true}
	m["vehicle_ferry"] = manifestEntry{Type: "spritesheet", File: "vehicles/ferry.png", FrameWidth: 48, FrameHeight: 24, Placeholder: true}
	m["photographer_back"] = manifestEntry{Type: "spritesheet", File: "chars/photographer_back.png", FrameWidth: 32, FrameHeight: 48, Placeholder: true}
	for _, e := range enemyArt {
		m["enemy_"+e.id] = manifestEntry{Type: "spritesheet", File: "enemies/" + e.id + ".png", FrameWidth: 16, FrameHeight: 16, Placeholder: true}
		m["portrait_"+e.id] = manifestEntry{Type: "spritesheet", File: "enemies/portrait_" + e.id + ".png", FrameWidth: 48, FrameHeight: 48, Placeholder: true}
	}
	for _, bg := range backgrounds {
		var layers []string
		for _, l := range []string{"far", "mid", "near"} {
			id := bg.id + "_" + l
			m[id] = manifestEntry{Type: "image", File: "backgrounds/" + id + ".png", Placeholder: true}
			layers = append(layers, id)
		}
		m[bg.id] = manifestEntry{Type: "background", Layers: layers, Perches: bg.perches, Ground: &bg.ground, GroundX: &bg.groundX, Placeholder: true}
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(assets, "manifest.json"), append(data, '\n'), 0o644)
}
