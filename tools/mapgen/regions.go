package main

// More regions (SPEC.md §4.3): ten districts in five regions, original
// layouts lightly inspired by places around Hong Kong.

// saiKung is a seafront town and a volcanic geopark, east of the country
// park (walk in from Clear Water Bay, or the minibus from the plaza).
func saiKung() *tmap {
	const w, h = 64, 56
	m := newMap(w, h)
	m.area(0, 28, "sai_kung_town")
	m.area(28, h, "geopark")
	m.fill(0, 0, w, h, "hill_grass")
	// The town: a road in from the west, the seafront promenade and restaurants.
	m.fill(0, 5, 44, 3, "road")
	m.fill(0, 6, 44, 1, "road_line")
	m.fill(10, 8, 34, 14, "pavement")
	for _, x := range []int{12, 22, 32} {
		m.fill(x, 10, 8, 1, "village_roof")
		m.fill(x, 11, 8, 2, "shop_front")
		m.fill(x, 9, 8, 1, "awning")
	}
	m.fill(10, 18, 34, 1, "railing")
	m.fill(10, 19, 34, 2, "boardwalk")
	m.fill(44, 0, w-44, 28, "water")
	m.fill(0, 21, 44, 3, "water")
	m.fill(30, 21, 3, 3, "pier")
	for _, p := range [][2]int{{48, 6}, {52, 12}, {47, 20}, {36, 23}} {
		m.put(p[0], p[1], "boat")
	}
	for i := range 16 {
		m.tree(int(hash(i, 41)%10), 10+int(hash(i, 42)%10))
	}
	// The geopark: hexagonal rock columns along a sea cliff.
	m.fill(0, 24, w, 4, "trail")
	m.fill(30, 24, 3, 22, "trail")
	for y := 30; y < 44; y += 3 {
		for x := 4 + (y/3)%2; x < 28; x += 3 {
			m.put(x, y, "rock")
		}
	}
	m.fill(36, 32, 12, 4, "tall_grass")
	m.fill(0, 46, w, h-46, "water")
	m.fill(48, 28, w-48, 18, "water")
	m.put(5, 7, "station_sign")
	m.obj("stop_sai_kung_town", "stop", 6, 7, map[string]string{"stop_id": "sai_kung_town"})
	m.obj("stop_sai_kung_pier", "stop", 31, 20, map[string]string{"stop_id": "sai_kung_pier"})
	m.obj("sai_kung_seafront", "spot", 24, 19, map[string]string{"spot_id": "sai_kung_seafront"})
	m.obj("geopark_cliffs", "spot", 40, 38, map[string]string{"spot_id": "geopark_cliffs"})
	m.obj("seafront_kites", "bird", 20, 16, map[string]string{"species": "black_kite", "count": "2"})
	m.obj("geopark_thrush", "bird", 34, 40, map[string]string{"species": "blue_rock_thrush", "count": "1"})
	m.obj("seafood_cat", "npc", 26, 14, map[string]string{"npc_id": "seafood_auntie", "sprite": "char_seafood_auntie"})
	m.obj("geologist", "npc", 32, 30, map[string]string{"npc_id": "geologist", "sprite": "char_geologist"})
	m.obj("geopark_dogs", "enemy", 12, 36, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("feather_geopark", "collectible", 20, 42, map[string]string{"item": "feather"})
	return m
}

// oldTown is a dense old district across the water from Harbour Island:
// a typhoon shelter by the harbour and a market quarter with a bird garden.
func oldTown() *tmap {
	const w, h = 96, 48
	m := newMap(w, h)
	m.area(0, 14, "old_town_harbour")
	m.area(14, h, "old_town_market")
	m.fill(0, 0, w, 10, "water")
	// The typhoon shelter: a breakwater and moored sampans.
	m.fill(20, 3, 56, 1, "seawall")
	for i := range 14 {
		m.put(22+int(hash(i, 51)%52), 5+int(hash(i, 52)%4), "boat")
	}
	m.fill(0, 10, w, 1, "railing")
	m.fill(0, 11, w, 3, "boardwalk")
	m.fill(46, 4, 3, 7, "pier")
	m.fill(46, 10, 3, 1, "boardwalk")
	// Streets, market stalls, towers, the temple square and the bird garden.
	m.fill(0, 14, w, h-14, "pavement")
	m.fill(0, 16, w, 3, "road")
	m.fill(0, 17, w, 1, "road_line")
	for x := 2; x < 60; x += 10 {
		m.fill(x, 20, 8, 1, "awning")
		m.fill(x, 21, 8, 1, "shop_front")
	}
	for _, x := range []int{2, 16, 30} {
		m.tower(x, 30, 12, 7)
	}
	m.fill(60, 20, 14, 10, "plaza")
	m.fill(64, 22, 6, 1, "village_roof")
	m.fill(64, 23, 6, 2, "village_wall")
	m.fill(76, 20, 20, 18, "grass_flowers")
	for _, p := range [][2]int{{78, 22}, {84, 22}, {92, 22}, {80, 30}, {90, 30}, {86, 35}} {
		m.tree(p[0], p[1])
	}
	m.fill(76, 26, 20, 1, "trail")
	m.fill(84, 20, 1, 18, "trail")
	m.fill(0, 40, w, 3, "road")
	m.fill(0, 41, w, 1, "road_line")
	m.put(29, 25, "station_sign")
	m.obj("stop_old_town_station", "stop", 30, 25, map[string]string{"stop_id": "old_town_station"})
	m.obj("bird_garden", "spot", 86, 28, map[string]string{"spot_id": "bird_garden"})
	m.obj("typhoon_shelter", "spot", 40, 12, map[string]string{"spot_id": "typhoon_shelter"})
	m.obj("old_town_shop", "shop", 12, 21, map[string]string{"title": "Market Stall", "shop_id": "old_town_market"})
	m.obj("sampan_lady", "npc", 50, 12, map[string]string{"npc_id": "sampan_lady", "sprite": "char_sampan_lady"})
	m.obj("bird_uncle", "npc", 82, 27, map[string]string{"npc_id": "bird_uncle", "sprite": "char_bird_uncle"})
	m.obj("garden_bulbuls", "bird", 90, 25, map[string]string{"species": "red_whiskered_bulbul", "count": "3"})
	m.obj("shelter_egrets", "bird", 30, 12, map[string]string{"species": "little_egret", "count": "2"})
	m.obj("part_market", "collectible", 56, 22, map[string]string{"item": "camera_part"})
	m.obj("harbour_ghost", "enemy", 70, 12, map[string]string{"enemy_id": "water_ghost"})
	return m
}

// lionRidge is a ridge shaped like a crouching lion and the old housing
// estate below it, east of the old town (walk in from either side).
func lionRidge() *tmap {
	const w, h = 64, 48
	m := newMap(w, h)
	m.area(0, 24, "lion_ridge")
	m.area(24, h, "lion_estate")
	m.fill(0, 0, w, 24, "hill_grass")
	for i := range 40 {
		m.tree(int(hash(i, 61)%w), 3+int(hash(i, 62)%18))
	}
	// The lion's head: a crag of rock on the ridge.
	for _, p := range [][2]int{{28, 4}, {29, 4}, {30, 4}, {27, 5}, {28, 5}, {29, 5}, {30, 5}, {31, 5}, {26, 6}, {32, 6}, {33, 6}} {
		m.put(p[0], p[1], "rock")
	}
	m.fill(30, 7, 3, 17, "trail")
	m.fill(0, 14, w, 2, "trail")
	m.fill(30, 7, 3, 1, "stairs")
	// The estate: low towers, a playground and a cooked-food market.
	m.fill(0, 24, w, h-24, "pavement")
	m.fill(0, 40, w, 3, "road")
	m.fill(0, 41, w, 1, "road_line")
	for _, x := range []int{2, 16, 44} {
		m.tower(x, 26, 12, 6)
	}
	m.fill(30, 28, 10, 8, "plaza")
	m.fill(32, 30, 6, 1, "awning")
	m.fill(32, 31, 6, 2, "shop_front")
	m.fill(0, 36, w, 2, "grass")
	m.put(51, 39, "station_sign")
	m.obj("stop_lion_station", "stop", 52, 39, map[string]string{"stop_id": "lion_station"})
	m.obj("lion_ridge_trail", "spot", 40, 10, map[string]string{"spot_id": "lion_ridge_trail"})
	m.obj("estate_playground", "spot", 26, 37, map[string]string{"spot_id": "estate_playground"})
	m.obj("estate_shop", "shop", 35, 32, map[string]string{"title": "Cooked Food Market", "shop_id": "estate_market"})
	m.obj("estate_grandpa", "npc", 28, 34, map[string]string{"npc_id": "estate_grandpa", "sprite": "char_estate_grandpa"})
	m.obj("ridge_hiker", "npc", 34, 15, map[string]string{"npc_id": "ridge_hiker", "sprite": "char_ridge_hiker"})
	m.obj("ridge_kites", "bird", 20, 8, map[string]string{"species": "black_kite", "count": "1"})
	m.obj("lion_zombie", "enemy", 50, 8, map[string]string{"enemy_id": "hopping_zombie"})
	m.obj("feather_ridge", "collectible", 8, 12, map[string]string{"item": "feather"})
	return m
}

// borderFields is wet farmland by the border river and an old walled
// village, east of Lion Ridge.
func borderFields() *tmap {
	const w, h = 64, 56
	m := newMap(w, h)
	m.area(0, 30, "long_valley")
	m.area(30, h, "walled_village")
	m.fill(0, 0, w, 6, "water")
	m.fill(0, 6, w, 2, "reeds")
	m.fill(0, 8, w, h-8, "grass")
	// Fields: wet plots, dry plots and bunds between them.
	for py := range 3 {
		for px := range 5 {
			kind := []string{"water", "mud", "tall_grass", "grass_flowers"}[(px+py)%4]
			m.fill(2+px*12, 10+py*6, 10, 4, kind)
		}
	}
	for py := range 4 {
		m.fill(0, 9+py*6, w, 1, "trail")
	}
	// The walled village: a square wall with a gate, houses inside.
	m.fill(14, 32, 36, 1, "village_wall")
	m.fill(14, 50, 36, 1, "village_wall")
	m.fill(14, 32, 1, 19, "village_wall")
	m.fill(49, 32, 1, 19, "village_wall")
	m.fill(30, 32, 4, 1, "pavement")
	m.fill(15, 33, 34, 17, "pavement")
	for _, y := range []int{35, 41} {
		for _, x := range []int{17, 26, 37} {
			m.fill(x, y, 7, 1, "village_roof")
			m.fill(x, y+1, 7, 2, "village_wall")
		}
	}
	m.fill(0, 29, w, 2, "trail")
	m.put(5, 28, "station_sign")
	m.obj("stop_border_station", "stop", 6, 28, map[string]string{"stop_id": "border_station"})
	m.obj("long_valley_fields", "spot", 30, 16, map[string]string{"spot_id": "long_valley_fields"})
	m.obj("village_fengshui_wood", "spot", 56, 44, map[string]string{"spot_id": "village_fengshui_wood"})
	for i := range 10 {
		m.tree(52+int(hash(i, 71)%11), 36+int(hash(i, 72)%16))
	}
	m.obj("farmer", "npc", 26, 9, map[string]string{"npc_id": "farmer", "sprite": "char_farmer"})
	m.obj("village_elder", "npc", 32, 39, map[string]string{"npc_id": "village_elder", "sprite": "char_village_elder"})
	m.obj("field_snipe", "bird", 18, 22, map[string]string{"species": "cattle_egret", "count": "3"})
	m.obj("field_dogs", "enemy", 44, 20, map[string]string{"enemy_id": "stray_dog_pack"})
	m.obj("sheet_village", "collectible", 46, 47, map[string]string{"song": "harbour_lights"})
	return m
}

// lanternIsland is a big hilly island east of Sai Kung: a tea plateau on
// top and a stilt-house fishing village on the shore (ferry from Sai Kung).
func lanternIsland() *tmap {
	const w, h = 96, 64
	m := newMap(w, h)
	m.area(0, 32, "tea_plateau")
	m.area(32, h, "stilt_village")
	m.fill(0, 0, w, h, "water")
	m.fill(12, 4, 76, 30, "hill_grass")
	// Tea terraces in rows.
	for y := 8; y < 26; y += 3 {
		m.fill(20, y, 40, 1, "tall_grass")
	}
	for i := range 30 {
		m.tree(62+int(hash(i, 81)%24), 6+int(hash(i, 82)%24))
	}
	m.fill(46, 4, 3, 40, "trail")
	m.fill(14, 28, 70, 2, "trail")
	// The stilt village: houses on piers over the creek.
	m.fill(8, 34, 80, 8, "sand")
	for _, x := range []int{10, 22, 34, 58, 70} {
		m.fill(x, 44, 8, 6, "pier")
		m.fill(x, 44, 8, 1, "village_roof")
		m.fill(x, 45, 8, 2, "village_wall")
	}
	m.fill(8, 42, 80, 2, "boardwalk")
	m.fill(46, 42, 3, 14, "pier")
	m.put(40, 52, "boat")
	m.obj("stop_lantern_pier", "stop", 47, 43, map[string]string{"stop_id": "lantern_pier"})
	m.obj("tea_terraces", "spot", 36, 18, map[string]string{"spot_id": "tea_terraces"})
	m.obj("stilt_creek", "spot", 30, 41, map[string]string{"spot_id": "stilt_creek"})
	m.obj("tea_picker", "npc", 40, 12, map[string]string{"npc_id": "tea_picker", "sprite": "char_tea_picker"})
	m.obj("stilt_grandma", "npc", 52, 42, map[string]string{"npc_id": "stilt_grandma", "sprite": "char_stilt_grandma"})
	m.obj("tea_bulbuls", "bird", 30, 10, map[string]string{"species": "chestnut_bulbul", "count": "2"})
	m.obj("creek_herons", "bird", 64, 38, map[string]string{"species": "pacific_reef_heron", "count": "1"})
	m.obj("tea_zombie", "enemy", 70, 20, map[string]string{"enemy_id": "hopping_zombie"})
	m.obj("feather_tea", "collectible", 24, 26, map[string]string{"item": "feather"})
	m.obj("part_stilt", "collectible", 80, 40, map[string]string{"item": "camera_part"})
	return m
}
