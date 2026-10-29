// Command mapgen lays out the placeholder Tseung Kwan O starter map as a Tiled
// map (content/world/tko.tmj) and registers it in city.world. It exists only
// to bootstrap the vertical slice; once the map is edited by hand in Tiled,
// don't regenerate it (mapgen refuses to overwrite without -force).
//
//	go run ./tools/mapgen -world content/world
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"birdiegogo/tools/internal/tko"
)

const tileSize = 16

// metaFirst is the firstgid of meta.tsj, right after the atlas.
var metaFirst = len(tko.Tiles) + 1

func main() {
	dir := flag.String("world", "content/world", "world directory")
	force := flag.Bool("force", false, "overwrite an existing tko.tmj")
	flag.Parse()
	if err := run(*dir, *force); err != nil {
		fmt.Fprintln(os.Stderr, "mapgen:", err)
		os.Exit(1)
	}
}

func run(dir string, force bool) error {
	path := filepath.Join(dir, "tko.tmj")
	if _, err := os.Stat(path); err == nil && !force {
		return fmt.Errorf("%s exists; it may have been edited in Tiled (use -force to overwrite)", path)
	} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	m := build()
	if err := writeJSON(path, m.tiled("tilesets")); err != nil {
		return err
	}
	east := clearWaterBay()
	if err := writeJSON(filepath.Join(dir, "clear_water_bay.tmj"), east.tiled("tilesets")); err != nil {
		return err
	}
	world := map[string]any{
		"type": "world", "onlyShowAdjacentMaps": false,
		"maps": []map[string]any{
			{"fileName": "tko.tmj", "x": 0, "y": 0, "width": m.w * tileSize, "height": m.h * tileSize},
			{"fileName": "clear_water_bay.tmj", "x": m.w * tileSize, "y": 0, "width": east.w * tileSize, "height": east.h * tileSize},
		},
	}
	if err := writeJSON(filepath.Join(dir, "city.world"), world); err != nil {
		return err
	}
	interiors := filepath.Join(filepath.Dir(dir), "interiors")
	if err := os.MkdirAll(interiors, 0o755); err != nil {
		return err
	}
	for name, im := range map[string]*tmap{"angie_flat": angieFlat(), "mei_flat": meiFlat()} {
		if err := writeJSON(filepath.Join(interiors, name+".tmj"), im.tiled("../world/tilesets")); err != nil {
			return err
		}
	}
	return nil
}

type object struct {
	name, typ string
	x, y      int // tile coordinates of the object's center tile
	props     map[string]string
}

// tmap is a map being laid out; grids hold Tiled gids (0 = empty).
type tmap struct {
	w, h                               int
	ground, overhead, collision, areas [][]int
	objects                            []object
}

func newMap(w, h int) *tmap {
	grid := func() [][]int {
		g := make([][]int, h)
		for y := range g {
			g[y] = make([]int, w)
		}
		return g
	}
	return &tmap{w: w, h: h, ground: grid(), overhead: grid(), collision: grid(), areas: grid()}
}

func (m *tmap) put(x, y int, name string) {
	if x < 0 || y < 0 || x >= m.w || y >= m.h {
		return
	}
	t := tko.Tiles[tko.ID(name)]
	if t.Overhead {
		m.overhead[y][x] = tko.ID(name) + 1
		return
	}
	m.ground[y][x] = tko.ID(name) + 1
	m.collision[y][x] = 0
	if t.Solid {
		m.collision[y][x] = metaFirst + tko.MetaID("solid")
	}
	if name == "ledge" {
		m.collision[y][x] = metaFirst + tko.MetaID("ledge_south")
	}
}

func (m *tmap) fill(x, y, w, h int, name string) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			m.put(i, j, name)
		}
	}
}

func (m *tmap) tree(x, y int) {
	m.put(x, y, "tree_trunk")
	m.put(x, y-1, "canopy")
}

// tower is an estate block: roof, window rows, and a door in the middle of
// the bottom row (returns the door x).
func (m *tmap) tower(x, y, w, h int) int {
	m.fill(x, y, w, 1, "roof")
	m.fill(x, y+1, w, h-2, "tower_window")
	m.fill(x, y+h-1, w, 1, "tower_wall")
	door := x + w/2
	m.put(door, y+h-1, "door")
	m.collision[y+h-1][door] = metaFirst + tko.MetaID("solid")
	return door
}

