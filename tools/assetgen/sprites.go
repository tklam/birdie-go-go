package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// copyIfExists copies src to dst and reports whether src existed.
func copyIfExists(src, dst string) (bool, error) {
	data, err := os.ReadFile(src)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return false, err
	}
	return true, os.WriteFile(dst, data, 0o644)
}

// fileExists reports whether a file exists.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// Directions in character sheets, one per row (developer_guide.md §6).
const (
	dirDown = iota
	dirLeft
	dirRight
	dirUp
)

// genOBoy writes O Boy's 8×8 overworld sheet: idle, hop.
func genOBoy(assets string) error {
	c := newCanvas(2*8, 8)
	for f := range 2 {
		k := c.cell(f*8, 0)
		dy := 0
		if f == 1 {
			dy = -1
		}
		k.ellipse(1, 2+dy, 6, 5, cTeal)
		k.rect(1, 4+dy, 3, 2, cDarkTeal)
		k.rect(2, 5+dy, 2, 1, cBlue)
		k.set(5, 3+dy, cBlack)
		k.set(7, 4+dy, cSkin)
		k.set(3, 7, cSkin)
		k.set(5, 7, cSkin)
	}
	return c.save(filepath.Join(assets, "chars", "oboy.png"))
}

// birdLook describes a species' placeholder colors.
type birdLook struct {
	id                      string
	back, belly, head, wing uint8
	accent, beak, legs      uint8
	accentAt                [2]int // cheek patch offset from head origin
	longNeck                bool
}

