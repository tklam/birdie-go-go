package model

// WorldIndex describes the streamed overworld emitted by tools/worldbuild
// (SPEC.md §9.7). Chunk files are named by content hash and never change.
type WorldIndex struct {
	TileSize     int           `json:"tileSize"`
	ChunkTiles   int           `json:"chunkTiles"`
	WidthChunks  int           `json:"widthChunks"`
	HeightChunks int           `json:"heightChunks"`
	Regions      []WorldRegion `json:"regions"`
	// Tileset is the manifest id of the atlas that tile values index into
	// (value − 1 is the frame; 0 is empty).
	Tileset string `json:"tileset"`
	// TileNames lists the atlas tile names by local id (from the tileset's
	// "name" properties), so the client can recognise e.g. tall grass.
	TileNames []string `json:"tileNames"`
	// Areas lists area ids; chunk area bytes index into it (255 = none).
	Areas []string `json:"areas"`
	// Fill describes chunks that have no file (e.g. open sea).
	Fill WorldFill `json:"fill"`
	// Chunks maps "cx,cy" to the chunk file name under world/chunks/.
	Chunks map[string]string `json:"chunks"`
	// AreaCenters maps area ids to their centroids in world pixels (for the
	// drifting weather front).
	AreaCenters map[string]Point `json:"areaCenters"`
	// Stops maps transit stop ids (objects of type "stop") to world pixels.
	Stops map[string]Point `json:"stops"`
	// Gateways maps Kei's gateway ids (objects of type "gateway") to
	// their positions and titles.
	Gateways map[string]Gateway `json:"gateways"`
	// Spawns maps spawn names to world pixel positions.
	Spawns map[string]Point `json:"spawns"`
}

// Gateway is a teleport pad in the world.
type Gateway struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Title string  `json:"title"`
}

// WorldRegion is one Tiled map placed in the world, in pixels.
type WorldRegion struct {
	File   string `json:"file"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// WorldFill is what an absent chunk contains.
type WorldFill struct {
	Ground    int `json:"ground"`
	Collision int `json:"collision"`
}

// Point is a position in world pixels.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// WorldObject is a placed object (spawn, spot, npc, door, bird, …) stored in
// the chunk that contains its position. X and Y are world pixels.
type WorldObject struct {
	Name  string            `json:"name"`
	Type  string            `json:"type"`
	X     float64           `json:"x"`
	Y     float64           `json:"y"`
	Props map[string]string `json:"props"`
}

// Collision codes stored per tile in chunks.
const (
	CollisionOpen       = 0
	CollisionSolid      = 1
	CollisionLedgeSouth = 2
)
