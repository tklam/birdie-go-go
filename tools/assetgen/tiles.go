package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"birdiegogo/tools/internal/tko"
)

const tile = 16

// tileArt draws each tile of the Tseung Kwan O atlas, by catalogue name.
var tileArt = map[string]func(k cell){
	"grass": func(k cell) {
		k.rect(0, 0, tile, tile, cGreen)
		k.speckle(0, 0, tile, tile, cLightGreen, 0.05, 1)
		k.speckle(0, 0, tile, tile, cDarkGreen, 0.02, 2)
	},
	"grass_flowers": func(k cell) {
		k.rect(0, 0, tile, tile, cGreen)
		k.speckle(0, 0, tile, tile, cLightGreen, 0.1, 3)
		for _, p := range [][2]int{{3, 4}, {11, 3}, {7, 10}, {13, 12}, {2, 13}} {
			k.set(p[0], p[1], cYellow)
			k.set(p[0]+1, p[1], cPink)
		}
	},
	"pavement": func(k cell) {
		// Smooth paving: no seams, only a few faint specks.
		k.rect(0, 0, tile, tile, cConcrete)
		k.speckle(0, 0, tile, tile, cLightGray, 0.03, 4)
	},
	"plaza": func(k cell) {
		// Warm smooth paving instead of a checkerboard.
		k.rect(0, 0, tile, tile, cSand)
		k.speckle(0, 0, tile, tile, cConcrete, 0.04, 22)
	},
	"road": func(k cell) {
		k.rect(0, 0, tile, tile, cAsphalt)
		k.speckle(0, 0, tile, tile, cDarkGray, 0.03, 5)
	},
	"road_line": func(k cell) {
		k.rect(0, 0, tile, tile, cAsphalt)
		k.speckle(0, 0, tile, tile, cDarkGray, 0.03, 6)
		k.rect(2, 7, 12, 2, cRoadLine)
	},
	"water": func(k cell) {
		k.rect(0, 0, tile, tile, cSea)
		k.line(2, 4, 6, 4, cLightSea)
		k.line(9, 10, 13, 10, cLightSea)
		k.set(12, 3, cPaleSky)
	},
	"seawall": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkConcrete)
		k.rect(0, 0, tile, 4, cConcrete)
		k.rect(0, 12, tile, 4, cSea)
		k.line(0, 12, 15, 12, cLightSea)
	},
	"mud": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.speckle(0, 0, tile, tile, cBrown, 0.06, 7)
		k.speckle(0, 0, tile, tile, cLightSea, 0.02, 8)
	},
	"tower_wall": func(k cell) {
		k.rect(0, 0, tile, tile, cLightGray)
		k.line(0, 15, 15, 15, cGray)
		k.line(7, 0, 7, 15, cGray)
	},
	"tower_window": func(k cell) {
		k.rect(0, 0, tile, tile, cLightGray)
		k.rect(2, 3, 5, 6, cWindow)
		k.rect(9, 3, 5, 6, cWindow)
		k.set(2, 3, cPaleSky)
		k.set(9, 3, cPaleSky)
		k.line(0, 12, 15, 12, cGray)
	},
	"roof": func(k cell) {
		k.rect(0, 0, tile, tile, cGray)
		k.rect(0, 13, tile, 3, cDarkGray)
		k.speckle(0, 0, tile, 13, cLightGray, 0.05, 9)
	},
	"tree_trunk": func(k cell) {
		k.rect(0, 0, tile, tile, cGreen)
		k.speckle(0, 0, tile, tile, cLightGreen, 0.1, 10)
		k.ellipse(3, 10, 10, 5, cDarkGreen)
		k.rect(6, 0, 4, 13, cBrown)
		k.line(6, 0, 6, 12, cDarkBrown)
	},
	"canopy": func(k cell) {
		k.ellipse(0, 0, 16, 16, cDarkGreen)
		k.ellipse(1, 1, 13, 12, cGreen)
		k.speckle(2, 2, 10, 8, cLightGreen, 0.25, 11)
	},
	"bush": func(k cell) {
		k.rect(0, 0, tile, tile, cGreen)
		k.ellipse(1, 3, 14, 12, cDarkGreen)
		k.ellipse(2, 3, 11, 9, cGreen)
		k.speckle(3, 4, 9, 6, cLightGreen, 0.3, 12)
	},
	"tall_grass": func(k cell) {
		k.rect(0, 0, tile, tile, cGreen)
		for x := 1; x < tile; x += 3 {
			k.line(x, 15, x+1, 5+int(hash3(x, 0, 13)%4), cLightGreen)
			k.line(x+1, 15, x+1, 8+int(hash3(x, 1, 13)%4), cDarkGreen)
		}
	},
	"railing": func(k cell) {
		k.rect(0, 0, tile, tile, cConcrete)
		k.rect(0, 4, tile, 2, cLightGray)
		for x := 1; x < tile; x += 5 {
			k.rect(x, 4, 1, 9, cGray)
		}
		k.rect(0, 12, tile, 1, cGray)
	},
	"bench": func(k cell) {
		k.rect(0, 0, tile, tile, cConcrete)
		k.rect(1, 5, 14, 3, cBrown)
		k.rect(1, 9, 14, 2, cTan)
		k.rect(2, 11, 1, 3, cDarkGray)
		k.rect(13, 11, 1, 3, cDarkGray)
	},
	"lamp": func(k cell) {
		k.rect(0, 0, tile, tile, cConcrete)
		k.rect(7, 2, 2, 13, cDarkGray)
		k.rect(5, 0, 6, 3, cYellow)
		k.ellipse(5, 13, 6, 3, cDarkConcrete)
	},
	"footbridge": func(k cell) {
		k.rect(0, 2, tile, 12, cConcrete)
		k.rect(0, 2, tile, 2, cLightGray)
		k.rect(0, 12, tile, 2, cDarkConcrete)
		k.line(0, 7, 15, 7, cDarkConcrete)
	},
	"stairs": func(k cell) {
		for y := 0; y < tile; y += 4 {
			k.rect(0, y, tile, 3, cConcrete)
			k.rect(0, y+3, tile, 1, cDarkConcrete)
		}
	},
	"door": func(k cell) {
		k.rect(0, 0, tile, tile, cLightGray)
		k.rect(3, 2, 10, 14, cDarkBrown)
		k.rect(4, 3, 8, 12, cBrown)
		k.set(10, 9, cYellow)
	},
	"flowerbed": func(k cell) {
		k.rect(0, 0, tile, tile, cBrick)
		k.rect(1, 1, 14, 13, cBrown)
		k.speckle(2, 2, 12, 11, cGreen, 0.4, 14)
		k.speckle(2, 2, 12, 11, cPink, 0.1, 15)
		k.speckle(2, 2, 12, 11, cYellow, 0.08, 16)
	},
	"reeds": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		for x := 0; x < tile; x += 2 {
			top := 2 + int(hash3(x, 2, 17)%6)
			k.line(x, 15, x, top, cGreen)
			k.set(x, top, cBrown)
		}
	},
	"rock": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkGreen)
		k.ellipse(1, 2, 14, 13, cGray)
		k.ellipse(3, 3, 8, 6, cLightGray)
		k.line(4, 12, 11, 12, cDarkGray)
	},
	"ledge": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkGreen)
		k.rect(0, 0, tile, 9, cGreen)
		k.speckle(0, 0, tile, 9, cLightGreen, 0.1, 18)
		k.rect(0, 9, tile, 2, cBrown)
		k.rect(0, 11, tile, 5, cDarkBrown)
	},
	"hill_grass": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkGreen)
		k.speckle(0, 0, tile, tile, cGreen, 0.1, 19)
	},
	"trail": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.speckle(0, 0, tile, tile, cBrown, 0.04, 20)
		k.speckle(0, 0, tile, tile, cSand, 0.04, 21)
	},
	"boardwalk": func(k cell) {
		// Wide planks: one seam per tile instead of every 4 px.
		k.rect(0, 0, tile, tile, cTan)
		k.line(0, 15, 15, 15, cBrown)
	},
	"station_sign": func(k cell) {
		k.rect(0, 0, tile, tile, cConcrete)
		k.rect(1, 2, 14, 9, cNavy)
		k.rect(3, 4, 10, 2, cWhite)
		k.rect(3, 7, 6, 2, cRed)
		k.rect(7, 11, 2, 5, cDarkGray)
	},
	"shop_front": func(k cell) {
		k.rect(0, 0, tile, tile, cLightGray)
		k.rect(1, 4, 14, 10, cWindow)
		k.line(8, 4, 8, 13, cGray)
		k.rect(1, 14, 14, 2, cGray)
	},
	"floor_wood": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.line(0, 15, 15, 15, cBrown)
	},
	"floor_tile": func(k cell) {
		k.rect(0, 0, tile, tile, cWhite)
		k.speckle(0, 0, tile, tile, cLightGray, 0.03, 45)
	},
	"wall_interior": func(k cell) {
		k.rect(0, 0, tile, tile, cSand)
		k.rect(0, 12, tile, 4, cBrown)
		k.line(0, 12, 15, 12, cDarkBrown)
	},
	"wall_window": func(k cell) {
		k.rect(0, 0, tile, tile, cSand)
		k.rect(2, 2, 12, 8, cWhite)
		k.rect(3, 3, 10, 6, cSky)
		k.line(8, 3, 8, 8, cWhite)
		k.rect(0, 12, tile, 4, cBrown)
	},
	"piano_left": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(1, 1, 15, 9, cBlack)
		k.rect(1, 10, 15, 4, cWhite)
		for x := 2; x < tile; x += 3 {
			k.rect(x, 10, 1, 2, cBlack)
		}
		k.rect(1, 14, 15, 2, cDarkGray)
	},
	"piano_right": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(0, 1, 15, 9, cBlack)
		k.rect(0, 10, 15, 4, cWhite)
		for x := 1; x < 15; x += 3 {
			k.rect(x, 10, 1, 2, cBlack)
		}
		k.rect(0, 14, 15, 2, cDarkGray)
		k.rect(10, 3, 3, 2, cWhite)
	},
	"bed_top": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(1, 2, 14, 14, cBrown)
		k.rect(2, 3, 12, 13, cWhite)
		k.rect(3, 4, 10, 5, cPaleSky)
	},
	"bed_bottom": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(1, 0, 14, 14, cBrown)
		k.rect(2, 0, 12, 13, cPink)
		k.line(2, 4, 13, 4, cWhite)
		k.speckle(2, 5, 12, 8, cRed, 0.08, 40)
	},
	"table": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(1, 3, 14, 9, cBrown)
		k.rect(2, 4, 12, 7, cTan)
		k.rect(2, 12, 2, 3, cDarkBrown)
		k.rect(12, 12, 2, 3, cDarkBrown)
		k.rect(6, 5, 4, 3, cWhite)
	},
	"chair": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(4, 2, 8, 4, cBrown)
		k.rect(4, 7, 8, 4, cDarkBrown)
		k.rect(4, 11, 2, 4, cDarkBrown)
		k.rect(10, 11, 2, 4, cDarkBrown)
	},
	"sofa": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(0, 2, tile, 12, cBlue)
		k.rect(0, 2, tile, 4, cNavy)
		k.rect(2, 7, 12, 5, cBlue)
		k.line(8, 7, 8, 11, cNavy)
	},
	"plant": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(5, 10, 6, 5, cBrick)
		k.ellipse(2, 1, 12, 11, cDarkGreen)
		k.speckle(3, 2, 10, 8, cLightGreen, 0.3, 41)
	},
	"rug": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkRed)
		k.rect(2, 2, 12, 12, cRed)
		k.rect(5, 5, 6, 6, cOrange)
	},
	"doormat": func(k cell) {
		k.rect(0, 0, tile, tile, cTan)
		k.rect(1, 3, 14, 10, cBrown)
		k.speckle(2, 4, 12, 8, cDarkBrown, 0.3, 42)
	},
	"bookshelf": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkBrown)
		for y := 1; y < tile; y += 5 {
			k.rect(1, y, 14, 4, cBrown)
			for x := 1; x < 15; x += 2 {
				k.rect(x, y, 1, 4, []uint8{cRed, cBlue, cYellow, cGreen, cPurple}[(x+y)%5])
			}
		}
	},
	"counter": func(k cell) {
		k.rect(0, 0, tile, tile, cLightGray)
		k.rect(0, 0, tile, 6, cConcrete)
		k.rect(3, 1, 8, 4, cGray)
		k.rect(0, 6, tile, 10, cWhite)
		k.line(0, 11, 15, 11, cLightGray)
		k.rect(13, 8, 1, 2, cDarkGray)
	},
	"village_wall": func(k cell) {
		k.rect(0, 0, tile, tile, cSand)
		k.rect(0, 13, tile, 3, cDarkConcrete)
		k.rect(5, 4, 6, 6, cNavy)
		k.rect(6, 5, 4, 4, cWindow)
		k.line(0, 12, 15, 12, cTan)
	},
	"village_roof": func(k cell) {
		k.rect(0, 0, tile, tile, cTeal)
		for y := 1; y < tile; y += 3 {
			k.line(0, y, 15, y, cDarkTeal)
		}
		k.rect(0, 14, tile, 2, cDarkGray)
	},
	"pier": func(k cell) {
		k.rect(0, 0, tile, tile, cSea)
		k.rect(1, 0, 14, tile, cBrown)
		for y := 2; y < tile; y += 4 {
			k.line(1, y, 14, y, cDarkBrown)
		}
		k.rect(1, 0, 1, tile, cDarkBrown)
		k.rect(14, 0, 1, tile, cDarkBrown)
	},
	"stream": func(k cell) {
		k.rect(0, 0, tile, tile, cLightSea)
		k.line(1, 5, 5, 5, cPaleSky)
		k.line(8, 11, 13, 11, cPaleSky)
		k.speckle(0, 0, tile, tile, cSea, 0.08, 43)
	},
	"stepping_stones": func(k cell) {
		k.rect(0, 0, tile, tile, cLightSea)
		k.ellipse(1, 2, 6, 5, cGray)
		k.ellipse(9, 8, 6, 5, cGray)
		k.ellipse(2, 10, 5, 4, cLightGray)
	},
	"fern": func(k cell) {
		k.rect(0, 0, tile, tile, cDarkGreen)
		k.speckle(0, 0, tile, tile, cGreen, 0.3, 44)
		for x := 2; x < tile; x += 5 {
			k.line(x, 14, x+3, 4, cLightGreen)
			k.line(x+1, 14, x-1, 6, cGreen)
		}
	},
	"boat": func(k cell) {
		k.rect(0, 0, tile, tile, cSea)
		k.ellipse(1, 3, 14, 10, cWhite)
		k.ellipse(3, 5, 10, 6, cTan)
		k.line(1, 8, 14, 8, cRed)
	},
	"fishing_net": func(k cell) {
		k.rect(0, 0, tile, tile, cBrown)
		for i := 0; i < tile; i += 3 {
			k.line(i, 0, 0, i, cTan)
			k.line(15-i, 15, 15, 15-i, cTan)
		}
		k.rect(0, 13, tile, 3, cDarkBrown)
	},
	"awning": func(k cell) {
		for x := 0; x < tile; x += 4 {
			k.rect(x, 0, 2, 10, cRed)
			k.rect(x+2, 0, 2, 10, cWhite)
		}
		k.rect(0, 10, tile, 2, cDarkRed)
	},
}

