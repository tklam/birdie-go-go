package model

// Item is something Angie can buy, carry or wear (SPEC.md §4.12).
type Item struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Kind is "gear" (worn in a slot) or "consumable" (used up).
	Kind string `json:"kind"`
	// Slot is "head", "body" or "hand" for gear.
	Slot  string `json:"slot,omitempty"`
	Price int    `json:"price"`
	// Counters lists the hazard ids this item protects against.
	Counters []string `json:"counters"`
	// Restores is the Energy a consumable gives back when used.
	Restores int `json:"restores,omitempty"`
	// DurationSlots is how long a consumable's protection lasts (0 = instant).
	DurationSlots int    `json:"durationSlots,omitempty"`
	Description   string `json:"description"`
}

// Hazard is a harmful weather condition (SPEC.md §4.12).
type Hazard struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Status is the status effect shown while exposed (e.g. "sunburnt").
	Status string `json:"status"`
	// When says which weather parameter triggers it and at what value.
	When HazardWhen `json:"when"`
	// DrainPerMin is Energy lost per in-game minute while exposed.
	DrainPerMin float64 `json:"drainPerMin"`
	// Severe raises the drain past a stronger threshold.
	Severe *HazardSevere `json:"severe,omitempty"`
	// Push is how strongly the wind pushes Angie, in px/s at full wind.
	Push float64 `json:"push,omitempty"`
	// Breaks names an item that breaks under this hazard past AtLeast.
	Breaks      *HazardBreak `json:"breaks,omitempty"`
	CounteredBy []string     `json:"counteredBy"`
}

// HazardWhen triggers on a weather parameter (cloud, precip, temp, fog, wind,
// uv, signal) being at least Min and/or at most Max.
type HazardWhen struct {
	Param string   `json:"param"`
	Min   *float64 `json:"min,omitempty"`
	Max   *float64 `json:"max,omitempty"`
}

// HazardSevere is a stronger tier of a hazard.
type HazardSevere struct {
	Min         float64 `json:"min"`
	DrainPerMin float64 `json:"drainPerMin"`
}

// HazardBreak says which item breaks and from what parameter value.
type HazardBreak struct {
	Item string  `json:"item"`
	Min  float64 `json:"min"`
}
