package model

// Enemy is a hostile creature met on the map (SPEC.md §4.13): wild dogs are
// only driven off; zombies and folklore creatures can be defeated.
type Enemy struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind is "dog" or "monster".
	Kind string `json:"kind"`
	// Sprite is the manifest id of the overworld sheet (2 frames, 16×16);
	// Portrait is the encounter sprite sheet (2 frames, 48×48).
	Sprite   string `json:"sprite"`
	Portrait string `json:"portrait"`
	// Where and when it roams.
	Areas []string `json:"areas"`
	Slots []string `json:"slots"`
	// Sight is how far it notices Angie in px (halved while she sneaks);
	// Speed is its chase speed in px/s.
	Sight float64 `json:"sight"`
	Speed float64 `json:"speed"`
	// Resolve is worn down by successful combos; Damage is Energy lost per
	// failed combo or when caught while escaping.
	Resolve int `json:"resolve"`
	Damage  int `json:"damage"`
	// Combo lengths and time windows scale from easy to hard as resolve drops.
	ComboLength [2]int `json:"comboLength"`
	WindowMs    [2]int `json:"windowMs"`
	// MashRate is the taps per second needed to outrun it.
	MashRate float64 `json:"mashRate"`
	// Weakness is an item that halves its resolve when used in the encounter.
	Weakness string `json:"weakness,omitempty"`
	// Drops are rewards for defeating a monster.
	Drops []Drop `json:"drops"`
	// Lore is the hint villagers give about it.
	Lore string `json:"lore"`
}

// Drop is a possible reward.
type Drop struct {
	Item   string  `json:"item"`
	Chance float64 `json:"chance"`
}