// metaArt colors for the collision/areas layers (editor-only; never drawn in game).
var metaColors = map[string]uint8{
	"solid":                    cRed,
	"ledge_south":              cOrange,
	"area_tko_town":            cPurple,
	"area_tko_waterfront":      cBlue,
	"area_tko_hillside":        cGreen,
	"area_cwb_country_park":    cDarkGreen,
	"area_po_toi_o":            cTeal,
	"area_island_harbourfront": cSky,
	"area_island_peak":         cOlive,
	"area_wetlands":            cYellowGreen,
}

// genTiles writes the TKO atlas and meta tileset images plus their Tiled
// tileset files (.tsj) for the world editor.
func genTiles(assets, tilesetDir string) error {
	rows := (len(tko.Tiles) + tko.AtlasColumns - 1) / tko.AtlasColumns
	atlas := newCanvas(tko.AtlasColumns*tile, rows*tile)
	for i, t := range tko.Tiles {
		draw, ok := tileArt[t.Name]
		if !ok {
			return fmt.Errorf("no art for tile %q", t.Name)
		}
		draw(atlas.cell((i%tko.AtlasColumns)*tile, (i/tko.AtlasColumns)*tile))
	}
	atlasPath := filepath.Join(assets, "tiles", "tko.png")
	if err := atlas.save(atlasPath); err != nil {
		return err
	}
	// Seasonal palette swaps of the same atlas (SPEC.md §1.3): spring and
	// summer use the base greens.
	for _, s := range seasonalTiles {
		if err := recolor(atlas, s.swap).save(filepath.Join(assets, "tiles", "tko_"+s.season+".png")); err != nil {
			return err
		}
	}

	meta := newCanvas(len(tko.Meta)*tile, tile)
	for i, m := range tko.Meta {
		k := meta.cell(i*tile, 0)
		k.rect(0, 0, tile, tile, metaColors[m.Name])
		k.rect(2, 2, 12, 12, cClear)
		k.line(2, 2, 13, 13, metaColors[m.Name])
	}
	metaPath := filepath.Join(assets, "tiles", "meta.png")
	if err := meta.save(metaPath); err != nil {
		return err
	}

	var tiles []tsjTile
	for i, t := range tko.Tiles {
		props := []tsjProperty{{Name: "name", Type: "string", Value: t.Name}}
		if t.Overhead {
			props = append(props, tsjProperty{Name: "overhead", Type: "bool", Value: true})
		}
		if t.Solid {
			props = append(props, tsjProperty{Name: "solid", Type: "bool", Value: true})
		}
		tiles = append(tiles, tsjTile{ID: i, Properties: props})
	}
	if err := writeTSJ(filepath.Join(tilesetDir, "tko.tsj"), "tko", atlasPath, tko.AtlasColumns, len(tko.Tiles), atlas.img.Rect.Dx(), atlas.img.Rect.Dy(), tiles); err != nil {
		return err
	}
	tiles = nil
	for i, m := range tko.Meta {
		tiles = append(tiles, tsjTile{ID: i, Properties: []tsjProperty{{Name: m.Property, Type: "string", Value: m.Value}}})
	}
	return writeTSJ(filepath.Join(tilesetDir, "meta.tsj"), "meta", metaPath, len(tko.Meta), len(tko.Meta), meta.img.Rect.Dx(), meta.img.Rect.Dy(), tiles)
}

