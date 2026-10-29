// Package tko is the shared catalogue of the placeholder Tseung Kwan O
// tileset, used by assetgen (to draw it) and mapgen (to lay out the starter
// map). Final art replaces the image but must keep tile order and meaning.
package tko

import "fmt"

// Tile describes one tile of the main atlas. Solid tiles get a collision
// mark from mapgen; overhead tiles go on the overhead layer.
type Tile struct {
	Name     string
	Solid    bool
	Overhead bool
}

// Tiles in atlas order (local id = index; Tiled gid = index + firstgid).
var Tiles = []Tile{
	{Name: "grass"}, {Name: "grass_flowers"}, {Name: "pavement"}, {Name: "plaza"},
	{Name: "road"}, {Name: "road_line"}, {Name: "water", Solid: true}, {Name: "seawall", Solid: true},
	{Name: "mud"}, {Name: "tower_wall", Solid: true}, {Name: "tower_window", Solid: true}, {Name: "roof", Solid: true},
	{Name: "tree_trunk", Solid: true}, {Name: "canopy", Overhead: true}, {Name: "bush", Solid: true}, {Name: "tall_grass"},
	{Name: "railing", Solid: true}, {Name: "bench", Solid: true}, {Name: "lamp", Solid: true}, {Name: "footbridge", Overhead: true},
	{Name: "stairs"}, {Name: "door"}, {Name: "flowerbed", Solid: true}, {Name: "reeds"},
	{Name: "rock", Solid: true}, {Name: "ledge"}, {Name: "hill_grass"}, {Name: "trail"},
	{Name: "boardwalk"}, {Name: "station_sign", Solid: true}, {Name: "shop_front", Solid: true}, {Name: "awning", Overhead: true},
	// Interiors.
	{Name: "floor_wood"}, {Name: "floor_tile"}, {Name: "wall_interior", Solid: true}, {Name: "wall_window", Solid: true},
	{Name: "piano_left", Solid: true}, {Name: "piano_right", Solid: true}, {Name: "bed_top", Solid: true}, {Name: "bed_bottom", Solid: true},
	{Name: "table", Solid: true}, {Name: "chair", Solid: true}, {Name: "sofa", Solid: true}, {Name: "plant", Solid: true},
	{Name: "rug"}, {Name: "doormat"}, {Name: "bookshelf", Solid: true}, {Name: "counter", Solid: true},
	// Country park and fishing village.
	{Name: "village_wall", Solid: true}, {Name: "village_roof", Solid: true}, {Name: "pier"}, {Name: "stream", Solid: true},
	{Name: "stepping_stones"}, {Name: "fern"}, {Name: "boat", Solid: true}, {Name: "fishing_net", Solid: true},
}

// AtlasColumns is the width of the atlas in tiles.
const AtlasColumns = 8

// ID returns the local id of a tile by name.
func ID(name string) int {
	for i, t := range Tiles {
		if t.Name == name {
			return i
		}
	}
	panic(fmt.Sprintf("tko: unknown tile %q", name))
}

// Meta tiles mark collision and areas on the collision and areas layers.
// Their meaning comes from the tileset properties written by assetgen
// ("collision": "solid"|"ledge_south", "area": <area id>).
var Meta = []struct {
	Name, Property, Value string
}{
	{"solid", "collision", "solid"},
	{"ledge_south", "collision", "ledge_south"},
	{"area_tko_town", "area", "tko_town"},
	{"area_tko_waterfront", "area", "tko_waterfront"},
	{"area_tko_hillside", "area", "tko_hillside"},
	{"area_cwb_country_park", "area", "cwb_country_park"},
	{"area_po_toi_o", "area", "po_toi_o"},
	{"area_island_harbourfront", "area", "island_harbourfront"},
	{"area_island_peak", "area", "island_peak"},
	{"area_wetlands", "area", "wetlands"},
}

// MetaID returns the local id of a meta tile by name.
func MetaID(name string) int {
	for i, m := range Meta {
		if m.Name == name {
			return i
		}
	}
	panic(fmt.Sprintf("tko: unknown meta tile %q", name))
}
