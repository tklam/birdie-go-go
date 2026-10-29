package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"birdiegogo/core/model"
)

type options struct {
	atlas      string // tileset name for visual layers
	atlasAsset string // manifest id of the atlas image
	fillTile   string // atlas tile name used for absent chunks
	blendTiles int    // weather blend band in tiles
}

// tiledWorld is the subset of Tiled's .world format we read.
type tiledWorld struct {
	Type string `json:"type"`
	Maps []struct {
		FileName string `json:"fileName"`
		X        int    `json:"x"`
		Y        int    `json:"y"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
	} `json:"maps"`
}

type tiledProperty struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

type tiledMap struct {
	Width, Height int
	TileWidth     int `json:"tilewidth"`
	Tilesets      []struct {
		FirstGID int    `json:"firstgid"`
		Source   string `json:"source"`
	} `json:"tilesets"`
	Layers []struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Data    []int  `json:"data"`
		Objects []struct {
			Name       string          `json:"name"`
			Type       string          `json:"type"`
			Class      string          `json:"class"`
			X          float64         `json:"x"`
			Y          float64         `json:"y"`
			Properties []tiledProperty `json:"properties"`
		} `json:"objects"`
	} `json:"layers"`
}

type tiledTileset struct {
	Name      string `json:"name"`
	TileCount int    `json:"tilecount"`
	Tiles     []struct {
		ID         int             `json:"id"`
		Properties []tiledProperty `json:"properties"`
	} `json:"tiles"`
}

// tileRef is what a global tile id resolves to.
type tileRef struct {
	tileset string
	local   int
	props   map[string]string
}

// chunk holds one chunk's data while building.
type chunk struct {
	ground, detail, overhead [chunkArea]uint16
	collision, area          [chunkArea]uint8
	// blend holds, per 4×4-tile cell, up to three (area, weight/255) pairs.
	blend   [cellsPerChunk * cellsPerChunk][blendSlots][2]uint8
	objects []model.WorldObject
}

func newChunk() *chunk {
	c := &chunk{objects: []model.WorldObject{}}
	for i := range c.area {
		c.area[i] = noArea
	}
	return c
}

// builder accumulates chunks across all maps of the world.
type builder struct {
	opts   options
	chunks map[[2]int]*chunk
	areas  map[string]int
	spawns map[string]model.Point
	stops  map[string]model.Point
	fill   int
	names  []string
}

func run(worldPath, outDir string, opts options) error {
	data, err := os.ReadFile(worldPath)
	if err != nil {
		return err
	}
	var w tiledWorld
	if err := json.Unmarshal(data, &w); err != nil {
		return fmt.Errorf("%s: %w", worldPath, err)
	}
	if strings.HasSuffix(worldPath, ".tmj") {
		// A single map (e.g. an interior) is a world of one map at 0,0.
		var m tiledMap
		if err := json.Unmarshal(data, &m); err != nil {
			return fmt.Errorf("%s: %w", worldPath, err)
		}
		w = singleMapWorld(filepath.Base(worldPath), m)
	}
	index, err := buildIndex(w)
	if err != nil {
		return fmt.Errorf("%s: %w", worldPath, err)
	}
	b := &builder{opts: opts, chunks: map[[2]int]*chunk{}, areas: map[string]int{}, spawns: map[string]model.Point{}, stops: map[string]model.Point{}}
	for _, m := range w.Maps {
		path := filepath.Join(filepath.Dir(worldPath), m.FileName)
		if err := b.addMap(path, m.X, m.Y); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	}
	b.blendField(index.WidthChunks, index.HeightChunks, opts.blendTiles)
	if len(w.Maps) > 0 && b.fill == 0 {
		return fmt.Errorf("fill tile %q not found in tileset %q", opts.fillTile, opts.atlas)
	}
	return b.write(index, outDir)
}

func singleMapWorld(file string, m tiledMap) tiledWorld {
	w := tiledWorld{Type: "world"}
	w.Maps = append(w.Maps, struct {
		FileName string `json:"fileName"`
		X        int    `json:"x"`
		Y        int    `json:"y"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
	}{FileName: file, Width: m.Width * m.TileWidth, Height: m.Height * m.TileWidth})
	return w
}