var birdLooks = []birdLook{
	{id: "red_whiskered_bulbul", back: cBrown, belly: cWhite, head: cBlack, wing: cDarkBrown,
		accent: cRed, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "oriental_magpie_robin", back: cBlack, belly: cWhite, head: cBlack, wing: cWhite,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "pacific_parrotlet", back: cTeal, belly: cPaleGreen, head: cTeal, wing: cDarkTeal,
		accent: cBlue, beak: cSkin, legs: cSkin, accentAt: [2]int{1, 2}},
	{id: "little_egret", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cBlack, legs: cBlack, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "eurasian_tree_sparrow", back: cBrown, belly: cLightGray, head: cChestnut, wing: cDarkBrown,
		accent: cBlack, beak: cDarkGray, legs: cSkinShadow, accentAt: [2]int{3, 4}},
	{id: "spotted_dove", back: cTan, belly: cSkinShadow, head: cGray, wing: cBrown,
		accent: cBlack, beak: cDarkGray, legs: cRed, accentAt: [2]int{1, 4}},
	{id: "swinhoes_white_eye", back: cOlive, belly: cYellowGreen, head: cYellowGreen, wing: cOlive,
		accent: cWhite, beak: cDarkGray, legs: cGray, accentAt: [2]int{4, 2}},
	{id: "black_collared_starling", back: cDarkGray, belly: cWhite, head: cWhite, wing: cBlack,
		accent: cBlack, beak: cBlack, legs: cSand, accentAt: [2]int{3, 5}},
	{id: "crested_myna", back: cBlack, belly: cDarkGray, head: cBlack, wing: cDarkGray,
		accent: cWhite, beak: cYellow, legs: cOrange, accentAt: [2]int{2, 0}},
	{id: "light_vented_bulbul", back: cOlive, belly: cLightGray, head: cBlack, wing: cYellowGreen,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{1, 1}},
	{id: "masked_laughingthrush", back: cTan, belly: cSand, head: cBlack, wing: cBrown,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{4, 2}},
	{id: "asian_koel", back: cBlack, belly: cNavy, head: cBlack, wing: cNavy,
		accent: cRed, beak: cPaleGreen, legs: cDarkGray, accentAt: [2]int{5, 2}},
	{id: "long_tailed_shrike", back: cGray, belly: cOrange, head: cBlack, wing: cBlack,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 3}},
	{id: "bull_headed_shrike", back: cChestnut, belly: cSand, head: cChestnut, wing: cDarkBrown,
		accent: cBlack, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 3}},
	{id: "fork_tailed_sunbird", back: cOlive, belly: cYellowGreen, head: cDarkTeal, wing: cOlive,
		accent: cRed, beak: cBlack, legs: cDarkGray, accentAt: [2]int{2, 5}},
	{id: "common_tailorbird", back: cOlive, belly: cWhite, head: cChestnut, wing: cYellowGreen,
		accent: cChestnut, beak: cDarkGray, legs: cSkinShadow, accentAt: [2]int{1, 0}},
	{id: "yellow_crested_cockatoo", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cBlack, legs: cDarkGray, accentAt: [2]int{1, -1}},
	{id: "common_kingfisher", back: cTeal, belly: cOrange, head: cBlue, wing: cDarkTeal,
		accent: cWhite, beak: cBlack, legs: cRed, accentAt: [2]int{3, 5}},
	{id: "white_throated_kingfisher", back: cBlue, belly: cChestnut, head: cChestnut, wing: cBlue,
		accent: cWhite, beak: cRed, legs: cRed, accentAt: [2]int{3, 5}},
	{id: "chinese_pond_heron", back: cSand, belly: cWhite, head: cChestnut, wing: cWhite,
		accent: cYellow, beak: cYellow, legs: cYellow, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "great_egret", back: cWhite, belly: cWhite, head: cWhite, wing: cLightGray,
		accent: cYellow, beak: cYellow, legs: cBlack, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "pacific_reef_heron", back: cDarkGray, belly: cDarkGray, head: cDarkGray, wing: cGray,
		accent: cSand, beak: cSand, legs: cYellow, accentAt: [2]int{4, 2}, longNeck: true},
	{id: "blue_rock_thrush", back: cNavy, belly: cChestnut, head: cNavy, wing: cDarkGray,
		accent: cBlue, beak: cBlack, legs: cBlack, accentAt: [2]int{3, 4}},
	{id: "black_kite", back: cBrown, belly: cTan, head: cTan, wing: cDarkBrown,
		accent: cDarkBrown, beak: cBlack, legs: cYellow, accentAt: [2]int{4, 2}},
	{id: "black_crowned_night_heron", back: cConcrete, belly: cAsphalt, head: cDarkGray, wing: cDarkGray,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "black_faced_spoonbill", back: cWhite, belly: cAsphalt, head: cConcrete, wing: cConcrete,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "common_moorhen", back: cDarkConcrete, belly: cAsphalt, head: cDarkConcrete, wing: cDarkBrown,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "grey_heron", back: cAsphalt, belly: cDarkGray, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "cattle_egret", back: cWhite, belly: cConcrete, head: cWhite, wing: cRoadLine,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "striated_heron", back: cLightGray, belly: cAsphalt, head: cWhite, wing: cWhite,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "great_cormorant", back: cAsphalt, belly: cDarkBrown, head: cDarkGray, wing: cDarkConcrete,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "common_greenshank", back: cGray, belly: cAsphalt, head: cWhite, wing: cWhite,
		accent: cLightGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "common_sandpiper", back: cDarkBrown, belly: cWhite, head: cDarkBrown, wing: cDarkConcrete,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "eurasian_curlew", back: cDarkBrown, belly: cDarkConcrete, head: cDarkConcrete, wing: cRoadLine,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "kentish_plover", back: cBrown, belly: cRoadLine, head: cBrown, wing: cDarkBrown,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "little_grebe", back: cDarkBrown, belly: cBrown, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "northern_pintail", back: cRoadLine, belly: cBrown, head: cBrown, wing: cTan,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "pied_kingfisher", back: cLightGray, belly: cAsphalt, head: cGray, wing: cWhite,
		accent: cDarkGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "tufted_duck", back: cDarkConcrete, belly: cAsphalt, head: cDarkConcrete, wing: cConcrete,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "white_bellied_sea_eagle", back: cDarkConcrete, belly: cConcrete, head: cWhite, wing: cDarkBrown,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "peregrine_falcon", back: cConcrete, belly: cDarkConcrete, head: cDarkConcrete, wing: cAsphalt,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "rock_dove", back: cLightGray, belly: cAsphalt, head: cDarkConcrete, wing: cGray,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "collared_scops_owl", back: cBrown, belly: cDarkConcrete, head: cRoadLine, wing: cDarkBrown,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "red_rumped_swallow", back: cGray, belly: cAsphalt, head: cRoadLine, wing: cDarkConcrete,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "olive_backed_pipit", back: cDarkConcrete, belly: cAsphalt, head: cWhite, wing: cWhite,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "large_billed_crow", back: cLightGray, belly: cGray, head: cAsphalt, wing: cAsphalt,
		accent: cDarkGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "grey_treepie", back: cConcrete, belly: cDarkConcrete, head: cWhite, wing: cRoadLine,
		accent: cSand, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "daurian_redstart", back: cDarkConcrete, belly: cAsphalt, head: cDarkConcrete, wing: cConcrete,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "hwamei", back: cTan, belly: cDarkBrown, head: cWhite, wing: cBrown,
		accent: cSand, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "red_billed_starling", back: cConcrete, belly: cAsphalt, head: cConcrete, wing: cRoadLine,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "scarlet_backed_flowerpecker", back: cWhite, belly: cSand, head: cDarkGray, wing: cConcrete,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "sooty_headed_bulbul", back: cChestnut, belly: cDarkBrown, head: cDarkBrown, wing: cBrown,
		accent: cSand, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "asian_brown_flycatcher", back: cGray, belly: cLightGray, head: cWhite, wing: cWhite,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "rose_ringed_parakeet", back: cGreen, belly: cDarkGreen, head: cPaleGreen, wing: cPaleGreen,
		accent: cLightGreen, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "yellow_bellied_prinia", back: cDarkConcrete, belly: cYellow, head: cAsphalt, wing: cOlive,
		accent: cBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "chinese_grosbeak", back: cDarkConcrete, belly: cWhite, head: cRoadLine, wing: cConcrete,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "white_rumped_munia", back: cDarkConcrete, belly: cAsphalt, head: cDarkConcrete, wing: cGray,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "black_winged_stilt", back: cWhite, belly: cDarkConcrete, head: cWhite, wing: cLightGray,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "common_redshank", back: cSkin, belly: cSkinShadow, head: cSkinShadow, wing: cTan,
		accent: cBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "whimbrel", back: cRoadLine, belly: cDarkBrown, head: cConcrete, wing: cConcrete,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "black_capped_kingfisher", back: cWhite, belly: cBrown, head: cWhite, wing: cConcrete,
		accent: cChestnut, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "northern_shoveler", back: cRoadLine, belly: cDarkBrown, head: cAsphalt, wing: cAsphalt,
		accent: cBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "black_headed_gull", back: cLightGray, belly: cDarkConcrete, head: cWhite, wing: cWhite,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "osprey", back: cDarkConcrete, belly: cAsphalt, head: cAsphalt, wing: cDarkBrown,
		accent: cDarkGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "common_kestrel", back: cSkin, belly: cDarkBrown, head: cSkin, wing: cSkinShadow,
		accent: cTan, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "oriental_turtle_dove", back: cDarkConcrete, belly: cGray, head: cWhite, wing: cLightGray,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "asian_barred_owlet", back: cBrown, belly: cDarkConcrete, head: cDarkConcrete, wing: cSkinShadow,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "white_wagtail", back: cAsphalt, belly: cDarkConcrete, head: cWhite, wing: cWhite,
		accent: cDarkGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "collared_crow", back: cAsphalt, belly: cWhite, head: cAsphalt, wing: cDarkGray,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "common_myna", back: cDarkConcrete, belly: cAsphalt, head: cAsphalt, wing: cConcrete,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "japanese_tit", back: cWhite, belly: cRoadLine, head: cGray, wing: cDarkBrown,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "red_flanked_bluetail", back: cAsphalt, belly: cSand, head: cAsphalt, wing: cGray,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "blue_whistling_thrush", back: cNavy, belly: cDarkGray, head: cDarkGray, wing: cSea,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "red_billed_leiothrix", back: cDarkConcrete, belly: cAsphalt, head: cRoadLine, wing: cDarkBrown,
		accent: cOlive, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "black_naped_monarch", back: cNavy, belly: cRoadLine, head: cSea, wing: cSea,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "great_barbet", back: cTan, belly: cDarkBrown, head: cAsphalt, wing: cAsphalt,
		accent: cBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "scaly_breasted_munia", back: cBrown, belly: cTan, head: cBrown, wing: cDarkBrown,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "velvet_fronted_nuthatch", back: cDarkConcrete, belly: cNavy, head: cAsphalt, wing: cSea,
		accent: cSand, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "white_breasted_waterhen", back: cNavy, belly: cDarkGray, head: cGray, wing: cGray,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "pied_avocet", back: cConcrete, belly: cDarkConcrete, head: cAsphalt, wing: cWhite,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "wood_sandpiper", back: cAsphalt, belly: cDarkBrown, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "black_tailed_godwit", back: cDarkBrown, belly: cBrown, head: cBrown, wing: cDarkConcrete,
		accent: cSkin, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "eurasian_wigeon", back: cDarkConcrete, belly: cSkinShadow, head: cDarkBrown, wing: cTan,
		accent: cBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "eastern_spot_billed_duck", back: cAsphalt, belly: cDarkBrown, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}, longNeck: true},
	{id: "whiskered_tern", back: cWhite, belly: cGray, head: cWhite, wing: cLightGray,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "crested_serpent_eagle", back: cDarkConcrete, belly: cAsphalt, head: cDarkConcrete, wing: cConcrete,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "crested_goshawk", back: cConcrete, belly: cRoadLine, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "greater_coucal", back: cLightGray, belly: cDarkBrown, head: cLightGray, wing: cAsphalt,
		accent: cDarkConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "barn_swallow", back: cNavy, belly: cSea, head: cNavy, wing: cPurple,
		accent: cDarkGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "grey_wagtail", back: cLightGray, belly: cWhite, head: cLightGray, wing: cAsphalt,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "hair_crested_drongo", back: cLightGray, belly: cGray, head: cGray, wing: cDarkGray,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "oriental_magpie", back: cAsphalt, belly: cDarkGray, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "white_cheeked_starling", back: cAsphalt, belly: cDarkBrown, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "chestnut_bulbul", back: cConcrete, belly: cDarkConcrete, head: cBrown, wing: cRoadLine,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "yellow_browed_warbler", back: cOlive, belly: cDarkBrown, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cSand, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "siberian_rubythroat", back: cDarkConcrete, belly: cConcrete, head: cAsphalt, wing: cAsphalt,
		accent: cGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "plain_prinia", back: cAsphalt, belly: cRoadLine, head: cWhite, wing: cDarkConcrete,
		accent: cConcrete, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "pale_thrush", back: cConcrete, belly: cWhite, head: cDarkConcrete, wing: cDarkConcrete,
		accent: cRoadLine, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "scarlet_minivet", back: cRed, belly: cChestnut, head: cAsphalt, wing: cOrange,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "black_faced_bunting", back: cDarkConcrete, belly: cOlive, head: cDarkConcrete, wing: cConcrete,
		accent: cWhite, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "chinese_blackbird", back: cDarkConcrete, belly: cDarkBrown, head: cDarkConcrete, wing: cBrown,
		accent: cAsphalt, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "little_ringed_plover", back: cGray, belly: cDarkConcrete, head: cConcrete, wing: cWhite,
		accent: cSkinShadow, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "pacific_golden_plover", back: cBrown, belly: cTan, head: cSand, wing: cSand,
		accent: cDarkBrown, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
	{id: "eurasian_hoopoe", back: cConcrete, belly: cWhite, head: cTan, wing: cDarkConcrete,
		accent: cLightGray, beak: cBlack, legs: cDarkGray, accentAt: [2]int{3, 4}},
}