func (m *tmap) area(y0, y1 int, id string) {
	for y := y0; y < y1; y++ {
		for x := range m.w {
			m.areas[y][x] = metaFirst + tko.MetaID("area_"+id)
		}
	}
}

func (m *tmap) obj(name, typ string, x, y int, props map[string]string) {
	m.objects = append(m.objects, object{name: name, typ: typ, x: x, y: y, props: props})
}

func build() *tmap {
	const mapW, mapH = 96, 64
	m := newMap(mapW, mapH)

	// Hillside trail (rows 0–19).
	m.area(0, 20, "tko_hillside")
	m.fill(0, 0, mapW, 20, "hill_grass")
	for _, p := range [][2]int{{4, 3}, {9, 6}, {15, 2}, {22, 8}, {30, 4}, {36, 10}, {70, 5}, {76, 9}, {84, 3}, {90, 12}, {66, 15}, {12, 16}, {28, 15}, {82, 16}} {
		m.tree(p[0], p[1])
	}
	for _, p := range [][2]int{{18, 13}, {40, 4}, {58, 9}, {88, 7}} {
		m.put(p[0], p[1], "rock")
	}
	m.fill(6, 11, 34, 1, "ledge")
	m.fill(20, 14, 8, 3, "tall_grass")
	m.fill(72, 11, 9, 3, "tall_grass")
	// The trail zig-zags from the stairs up the hill.
	m.fill(46, 15, 4, 5, "trail")
	m.fill(46, 15, 16, 2, "trail")
	m.fill(60, 6, 3, 10, "trail")
	m.fill(60, 6, 14, 2, "trail")
	m.fill(46, 18, 4, 2, "stairs")
	m.obj("hillside_birds", "bird", 76, 12, map[string]string{"species": "red_whiskered_bulbul", "count": "2"})
	m.obj("hill_dogs", "enemy", 26, 6, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("old_villager", "npc", 50, 16, map[string]string{"npc_id": "old_villager", "sprite": "char_old_villager"})
	m.obj("hill_zombie", "enemy", 84, 8, map[string]string{"enemy_id": "hopping_zombie"})

	// Town centre (rows 20–43).
	m.area(20, 44, "tko_town")
	m.fill(0, 20, mapW, 24, "pavement")
	m.fill(0, 30, mapW, 3, "road")
	m.fill(0, 31, mapW, 1, "road_line")
	m.tower(4, 21, 12, 7)
	angieDoor := m.tower(20, 21, 12, 7)
	meiDoor := m.tower(64, 21, 12, 7)
	m.tower(80, 21, 14, 7)
	// Mall with shop fronts and awnings, facing the plaza.
	m.fill(36, 21, 23, 4, "tower_window")
	m.fill(36, 21, 23, 1, "roof")
	m.fill(36, 25, 23, 1, "shop_front")
	m.fill(36, 26, 23, 1, "awning")
	m.fill(36, 26, 23, 4, "plaza")
	m.put(60, 28, "station_sign")
	m.put(63, 29, "station_sign")
	m.obj("stop_tko_plaza", "stop", 62, 29, map[string]string{"stop_id": "tko_plaza"})
	m.obj("plaza_shop", "shop", 47, 25, map[string]string{"title": "Plaza Convenience Store"})
	m.obj("kei", "npc", 40, 27, map[string]string{"npc_id": "kei", "sprite": "char_kei", "requires_flag": "chapter3_started", "unless_flag": "kei_met"})
	m.obj("gateway_tko_plaza", "gateway", 34, 28, map[string]string{"gateway_id": "tko_plaza", "title": "Plaza Gateway"})
	m.obj("neighbour", "npc", 54, 28, map[string]string{"npc_id": "neighbour", "sprite": "char_neighbour"})
	for _, x := range []int{38, 44, 50, 56} {
		m.put(x, 29, "lamp")
	}
	// Footbridge over the road (overhead), with stairs at each end.
	m.fill(86, 29, 3, 5, "footbridge")
	m.fill(86, 28, 3, 1, "stairs")
	m.fill(86, 34, 3, 1, "stairs")
	// Estate garden south of the road.
	m.fill(6, 34, 26, 9, "grass")
	m.fill(6, 34, 26, 1, "flowerbed")
	m.fill(6, 42, 26, 1, "flowerbed")
	m.fill(18, 42, 3, 1, "pavement") // garden entrance
	m.fill(18, 34, 3, 1, "pavement")
	m.fill(7, 37, 24, 2, "pavement")
	for _, p := range [][2]int{{8, 36}, {13, 36}, {24, 36}, {29, 36}, {10, 41}, {27, 41}} {
		m.tree(p[0], p[1])
	}
	for _, p := range [][2]int{{16, 40}, {21, 40}, {12, 39}} {
		m.put(p[0], p[1], "bush")
	}
	m.put(15, 36, "bench")
	m.put(22, 36, "bench")
	m.fill(26, 39, 4, 2, "grass_flowers")
	m.tower(64, 35, 16, 7)

	// Junk Bay waterfront (rows 44–63).
	m.area(44, mapH, "tko_waterfront")
	m.fill(0, 44, mapW, 2, "pavement")
	m.fill(0, 46, mapW, 8, "grass")
	m.fill(0, 49, mapW, 2, "pavement") // park path
	for _, p := range [][2]int{{16, 47}, {24, 47}, {33, 52}, {45, 47}, {54, 52}, {63, 47}, {72, 52}, {81, 47}, {90, 52}} {
		m.tree(p[0], p[1])
	}
	m.fill(58, 46, 6, 2, "grass_flowers")
	m.fill(76, 51, 8, 3, "tall_grass")
	m.fill(1, 46, 11, 8, "mud")
	m.fill(1, 46, 11, 2, "reeds")
	m.fill(0, 54, mapW, 2, "boardwalk")
	for _, x := range []int{20, 40, 60, 80} {
		m.put(x, 54, "bench")
		m.put(x+4, 54, "lamp")
	}
	m.fill(0, 56, mapW, 1, "railing")
	m.fill(0, 57, mapW, 1, "seawall")
	m.obj("bay_ghost", "enemy", 70, 55, map[string]string{"enemy_id": "water_ghost"})
	m.fill(0, 58, mapW, 6, "water")
	// A small ferry pier on Junk Bay.
	m.fill(70, 56, 3, 1, "boardwalk")
	m.fill(70, 57, 3, 5, "pier")
	m.obj("stop_tko_pier", "stop", 71, 55, map[string]string{"stop_id": "tko_pier"})

	// Objects.
	m.obj("estate_plaza", "spawn", 47, 28, nil)
	m.obj("tko_estate_garden", "spot", 18, 38, map[string]string{"spot_id": "tko_estate_garden"})
	m.obj("tko_waterfront_park", "spot", 40, 52, map[string]string{"spot_id": "tko_waterfront_park"})
	m.obj("angie_home", "door", angieDoor, 27, map[string]string{"to_map": "angie_flat", "to_spawn": "front_door", "title": "Angie's flat"})
	m.obj("angie_home_out", "spawn", angieDoor, 28, nil)
	m.obj("mei_home", "door", meiDoor, 27, map[string]string{"to_map": "mei_flat", "to_spawn": "front_door", "title": "Mei's flat"})
	m.obj("mei_home_out", "spawn", meiDoor, 28, nil)
	m.obj("garden_birds", "bird", 20, 39, map[string]string{"species": "red_whiskered_bulbul", "count": "3"})
	m.obj("garden_robin", "bird", 11, 38, map[string]string{"species": "oriental_magpie_robin", "count": "1"})
	m.obj("mudflat_egrets", "bird", 6, 50, map[string]string{"species": "little_egret", "count": "2"})
	m.obj("park_robins", "bird", 50, 50, map[string]string{"species": "oriental_magpie_robin", "count": "2"})
	return m
}

// clearWaterBay lays out the region east of Tseung Kwan O: Clear Water Bay
// Country Park (woodland trails, a stream) and the Po Toi O fishing-village
// cove. Its west edge lines up with TKO's east edge: hill trail (rows 0–19),
// road (rows 30–32) and waterfront boardwalk (rows 54–55).
func clearWaterBay() *tmap {
	const w, h = 64, 64
	m := newMap(w, h)
	// Country park: woodland over most of the region.
	m.area(0, 40, "cwb_country_park")
	m.fill(0, 0, w, 40, "hill_grass")
	for i := range 70 {
		x, y := int(hash(i, 1)%w), 1+int(hash(i, 2)%38)
		m.tree(x, y)
	}
	for i := range 40 {
		m.put(int(hash(i, 3)%w), int(hash(i, 4)%40), "fern")
	}
	for i := range 12 {
		m.put(int(hash(i, 5)%w), int(hash(i, 6)%40), "rock")
	}
	// Trails: the hill trail continues east, the road becomes a trail, and a
	// north–south trail joins them.
	m.fill(0, 6, 40, 2, "trail")
	m.fill(0, 30, 30, 3, "road")
	m.fill(0, 31, 30, 1, "road_line")
	m.fill(30, 30, 14, 3, "trail")
	m.fill(38, 6, 3, 50, "trail")
	// A stream with stepping stones.
	m.fill(20, 12, 2, 28, "stream")
	m.fill(20, 31, 2, 1, "stepping_stones")
	m.fill(20, 7, 2, 1, "stepping_stones")
	m.fill(14, 18, 6, 4, "tall_grass")
	m.fill(46, 20, 10, 4, "tall_grass")
	m.fill(24, 24, 10, 1, "ledge")

	// Po Toi O: a fishing-village cove in the south-east.
	m.area(40, h, "po_toi_o")
	m.fill(0, 40, w, 14, "hill_grass")
	m.fill(0, 44, w, 10, "pavement")
	m.fill(0, 54, w, 2, "boardwalk")
	m.fill(0, 56, w, 1, "railing")
	m.fill(0, 57, w, 7, "water")
	m.fill(38, 40, 3, 4, "trail")
	for i, x := range []int{6, 16, 26, 44, 54} {
		m.fill(x, 44, 6, 1, "village_roof")
		m.fill(x, 45, 6, 2, "village_wall")
		if i%2 == 0 {
			m.put(x+6, 48, "fishing_net")
		}
	}
	// A gap in the railing and a pier into the cove, with boats.
	m.fill(30, 56, 3, 1, "boardwalk")
	m.fill(30, 57, 3, 6, "pier")
	m.put(28, 59, "boat")
	m.put(34, 61, "boat")
	m.put(12, 54, "bench")
	m.put(50, 54, "bench")
	m.fill(56, 49, 6, 4, "mud")
	m.fill(56, 49, 6, 1, "reeds")

	m.obj("cwb_stream", "spot", 22, 16, map[string]string{"spot_id": "cwb_stream"})
	m.obj("gateway_cwb", "gateway", 40, 10, map[string]string{"gateway_id": "cwb_park", "title": "Country Park Gateway"})
	m.obj("gateway_po_toi_o", "gateway", 44, 50, map[string]string{"gateway_id": "po_toi_o", "title": "Po Toi O Gateway"})
	m.put(36, 44, "station_sign")
	m.obj("stop_po_toi_o_village", "stop", 37, 44, map[string]string{"stop_id": "po_toi_o_village"})
	m.obj("stop_po_toi_o_pier", "stop", 31, 56, map[string]string{"stop_id": "po_toi_o_pier"})
	m.obj("po_toi_o_pier", "spot", 31, 60, map[string]string{"spot_id": "po_toi_o_pier"})
	m.obj("forest_birds", "bird", 30, 14, map[string]string{"species": "oriental_magpie_robin", "count": "2"})
	m.obj("cove_egrets", "bird", 58, 51, map[string]string{"species": "little_egret", "count": "2"})
	m.obj("village_dogs", "enemy", 22, 50, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("pier_ghost", "enemy", 31, 58, map[string]string{"enemy_id": "water_ghost"})
	return m
}

// hash is a small deterministic integer hash for scattering decorations.
func hash(i, salt int) uint32 {
	h := uint32(i)*2654435761 + uint32(salt)*40503
	h ^= h >> 15
	h *= 2246822519
	return h ^ (h >> 13)
}

// room lays out a 20×12 interior: walls around a floor, with the exit
// door mat at the bottom middle.
func room(floor string) *tmap {
	m := newMap(20, 12)
	m.fill(0, 0, 20, 12, "wall_interior")
	m.fill(1, 2, 18, 9, floor)
	m.fill(0, 0, 20, 2, "wall_interior")
	for _, x := range []int{4, 9, 15} {
		m.put(x, 1, "wall_window")
	}
	m.put(10, 11, "doormat")
	m.obj("front_door", "spawn", 10, 10, nil)
	return m
}

// exit adds the door object that leads back outside.
func (m *tmap) exit(toSpawn string) {
	m.obj("exit", "door", 10, 11, map[string]string{"to_map": "world", "to_spawn": toSpawn, "title": "Tseung Kwan O"})
}

func angieFlat() *tmap {
	m := room("floor_wood")
	m.put(2, 2, "bed_top")
	m.put(2, 3, "bed_bottom")
	m.obj("angie_bed", "bed", 2, 3, nil)
	m.put(16, 2, "bookshelf")
	m.put(17, 2, "bookshelf")
	m.fill(13, 2, 2, 1, "counter")
	m.obj("radio", "radio", 14, 2, nil)
	m.put(9, 5, "table")
	m.put(8, 5, "chair")
	m.put(10, 5, "chair")
	m.fill(7, 7, 6, 2, "rug")
	m.put(18, 9, "plant")
	m.put(1, 9, "plant")
	m.exit("angie_home_out")
	return m
}

func meiFlat() *tmap {
	m := room("floor_tile")
	m.put(4, 2, "piano_left")
	m.put(5, 2, "piano_right")
	m.put(5, 3, "chair")
	m.obj("mei", "npc", 6, 3, map[string]string{"npc_id": "mei", "student": "mei", "sprite": "char_mei"})
	m.put(13, 3, "sofa")
	m.put(14, 3, "sofa")
	m.put(15, 3, "sofa")
	m.put(14, 6, "table")
	m.fill(12, 5, 5, 3, "rug")
	m.put(14, 6, "table")
	m.put(18, 2, "plant")
	m.put(1, 2, "bookshelf")
	m.exit("mei_home_out")
	return m
}

// tiled renders the map as Tiled JSON (.tmj).
func (m *tmap) tiled(tilesetDir string) map[string]any {
	layer := func(id int, name string, grid [][]int, visible bool) map[string]any {
		data := make([]int, 0, m.w*m.h)
		for y := range m.h {
			if grid == nil {
				data = append(data, make([]int, m.w)...)
				continue
			}
			data = append(data, grid[y]...)
		}
		return map[string]any{
			"id": id, "name": name, "type": "tilelayer", "width": m.w, "height": m.h,
			"x": 0, "y": 0, "opacity": 1, "visible": visible, "data": data,
		}
	}
	var objects []map[string]any
	for i, o := range m.objects {
		var props []map[string]any
		for k, v := range o.props {
			props = append(props, map[string]any{"name": k, "type": "string", "value": v})
		}
		objects = append(objects, map[string]any{
			"id": i + 1, "name": o.name, "type": o.typ, "point": true,
			"x": o.x*tileSize + tileSize/2, "y": o.y*tileSize + tileSize/2,
			"width": 0, "height": 0, "rotation": 0, "visible": true, "properties": props,
		})
	}
	return map[string]any{
		"type": "map", "version": "1.10", "tiledversion": "1.10.2", "orientation": "orthogonal",
		"renderorder": "right-down", "infinite": false, "compressionlevel": -1,
		"width": m.w, "height": m.h, "tilewidth": tileSize, "tileheight": tileSize,
		"nextlayerid": 7, "nextobjectid": len(m.objects) + 1,
		"tilesets": []map[string]any{
			{"firstgid": 1, "source": tilesetDir + "/tko.tsj"},
			{"firstgid": metaFirst, "source": tilesetDir + "/meta.tsj"},
		},
		"layers": []map[string]any{
			layer(1, "ground", m.ground, true),
			layer(2, "detail", nil, true),
			layer(3, "collision", m.collision, false),
			layer(4, "overhead", m.overhead, true),
			layer(5, "areas", m.areas, false),
			{"id": 6, "name": "objects", "type": "objectgroup", "draworder": "topdown", "x": 0, "y": 0,
				"opacity": 1, "visible": true, "objects": objects},
		},
	}
}

func writeJSON(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
