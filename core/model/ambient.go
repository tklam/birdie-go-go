package model

// AmbientNPC is a kind of passer-by who wanders the map (SPEC.md §4.3):
// joggers, office workers, aunties, and birders who photograph birds both on
// the map and in photo sessions.
type AmbientNPC struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Sprite is a 16×24 character sheet (manifest id).
	Sprite string `json:"sprite"`
	// Kind is "walker" or "birder" (birders stop to photograph birds and
	// appear in photo sessions in their areas).
	Kind  string   `json:"kind"`
	Areas []string `json:"areas"`
	Slots []string `json:"slots"`
	// PerChunk is how many spawn in each loaded chunk of their areas.
	PerChunk int `json:"perChunk"`
	// Lines are small-talk lines; one is picked when Angie talks to them.
	Lines []string `json:"lines"`
}