// Photo-scene bird frames, in sheet order (32×32 each).
var birdFrames = []string{"perched", "perched_alert", "wings_spread", "flying1", "flying2", "back_turned"}

// photoBirds is where tools/birdphoto writes sheets made from real photos
// (art/birds/out/<id>.png and album_<id>.png). When a sheet exists there it
// replaces the drawn placeholder.
var photoBirds = filepath.Join("art", "birds", "out")

func genBirds(assets string) error {
	for _, b := range birdLooks {
		dst := filepath.Join(assets, "birds", b.id+".png")
		if ok, err := copyIfExists(filepath.Join(photoBirds, b.id+".png"), dst); err != nil {
			return err
		} else if !ok {
			sheet := newCanvas(len(birdFrames)*32, 32)
			for i, f := range birdFrames {
				drawBird(sheet.cell(i*32, 0), b, f)
			}
			if err := sheet.save(dst); err != nil {
				return err
			}
		}
		if _, err := copyIfExists(filepath.Join(photoBirds, "album_"+b.id+".png"), filepath.Join(assets, "birds", "album_"+b.id+".png")); err != nil {
			return err
		}
		ow := newCanvas(2*8, 8)
		for f := range 2 {
			drawOverworldBird(ow.cell(f*8, 0), b, f)
		}
		if err := ow.save(filepath.Join(assets, "birds", "ow_"+b.id+".png")); err != nil {
			return err
		}
	}
	return nil
}

