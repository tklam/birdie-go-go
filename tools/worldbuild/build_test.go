package main

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"birdiegogo/core/model"
)

// writeTestWorld writes a 40×2-tile map (spanning two chunks horizontally)
// with an atlas tileset of 2 tiles ("grass", "water") and a meta tileset.
func writeTestWorld(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(name string, v any) {
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	prop := func(name, value string) []map[string]any {
		return []map[string]any{{"name": name, "type": "string", "value": value}}
	}
	write("atlas.tsj", map[string]any{"name": "tko", "tilecount": 2, "tiles": []map[string]any{
		{"id": 0, "properties": prop("name", "grass")}, {"id": 1, "properties": prop("name", "water")},
	}})
	write("meta.tsj", map[string]any{"name": "meta", "tilecount": 3, "tiles": []map[string]any{
		{"id": 0, "properties": prop("collision", "solid")},
		{"id": 1, "properties": prop("collision", "ledge_south")},
		{"id": 2, "properties": prop("area", "town")},
	}})
	const w, h = 40, 2
	ground, collision, areas := make([]int, w*h), make([]int, w*h), make([]int, w*h)
	for i := range ground {
		ground[i] = 1 // grass
		areas[i] = 5  // area "town"
	}
	ground[35] = 2    // water at (35, 0)
	collision[35] = 3 // solid
	collision[1] = 4  // ledge at (1, 0)
	layer := func(name string, data []int) map[string]any {
		return map[string]any{"name": name, "type": "tilelayer", "data": data}
	}
	write("m.tmj", map[string]any{
		"width": w, "height": h, "tilewidth": 16,
		"tilesets": []map[string]any{{"firstgid": 1, "source": "atlas.tsj"}, {"firstgid": 3, "source": "meta.tsj"}},
		"layers": []map[string]any{
			layer("ground", ground), layer("collision", collision), layer("areas", areas),
			{"name": "objects", "type": "objectgroup", "objects": []map[string]any{
				{"name": "start", "type": "spawn", "x": 600, "y": 8},
				{"name": "p", "type": "spot", "x": 24, "y": 8, "properties": prop("spot_id", "park")},
			}},
		},
	})
	write("city.world", map[string]any{"type": "world", "maps": []map[string]any{
		{"fileName": "m.tmj", "x": 0, "y": 0, "width": w * 16, "height": h * 16},
	}})
	return dir
}

type decoded struct {
	cx, cy                   uint16
	ground, detail, overhead [chunkArea]uint16
	collision, area          [chunkArea]uint8
	blend                    [cellsPerChunk * cellsPerChunk][blendSlots][2]uint8
	objects                  []model.WorldObject
}

func decode(t *testing.T, path string) decoded {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw[:4]) != "BGC2" {
		t.Fatalf("magic = %q", raw[:4])
	}
	r := bytes.NewReader(raw[4:])
	var d decoded
	for _, v := range []any{&d.cx, &d.cy, &d.ground, &d.detail, &d.overhead, &d.collision, &d.area, &d.blend} {
		if err := binary.Read(r, binary.LittleEndian, v); err != nil {
			t.Fatal(err)
		}
	}
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		t.Fatal(err)
	}
	objs := make([]byte, n)
	if _, err := io.ReadFull(r, objs); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(objs, &d.objects); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestRunBuildsChunks(t *testing.T) {
	dir := writeTestWorld(t)
	out := filepath.Join(dir, "out")
	if err := run(filepath.Join(dir, "city.world"), out, options{atlas: "tko", atlasAsset: "tiles_tko", fillTile: "water", blendTiles: 8}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(out, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	var index model.WorldIndex
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatal(err)
	}
	if index.WidthChunks != 2 || index.HeightChunks != 1 || len(index.Chunks) != 2 {
		t.Fatalf("index = %+v", index)
	}
	if index.Fill.Ground != 2 || index.Tileset != "tiles_tko" {
		t.Errorf("fill/tileset = %+v %q", index.Fill, index.Tileset)
	}
	if len(index.TileNames) != 2 || index.TileNames[1] != "water" {
		t.Errorf("tileNames = %v", index.TileNames)
	}
	if len(index.Areas) != 1 || index.Areas[0] != "town" {
		t.Errorf("areas = %v", index.Areas)
	}
	if p := index.Spawns["start"]; p.X != 600 || p.Y != 8 {
		t.Errorf("spawn = %+v", p)
	}

	c0 := decode(t, filepath.Join(out, "chunks", index.Chunks["0,0"]))
	if c0.cx != 0 || c0.cy != 0 || c0.ground[0] != 1 || c0.collision[1] != model.CollisionLedgeSouth || c0.area[0] != 0 {
		t.Errorf("chunk 0,0: ground %d collision %d area %d", c0.ground[0], c0.collision[1], c0.area[0])
	}
	if c0.area[2*chunkTiles] != noArea {
		t.Error("tiles outside the map should have no area")
	}
	// Row 2 is outside the 2-row map: filled and solid so nobody walks off the edge.
	if c0.collision[2*chunkTiles] != model.CollisionSolid || c0.ground[2*chunkTiles] != 2 {
		t.Errorf("uncovered tile: collision %d ground %d", c0.collision[2*chunkTiles], c0.ground[2*chunkTiles])
	}
	if len(c0.objects) != 1 || c0.objects[0].Props["spot_id"] != "park" {
		t.Errorf("chunk 0,0 objects = %+v", c0.objects)
	}
	c1 := decode(t, filepath.Join(out, "chunks", index.Chunks["1,0"]))
	// Tile (35, 0) is local (3, 0) in chunk 1,0.
	if c1.ground[3] != 2 || c1.collision[3] != model.CollisionSolid {
		t.Errorf("chunk 1,0: ground %d collision %d", c1.ground[3], c1.collision[3])
	}
	if len(c1.objects) != 1 || c1.objects[0].Name != "start" {
		t.Errorf("chunk 1,0 objects = %+v", c1.objects)
	}
}

func TestRunBuildsSingleMap(t *testing.T) {
	dir := writeTestWorld(t)
	out := filepath.Join(dir, "single")
	if err := run(filepath.Join(dir, "m.tmj"), out, options{atlas: "tko", atlasAsset: "tiles_tko", fillTile: "water", blendTiles: 8}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(out, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	var index model.WorldIndex
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatal(err)
	}
	if index.WidthChunks != 2 || len(index.Chunks) != 2 || index.Spawns["start"].X != 600 {
		t.Errorf("index = %+v", index)
	}
}

func TestRunRejectsForeignTilesetOnVisualLayer(t *testing.T) {
	dir := writeTestWorld(t)
	path := filepath.Join(dir, "m.tmj")
	data, _ := os.ReadFile(path)
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	ground := m["layers"].([]any)[0].(map[string]any)["data"].([]any)
	ground[0] = 3 // a meta tile on the ground layer
	data, _ = json.Marshal(m)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	err := run(filepath.Join(dir, "city.world"), filepath.Join(dir, "out"), options{atlas: "tko", atlasAsset: "tiles_tko", fillTile: "water", blendTiles: 8})
	if err == nil {
		t.Fatal("expected an error")
	}
}
