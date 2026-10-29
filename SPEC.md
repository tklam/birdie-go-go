# Birdie Go Go — Game Specification

> Status: **Design v0.1** (2026-10-29). Nothing is implemented yet. This document is the source of truth for game design; when code and spec disagree, either fix the code or update this spec deliberately.

## 1. Overview

Birdie Go Go is a cozy, browser-based JRPG. The player is **Angie**, a young woman who earns her living (and finds her story) through two activities:

1. **Bird photography** — exploring the overworld, finding birds, and capturing perfect photos in a dedicated *action view*.
2. **Teaching piano** — visiting students, listening to them play, and flagging their mistakes in real time.

Combat is light and occasional (§4.13). Progression comes from money, gear, the photo album, student growth, exploration, and Angie's relationships with her companions **O Boy** (a little bird from the Bird Paradise, travelling the universe) and **Kei** (an engineer who becomes her boyfriend, then husband).

### 1.1 Pillars

- **Eyes and ears** — the two minigames test complementary skills (visual timing vs. listening).
- **Explore to discover** — a hand-crafted top-down overworld with hidden corners, where new gear opens new paths.
- **A living world** — a huge Hong Kong-inspired city and countryside, each region with its own weather blending naturally at the borders, connected by buses, trams, metro, ferries, and teleports.
- **Cozy, with a bite** — wild dogs, the odd monster, and harsh weather add tension, but failure costs time, not progress. No game over.
- **Companions matter** — who you bring changes how tasks play.
- **Touch first** — every interaction works on a phone or tablet; mouse and keyboard are supported as equivalents.

### 1.2 Platform

- Runs in modern browsers (Chrome, Safari incl. iOS, Firefox, Edge), desktop and mobile.
- Landscape orientation. The game renders at a **native 16-bit-style resolution of 320×180**, scaled up **by whole numbers only** (pixel-perfect) and letterboxed (§1.3).
- No server required to play: static files, installable, works offline (§9.1).
- Minimum tap target: 44×44 CSS px. No hover-only interactions.

### 1.3 Visual and audio style: 16-bit JRPG
The whole game (overworld, photo scenes, lessons, menus) looks and sounds like a **classic 16-bit-era console JRPG**, with original art and music.

- **Resolution**: native 320×180 framebuffer, nearest-neighbor, integer scaling only; no sub-pixel sprite positions (positions snap to whole pixels when drawn).
- **Palettes**: each sprite/tile uses a **16-color palette** (15 colors + transparent), from a shared master palette of ≤ 256 colors. Palette swaps are used for variations: seasonal foliage, time-of-day tint, birds' plumage variants.
- **Sprites**: 16×16 tiles; characters 16×24; outlines and limited shading in the 16-bit tradition. No smooth rotation or scaling of sprites, except deliberate era-style effects.
- **Era-style effects** (used sparingly): pseudo-3D floor effect for the world map and teleport transitions, mosaic/pixelate fades, palette-cycling water and neon signs, horizontal line-scroll waves for heat haze and water, iris wipes into the photo and lesson scenes.
- **UI**: classic JRPG windows: framed boxes with a gradient fill (player-selectable color, as in the genre), bitmap pixel font, a blinking cursor/hand, and a portrait in dialogue boxes. The HTML overlay renders these with the same pixel font and integer scaling so it matches the canvas.
- **Reduced motion** (Settings): wipes and the teleport glitch become plain fades, the camera never shakes or flashes, and rain falls straight, slower and sparser. **Text speed** (slow/normal/fast/instant) and **window colour** (blue/green/plum/grey) are also settings; all settings survive New Game.
- **Audio**: music and effects are **sequenced** (note data in YAML/MIDI) and played by the same SoundFont synth as the piano, using a 16-bit-style sample bank. The music sounds like the era and the downloads stay tiny. The lesson piano uses a clearer piano sample, so mistakes stay audible.
- Original art and music only; the style evokes the era without copying any game.

## 2. Characters

### 2.1 Angie (protagonist)
- Fixed name; not player-renamable.
- Birder-photographer and piano teacher.
- One combat-style stat: **Energy** (§4.12). She also has **money**, **gear**, **reputation** (as a teacher), and an **album**.

### 2.2 O Boy
- A little bird from the **Bird Paradise**, a traveller journeying around the universe. On Earth he looks like a blue-greenish **Pacific parrotlet** (*Forpus coelestis*), with a faint starry shimmer in his feathers. His voice is real Pacific parrotlet calls: a chirp on each of his dialogue lines and now and then on the map, a two-note contact call in photo sessions, and an excited squawk in encounters.
- Where the Bird Paradise is, why he's travelling and why he stays with Angie unfold gently through the story (see §11).
- Found by Angie during an early-game birding outing; she names him "O Boy". Joining is a scripted story event.
- On the map he rides on Angie's shoulder and occasionally flutters off and back (cosmetic).
- Initially wary/jealous of Kei; warms up as bond grows (a small three-way arc).

### 2.3 Kei
- Appears **mid-game** (Chapter 3, see §8).
- Skilled in **computer science and engineering**. His help comes as gadgets and software he builds — including the exploration tools that open new paths (§4.6).
- He is famously **absent-minded**, so he is building a **digital kingdom**, a digital realm where he can upload his **"ghost"** (his mind and memories) so he never forgets anything again. His ultimate goal is to let **everyone** upload their ghosts to the digital realm.
- To get there he develops **digitalization** (turning a person or thing into data in the realm) and **undigitalization** (bringing them back out). His **teleport gateways** (§4.11) are the first practical use: step in, get digitalized, cross the realm, get undigitalized at another gateway. This project runs through his romance arc as a running thread.
- Relationship arc: `met → friends → dating → engaged → married`.
- On the map he follows Angie, retracing her path.

## 3. Core Loop

```
Day starts → choose time slot activity → explore overworld → task (photo / lesson / story)
          → rewards (money, album entries, bond, parts) → upgrades / story → next slot
```

### 3.1 Time
- Each day has three slots: **Morning, Afternoon, Evening**.
- A photo session or a lesson consumes one slot. Walking around the overworld is free.
- Bird availability depends on time slot, area, season, and weather.
- In the evening, while Angie is away from home, a toast every `bedtime_reminder.every_seconds` of play (set in `content/game.yaml`, with its `lines`) suggests heading home to sleep. The first comes a few seconds into the evening.
- Seasons change every 14 days (Spring, Summer, Autumn, Winter).
- Weather is simulated per area and changes per time slot (§4.9).

