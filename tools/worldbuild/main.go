// Command worldbuild turns the Tiled world (content/world/city.world) into the
// streamed overworld the client loads.
//
//	go run ./tools/worldbuild -world content/world/city.world -out web/public/world
//
// For now it writes only the world index (grid size and region placement).
// Chunking, the weather blend field, transit paths and the world-map pyramid
// arrive in M1 (see TODO.md).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"birdiegogo/core/model"
)

const (
	tileSize   = 16
	chunkTiles = 32
)

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

func main() {
	world := flag.String("world", "content/world/city.world", "Tiled world file")
	out := flag.String("out", "web/public/world", "output directory")
	flag.Parse()

	if err := run(*world, *out); err != nil {
		fmt.Fprintln(os.Stderr, "worldbuild:", err)
		os.Exit(1)
	}
}

func run(worldPath, outDir string) error {
	data, err := os.ReadFile(worldPath)
	if err != nil {
		return err
	}
	var w tiledWorld
	if err := json.Unmarshal(data, &w); err != nil {
		return fmt.Errorf("%s: %w", worldPath, err)
	}
	index, err := buildIndex(w)
	if err != nil {
		return fmt.Errorf("%s: %w", worldPath, err)
	}
	out, err := json.Marshal(index)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "index.json"), out, 0o644)
}

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
