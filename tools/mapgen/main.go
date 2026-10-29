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
	marsh := wetlands()
	if err := writeJSON(filepath.Join(dir, "wetlands.tmj"), marsh.tiled("tilesets")); err != nil {
		return err
	}
	island := harbourIsland()
	if err := writeJSON(filepath.Join(dir, "island.tmj"), island.tiled("tilesets")); err != nil {
		return err
	}
	world := map[string]any{
		"type": "world", "onlyShowAdjacentMaps": false,
		"maps": []map[string]any{
			{"fileName": "tko.tmj", "x": 0, "y": 0, "width": m.w * tileSize, "height": m.h * tileSize},
			{"fileName": "clear_water_bay.tmj", "x": m.w * tileSize, "y": 0, "width": east.w * tileSize, "height": east.h * tileSize},
			{"fileName": "island.tmj", "x": 0, "y": m.h * tileSize, "width": island.w * tileSize, "height": island.h * tileSize},
			{"fileName": "wetlands.tmj", "x": m.w * tileSize, "y": m.h * tileSize, "width": marsh.w * tileSize, "height": marsh.h * tileSize},
		},
	}
	if err := writeJSON(filepath.Join(dir, "city.world"), world); err != nil {
		return err
	}
	interiors := filepath.Join(filepath.Dir(dir), "interiors")
	if err := os.MkdirAll(interiors, 0o755); err != nil {
		return err
	}
	for name, im := range map[string]*tmap{"angie_flat": angieFlat(), "mei_flat": meiFlat(), "fai_house": faiHouse(), "ho_flat": hoFlat(), "shared_home": sharedHome()} {
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
	m.obj("ridge_dogs", "enemy", 56, 4, map[string]string{"enemy_id": "stray_dog_pack"})
	// Hidden collectibles (SPEC.md §4.5).
	m.obj("feather_hilltop", "collectible", 12, 14, map[string]string{"item": "feather"})
	m.obj("feather_garden", "collectible", 22, 40, map[string]string{"item": "feather"})
	m.obj("part_promenade", "collectible", 88, 52, map[string]string{"item": "camera_part"})
	m.obj("sheet_plaza", "collectible", 44, 33, map[string]string{"song": "egrets_lullaby"})
	m.obj("feather_seawall", "collectible", 8, 53, map[string]string{"item": "feather"})

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
	m.obj("minibus_driver", "npc", 64, 30, map[string]string{"npc_id": "minibus_driver", "sprite": "char_minibus_driver"})
	m.obj("plaza_shop", "shop", 47, 25, map[string]string{"title": "Plaza Convenience Store", "shop_id": "plaza_convenience"})
	m.obj("outdoor_shop", "shop", 54, 25, map[string]string{"title": "Harbour Outdoors", "shop_id": "harbour_outdoors"})
	// The metro station entrance (SPEC.md §4.11).
	m.put(59, 32, "station_sign")
	m.obj("stop_tko_station", "stop", 60, 32, map[string]string{"stop_id": "tko_station"})
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
	hoDoor := m.tower(64, 35, 16, 7)
	m.obj("ho_home", "door", hoDoor, 41, map[string]string{"to_map": "ho_flat", "to_spawn": "front_door", "title": "Mrs Ho's flat"})
	m.obj("ho_home_out", "spawn", hoDoor, 42, nil)

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
	m.obj("promenade_ghost", "enemy", 30, 55, map[string]string{"enemy_id": "water_ghost"})
	m.fill(0, 58, mapW, 6, "water")
	// A small ferry pier on Junk Bay.
	m.fill(70, 56, 3, 1, "boardwalk")
	m.fill(70, 57, 3, 5, "pier")
	m.obj("stop_tko_pier", "stop", 71, 55, map[string]string{"stop_id": "tko_pier"})
	m.obj("ferry_deckhand", "npc", 74, 54, map[string]string{"npc_id": "ferry_deckhand", "sprite": "char_ferry_deckhand"})

	// Objects.
	m.obj("estate_plaza", "spawn", 47, 28, nil)
	m.obj("tko_estate_garden", "spot", 18, 38, map[string]string{"spot_id": "tko_estate_garden"})
	m.obj("tko_waterfront_park", "spot", 40, 52, map[string]string{"spot_id": "tko_waterfront_park"})
	m.obj("angie_home", "door", angieDoor, 27, map[string]string{"to_map": "angie_flat", "to_spawn": "front_door", "title": "Angie's flat",
		"alt_flag": "wedding_done", "alt_map": "shared_home", "alt_title": "Home"})
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
// wetlands is the fishpond country (NW wetlands inspired, original layout),
// reached by the Wetland Line: fishponds on bunds, reed beds, a bird hide on
// a boardwalk, and a deep mudflat that needs wading boots.
func wetlands() *tmap {
	const w, h = 64, 40
	m := newMap(w, h)
	m.area(0, h, "wetlands")
	m.fill(0, 0, w, 4, "water")
	m.fill(0, 4, w, h-4, "grass")
	// Fishponds in a grid of bunds (the paths between them).
	for py := range 3 {
		for px := range 4 {
			m.fill(4+px*14, 8+py*8, 11, 5, "water")
		}
	}
	m.fill(0, 6, w, 1, "trail")
	for py := range 3 {
		m.fill(0, 13+py*8, w, 2, "trail")
	}
	for px := range 5 {
		m.fill(2+px*14, 6, 2, 26, "trail")
	}
	// Reed beds and tall grass along the edges.
	m.fill(0, 33, w, 2, "reeds")
	m.fill(46, 30, 12, 3, "tall_grass")
	// The mudflat to the south, behind deep mud.
	m.fill(0, 35, w, 5, "mud")
	m.obj("wetland_mud_gate", "gate", 20, 35, map[string]string{"requires": "wading_boots", "w": "24", "h": "5", "hint": "The mud here is deep and soft. Wading boots would help."})
	// A boardwalk out to the bird hide.
	m.fill(30, 28, 3, 6, "boardwalk")
	m.put(29, 27, "shop_front")
	m.put(30, 27, "shop_front")
	m.put(31, 27, "shop_front")
	m.put(32, 27, "shop_front")
	m.fill(29, 26, 4, 1, "awning")
	m.put(5, 5, "station_sign")
	m.obj("stop_wetland_station", "stop", 6, 5, map[string]string{"stop_id": "wetland_station"})
	m.obj("wetland_hide", "spot", 31, 28, map[string]string{"spot_id": "wetland_hide"})
	m.obj("wetland_mudflat", "spot", 32, 37, map[string]string{"spot_id": "wetland_mudflat"})
	m.obj("pond_egrets", "bird", 10, 10, map[string]string{"species": "great_egret", "count": "2"})
	m.obj("pond_ducks", "bird", 40, 18, map[string]string{"species": "little_grebe", "count": "2"})
	m.obj("bund_dogs", "enemy", 50, 22, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("feather_reeds", "collectible", 12, 33, map[string]string{"item": "feather"})
	m.obj("sheet_hide", "collectible", 34, 31, map[string]string{"song": "reed_bed_waltz"})
	return m
}

// harbourIsland is the island across the harbour, south of Tseung Kwan O
// (Hong Kong Island inspired, original layout): a harbourfront with a tram
// road and towers, a park, and a peak trail up the hill.
func harbourIsland() *tmap {
	const w, h = 96, 40
	m := newMap(w, h)
	m.area(0, 26, "island_harbourfront")
	m.area(26, h, "island_peak")
	// The harbour, a seawall and the promenade with a ferry pier.
	m.fill(0, 0, w, 8, "water")
	m.fill(0, 8, w, 1, "railing")
	m.fill(0, 9, w, 2, "boardwalk")
	m.fill(70, 8, 3, 1, "boardwalk")
	m.fill(70, 2, 3, 6, "pier")
	m.put(66, 4, "boat")
	for _, x := range []int{10, 30, 50, 86} {
		m.put(x, 9, "bench")
		m.put(x+3, 9, "lamp")
	}
	// The tram road.
	m.fill(0, 11, w, 3, "road")
	m.fill(0, 12, w, 1, "road_line")
	m.fill(0, 14, w, 2, "pavement")
	// Towers along the road, the metro station and shops.
	m.fill(0, 16, w, 7, "pavement")
	for _, x := range []int{2, 18, 54, 72} {
		m.tower(x, 16, 12, 7)
	}
	m.fill(34, 16, 14, 1, "awning")
	m.fill(34, 17, 14, 2, "shop_front")
	m.put(40, 19, "station_sign")
	m.fill(0, 23, w, 3, "pavement")
	m.fill(86, 16, 10, 7, "plaza")
	// A small harbourfront park among the towers.
	m.fill(86, 17, 10, 6, "grass_flowers")
	for _, p := range [][2]int{{87, 18}, {93, 18}, {90, 21}} {
		m.tree(p[0], p[1])
	}
	// The peak trail.
	m.fill(0, 26, w, h-26, "hill_grass")
	for i := range 60 {
		m.tree(int(hash(i, 21)%w), 28+int(hash(i, 22)%11))
	}
	for i := range 14 {
		m.put(int(hash(i, 23)%w), 27+int(hash(i, 24)%12), "fern")
	}
	m.fill(46, 26, 3, 14, "trail")
	m.fill(20, 32, 60, 2, "trail")
	m.fill(46, 26, 3, 1, "stairs")
	m.fill(60, 35, 8, 3, "tall_grass")

	m.obj("stop_island_pier", "stop", 71, 9, map[string]string{"stop_id": "island_pier"})
	for _, s := range []struct {
		id string
		x  int
	}{{"tram_western", 12}, {"tram_central", 46}, {"tram_eastern", 84}} {
		m.put(s.x-1, 14, "station_sign")
		m.obj("stop_"+s.id, "stop", s.x, 14, map[string]string{"stop_id": s.id})
	}
	m.obj("stop_island_station", "stop", 41, 20, map[string]string{"stop_id": "island_station"})
	m.obj("island_harbour_park", "spot", 90, 19, map[string]string{"spot_id": "island_harbour_park"})
	m.obj("island_peak_trail", "spot", 64, 33, map[string]string{"spot_id": "island_peak_trail"})
	m.obj("peak_dogs", "enemy", 30, 33, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("pier_ghost_island", "enemy", 60, 9, map[string]string{"enemy_id": "water_ghost"})
	m.obj("feather_peak", "collectible", 80, 37, map[string]string{"item": "feather"})
	m.obj("part_tram", "collectible", 28, 15, map[string]string{"item": "camera_part"})
	m.obj("park_kites", "bird", 88, 20, map[string]string{"species": "black_kite", "count": "1"})
	m.obj("uncle_chan", "npc", 58, 32, map[string]string{"npc_id": "uncle_chan", "sprite": "char_uncle_chan"})
	m.obj("siu_ming", "npc", 89, 22, map[string]string{"npc_id": "siu_ming", "sprite": "char_siu_ming"})
	m.obj("peak_bulbuls", "bird", 52, 30, map[string]string{"species": "red_whiskered_bulbul", "count": "3"})
	return m
}

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
	// Ah Fai's family house.
	m.put(18, 46, "door")
	m.collision[46][18] = metaFirst + tko.MetaID("solid")
	m.obj("fai_home", "door", 18, 46, map[string]string{"to_map": "fai_house", "to_spawn": "front_door", "title": "Ah Fai's house"})
	m.obj("fai_home_out", "spawn", 18, 47, nil)
	// A gap in the railing and a pier into the cove, with boats.
	m.fill(30, 56, 3, 1, "boardwalk")
	m.fill(30, 57, 3, 6, "pier")
	m.put(28, 59, "boat")
	m.put(34, 61, "boat")
	// An islet with a sea cave, reached by kayak along a channel from the pier.
	m.fill(52, 58, 6, 5, "hill_grass")
	for _, p := range [][2]int{{52, 58}, {57, 58}, {52, 62}, {57, 62}, {56, 58}} {
		m.put(p[0], p[1], "rock")
	}
	m.obj("kayak_channel", "gate", 33, 59, map[string]string{"requires": "kayak", "w": "19", "h": "2", "water": "true", "hint": "Too far to swim. A kayak would get you out to the islet."})
	m.obj("sea_cave", "spot", 55, 60, map[string]string{"spot_id": "sea_cave"})
	m.put(12, 54, "bench")
	m.put(50, 54, "bench")
	m.fill(56, 49, 6, 4, "mud")
	m.fill(56, 49, 6, 1, "reeds")
	// Deep mud: wading boots open it (SPEC.md §4.6).
	m.obj("mudflat_gate", "gate", 56, 49, map[string]string{"requires": "wading_boots", "w": "6", "h": "4", "hint": "The mud is knee-deep here. Wading boots would help."})
	m.obj("po_toi_o_mudflat", "spot", 58, 51, map[string]string{"spot_id": "po_toi_o_mudflat"})

	m.obj("cwb_stream", "spot", 22, 16, map[string]string{"spot_id": "cwb_stream"})
	m.obj("cwb_night_woods", "spot", 14, 8, map[string]string{"spot_id": "cwb_night_woods"})
	m.obj("gateway_cwb", "gateway", 40, 10, map[string]string{"gateway_id": "cwb_park", "title": "Country Park Gateway"})
	m.obj("gateway_po_toi_o", "gateway", 44, 50, map[string]string{"gateway_id": "po_toi_o", "title": "Po Toi O Gateway"})
	m.put(36, 44, "station_sign")
	m.obj("stop_po_toi_o_village", "stop", 37, 44, map[string]string{"stop_id": "po_toi_o_village"})
	m.obj("village_store", "shop", 46, 46, map[string]string{"title": "Village Store", "shop_id": "po_toi_o_store"})
	m.obj("hiker", "npc", 39, 45, map[string]string{"npc_id": "hiker", "sprite": "char_hiker"})
	m.obj("stop_po_toi_o_pier", "stop", 31, 56, map[string]string{"stop_id": "po_toi_o_pier"})
	m.obj("stop_cwb_park_gate", "stop", 10, 29, map[string]string{"stop_id": "cwb_park_gate"})
	m.obj("po_toi_o_pier", "spot", 31, 60, map[string]string{"spot_id": "po_toi_o_pier"})
	m.obj("forest_birds", "bird", 30, 14, map[string]string{"species": "oriental_magpie_robin", "count": "2"})
	m.obj("cove_egrets", "bird", 58, 51, map[string]string{"species": "little_egret", "count": "2"})
	m.obj("village_dogs", "enemy", 22, 50, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("park_zombie", "enemy", 48, 20, map[string]string{"enemy_id": "hopping_zombie"})
	// Hidden collectibles (SPEC.md §4.5).
	m.obj("feather_woods", "collectible", 10, 30, map[string]string{"item": "feather"})
	m.obj("sheet_village", "collectible", 50, 52, map[string]string{"song": "tram_bell_rag"})
	m.obj("part_stream", "collectible", 26, 20, map[string]string{"item": "camera_part"})
	m.obj("feather_cove", "collectible", 60, 52, map[string]string{"item": "feather"})
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
	m.obj("cupboard", "storage", 16, 2, nil)
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

// sharedHome is Angie and Kei's home after the wedding (SPEC.md §8): the
// photo wall, the piano, Kei's desk and O Boy's perch.
func sharedHome() *tmap {
	m := room("floor_wood")
	m.put(2, 2, "bed_top")
	m.put(2, 3, "bed_bottom")
	m.obj("home_bed", "bed", 2, 3, nil)
	m.obj("photo_wall", "photo_wall", 9, 1, nil)
	m.put(5, 2, "piano_left")
	m.put(6, 2, "piano_right")
	m.put(6, 3, "chair")
	m.fill(13, 2, 2, 1, "counter")
	m.obj("radio", "radio", 14, 2, nil)
	m.put(16, 2, "bookshelf")
	m.put(17, 2, "bookshelf")
	m.obj("cupboard", "storage", 16, 2, nil)
	m.put(15, 6, "table")
	m.put(14, 6, "chair")
	m.put(16, 6, "chair")
	m.fill(6, 7, 6, 2, "rug")
	m.put(18, 9, "plant")
	m.put(1, 9, "plant")
	m.exit("angie_home_out")
	return m
}

func hoFlat() *tmap {
	m := room("floor_wood")
	m.put(9, 2, "piano_left")
	m.put(10, 2, "piano_right")
	m.put(10, 3, "chair")
	m.obj("mrs_ho", "npc", 11, 3, map[string]string{"npc_id": "mrs_ho", "student": "mrs_ho", "sprite": "char_mrs_ho"})
	m.put(2, 2, "bookshelf")
	m.put(3, 2, "bookshelf")
	m.put(15, 6, "table")
	m.put(14, 6, "chair")
	m.fill(13, 8, 5, 2, "rug")
	m.put(18, 2, "plant")
	m.put(1, 9, "plant")
	m.exit("ho_home_out")
	return m
}

func faiHouse() *tmap {
	m := room("floor_wood")
	m.put(14, 2, "piano_left")
	m.put(15, 2, "piano_right")
	m.put(15, 3, "chair")
	m.obj("fai", "npc", 16, 3, map[string]string{"npc_id": "fai", "student": "fai", "sprite": "char_fai"})
	m.put(2, 2, "fishing_net")
	m.put(3, 2, "fishing_net")
	m.put(8, 6, "table")
	m.fill(6, 8, 6, 2, "rug")
	m.put(18, 9, "plant")
	m.exit("fai_home_out")
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