// buildIndex validates map placement and computes the world size.
func buildIndex(w tiledWorld) (model.WorldIndex, error) {
	if w.Type != "world" {
		return model.WorldIndex{}, fmt.Errorf("type is %q, want \"world\"", w.Type)
	}
	index := model.WorldIndex{TileSize: tileSize, ChunkTiles: chunkTiles, Regions: []model.WorldRegion{}}
	const chunkPx = tileSize * chunkTiles
	var maxX, maxY int
	for _, m := range w.Maps {
		if m.X < 0 || m.Y < 0 {
			return index, fmt.Errorf("%s: negative world position; keep all maps at x, y ≥ 0", m.FileName)
		}
		if m.X%tileSize != 0 || m.Y%tileSize != 0 || m.Width%tileSize != 0 || m.Height%tileSize != 0 {
			return index, fmt.Errorf("%s: position and size must be multiples of %d px", m.FileName, tileSize)
		}
		if m.Width == 0 || m.Height == 0 {
			return index, errors.New(m.FileName + ": empty map")
		}
		index.Regions = append(index.Regions, model.WorldRegion{File: m.FileName, X: m.X, Y: m.Y, Width: m.Width, Height: m.Height})
		maxX = max(maxX, m.X+m.Width)
		maxY = max(maxY, m.Y+m.Height)
	}
	index.WidthChunks = ceilDiv(maxX, chunkPx)
	index.HeightChunks = ceilDiv(maxY, chunkPx)
	return index, nil
}

func ceilDiv(a, b int) int { return (a + b - 1) / b }

func (b *builder) addMap(path string, ox, oy int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var m tiledMap
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	if m.TileWidth != tileSize {
		return fmt.Errorf("tile width %d, want %d", m.TileWidth, tileSize)
	}
	gids, err := b.resolveTilesets(filepath.Dir(path), m)
	if err != nil {
		return err
	}
	baseX, baseY := ox/tileSize, oy/tileSize
	for _, l := range m.Layers {
		switch l.Type {
		case "tilelayer":
			if len(l.Data) != m.Width*m.Height {
				return fmt.Errorf("layer %s: %d tiles, want %d (export uncompressed CSV/array data)", l.Name, len(l.Data), m.Width*m.Height)
			}
			for i, gid := range l.Data {
				if gid == 0 {
					continue
				}
				ref, ok := gids[gid&0x1fffffff]
				if !ok {
					return fmt.Errorf("layer %s: unknown tile gid %d", l.Name, gid)
				}
				if gid&^0x1fffffff != 0 {
					return fmt.Errorf("layer %s: flipped/rotated tiles aren't supported", l.Name)
				}
				if err := b.setTile(l.Name, baseX+i%m.Width, baseY+i/m.Width, ref); err != nil {
					return err
				}
			}
		case "objectgroup":
			for _, o := range l.Objects {
				typ := o.Type
				if typ == "" {
					typ = o.Class
				}
				obj := model.WorldObject{Name: o.Name, Type: typ, X: float64(ox) + o.X, Y: float64(oy) + o.Y, Props: map[string]string{}}
				for _, p := range o.Properties {
					obj.Props[p.Name] = fmt.Sprint(p.Value)
				}
				if typ == "spawn" {
					if _, dup := b.spawns[o.Name]; dup {
						return fmt.Errorf("duplicate spawn %q", o.Name)
					}
					b.spawns[o.Name] = model.Point{X: obj.X, Y: obj.Y}
				}
				if typ == "stop" && obj.Props["stop_id"] != "" {
					b.stops[obj.Props["stop_id"]] = model.Point{X: obj.X, Y: obj.Y}
				}
				tx, ty := int(obj.X)/tileSize, int(obj.Y)/tileSize
				c := b.chunk(tx/chunkTiles, ty/chunkTiles)
				c.objects = append(c.objects, obj)
			}
		}
	}
	return nil
}

func (b *builder) resolveTilesets(dir string, m tiledMap) (map[int]tileRef, error) {
	gids := map[int]tileRef{}
	for _, ts := range m.Tilesets {
		if ts.Source == "" {
			return nil, errors.New("embedded tilesets aren't supported; save tilesets as external .tsj files")
		}
		data, err := os.ReadFile(filepath.Join(dir, ts.Source))
		if err != nil {
			return nil, err
		}
		var t tiledTileset
		if err := json.Unmarshal(data, &t); err != nil {
			return nil, fmt.Errorf("%s: %w", ts.Source, err)
		}
		props := map[int]map[string]string{}
		for _, tile := range t.Tiles {
			props[tile.ID] = map[string]string{}
			for _, p := range tile.Properties {
				props[tile.ID][p.Name] = fmt.Sprint(p.Value)
			}
		}
		for local := range t.TileCount {
			ref := tileRef{tileset: t.Name, local: local, props: props[local]}
			gids[ts.FirstGID+local] = ref
			if t.Name == b.opts.atlas {
				if ref.props["name"] == b.opts.fillTile {
					b.fill = local + 1
				}
				if len(b.names) < t.TileCount {
					b.names = make([]string, t.TileCount)
				}
				b.names[local] = ref.props["name"]
			}
		}
	}
	return gids, nil
}