type tsjProperty struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Value any    `json:"value"`
}

type tsjTile struct {
	ID         int           `json:"id"`
	Properties []tsjProperty `json:"properties"`
}

func writeTSJ(path, name, image string, columns, count, w, h int, tiles []tsjTile) error {
	rel, err := filepath.Rel(filepath.Dir(path), image)
	if err != nil {
		return err
	}
	ts := map[string]any{
		"type": "tileset", "version": "1.10", "tiledversion": "1.10.2", "name": name,
		"tilewidth": tile, "tileheight": tile, "spacing": 0, "margin": 0,
		"columns": columns, "tilecount": count, "image": filepath.ToSlash(rel),
		"imagewidth": w, "imageheight": h, "tiles": tiles,
	}
	data, err := json.MarshalIndent(ts, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// seasonalTiles are the foliage palette swaps of the tile atlas: golden
// grass and olive leaves in autumn, dry, dull greens in winter.
var seasonalTiles = []struct {
	season string
	swap   map[uint8]uint8
}{
	{"autumn", map[uint8]uint8{cLightGreen: cYellowGreen, cGreen: cOlive, cPaleGreen: cSand}},
	{"winter", map[uint8]uint8{cLightGreen: cOlive, cPaleGreen: cTan, cYellowGreen: cOlive}},
}

// recolor returns a copy of c with palette indices swapped.
func recolor(c *canvas, swap map[uint8]uint8) *canvas {
	b := c.img.Rect
	out := newCanvas(b.Dx(), b.Dy())
	for i, v := range c.img.Pix {
		if to, ok := swap[v]; ok {
			v = to
		}
		out.img.Pix[i] = v
	}
	return out
}
