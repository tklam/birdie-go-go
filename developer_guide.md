# Developer Guide

This guide covers how to set up, run, extend, and ship Birdie Go Go. The game rules live in [SPEC.md](SPEC.md), and the rules for agents live in [AGENTS.md](AGENTS.md).

> Status: M0 done, M1 (the Tseung Kwan O vertical slice) mostly done. Items marked *(planned)* describe later milestones in [TODO.md](TODO.md).

## 1. Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Go | 1.24+ | Core, tools, optional server |
| TinyGo | 0.34+ (optional) | Smaller `core.wasm`; without it `make core` falls back to standard Go (~3 MB) |
| Node.js | 22 LTS+ | Frontend build |
| make | any | Task runner |
| [Tiled](https://www.mapeditor.org/) | 1.10+ | World and interior maps |
| `tygo` | latest | Go → TypeScript types (`go install github.com/gzuidhof/tygo@latest`) |
| `staticcheck` | latest | Go lint (`go install honnef.co/go/tools/cmd/staticcheck@latest`) |
| Playwright browsers | via npm | `make bench`, end-to-end tests |

Approved dependencies (ask before adding others):
- Go: `gopkg.in/yaml.v3` (tools only, not `core/`).
- npm: `phaser`, `smplr`, `vite`, `vite-plugin-pwa`, `idb`, `typescript`, `vitest`, `playwright`, `eslint`.

## 2. Getting started

```sh
git clone <repo> birdie-go-go && cd birdie-go-go
cd web && npm install && cd ..
make dev
```

Then open http://localhost:5173. `make dev` does the following:
1. Builds `core.wasm` with TinyGo.
2. Runs `contentbuild` (validates YAML and emits `web/public/content/base.json`).
3. Runs `worldbuild` (emits chunks and the world index to `web/public/world/`).
4. Starts Vite with hot reload. It also watches `core/`, `content/`, and `web/`, and rebuilds whatever changed.

**Testing on a phone on the same network:** run `make dev HOST=0.0.0.0` and open `http://<your-ip>:5173`. Mobile browsers need HTTPS for service workers and sometimes for audio; an HTTPS dev server is still on the TODO list. Until then, test those features on a deployed build or through a tunnel.

**Testing content updates:** run `make server` in a second terminal and start the game with `?updates=http://localhost:8080`. Alternatively, set `VITE_UPDATE_SERVER` in `web/.env.local`.

## 3. Make targets

| Target | What it does |
|---|---|
| `make dev` | Builds core, content, and world, then runs Vite in watch mode; edits under `core/`, `content/`, `content/world/` or `content/interiors/` rebuild and reload |
| `make core` | Builds `web/public/core.wasm` (TinyGo if installed, else standard Go) |
| `make content` | Validates `content/` and emits the content bundle |
| `make world` | Builds the city world and every interior into streamed chunks (weather blend field, transit paths and world-map pyramid are *(planned)*) |
| `make assets` | Regenerates placeholder art, using real-photo bird sheets from `art/birds/out/` when present |
| `make gen` | Regenerates `web/src/core/types.gen.ts` from `core/model` |
| `make test` | Runs `go test ./...` and `vitest run` |
| `make lint` | Runs `gofmt`, `go vet`, `staticcheck`, `eslint`, `tsc --noEmit`, and `assetgen check` (palettes) |
| `make bench` | Builds, then runs the headless streaming benchmark (`tools/bench/bench.mjs`); fails if a budget is exceeded |
| `make build` | Builds a production static site into `dist/` |
| `make server` | Runs the optional update server (`server/cmd/birdie-server`) |
| `make pack` | *(planned, M5)* builds a content update pack |

One-off tools:
- `go run ./tools/mapgen -force` regenerates the placeholder maps (Tseung Kwan O, Clear Water Bay, Harbour Island, the Wetlands, Pebble Island) and interiors. Don't run it once the maps have been edited in Tiled. To add a region or interior without touching hand-edited maps, generate into a scratch folder (`-world <dir>/world`) and copy just the new files and `city.world`. Adding a tile to the catalogue moves the meta tileset's `firstgid` up by one in every map; shift the meta gids in existing maps to match.
- `go run ./tools/birdphoto -sources art/birds/sources.yaml -out art/birds/out` turns real bird photos into sprite sheets (see §6), then `make assets`.

## 4. Architecture

```
Browser (static, PWA)
├─ Main thread: TypeScript + Phaser 3
│    scenes · input · rendering · audio · events · UI overlay · IndexedDB
├─ Core worker: core.wasm (Go via TinyGo)
│    lesson · weather · transit routing · content-pack validation
└─ Streaming worker: chunk fetch + decode
Build time (Go): contentbuild · worldbuild · assetgen
Optional (Go): update server → content packs; later cloud saves
```

### 4.1 Frontend layout
```
web/src/
  main.ts              Phaser config (320×180, pixelArt, integer zoom); registers scenes; exposes window.__game
  scenes/              Boot (assets, content, world index) · Title (New Game / Continue) · Map (overworld and
                       interiors) · Photo · Piano · Calibration
  systems/
    session.ts         Session: content + GameState + core + saves + event runner (registry 'session')
    state.ts           GameState, newGame, seasons
    events.ts          trigger matching, conditions, state actions, EventHost (pure)
    time.ts            time slots and days
    save.ts            versioned saves, migrations, IndexedDB/memory stores, export/import
    backup.ts          download/upload of save files
    photoScore.ts      shot scoring, alert meter, album bests (pure)
    party.ts           FollowerTrail for companions (pure)
    input.ts           keyboard + touch joystick → move/sneak/action/menu
    assets.ts          manifest types, loader queueing
    display.ts         pixel-perfect zoom (whole device pixels)
  world/
    chunk.ts           chunk format decoding (pure)
    streaming.ts       wanted-chunk window, ChunkStore (LRU, collision/area/ground queries) (pure)
    movement.ts        tile collision with wall sliding and south-only ledges (pure)
    chunk.worker.ts    fetch + gunzip + decode off the main thread
    loader.ts          one cached worker loader per map
    ChunkRenderer.ts   bakes chunks into pooled render textures (one per frame)
  photo/birds.ts       bird tables, landing spots, idle poses (pure)
  piano/               song timing, roll layout, results, calibration math, lesson bookkeeping (pure)
  audio/               AudioEngine (offline additive piano, metronome, SFX) + voice math (pure)
  core/                worker bridge (client.ts, core.worker.ts) + types.gen.ts (generated)
  ui/                  DOM overlay: 16-bit windows, dialogue, menu, panel, HUD, album, toast, touch controls, pixel font
```

**Registry keys:** `core` (CoreClient), `audio` (AudioEngine), `manifest`, `content`, `world` (city index), `session`, plus `lastPhotos` and `lastLesson` written by the task scenes.

**Pixel-perfect rendering:** Phaser runs at 320×180 with `pixelArt: true` and `roundPixels: true`. The canvas is scaled by the largest whole number of *device* pixels that fits the screen, and the rest is letterboxed. The DOM overlay uses the same scale through the CSS variable `--px` and the Press Start 2P pixel font, so windows line up with the canvas.

### 4.2 Go layout
```
core/
  model/       shared types (tygo source)
  lesson/      Generate(payload) → Performance, answer key; Grade(key, flags, offset) → Result
  rpc/         Server: worker request dispatch; keeps lesson keys until grading
  content/     content validation (also used for update packs)
  wasm/        WASM entry point, the only package touching syscall/js
  weather/     (planned) per-area weather simulation
  transit/     Build(transit, stopPositions) → Network; VehicleAt, Plan (timetables, route planner)
tools/
  contentbuild/  YAML → JSON bundle (uses core/content)
  worldbuild/    Tiled world or single map → chunks + index
  mapgen/        placeholder Tseung Kwan O map and interiors
  assetgen/      placeholder art, manifest, palette checks
  birdphoto/     real bird photos → 16-bit sprite sheets and album portraits
  internal/tko/  the TKO tile catalogue shared by assetgen and mapgen
  bench/         streaming benchmark (Node + headless Chromium)
server/
  cmd/birdie-server/  flags: -addr, -packs, -allow-origin, -saves (cloud saves; off when empty)
  internal/updates/   manifest + pack serving (immutable caching)
  internal/saves/     cloud saves under random sync codes (POST/PUT/GET /api/save)
```

`web/go.mod` exists only to keep `web/` (including Go files that some npm packages ship in `node_modules`) out of the root Go module.

`core/` must build with **TinyGo**. Avoid `encoding/json`'s reflection-heavy paths in hot loops, don't use `reflect`-based libraries, and stick to the standard library. CI builds the core with TinyGo on every push.

### 4.3 Core worker protocol
The main thread sends `{id, op, payload}` and the worker replies `{id, ok, result | error}`. The available operations are:

| `op` | Payload → result |
|---|---|
| `ping` | `{echo}` → `{echo, coreVersion}` |
| `lesson.generate` | `{song, tendencies, difficulty, seed}` → `{lessonId, performance}` (the answer key stays in the worker) |
| `lesson.grade` | `{lessonId, flagsMs, latencyOffsetMs}` → `{score, hits, misses, falseAlarms, mistakes}` |
| `weather.day` | *(planned)* `{seed, day}` → per-area, per-slot params + forecast + warnings |
| `transit.load` | `{transit, stopPositions}` → `{lines, stops}`; keeps the network in the worker for the two calls below (call again after a content update) |
| `transit.plan` | `{from, to, time, lines?, excludeModes?, ignoreTimetable?}` → `{depart, arrive, duration, fare, transfers, legs}`; each leg has `line, from, to, direction, wait, depart, arrive, ride, fare, path`. Unreachable → error `destination unreachable` |
| `transit.vehicles` | `{lines?, time}` → `{vehicles: [{line, direction, depart, x, y, dx, dy, progress}]}` |
| `content.load` | *(planned)* `{packs}` → merged bundle or validation errors |

`web/src/core/client.ts` wraps these as typed async functions.

### 4.4 Weather pipeline
1. `worldbuild` computes the **blend field**. For each 4×4-tile cell it stores up to three areas with weights `max(0, 1 − d/B)`, normalized. `B` defaults to 8 tiles and can be overridden per area pair in `areas.yaml`.
2. At day start, the client calls `weather.day` and caches the result in the save.
3. Each frame, `weather.ts` samples the blend field at Angie's position (bilinear between cells) and mixes the areas' parameters. `WeatherRenderer` eases toward the target over about 1 s.
4. `PhotoScene` receives the blended parameters at the spot's position.

Debugging: `?debug=weather` shows an overlay with each area's values, the blend weights, and the result, plus sliders to override them.

### 4.5 World streaming
- **Maps:** the city is map `world` (`web/public/world/`); each interior is its own small streamed map under `web/public/world/maps/<id>/`. `MapScene` loads any of them by id.
- **Chunks:** 32×32 tiles. Each gzipped chunk file holds the ground/detail/overhead layers, a collision code per tile, area indices and objects, named by content hash (format in `tools/worldbuild/main.go`).
- **Active window:** the chunks under the camera plus a 1-chunk margin, and one more ring in the direction of travel. Tiles in chunks that aren't loaded yet count as solid.
- **Decoding** happens in a worker per map. **Baking** into two pooled render textures per chunk (below and above characters) happens on the main thread, at most one chunk per frame.
- **Caching:** an in-memory LRU of 64 decoded chunks; the service worker precaches chunk files for offline play.
- **Overworld birds** spawn from `bird` objects when their chunk loads and are removed when it's evicted.

## 5. Content authoring

Everything lives in `content/`. Running `make content` (or `make dev`) fails with a list of errors if any reference is broken.

### 5.1 Birds: `content/birds.yaml`
Use real species from the Hong Kong region, drawn as original art.
```yaml
- id: red_whiskered_bulbul
  name: Red-whiskered Bulbul
  sprite: bird_red_whiskered_bulbul        # manifest ID
  overworld_sprite: owbird_small_brown
  skittishness: 0.3                        # 0 calm … 1 very skittish
  size_band: [0.08, 0.30]                  # ideal bbox/frame ratio
  speed: 120                               # px/s in flight
  seasons: [spring, summer, autumn, winter]
  poses: { wings_spread: 1.0, perched_alert: 0.9, perched: 0.8, flying: 0.7, flapping: 0.5, back_turned: 0.3 }
  behaviors: [perch, hop, forage, fly]
```

### 5.2 Spots: `content/spots.yaml`
```yaml
- id: park_fountain
  area: hillside_park
  background: bg_park_fountain
  shots: 12
  birds:
    - { species: red_whiskered_bulbul, weight: 5, slots: [morning, afternoon] }
    - { species: yellow_crested_cockatoo, weight: 2 }
    - { species: pacific_parrotlet, weight: 0, requires_flag: chapter1_started }
    - { species: oriental_magpie_robin, weight: 4, weather_bonus: { drizzle: 2.0, rainstorm: 0.2 } }
- id: ferry_deck_outlying
  kind: ferry_deck                          # opened from a ferry ride
  line: ferry_outlying_1
  birds:
    - { species: black_tailed_gull, weight: 5, seasons: [winter] }
```

### 5.3 Areas: `content/areas.yaml`
```yaml
- id: hillside_park
  name: Hillside Park
  music: bgm_park
  requires: null                    # or an item, e.g. wading_boots
  blend_tiles: { harbour_city: 12 } # override the default 8-tile band with a given neighbor
  climate:                          # per season: [mean, variability]
    spring: { cloud: [0.6, 0.2], precip: [0.3, 0.3], temp: [22, 3], fog: [0.3, 0.2], wind: [0.3, 0.2] }
    summer: { cloud: [0.5, 0.3], precip: [0.4, 0.3], temp: [30, 2], fog: [0.0, 0.05], wind: [0.3, 0.3] }
    autumn: { cloud: [0.3, 0.2], precip: [0.1, 0.1], temp: [25, 3], fog: [0.05, 0.05], wind: [0.3, 0.2] }
    winter: { cloud: [0.4, 0.2], precip: [0.1, 0.1], temp: [16, 4], fog: [0.1, 0.1], wind: [0.4, 0.2] }
```
Every area must define all four seasons. Area shapes are painted on the world's `areas` layer.

### 5.4 The world: `content/world/` and `content/interiors/`
- `city.world` is a Tiled world file that places region `.tmj` maps side by side (currently the generated `tko.tmj`). `worldbuild` stitches them together.
- Tilesets are external `.tsj` files in `content/world/tilesets/`: `tko.tsj` (the atlas, with a `name` property per tile) and `meta.tsj` (collision and area marker tiles). Visual layers may only use the atlas.
- Layers: `ground`, `detail`, `overhead` (drawn above characters), `collision` (meta tiles `solid` or `ledge_south`), `areas` (meta tiles naming an area), and `objects`.
- Object types in use: `spawn`, `door` (`to_map`, `to_spawn`, `title`), `npc` (`npc_id`, `student`), `spot` (`spot_id`), `bird` (`species`, `count`), `bed`. *(Planned:)* `gate`, `collectible`, `stop`, `route`.
- A `collectible` (`item` or `song`) is remembered in the save by its object name, so `worldbuild` rejects a name used twice anywhere in the world (as it does for spawn names).
- An `enemy` (`enemy_id`) must sit at least 128 px (8 tiles) from every stop, door, spawn and gateway, more than any enemy's sight plus its wandering, so arriving or boarding never starts an encounter; `worldbuild` rejects closer ones.
- Interiors are single 20×12 maps in `content/interiors/<id>.tmj`, built with `-fill wall_interior`. A door's `to_map` is an interior id or `world`.
- `content/game.yaml` sets `start_map` (`world`) and `start_spawn`, plus `mission_reminder_slots` (time slots between active-mission reminders, 0 = off) and `bedtime_reminder` (`every_seconds`, 0 = off, and the `lines` that take turns when Angie is out in the evening).
- Chunks outside the authored maps aren't stored; they're filled with the `-fill` tile (water for the city).

### 5.5 Transit: `content/transit.yaml`
```yaml
stops:
  - { id: tko_plaza, name: Tseung Kwan O Plaza }       # placed on the map as objects of type `stop` (prop stop_id)
lines:
  - id: minibus_16
    name: Green Minibus 16
    mode: bus                                         # bus | tram | metro | ferry
    fare: 8
    stops: [tko_plaza, po_toi_o_village]              # path runs from the first stop to the last
    path: [[1000, 472], [1000, 504], [2168, 504], [2168, 712], [2136, 712]]   # world px waypoints
    speed: 110                                        # px/s on the map (= px per in-game minute)
    headway: 10                                       # optional: minutes between departures from each terminus (15)
    first: "06:00"                                    # optional: first departure from each terminus (06:00)
    last: "23:30"                                     # optional: last departure; may pass midnight, e.g. "25:00" (23:30)
```
`worldbuild` records stop positions in the world index (`stops`). Rides run the path forwards or backwards. Intermediate stops are placed along the path from their world-index positions (pass them as `stopPositions` to `transit.load`). Transit times are in-game minutes, absolute from day 0 (`day × 1440 + minutes`). `core/transit` computes timetables, vehicle positions and plans; the client must not reimplement them. *(Planned:)* vehicles visible between rides and planner-driven rides in MapScene, metro interiors.

### 5.6 Songs and music
```yaml
# content/songs/twinkle_variation.yaml (lesson piece)
id: twinkle_variation
title: Twinkle Variation
tempo: 96
time_signature: [4, 4]
difficulty: 1
notes:            # pitch (MIDI), start/dur in beats, velocity
  - { pitch: 60, start: 0, dur: 1, vel: 80 }
  - { pitch: 67, start: 2, dur: 1, vel: 85 }
```
Background music lives in `content/music/<id>.yaml`: `tempo`, `loop_beats`, and `tracks`, each with an `instrument` (`square`, `pulse` (25% duty), `triangle`, `noise`; for noise, pitch < 50 is a snare and higher is a hi-hat), a `volume` (0–1) and notes in the song format. Areas pick their tune with `music:`. `web/src/audio/music.ts` loops it on the music bus and crossfades between areas; interiors, photo sessions and lessons are quiet. Use original or public-domain music only.

### 5.7 Hazards, gear and enemies
```yaml
# content/hazards.yaml
- id: high_uv
  name: High UV
  status: sunburnt
  when: { param: uv, min: 8 }          # param: cloud, precip, temp, fog, wind, uv or signal; min and/or max
  drain_per_min: 0.25                  # Energy per in-game minute outdoors (1 real second = 1 minute)
  severe: { min: 11, drain_per_min: 0.5 }
  countered_by: [sun_hat, sunscreen, umbrella]
- id: strong_wind
  name: Strong wind
  status: windswept
  when: { param: wind, min: 0.7 }
  drain_per_min: 0.1
  push: 22                             # px/s at full wind, along the wind direction
  breaks: { item: umbrella, min: 0.8 }
  countered_by: [windbreaker]
```
```yaml
# content/items.yaml (excerpt)
- { id: umbrella, name: Umbrella, kind: gear, slot: hand, price: 60, counters: [heavy_rain, high_uv], description: "..." }
- { id: sunscreen, name: Sunscreen, kind: consumable, price: 25, counters: [high_uv], duration_slots: 1, description: "..." }
- { id: milk_tea, name: Milk Tea, kind: consumable, price: 18, counters: [], restores: 25, description: "..." }
```
*(Planned:)* `encounter` options for items (block, breaks on failure), bag size, refill points.
```yaml
# content/enemies.yaml
- id: stray_dog_pack
  kind: dog                       # driven off, never hurt
  sprite: enemy_stray_dog
  areas: [country_park_east, village_edge]
  slots: [evening]
  sight: 64                       # px; sneaking halves it
  speed: 90
  resolve: 40
  combos: { length: [2, 4], window_ms: [1800, 1200] }   # easier → harder as resolve drops
  escape: { mash_rate: 6.0 }      # taps/s needed to outrun
  damage: 10
- id: hopping_zombie
  kind: monster
  areas: [old_village_cemetery]
  slots: [evening]
  weakness: { item: sticky_rice, effect: resolve_half }   # lore-based weakness
  resolve: 80
  patterns: [lunge, roar]         # telegraphed attacks → block/dodge prompts
  drops: [{ item: rare_part, chance: 0.3 }]
```
Encounter tuning lives entirely in YAML. Combo sequences are generated from the enemy's `combos` settings with a seeded RNG, so they're reproducible in tests.

### 5.8 Passers-by: `content/ambient.yaml`
```yaml
- id: birder
  name: Birder
  sprite: char_birder        # 16×24 character sheet
  kind: birder               # walker | birder (birders photograph birds and appear in photo sessions)
  areas: [tko_waterfront]
  slots: [morning, afternoon]
  per_chunk: 1               # spawned on open tiles of these areas in each loaded chunk, same spots all day
  lines: ["Shh... there's a magpie-robin singing in that tree."]
```

### 5.9 Students, missions, events, dialogue
- Students: `content/students.yaml` (name, level, home, repertoire, mistake `tendencies`, fee).
- Missions: `content/missions.yaml`. See SPEC.md §9.5 for the schema and objective types.
- Shops: `content/shops.yaml` (id, title, stock of item ids); a `shop` object in the world names one with `shop_id` (without it, a shop sells every priced item).
- Events: `content/events/*.yaml`. See SPEC.md §9.4 for triggers, conditions, and actions.
- Dialogue: `content/dialogue/*.yaml`:
  ```yaml
  - id: intro_wake_up
    lines:
      - { speaker: angie, portrait: angie_happy, text: "First day in the city. Camera, check. Sheet music, check." }
      - { speaker: oboy, text: "Chirp!", if: { party_has: oboy } }
  ```

To add a trigger, condition, or action:
1. Implement it in `web/src/systems/events.ts`.
2. Add schema validation in `core/content`.
3. Add tests on both sides.
4. Document it in SPEC.md §9.4.

## 6. Assets (16-bit)

- **Manifest:** `web/public/assets/manifest.json` (generated by `make assets`) maps IDs to files and metadata. Spritesheets have `frameWidth`/`frameHeight` and optional named `frames`; `background` entries list their parallax `layers`, `perches`, and the `ground`/`groundX` band where waders land.
- **Palettes:** the master palette is `web/public/assets/palette.gpl` (38 colors; the last three, olive, yellow-green and chestnut, are for bird plumage). Each frame, tile or image uses at most 15 colors plus full transparency. `make lint` (`assetgen check`) enforces it for all art, placeholder or final.
- **Placeholders:** `make assets` draws placeholders in code with the same IDs, sizes and frame layouts the final art must keep.
- **Real-photo birds:** `tools/birdphoto` builds bird sheets (6 poses × 32×32: perched, perched_alert, wings_spread, flying1, flying2, back_turned) and 96×64 album portraits from freely licensed photos. `art/birds/sources.yaml` records each pose's photo, crop, flip and cut-out settings; `art/birds/CREDITS.md` lists authors and licences. Sprites derived from CC BY-SA photos are CC BY-SA. Only use photos whose licence allows it (own photos, CC0, CC BY, CC BY-SA); eBird/Macaulay Library photos are not freely licensed.
- **Adding bird species in bulk:** `art/birds/scripts/` holds the optional authoring helpers used for the photo birds (Python 3, run from the repo root; they are not needed to build the game, because masks, sources and outputs are committed):
  1. `fetch.py species.json` downloads freely licensed candidates from Wikimedia Commons into `art/birds/candidates/<id>/` (git-ignored), with their credits.
  2. `autopick.py auto.json <ids…>` segments each candidate (rembg), keeps photos showing one whole bird, asks a local vision model through Ollama (`qwen2.5vl:7b`) whether it's a real photo of the right species and which way it faces, and picks perched, alert and flying photos with crops.
  3. `picks2yaml.py art/birds/scripts/picks_manual.json art/birds/scripts/picks_auto.json` (the committed picks, after review fixes) copies the chosen photos to `selected/`, writes a segmentation mask per frame (rembg `isnet-general-use`) and the species entries at the end of `sources.yaml`.
  4. `go run ./tools/birdphoto -species <id>` builds the sheet; `-credits <ids>` prints the CREDITS.md sections.
  Review every sheet by eye before committing. In `sources.yaml`, `mask:` uses a segmentation mask instead of the colour flood fill, and `from: <pose>` reuses another frame (with `offsetX/Y` and `flipX`) when there is no photo for a pose.
- **Replacing an asset:** drop the new file at the same path with the same dimensions and frame layout, then run `make lint`.
- **Character sheets:** 16×24 frames. Rows are down, left, right, up; columns are idle and walk 1–3. `tools/assetgen/characters.go` draws everyone in one top-down adventure style: big round head, short body, automatic two-tone shading lit from the top left, a near-black 1-px outline, and a 1-px body bob on walking frames. Add a character by adding a `charSpec` (hair style, clothes, glasses, hat, child size).
- **Font:** Press Start 2P (SIL OFL, `web/public/fonts/OFL.txt`) for the overlay and Phaser text.
- **Audio:** synthesized in `web/src/audio/`: an additive piano for lessons, and square/pulse/triangle/noise voices for background music and SFX. A SoundFont sample bank is *(planned)*. Recorded clips live in `art/audio/<voice>/*.mp3`; `make assets` copies them to `web/public/assets/audio/` and lists them in the manifest as `audio` entries (`sfx_<name>`), which `AudioEngine.playSample` plays. O Boy's chirps come from xeno-canto field recordings under **CC BY-NC-SA** (`art/audio/CREDITS.md`), so the game is distributed non-commercially.
- **No real-world logos or trademarks.**

## 7. Testing

**Go (`go test ./...`)** must cover:
- `lesson`: determinism (same seed → identical output), mistake constraints, and grading edge cases (window edges, double flags, latency offset, zero mistakes).
- `weather`: determinism, value ranges, correlation between neighbors, a front that drifts with the wind, smooth slot-to-slot changes, and typhoon signal progression.
- `transit`: route planning (transfers, suspended ferries, unlocked lines only) and vehicle positions from timetables.
- `content`: every broken-reference type, missing seasons, and transit/world consistency.
- `worldbuild`: chunk round-trip, blend-field properties (50/50 on boundaries, 100% deep inside, normalized weights).
- A TinyGo build of `core/wasm` in CI.

**TypeScript (vitest):** `photoScore`, `hazards` (thresholds, counters, umbrella breaking, status recovery), `combo` (window timing, wrong input, mash rate, accessibility modes), `pathfinding`, event evaluation, the follower trail, blend-field sampling, streaming window and prefetch logic (with a fake loader), and save migrations.

**Benchmark (`make bench`):** builds the game, plays it in headless Chromium with CPU throttling (`BENCH_CPU`, default 2), walks and teleports Angie across the world so chunk windows change, and fails if p95 frame time exceeds 33 ms, more than 1% of frames exceed 50 ms, the JS heap exceeds 300 MB, or the page logs errors. Set `CHROME` to the browser binary if it isn't `chromium`.

**Manual:** test on at least one iOS Safari and one Android Chrome device per milestone, covering touch controls, audio unlock, latency calibration, offline play, and installing as an app.

## 8. Building and deploying

```sh
make build        # → dist/ (static site: HTML, JS, core.wasm, content, world chunks, assets)
```
- **GitHub Pages:** `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>/` and publishes on every push to `main`. One-time setup: repository Settings → Pages → Source: *GitHub Actions*. The game is then at `https://<user>.github.io/<repo>/`.
- **Host `dist/` on any static host** (GitHub Pages, Netlify, Cloudflare Pages, S3+CDN). Serve `.wasm` as `application/wasm` and give hashed chunk and asset files long-lived `Cache-Control: immutable`.
- **Optional update server:**
  ```sh
  make pack VERSION=1.1.0     # validates content/, writes packs/base-1.1.0.pack and updates packs/manifest.json
  go run ./server/cmd/birdie-server -addr :8080 -packs ./packs -saves ./saves
  ```
  A pack is JSON `{id, version, minClient, content}`; clients merge its content over theirs by id (missions, events, dialogue, birds, spots, items, transit, …). Map changes in packs are *(planned)*. Try it locally with `?updates=http://localhost:8080`; the pack applies on the next start.
  The game finds the server through `VITE_UPDATE_SERVER` at build time or the `?updates=` URL parameter. Run it behind HTTPS and enable CORS for the game's origin.
- **Packs are additive:** bump `minClient` when a pack needs newer client code.

## 9. Workflow

1. Pick a task in TODO.md and mark it `[~]`.
2. Implement it with tests. Keep content in `content/` and shared logic in `core/`.
3. Run `make gen` if the models changed, then `make test` and `make lint`. Also run `make bench` if you touched performance-sensitive code.
4. Update SPEC.md, user_guide.md, or this guide if behavior or workflow changed.
5. Mark the task `[x]` in TODO.md and commit with a scoped message.