### 3.2 Economy
- Lessons pay money (scaled by score and student level).
- Photo requests and contests pay money.
- Money buys gear and parts. After Kei joins, many upgrades are **built by Kei** from parts instead of bought.
- **Bills.** Each morning, the bills due that day (`bills` in `content/game.yaml`: name, amount, `every_days`) are deducted and listed in a panel: daily electricity and phone, water and gas every other day, rent weekly. Money never goes below 0; an unpaid remainder is simply forgiven, with a nudge to earn more. Together with food (§4.12), this keeps money worth earning.

## 4. Overworld (Map Scene)

### 4.1 Style
A **top-down, 3/4-perspective action-adventure overworld** in the style of classic 2D Zelda-like games. This is inspiration for perspective and feel only — all maps, characters, items, and art are original.

- Hand-crafted, dense areas with landmarks, secrets, and shortcuts rather than empty space.
- 16-bit pixel art (§1.3) on a 16×16 tile grid. Characters 16×24 with 4 facing directions.
- Interiors (homes, shop, studio, stations) are separate small rooms entered through doors.

### 4.2 Setting: a Hong Kong-inspired world
The world is **modelled on Hong Kong**: a compressed, stylized version of its geography, not a 1:1 replica. Place names, landmarks, and transit brands are original or lightly fictionalized (no real logos or trademarks in shipped assets). The defining feature is the contrast of **dense city right next to green hills, sea and wetland**, including **green spaces inside the city**.

| Terrain / district type | HK reference (inspiration) | Birding character |
|---|---|---|
| Dense city (high-rises, markets, footbridges, alleys) | Kowloon, Hong Kong Island north shore | Urban birds: mynas, sparrows, spotted doves, black kites overhead |
| Harbourfront promenades | Victoria Harbour | Gulls (winter), egrets, kites; ferry piers |
| Urban parks and gardens | City parks, botanical gardens | Bulbuls, white-eyes, magpie-robins; feral cockatoos and parakeets |
| Peaks and hill trails | The Peak, ridge trails | Raptors, swifts; views over the city |
| Country parks / forest | Woodland country parks, reservoirs | Forest birds, minivets, flycatchers |
| Wetlands and fishponds | The northwest wetlands | Herons, spoonbills, waders, migrants (seasonal) |
| Mangroves and mudflats | Northwest bay | Waders at low tide |
| Villages and farmland | New Territories valleys | Farmland birds, munias, buntings |
| Beaches and rocky coasts | South side, east coast | Sea eagles, reef egrets |
| Outlying islands | Island villages | Island specialties; reached by ferry |
| The sea | Harbour, channels | Its own weather region; seabirds from the ferry deck |

**First district: Tseung Kwan O.** The vertical slice and the start of the game take place in a Tseung Kwan O-inspired new town on Junk Bay: high-rise housing estates linked by footbridges and malls, a metro station, the waterfront promenade and park along the bay, and hillside trails rising toward the country park and peaks to the east, with a small fishing village tucked in a nearby cove. Real geographic names may be used for districts and places; brands stay fictional.

Hilly terrain is expressed with cliffs, stairs, slopes, and ledges (§4.5). Real-world bird species of the region are used (with original art).

### 4.3 Camera, world and areas
- The overworld is **one large, seamless map** streamed in chunks (§4.10). There are no loading screens or screen transitions while walking outdoors.
- The camera follows Angie smoothly (snapped to whole pixels). The visible world is 320×180 px (20×11 tiles).
- The world is divided into logical **areas** (districts: e.g. Harbour City, Hillside Park, Northwest Wetlands, Outlying Island). Areas don't change the view; they own weather (§4.9), music, bird tables, unlocks, and story triggers. Entering one shows its name briefly.
- Doors, stairs, station entrances, and cave mouths **fade** into interiors (small separate maps).
- **Passers-by** (`content/ambient.yaml`) wander their areas: joggers, office workers, aunties, students and **birders**. Birders stop to photograph nearby birds, and one or two of them show up in the foreground of photo sessions in their areas, clicking away (their shutters unsettle the birds a little). Anyone can be talked to for a line of small talk.
- The world is authored in Tiled as a **world** (`.world`) of many region maps (`.tmj`) placed side by side, built into chunks by a Go tool (§9.7). Layers: `ground`, `detail`, `collision`, `overhead` (above characters: canopies, roofs, footbridges), `areas` (painted area IDs), and `objects` (spawns, doors, NPCs, birding spots, transit stops, routes).

### 4.4 Movement
- **Free 8-directional movement** (pixel-based, not grid-locked) with collision against the `collision` layer and solid objects; slides along walls.
- Two speeds: **walk** and **sneak**. Sneaking is quiet and slower — important around birds.

| Action | Touch | Mouse | Keyboard |
|---|---|---|---|
| Move | Floating virtual joystick (appears where the left thumb touches); small deflection = sneak | Click/hold to move toward pointer | Arrows / WASD |
| Sneak | Small joystick deflection | Hold right button while moving | Hold Shift |
| Action (context) | Action button (right side) | Click target when adjacent | Space / Enter |
| Menu | Menu button (top right) | Menu button | Esc / Tab |

Optional setting: **tap-to-move** (tap a destination; A* pathfinding on the collision grid).