func (b *builder) chunk(cx, cy int) *chunk {
	key := [2]int{cx, cy}
	c, ok := b.chunks[key]
	if !ok {
		c = newChunk()
		b.chunks[key] = c
	}
	return c
}

func (b *builder) setTile(layer string, tx, ty int, ref tileRef) error {
	c := b.chunk(tx/chunkTiles, ty/chunkTiles)
	i := (ty%chunkTiles)*chunkTiles + tx%chunkTiles
	visual := func(dst *[chunkArea]uint16) error {
		if ref.tileset != b.opts.atlas {
			return fmt.Errorf("layer %s at (%d,%d): tile from tileset %q; visual layers must use %q", layer, tx, ty, ref.tileset, b.opts.atlas)
		}
		dst[i] = uint16(ref.local + 1)
		return nil
	}
	switch layer {
	case "ground":
		return visual(&c.ground)
	case "detail":
		return visual(&c.detail)
	case "overhead":
		return visual(&c.overhead)
	case "collision":
		switch ref.props["collision"] {
		case "solid":
			c.collision[i] = model.CollisionSolid
		case "ledge_south":
			c.collision[i] = model.CollisionLedgeSouth
		default:
			return fmt.Errorf("collision layer at (%d,%d): tile has no collision property", tx, ty)
		}
	case "areas":
		id := ref.props["area"]
		if id == "" {
			return fmt.Errorf("areas layer at (%d,%d): tile has no area property", tx, ty)
		}
		n, ok := b.areas[id]
		if !ok {
			n = len(b.areas)
			if n >= noArea {
				return errors.New("too many areas (max 255)")
			}
			b.areas[id] = n
		}
		c.area[i] = uint8(n)
	default:
		return fmt.Errorf("unknown tile layer %q (want ground, detail, overhead, collision or areas)", layer)
	}
	return nil
}

// write emits the chunk files and index, replacing any previous build.
func (b *builder) write(index model.WorldIndex, outDir string) error {
	chunkDir := filepath.Join(outDir, "chunks")
	if err := os.RemoveAll(chunkDir); err != nil {
		return err
	}
	if err := os.MkdirAll(chunkDir, 0o755); err != nil {
		return err
	}
	index.Tileset = b.opts.atlasAsset
	index.Fill = model.WorldFill{Ground: b.fill, Collision: model.CollisionSolid}
	index.Chunks = map[string]string{}
	index.Spawns = b.spawns
	index.Stops = b.stops
	index.TileNames = b.names
	if index.TileNames == nil {
		index.TileNames = []string{}
	}
	index.AreaCenters = b.areaCenters()
	index.Areas = make([]string, len(b.areas))
	for id, n := range b.areas {
		index.Areas[n] = id
	}
	keys := make([][2]int, 0, len(b.chunks))
	for k := range b.chunks {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return keys[i][1] < keys[j][1] || keys[i][1] == keys[j][1] && keys[i][0] < keys[j][0]
	})
	for _, k := range keys {
		data, err := encodeChunk(k[0], k[1], b.chunks[k])
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		name := hex.EncodeToString(sum[:8]) + ".bin"
		if err := os.WriteFile(filepath.Join(chunkDir, name), data, 0o644); err != nil {
			return err
		}
		index.Chunks[fmt.Sprintf("%d,%d", k[0], k[1])] = name
	}
	out, err := json.Marshal(index)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "index.json"), out, 0o644)
}

func encodeChunk(cx, cy int, c *chunk) ([]byte, error) {
	var raw bytes.Buffer
	raw.WriteString("BGC2")
	le := binary.LittleEndian
	for _, v := range []any{uint16(cx), uint16(cy), c.ground, c.detail, c.overhead, c.collision, c.area, c.blend} {
		if err := binary.Write(&raw, le, v); err != nil {
			return nil, err
		}
	}
	objs, err := json.Marshal(c.objects)
	if err != nil {
		return nil, err
	}
	if err := binary.Write(&raw, le, uint32(len(objs))); err != nil {
		return nil, err
	}
	raw.Write(objs)

	var gz bytes.Buffer
	zw, err := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(raw.Bytes()); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return gz.Bytes(), nil
}
