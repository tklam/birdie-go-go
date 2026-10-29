// Command worldbuild turns the Tiled world (content/world/city.world) into the
// streamed overworld the client loads (SPEC.md §9.7):
//
//	go run ./tools/worldbuild -world content/world/city.world -out web/public/world
//
// It writes world/index.json and one gzipped binary file per 32×32-tile
// chunk under world/chunks/, named by content hash. Chunks with no map
// coverage are not written; the client uses the index's fill instead.
//
// Chunk format (little endian, then gzip):
//
//	"BGC1"  magic
//	u16 cx, u16 cy
//	u16[1024] ground, u16[1024] detail, u16[1024] overhead   (atlas frame + 1, 0 = empty)
//	u8[1024]  collision                                     (model.Collision*)
//	u8[1024]  area                                          (index into index.areas, 255 = none)
//	u32 n, then n bytes of JSON: []model.WorldObject
//
// The weather blend field and transit paths are added in later milestones.
package main

import (
	"flag"
	"fmt"
	"os"
)

const (
	tileSize   = 16
	chunkTiles = 32
	chunkArea  = chunkTiles * chunkTiles
	noArea     = 255
)

func main() {
	world := flag.String("world", "content/world/city.world", "Tiled world file")
	out := flag.String("out", "web/public/world", "output directory")
	tileset := flag.String("tileset", "tko", "name of the atlas tileset used by visual layers")
	manifestID := flag.String("tileset-asset", "tiles_tko", "manifest id of the atlas image")
	fill := flag.String("fill", "water", "atlas tile name for chunks with no map (solid)")
	flag.Parse()

	opts := options{atlas: *tileset, atlasAsset: *manifestID, fillTile: *fill}
	if err := run(*world, *out, opts); err != nil {
		fmt.Fprintln(os.Stderr, "worldbuild:", err)
		os.Exit(1)
	}
}