### 4.5 Terrain and interaction
- **Tall grass**: birds hide in it; walking (not sneaking) through it rustles and can flush them.
- **Ledges**: hop down one way; climbing up requires a path around (or gear, §4.6).
- **Shallow water, bridges, signs, benches, bird feeders, bushes, trees**.
- **Context Action**: the action button shows a label for the nearest target — *Talk*, *Look*, *Enter*, *Sit*, *Photograph*.
- **Collectibles** hidden around the world: feathers (album extras), camera parts (for Kei's builds), and sheet music (new songs for students). *As built:* `collectible` objects in the world with `item` (feather, camera_part) or `song` props, shown by a small twinkle and picked up once per save (flag `collected:<object name>`). Feathers are counted in the album header; sheet music sets `sheet:<song>`, and every student continues into found pieces after finishing their repertoire.

### 4.6 Gear-gated exploration
Some paths open only with the right gear, in the classic adventure-game tradition:

| Gear | Source | Opens |
|---|---|---|
| Wading boots | Shop (Chapter 2) | Wetland fishpond bunds and mudflats |
| Folding ladder | Kei build (friends) | Climb selected ledges/cliffs |
| Night lens | Kei build (dating) | Night-only birding spots |
| Kayak | Kei build (engaged) | Sea caves and islets unreachable by ferry |

### 4.7 Birds on the overworld
- Birds appear as small animated sprites (singles or flocks) in their habitats.
- Approaching while **sneaking** lets Angie get close; walking or running nearby flushes them (they fly to another perch or leave the area).
- When Angie is within range of a bird or a marked **birding spot**, the Action button shows *Photograph*, which opens the Photo Scene seeded with that bird/spot.

### 4.8 Party display
- Kei follows Angie along her recorded path (classic follower movement), offset by ~12 px of path.
- O Boy perches on Angie's shoulder; idles occasionally fly him to a nearby object and back.

### 4.9 Regional weather
Every area has **its own weather**, and weather changes **gradually across area boundaries** rather than switching abruptly. The climate follows Hong Kong's subtropical seasons.

**Weather state.** Weather is a set of continuous parameters, not a single label:

| Parameter | Range | Drives |
|---|---|---|
| `cloud` | 0–1 | Sky tint, light level, shadows |
| `precip` | 0–1 | Rain particle density, puddles, sound |
| `temp` | °C | Heat haze (hot), breath puffs and frost on the peaks (rare cold snaps) |
| `fog` | 0–1 | Fog/mist overlay, view distance in photo scenes |
| `wind` | 0–1, plus direction | Grass/tree sway, rain slant, waves, bird flight drift |
| `uv` | 0–11+ | Glare/brightness, UV hazard (§4.12) |

A **named weather** is derived from the parameters for UI, forecasts, and event conditions: `clear`, `hazy`, `cloudy`, `foggy`, `drizzle`, `rain`, `rainstorm`, `thunderstorm`, `windy`, `typhoon`.

**Seasons (HK-like).**
| Season | Character | Birding |
|---|---|---|
| Spring | Humid, foggy (especially by the sea and on hills), drizzle | Spring migrants pass through |
| Summer | Hot, showers and thunderstorms, **typhoons** | Breeding residents; after a typhoon, rare seabirds may be blown in |
| Autumn | Clear, dry, comfortable | Peak migration — the best birding season |
| Winter | Cool, dry monsoon wind, occasional cold snaps | Winter visitors: waders, ducks, gulls, spoonbills in the wetlands |

**Climate profiles.** Each area has a per-season climate profile (mean and variability per parameter) in `content/areas.yaml`. Examples: the open sea and outlying islands are windier and foggier in spring; the peaks are cooler, windier, and often in cloud; the dense city is hotter and hazier; the wetlands are misty in the morning.

**Typhoons and warnings.** A typhoon is a multi-day weather front generated with low probability in summer/early autumn. Its strength raises a **typhoon signal** level (1 → 3 → 8 → 10, as in Hong Kong) shown in the HUD. At signal 8+: ferries are suspended, most outdoor birding spots close, lessons are cancelled, and Angie stays home (cozy indoor day). Heavy rain likewise raises a **rainstorm warning** (amber → red → black).

*As built:* the core computes `rainstorm` per slot from the heaviest rain in any area (amber ≥ 0.7, red ≥ 0.85, black ≥ 0.95). The HUD shows the signal and warning (e.g. "T8", "Amber rain"); a newly raised one is announced once per slot and fires `weather_warning` with `{kind: typhoon|rainstorm, level}`. At signal 8+ or a black rainstorm, ferries are suspended, birding spots are closed and lessons are cancelled (Angie isn't forced home). The radio adds a warning line for each weather hazard (`hazards.yaml`) expected tomorrow afternoon, with the areas affected.

**Simulation (Go core, deterministic).** For each day and time slot, every area's parameters are generated from the save's `worldSeed`:
`value = climate_mean + regional_front + local_variation`, smoothed over time so weather evolves between slots instead of jumping.
- The **regional front** is shared by all areas and drifts across the map along the wind direction: an area's front value is sampled with a delay proportional to its position along the wind direction, so rain reaches the islands, then the harbour, then the hills.
- **Local variation** is per area, so regions still differ.
- Same seed + day + slot → same weather (reproducible, testable).

**Boundary blending.** Areas are painted on the world's `areas` layer and can have any shape. At build time, the world tool (§9.7) computes a **blend weight field** on a coarse grid (cells of 4×4 tiles):
- For each cell and each area within the blend band `B` (default **8 tiles**; configurable per area pair, e.g. 16 between hills and city): raw weight `max(0, 1 − d/B)`, where `d` is the distance in tiles from the cell to that area (0 inside it). Weights are normalized.
- Deep inside an area: 100% its own weather. Exactly on a boundary: 50/50. Where three areas meet, all three mix.
- The sea is an area with its own weather, so coastlines blend too.
- Each chunk stores the top 3 area weights per cell. At runtime the client interpolates bilinearly between cells and mixes the areas' parameters — essentially free per frame.
- Rendering (particles, fog, tint, sway, waves, ambient sound) uses the blended values continuously as Angie walks, easing over ~1 s when the slot changes.

**Interiors and underground** (homes, metro stations) have no weather; rain is heard muffled when `precip > 0.3` outside.

**Effects on gameplay.**
- Bird tables can require or prefer weather (e.g. gulls in winter wind, flycatchers after autumn rain, seabirds after typhoons; most birds hide in rainstorms).
- Overworld birds take shelter in heavy rain and come out right after.
- **Photo scene** uses the blended weather at the spot's position: low light (`cloud`, `fog`) lengthens focus time; `fog` reduces visible distance; `wind` drifts birds in flight; heavy `precip` lowers the sharpness ceiling.
- Weather affects transit (§4.11) and can be a hazard to Angie (§4.12).
- **Forecast**: the radio at Angie's home gives tomorrow's per-area forecast (the generated weather, slightly noisy) and any typhoon outlook.

### 4.10 World scale and streaming
The world is **huge** — thousands of tiles in each direction — and must run smoothly on mid-range phones. Player-facing requirements:
- **No loading screens** while walking or riding outdoors. Distant parts of the world stream in invisibly.
- **Targets**: 60 fps on mid-range phones (≈2021 and newer), never below 30 fps on low-end devices; memory under 300 MB; under 5 MB downloaded before the title screen.
- **Offline**: after the first visit, the game is installable (PWA) and playable offline; visited parts of the world are cached.
- **World map**: a zoomable map of the whole city from the Menu, showing discovered areas, spots, and transit lines.

Technical design: §9.7.

### 4.11 Transportation
A Hong Kong-style public transport network connects the world. Walking is always possible, but transit makes the huge map practical and is part of the fun.

| Mode | Presentation | Network role | Notes |
|---|---|---|---|
| **Bus** | Rides **on the map**: Angie boards, the camera follows the bus along its route; tap **Get off at next stop** or **Skip** to arrive | Many routes across districts, incl. into the countryside | Less frequent at night; rainstorms slow it |
| **Tram** | Rides on the map along the tram tracks on the island's north shore; slow and cheap | Short hops along the busiest waterfront strip | Top deck: occasional "window shot" photo opportunities (later) |
| **Metro** (MTR-style) | Underground: enter a station (interior), pick a destination, short skippable in-car scene with announcements, exit at the destination station | Fast backbone linking most districts | Weather-proof |
| **Ferry** | Board at a pier; a short **deck scene** on the water | Harbour crossings and outlying islands | The deck is a **photo spot** — gulls, terns, and other seabirds follow the boat. Suspended at typhoon signal 8+ |
| **Teleport** | A glitchy digital-dissolve transition between activated waypoints | Late-game fast travel between discovered places | **Kei's gateways**: digitalize the traveller into his digital kingdom and undigitalize them at another gateway. Waypoints come online as his project and the romance progress |

Rules:
- **Fares**: paid with a rechargeable transit card (original in-game name), topped up at shops and kiosks. Teleports are free once unlocked. *As built:* `transit_card` in `game.yaml` (the **Harbour Pass**, starting with $50, $50 per top-up); fares come off the card; every shop and every stop's kiosk tops it up from cash. Save version 3 adds the balance (old saves get $50).
- **Time**: rides don't use a time slot, except long ferry routes to outlying islands (`slot_cost` per line).
- **Route planner**: at any stop or station, choose any reachable destination; the planner finds the best route across modes (shortest travel time plus a transfer penalty) and runs the trip, with each leg skippable.
- **Discovery**: lines and stops open with story progress; a stop appears on the world map after Angie first visits it.
- **Vehicles on the map** follow timetables. Their position is a pure function of the in-game time, so there's no off-screen simulation; they're drawn only when on screen. Vehicles never hurt Angie (cozy).
- **Companions** ride along. O Boy travels in a small carrier on the metro and buses (with his own opinions about it).
- **Transit missions**: some tasks involve going somewhere specific, or photographing from the ferry deck.

*As built (`core/transit`):*
- **Clock**: transit times are in-game minutes, absolute from day 0 at midnight (`day × 1440 + minutes`). A ride on the map runs one in-game minute per real second, so a line's `speed` in px/s is also px per in-game minute.
- **Timetables**: every day each terminus sends a vehicle every `headway` minutes (default 15) from `first` to `last` (`"HH:MM"`, defaults 06:00 and 23:30; `last` may pass midnight, up to a day after `first`). Vehicles run the whole path at constant speed without dwelling, forward trips from the first stop and backward trips from the last. `VehicleAt(line, t)` derives every running vehicle's position, heading and progress from the timetable alone; trips that started the evening before are still on the road after midnight.
- **Stops along a line**: the first and last stops sit on the path's ends; intermediate stops snap to the nearest point of the path past the previous stop (from their world-index positions), or are spaced evenly when they have none.
- **Planner**: a time-dependent multi-criteria search over stops. Each leg is one vehicle from its boarding stop to any later stop of the line, so a fare is paid once per boarding and staying aboard is not a transfer. The best itinerary has the earliest arrival, then the lowest fare, then the fewest transfers; full ties go to the line listed first in content. Callers pass the unlocked lines and any suspended modes (e.g. ferry at signal 8+); with no allowed connection the planner reports the destination as unreachable. `ignoreTimetable` boards every leg immediately (no waits).

*As built (client):*
- **Game clock**: slots start at 07:00, 12:00 and 17:00 and last five hours; the clock is the slot start plus in-game minutes played in it (one per real second on the map and while riding, held at the slot's last minute, not saved).
- **Boarding** is the route planner: the stop lists every stop reachable on open lines from now, sorted by arrival, each with its fare; the detail line shows the legs, departure times, changes and arrival. The whole fare is paid up front; waits advance the clock; at a change the next leg starts from the transfer stop. Skip jumps to the end of the current leg.
- **Vehicles on the map** come from `transit.vehicles` (polled twice a second, moved along their heading in between); only those near the camera get sprites.
- **Discovery and unlocks**: walking near a stop (or arriving at one) discovers it (flag `stop:<id>`), and only discovered stops show on the world map. Lines with `locked: true` need an `unlock_line` event (flag `line:<id>`); `unlock_teleport` opens a gateway; `stop_discovered` is a condition.

### 4.12 Energy, weather hazards and outdoor gear
Weather isn't just scenery; it can also be an **enemy**.

**Energy.** Angie has an **Energy** meter (0–100), the game's HP. It drains slowly from hazards and quickly from encounters (§4.13). It comes back from food and drinks (bought at shops or kiosks, or carried), resting on benches or in shelters, and sleeping at home.

**Everyday costs** (`energy` in `content/game.yaml`): walking outdoors drains `walk_per_min`, multiplied by the area's `walk_effort` (`content/areas.yaml`; hills cost more). Starting a photo session or a lesson costs Energy, and Angie can't start one with less Energy than its cost; a toast suggests eating or resting. Indoors, Energy slowly recovers (`indoor_recovery_per_min`). Dropping below `low_warning` shows a one-off toast pointing to the shop.

**Hazards** come from the blended weather at Angie's position (§4.9). Each one has thresholds, a status effect, and gear that counters it:

| Hazard | Trigger (default) | Without protection | Countered by |
|---|---|---|---|
| **High UV** | `uv` ≥ 8 (very high) | *Sunburnt*: Energy drains; at 11+ it drains faster | Sun hat, sunscreen (consumable, lasts one slot), parasol/umbrella |
| **Heat** | `temp` ≥ 33 °C | *Overheated*: Energy drains faster, walking slows | Water bottle (refill at fountains/shops), shade, sun hat |
| **Heavy rain** | `precip` ≥ 0.7 | *Soaked*: Energy drains; the camera fogs up (longer focus) | Umbrella, raincoat |
| **Strong wind** | `wind` ≥ 0.7 | *Windswept*: movement pushed sideways; **umbrellas flip and break** above 0.8 | Windbreaker; switch to a raincoat in windy rain |
| **Cold snap** | `temp` ≤ 8 °C (peaks, winter) | *Chilled*: Energy drains | Jacket, hot drink |
| **Typhoon** | signal 8+ | Outdoors becomes very dangerous: high drain, strong push | Stay indoors (story events may force a short dash home) |

- `uv` is a new weather parameter (0–11+). It's computed from cloud cover, season, time slot (highest in the afternoon), and altitude (higher on peaks).
- The HUD shows active hazards as icons with a level. The radio forecast warns about tomorrow's UV, heat, rain, and wind so the player can **pack accordingly**.
- **Gear slots**: head (hat), body (raincoat / windbreaker / jacket), hand (umbrella or parasol), plus a bag with limited space for consumables (sunscreen, water, snacks, plasters). Packing is a small daily choice: the bag doesn't fit everything.
- Status effects wear off indoors, in shelter, or with the right item.
- In the photo scene, the *Soaked* and *Overheated* statuses carry over: a fogged lens means longer focus, and heat haze lowers sharpness. *As built:* a hazard's optional `photo: { focus_scale, sharpness_scale }` in `hazards.yaml` applies while Angie is exposed when a session starts (heavy rain ×1.3 focus time, heat ×0.8 sharpness).
- **Weather birds and sheltering.** A spot's bird entry may list `weather` (named weathers); it only appears then (e.g. terns in rain, storm-blown seabirds at the pier, ospreys on windy days). Birds shelter from rain: one visitor fewer in rain, two fewer in rainstorms, thunderstorms and typhoons.

**No game over.** If Energy reaches 0, Angie gets dizzy and sits down. A passer-by (or a companion) helps her to the nearest shelter, clinic, or home. The rest of the time slot is lost, she pays a small clinic fee, and her gear may need repair (Kei can fix it once he's around). Story progress is never lost.

### 4.13 Encounters: wild dogs and monsters
Occasionally Angie meets something hostile: **wild dogs** (stray packs found on the city's edges and in country parks) and, rarely, **monsters**:
- **Zombies**, including hopping corpses in the style of Chinese/Hong Kong folklore and cinema. They appear at night, in abandoned villages, and in old cemeteries on the hills.
- **Local folklore creatures**: spirits and beings from Cantonese and Hong Kong folk tales (e.g. water ghosts at reservoirs and piers, mountain spirits on the trails, fox spirits). Each has an original design and a behavior pattern tied to its lore, such as a weakness or taboo that a specific combo or item exploits.
- Monsters are rarer near the city center and more common at night, in remote areas, and around folklore festival dates.

**On the map.** Enemies are **visible and avoidable**: no random battles. They roam their territory, react to noise like birds do (sneaking helps), and chase Angie when they spot her. Contact starts an encounter with a classic 16-bit transition (screen swirl/mosaic) into the **Encounter Scene**.

**Encounter Scene.** This is a short, real-time input challenge with no menus. The enemy has a **resolve** meter, and Angie has her Energy. In the first moment the player chooses to **Escape** or **Confront**:

| Approach | How it plays | Success | Failure |
|---|---|---|---|
| **Escape** | **Button mashing**: tap as fast as possible to fill a run meter faster than the enemy closes in; a few prompts to dodge along the way | Angie gets away; the enemy loses track of her for a while | Caught: Energy loss, then retry from closer |
| **Confront** | **Button combinations**: sequences of directions + A/B appear (e.g. ← → A, ↓ ↓ B) and must be entered within a time window; longer and faster sequences as resolve drops | Enemy resolve hits 0: dogs back off and leave, monsters are defeated or driven off | Missed/wrong combos cost Energy; the enemy counters |

- **Wild dogs** are driven off, not hurt. Confront combos are things like *stand tall*, *stomp*, *open the umbrella*, *shout*. Following real-world advice, **escaping by running is harder** against dogs than calmly confronting them.
- **Monsters** have their own attack patterns, telegraphed by animations, plus special combo patterns. Defeating one can drop rare **parts** for Kei's builds or unlock story beats.
- **Gear helps**: an umbrella gives a block prompt (and breaks on failure), a whistle starts a fight with lower enemy resolve, and snacks can distract dogs (one-time escape).
- **Difficulty** scales with the enemy and the area. Rewards are small: avoiding enemies is always a valid play style.

**As built (v1 tuning).** Combo windows are per symbol (a 4-symbol combo with a 1.5 s window gets 6 s), with a short "Ready…" preview. A completed combo removes 15–25 resolve (more for longer and faster ones); a failed one costs the enemy's damage in Energy and returns to the choice menu. In Escape, the enemy fills its meter in 4 s and each tap is worth 1/mash_rate of that, so you must tap faster than the enemy's mash rate; holding (accessibility) fills at 1.15× the enemy's pace; being caught twice ends the encounter as lost. Skip costs half the enemy's damage.

**Gear assists (as built).** Items carry an optional `assist` in `items.yaml`: `resolve_scale` (the whistle, 0.85: enemies start with less resolve while Angie carries it) and `block` with `block_window_ms` (the umbrella, worn: before each hit, a one-symbol block prompt; success blocks the hit, a miss hurts and breaks the umbrella; Slower prompts lengthens it).

**Spawns.** Enemies stand at fixed `enemy` spawn points in the world, in their time slots. Each spawn point is dealt with separately: beating or driving off one clears only that spawn for the rest of the day; escaping calms all enemies for 15 s.

**Controls**
| Input | Touch | Mouse | Keyboard |
|---|---|---|---|
| Directions in combos | Swipe ← → ↑ ↓ anywhere on the left half | Arrow buttons on screen | Arrows / WASD |
| A / B | Two large buttons on the right | Click the on-screen A/B | Z / X (or J / K) |
| Mash | Tap anywhere rapidly | Click rapidly | Space rapidly |

Accessibility settings: **Hold instead of mash** (holding fills the meter at a fixed rate), **Slower prompts**, and **Skip encounter** (auto-escape at a small Energy cost).

**Companions in encounters** (hints and assists, never automatic wins):
- **O Boy**: a loud squawk distracts the enemy, removing one combo step (once per encounter). He flies to safety during fights.
- **Kei** (`friends`+): an ultrasonic deterrent gadget against dogs lowers their resolve at the start. From `dating`, a camera-flash gadget stuns monsters briefly, so a combo gets a longer time window.
- **Both**: O Boy distracts while Kei sets up the gadget, giving one free success.

## 5. Photo Scene (Action View)

### 5.1 Presentation
- Side-view scene of the spot's habitat (background layers with parallax), rendered with the current weather at the spot (§4.9).
- Birds spawn per the spot's bird table and behave per species AI: perch, hop, forage, fly across, take off, land.
- A **viewfinder** reticle represents the camera frame.

### 5.2 Controls
| Action | Touch | Mouse | Keyboard |
|---|---|---|---|
| Aim | Drag anywhere (relative movement, like a trackpad) | Move mouse | Arrows / WASD |
| Focus | Press and hold | Hold left button | Hold Space |
| Shoot | Release | Release button | Release Space |
| Zoom (if lens allows) | Pinch / zoom buttons | Wheel | Q / E |
| Leave | Back button | Back button | Esc |

The viewfinder is never directly under the finger (relative drag), so the finger never hides the target.

### 5.3 Shot scoring (0–100)
Each shot evaluates the bird closest to the frame center that is at least partly in frame.

| Factor | Weight | Rule |
|---|---|---|
| Framing | 25 | Distance of bird center from frame center (or rule-of-thirds points), normalized |
| Size | 20 | Bird bbox area / frame area; ideal band per species (e.g. 8–30%) |
| Focus | 20 | Hold time ≥ lens focus time → full; less → proportional blur |
| Pose | 20 | Species pose value: wings spread 1.0, perched alert 0.9, perched 0.8, flying 0.7, flapping 0.5, back turned 0.3 |
| Sharpness | 15 | Penalty if bird screen-speed exceeds the shutter's motion threshold |

Ratings: **≥90 Perfect ★★★**, 75–89 Great ★★, 50–74 Good ★, <50 Blurry (not saved to album).

### 5.4 Stealth
- An **alert meter** (0–100) rises when the viewfinder moves faster than a threshold or the player shoots repeatedly; it slowly decays.
- At 100, nearby birds flee. Species have different skittishness.

### 5.5 Limits
- A session has a shot budget (memory card, default 12 shots; upgradeable).
- Session ends when out of shots, the player leaves, or all birds have gone.

### 5.6 Album
- Best shot per species is kept (plus a few extra favorites).
- Album entry: species, rating, score, date, area, companions present.
- Completion milestones give rewards and story beats. As built: after each photo session and each morning that trail cameras add photos, every `album_milestone` event whose `species` count the album has reached fires (events run once). `content/events/album.yaml` rewards 5, 10, 25, 50 and 100 species with items, money and camera parts from the Birding Society.

## 6. Piano Scene (Lessons)

### 6.1 Presentation
- A student at the piano; a **piano roll** of the reference score scrolls horizontally with a playhead.
- Audio: the student's performance synthesized with a piano SoundFont.
- A large **Mistake!** button (bottom center; also tap anywhere on the lower half, or press Space/Enter).

### 6.2 Performance generation (Go core)
Input: song, student profile, difficulty, seed. Output: a performance (list of note events) plus a hidden answer key.

| Type | Description | Subtlety knobs |
|---|---|---|
| `wrong_note` | Pitch replaced | ±1 semitone (subtle) to ±octave (obvious); in-key vs. chromatic |
| `missed_note` | Note omitted | Short vs. long note; inner voice vs. melody |
| `extra_note` | Note inserted | Grace-note-like vs. clear clunker |
| `rush` | Note(s) early | 60–250 ms |
| `drag` | Note(s) late | 60–250 ms |
| `hesitation` | Pause before a passage | 300–1200 ms |

Difficulty controls mistake count, spacing (min 1.5 s apart), and subtlety. Student tendencies bias the mistake types. Same seed → same performance (reproducible, testable).

### 6.3 Grading
- Client records flag timestamps relative to audio start, minus the player's **latency offset** (from calibration).
- A flag **hits** a mistake if it falls in `[onset − 100 ms, onset + 1000 ms]`. Each mistake can be hit once; each flag matches at most one mistake (earliest unmatched first).
- Unmatched flags are **false alarms**.
- Score = `100 × hits / mistakes − 10 × false_alarms`, clamped to 0–100.
- Grading is done by the Go core against the answer key, which the UI never sees before the lesson ends. (It's single-player, so this keeps the code honest rather than preventing cheating. A future leaderboard can re-verify, since lessons are deterministic from their seed.)

### 6.4 Calibration
- First lesson (and in Settings): tap along to 8 metronome clicks; the median offset becomes the latency offset.

### 6.5 Students
- Each student has a name, level, repertoire, mistake tendencies (e.g. "rushes fast passages"), and a small story arc.
- Lesson score raises the student's progress; at thresholds they learn new songs and pay more.

## 7. Companions & Party

Party options for any outing: **Alone, O Boy, Kei, O Boy + Kei** (once each has joined). The party is changed from the menu (Menu → Party).

### 7.1 Bond
- `bond.oboy`, `bond.kei`: 0–100. Raised by outings together (+2 per photo session or lesson with them along), gifts, story scenes.
- Thresholds unlock stronger abilities and story events.

### 7.2 Abilities
Abilities are **hints**, never automatic success.

**O Boy**
| Bond | Overworld | Photo | Piano |
|---|---|---|---|
| 0+ | Chirps when a bird is nearby off-screen | Alert meter rises 20% slower | Bobs to the beat (visual metronome) |
| 40+ | — | Contact call: lures one curious bird closer once per session | Ruffles feathers shortly after a missed mistake |
| 80+ | Flies to hidden collectibles | Gently highlights perched birds | Head-tilt cue at hesitation mistakes |

**Kei** (unlocks follow romance stage)
| Stage | Overworld | Photo | Piano |
|---|---|---|---|
| friends | Folding ladder | Bird-call ID app: names audible but hidden species | Faint pitch-line overlay on the piano roll |
| dating | Night lens; trail cameras (place on map, collect photos passively) | — | Post-lesson replay of missed mistakes |
| engaged | Kayak; camera mods (tracking AF, stabilizer) from parts | Mods apply here | Practice drills: students progress faster |
| married | Home workshop: print and sell album photos | — | — |

**O Boy + Kei together**: combo — Kei's app identifies a hidden bird, O Boy lures it (once per session). Unique banter. Until `oboy_accepts_kei`, O Boy's jealousy slightly raises the alert meter when both are in the party.

## 8. Story Outline

| Chapter | Summary | Key events |
|---|---|---|
| Prologue | Angie, new to the city, starts her first lessons and buys a basic camera | Tutorial: movement, first lesson, calibration, first photo |
| 1 | Finding O Boy at the waterfront park — a shimmering blue-green bird from the Bird Paradise, resting on his journey around the universe | `oboy_found`, `oboy_joins` |
| 2 | Growing reputation; harder birds and students reveal gear limits | Wading boots; Wetlands opens; contest request |
| 3 (mid-game) | Meets Kei (e.g. at the shop, fixing a broken camera) | `kei_met`, `kei_joins`; `kei.stage = friends` |
| 4 | Outings become dates | `kei.stage = dating`; O Boy jealousy arc → `oboy_accepts_kei` |
| 5 | Big photo contest + student recital | `kei_proposes` → `kei.stage = engaged` |
| Finale | Wedding; the shared home with Angie's best photos on the wall | `kei.stage = married`; post-game free play |

All story is data-driven (§9.4). The dialogue is a full first draft (content/dialogue/), open to revision.

## 9. Technical Architecture

### 9.1 Overview
The game is a **static web app** — no server is needed to play. An **optional Go server** delivers content updates (maps, tasks, missions, events) and, later, cloud saves.

```
┌──────────────── Browser (static files, PWA) ─────────────────┐
│  TypeScript + Phaser 3           Web Worker                   │
│  scenes, input, rendering,  ◄──► Go core (WebAssembly):       │
│  audio, events, UI               lessons, weather, routes,    │
│  IndexedDB: saves, caches        content-pack validation      │
└───────────────▲──────────────────────────────▲───────────────┘
                │ static hosting (any CDN)      │ optional
        game files, base content,        Go update server:
        world chunks (built by Go tools) content packs, (later) cloud saves
```

Where Go is used:
1. **Go core → WebAssembly**, running in a Web Worker: lesson generation and grading, weather simulation, transit route planning, and validation of downloaded content packs. Built with **TinyGo** for a small binary (pure computation, no reflection-heavy dependencies); standard Go `GOOS=js GOARCH=wasm` is the fallback.
2. **Go build tools**: `contentbuild` (validate YAML, emit the JSON content bundle), `worldbuild` (chunk the world, compute the weather blend field, transit paths, world-map image pyramid).
3. **Optional Go server**: serves content-pack updates and, later, cloud saves. It can also serve the static game itself.

The game also works when the core runs in Node or natively — the same Go packages are unit-tested with `go test`.

### 9.2 Stack
- **Frontend**: TypeScript (strict), **Phaser 3**, Vite. Dialogue, menus, and touch controls as an HTML/CSS overlay. Service worker for offline play.
- **Go core**: Go 1.24+ packages compiled with TinyGo to `core.wasm`. Called through a typed message API from a Web Worker.
- **Audio**: Web Audio; a SoundFont synth (e.g. `smplr`) plays the piano, plus sequenced 16-bit-style music and effects from a small sample bank. All lesson timing scheduled against `AudioContext.currentTime`.
- **Storage**: IndexedDB for saves, downloaded content packs, and the world-chunk cache.
- **Shared types**: Go structs in `core/model` → TypeScript via `tygo` → `web/src/core/types.gen.ts`.
- **Optional server**: Go standard library `net/http`.

### 9.3 Repository layout
```
birdie-go-go/
  core/                Go packages compiled to WASM (and tested natively)
    model/             shared types (tygo source)
    lesson/            performance generator + grader
    weather/           per-area weather simulation, typhoons, forecasts
    transit/           network graph, timetables, route planner
    content/           content schema + validation (used by tools and at runtime for packs)
    wasm/              WASM entry point: message dispatch
  tools/
    contentbuild/      YAML → content bundle JSON
    worldbuild/        Tiled world → chunks, blend field, transit paths, world-map pyramid
    assetgen/          placeholder art/audio generation
  server/              optional update server
    cmd/birdie-server/
    internal/updates/  content-pack manifest + files
    internal/save/     (later) cloud saves
  content/
    birds.yaml  spots.yaml  areas.yaml  students.yaml  items.yaml  missions.yaml  transit.yaml
    enemies.yaml  hazards.yaml
    songs/*.yaml  events/*.yaml  dialogue/*.yaml
    world/city.world  world/*.tmj  interiors/*.tmj
  web/
    src/scenes/        Boot, Title, Map, Photo, Piano, Transit, Encounter, Album, Home, WorldMap
    src/systems/       input, audio, party, events, save, time, photoScore, weather, streaming, entities, updates
    src/core/          worker bridge to core.wasm + generated types
    src/ui/            HTML overlay (dialogue, menus, touch controls)
    public/assets/     placeholder art/audio + manifest.json
  Makefile
```

### 9.4 Event system
Events live in `content/events/*.yaml`:
```yaml
- id: oboy_found
  trigger: { type: photo_session_end, spot: park_fountain }
  conditions:
    - flag_not_set: oboy_found
    - chapter_at_least: 1
  actions:
    - dialogue: oboy_found_scene
    - set_flag: oboy_found
    - join_party: oboy
    - add_bond: { who: oboy, amount: 10 }
```
- **Triggers**: `enter_area`, `talk`, `interact`, `photo_taken`, `photo_session_end`, `lesson_complete`, `ride_complete`, `mission_complete`, `day_start`, `time_slot_start`, `album_milestone`, `item_obtained`, `weather_warning`, `encounter_won`, `encounter_escaped`, `energy_depleted`.
- **Conditions**: `flag_set`, `flag_not_set`, `chapter_at_least`, `bond_at_least`, `kei_stage`, `party_has`, `party_lacks`, `has_item`, `money_at_least`, `season`, `time_slot`, `weather` (named weather here), `typhoon_signal_at_least`, `album_has`, `mission_state`, `stop_discovered`, `energy_at_least`, `has_status`, `equipped`.
- **Actions**: `dialogue`, `set_flag`, `clear_flag`, `set_chapter`, `join_party`, `add_bond`, `set_kei_stage`, `give_item`, `give_money`, `unlock_area`, `unlock_line`, `unlock_teleport`, `start_mission`, `start_encounter`, `restore_energy`, `add_status`, `start_scene`, `move_npc`.
- Content is validated by `contentbuild` at build time and by the Go core when an update pack is loaded. Unknown dialogue IDs, species, items, areas, spots, songs, students, lines, stops, or missions are errors. Flags are free-form strings.
- Dialogue lines may carry conditions (e.g. alternate lines when `party_has: kei`).
- Events are evaluated in TypeScript on the main thread (instant reactions to game state).

### 9.5 Missions
`content/missions.yaml` defines tasks beyond the story:
```yaml
- id: spoonbill_request
  giver: magazine_editor
  title: Winter Visitors
  objective: { type: photograph, species: black_faced_spoonbill, min_rating: great, area: nw_wetlands }
  reward: { money: 300, items: [lens_part] }
  available: { season: winter, chapter_at_least: 2 }
  window: { from: 2026-12-01, to: 2027-02-28 }   # optional real-world dates (live missions from updates)
```
Objective types: `photograph`, `lesson` (student, min score), `visit`, `ride` (line or stop), `collect`, `talk`.

**Reminders.** Every `mission_reminder_slots` time slots (set in `content/game.yaml`; 0 turns them off), a toast names one active mission when Angie is back on the map; active missions take turns. Loading a save with active missions shows one reminder right away.

### 9.6 Content packs and updates
- The client ships with the **base pack** (all content plus world chunks).
- The optional server publishes **update packs**: new or changed maps (replaced world chunks or new interiors), missions, events, dialogue, birds, songs — any content type.
- Manifest: `GET {updateServer}/updates/manifest.json` →
  `{ packs: [{ id, version, minClient, sha256, size, url }] }`.
- On startup (if an update server is configured and the device is online) the client fetches the manifest, downloads newer packs in the background, checks the SHA-256, validates the pack with the Go core, stores it in IndexedDB, and applies it at the next title screen or day start. A failing pack is skipped, never applied partially.
- Packs **override by ID**; removals must be listed explicitly (`remove:`).
- Saves reference content by ID; IDs that disappear are ignored gracefully (e.g. an expired live mission).
- Offline or with no server configured, the game simply uses the content it already has.

**Optional server API**
| Method & path | Purpose |
|---|---|
| `GET /updates/manifest.json` | Available content packs |
| `GET /updates/packs/{id}-{version}.pack` | Pack file (zip: content JSON + chunk files) |
| `GET /api/health` | Liveness |
| `GET /api/save`, `PUT /api/save` | *(later)* cloud save sync |

### 9.7 World streaming (huge map)
- **Build** (`tools/worldbuild`): reads the Tiled `.world` (many `.tmj` region maps) and outputs:
  - **Chunks** of 32×32 tiles: tile layers as packed `uint16` IDs (RLE + gzip), a collision **bitset** (128 bytes), objects (spawns, NPCs, spots, stops), and the weather blend cells (§4.9). Files are named by content hash → cached forever.
  - **World index**: chunk grid, hashes, area table, sparse-chunk defaults (e.g. open sea chunks aren't stored; they're generated from a fill rule).
  - **Transit paths**: route polylines for on-map vehicles; stop graph.
  - **World-map pyramid**: pre-rendered low-res images at several zoom levels.
- **Runtime** (`web/src/systems/streaming.ts`):
  - **Active window**: chunks overlapping the camera plus a 1-chunk margin (typically ≤ 12 chunks live).
  - **Prefetch**: one more ring in the direction of travel; during transit rides, chunks along the route polyline ahead of the vehicle. Vehicle speed is capped so streaming keeps up; if a chunk is late, the ride fades briefly instead of showing holes.
  - **Decode** chunk files in a Web Worker; the main thread only uploads textures.
  - **Bake** each chunk's static layers into pooled render textures (below-characters and overhead) — about 2 draw calls per chunk. Animated tiles (water, waves) are a light overlay. At most one chunk is baked per frame to avoid hitches.
  - **Cache**: decoded chunks in an in-memory LRU (≈64); chunk files in the service-worker cache / IndexedDB for offline play.
- **Entities**: NPCs, birds, enemies, and vehicles are simulated only inside the live zone. Outside it, birds are spawn tables re-rolled on entry, and vehicles are computed from timetables. A spatial hash grid serves interaction and collision queries.
- **Pathfinding**: tap-to-move runs A* within loaded chunks only (≤ ~64-tile radius); long journeys use the transit planner.
- **Saves** store only deltas (collected items, flags, positions), never world state.
- **Budgets** are checked by an automated benchmark (scripted walk and bus ride across the city in a headless browser, recording frame times and memory).

### 9.8 Save data
`saveVersion`, `worldSeed`, flags, chapter, day/slot/season, position (area + world coordinates), Energy, status effects, equipped gear and bag contents, money, transit card balance, items, album (photo metadata + small thumbnails), students' progress, missions, discovered stops, unlocked lines and teleports, bond values, `kei.stage`, party, settings (latency offset, control scheme, volume).
- Stored in **IndexedDB** on the device; autosaved at the end of each slot, on entering interiors, and after rides.
- **Export/import** a save file from Settings (backup or moving devices).
- Migrations run on load according to `saveVersion`.

### 9.9 Assets
- All art/audio is placeholder for now — generated by `tools/assetgen` or simple shapes.
- Every asset is referenced by **ID** through `web/public/assets/manifest.json`; code never hardcodes file paths. Replacing art = replacing files with the same ID, dimensions, and frame layout.
- 16-bit constraints (§1.3): 16-color palettes per sprite/tile from a ≤ 256-color master palette (`web/public/assets/palette.gpl`), validated by `tools/assetgen check`.
- Conventions: 16×16 tiles in texture atlases; characters 16×24, 4 directions × 4 walk frames (+ idle); birds have per-species sheets with named animations (`perch`, `hop`, `fly`, `takeoff`, `land`, `wings_spread`); overworld birds 8×8 or 16×16; vehicles in 4 directions.
- No real-world logos or trademarks (transit operators, shops) in shipped assets.

## 10. Non-Goals (v1)
Turn-based or deep combat systems (encounters stay short input challenges, §4.13), multiplayer, accounts, monetization, localization (text is structured for it — Cantonese/Chinese is a natural later target — but English only for v1).

## 11. Open Questions
- Final art direction (pixel art assumed).
- After Tseung Kwan O, which districts come next.
- Final number of areas, species, students, songs.
- Whether weather should ever block paths (e.g. flooded paths after a black rainstorm).
- Whether married life adds gameplay or is post-game only.
- The Bird Paradise and O Boy's journey: what it is like, where he's been, and whether it connects to Kei's digital kingdom or the folklore creatures.
- Kei's digital kingdom: can the player visit it? How does uploading "ghosts" play out in the story (Angie's feelings about it, risks, the folklore ghosts' view of digital ghosts)?
- Which specific folklore creatures to include, and how scary they should look (cozy-spooky vs. genuinely creepy).
- Whether dog encounters should become rarer as the story progresses (e.g. a side quest to help an animal shelter).