func drawBird(k cell, b birdLook, frame string) {
	headX, headY := 20, 9
	bodyY := 14
	if frame == "perched_alert" {
		headY -= 2
	}
	if b.longNeck {
		headY -= 4
	}
	flying := frame == "flying1" || frame == "flying2"
	if flying {
		bodyY = 13
		headY = bodyY - 3
	}
	// Tail.
	k.rect(3, bodyY+4, 7, 3, b.back)
	// Legs.
	if !flying {
		legLen := 4
		if b.longNeck {
			legLen = 8
		}
		k.rect(13, bodyY+9, 1, legLen, b.legs)
		k.rect(17, bodyY+9, 1, legLen, b.legs)
	}
	// Body.
	k.ellipse(7, bodyY, 16, 10, b.back)
	k.ellipse(10, bodyY+4, 12, 6, b.belly)
	// Neck for long-necked birds.
	if b.longNeck && !flying {
		k.rect(headX+1, headY+4, 3, bodyY-headY-2, b.head)
	}
	// Head, eye, beak, accent.
	back := frame == "back_turned"
	k.ellipse(headX, headY, 8, 7, b.head)
	if !back {
		k.set(headX+5, headY+2, cWhite)
		k.set(headX+5, headY+3, cBlack)
		beakLen := 3
		if b.longNeck {
			beakLen = 6
		}
		k.rect(headX+8, headY+3, beakLen, 1, b.beak)
		k.rect(headX+b.accentAt[0], headY+b.accentAt[1], 2, 2, b.accent)
	} else {
		k.rect(headX-2, headY+3, 2, 1, b.beak)
	}
	// Wings.
	switch frame {
	case "wings_spread", "flying1":
		for i := range 8 {
			k.line(12+i, bodyY+2, 6+i, bodyY-8+i/2, b.wing)
		}
		k.line(6, bodyY-8, 13, bodyY-4, b.back)
	case "flying2":
		for i := range 8 {
			k.line(12+i, bodyY+5, 8+i, bodyY+13-i/3, b.wing)
		}
	default:
		k.ellipse(9, bodyY+1, 11, 6, b.wing)
	}
}

func drawOverworldBird(k cell, b birdLook, frame int) {
	dy := 0
	if frame == 1 {
		dy = -1
	}
	if b.longNeck {
		k.rect(3, 5, 1, 3, b.legs)
		k.ellipse(1, 3+dy, 5, 3, b.back)
		k.rect(5, 1+dy, 1, 3, b.head)
		k.set(6, 1+dy, b.beak)
		return
	}
	k.ellipse(1, 3+dy, 6, 4, b.back)
	k.rect(2, 5+dy, 3, 1, b.belly)
	k.set(5, 3+dy, b.head)
	k.set(5, 4+dy, b.accent)
	k.set(7, 4+dy, b.beak)
	k.set(3, 7, b.legs)
}
