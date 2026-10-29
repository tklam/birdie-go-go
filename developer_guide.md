# Developer Guide

This guide covers how to set up, run, extend, and ship Birdie Go Go. The game rules live in [SPEC.md](SPEC.md), and the rules for agents live in [AGENTS.md](AGENTS.md).

> Status: design phase. The commands and paths below describe the planned setup (milestone M0 in [TODO.md](TODO.md)).

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
| `make dev` | Builds core, content, and world, then runs Vite in watch mode |
| `make core` | Builds `web/public/core.wasm` with TinyGo |
| `make content` | Validates `content/` and emits the content bundle |
| `make world` | Builds world chunks, the weather blend field, transit paths, and the world-map pyramid |
| `make assets` | Regenerates placeholder assets (`tools/assetgen`) |
| `make gen` | Regenerates `web/src/core/types.gen.ts` from `core/model` |
| `make test` | Runs `go test ./...` and `vitest run` |
| `make lint` | Runs `go vet`, `staticcheck`, `eslint`, `tsc --noEmit`, and `assetgen check` (palettes) |
| `make bench` | Runs the headless streaming benchmark and fails if a budget is exceeded |
| `make build` | Builds a production static site into `dist/` |
| `make server` | Runs the optional update server (`server/cmd/birdie-server`) |
| `make pack` | Builds a content update pack from `content/` against a base version |

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
  main.ts              Phaser config: 320×180, pixelArt, roundPixels, integer zoom
  scenes/              Boot, Title, Map, Photo, Piano, Transit, Encounter, Album, Home, WorldMap
  systems/
    input.ts           unified touch/mouse/keyboard → actions (move vector, action, sneak)
    audio.ts           AudioContext unlock, SoundFont synth, sequencer for music/SFX
    events.ts          trigger dispatch, conditions, actions (pure TS)
    party.ts           companions, bond, follower trail
    time.ts            day / slot / season
    save.ts            IndexedDB save, autosave, export/import, migrations
    streaming.ts       chunk window, prefetch, LRU, baking scheduler
    entities.ts        live-zone simulation, spatial hash
    weather.ts         blend-field sampling (pure) + WeatherRenderer
    photoScore.ts      shot scoring (pure)
    hazards.ts         hazard evaluation from blended weather + gear → statuses, Energy drain (pure)
    combo.ts           encounter input: combo sequences, mash rate, timing windows (pure)
    enemies.ts         enemy roaming, noise/sight detection, chase
    pathfinding.ts     A* within loaded chunks (pure)
    updates.ts         update manifest, pack download, apply
  core/                worker bridge (typed request/response) + types.gen.ts (generated)
  ui/                  16-bit windows, pixel font, dialogue, menus, joystick, action button
```

**Pixel-perfect rendering:** Phaser runs at 320×180 with `pixelArt: true` and `roundPixels: true`. The canvas is scaled by the largest integer that fits the screen, and the rest is letterboxed. The HTML overlay uses the same scale factor, with a bitmap pixel font (`image-rendering: pixelated`), so windows line up exactly with the canvas.

### 4.2 Go layout
```
core/
  model/       shared types (tygo source)
  lesson/      Generate(song, student, difficulty, seed) → Performance, Key; Grade(key, flags, offset) → Result
  weather/     Day(seed, day, areas, climate) → per-area per-slot Params; Forecast; typhoon fronts
  transit/     Network from transit.yaml; Plan(from, to, time) → Route; VehicleAt(line, t) → position
  content/     schema, Validate(bundle) → []error
  wasm/        main.go: message loop (JSON in/out), the only package touching syscall/js
tools/
  contentbuild/  YAML → JSON bundle (uses core/content for validation)
  worldbuild/    Tiled world → chunks, blend field, transit paths, world-map pyramid
  assetgen/      placeholder generation; `check` validates palettes and manifest
server/
  cmd/birdie-server/  flags: -addr, -packs
  internal/updates/   manifest + pack serving (immutable caching, SHA-256)
```

`web/go.mod` exists only to keep `web/` (including Go files that some npm packages ship in `node_modules`) out of the root Go module.

`core/` must build with **TinyGo**. Avoid `encoding/json`'s reflection-heavy paths in hot loops, don't use `reflect`-based libraries, and stick to the standard library. CI builds the core with TinyGo on every push.

### 4.3 Core worker protocol
The main thread sends `{id, op, payload}` and the worker replies `{id, ok, result | error}`. The available operations are:

| `op` | Payload → result |
|---|---|
| `lesson.generate` | `{songId, studentId, difficulty, seed}` → `{lessonId, performance}` (the key stays in the worker) |
| `lesson.grade` | `{lessonId, flagsMs, latencyOffsetMs}` → `{score, hits, misses, falseAlarms, mistakes}` |
| `weather.day` | `{seed, day}` → per-area, per-slot params + forecast + warnings |
| `transit.plan` | `{fromStop, toStop, time}` → route legs |
| `transit.vehicles` | `{lines, time}` → positions (for on-screen vehicles) |
| `content.load` | `{packs}` → merged bundle or validation errors |

`web/src/core/client.ts` wraps these as typed async functions.

### 4.4 Weather pipeline
1. `worldbuild` computes the **blend field**. For each 4×4-tile cell it stores up to three areas with weights `max(0, 1 − d/B)`, normalized. `B` defaults to 8 tiles and can be overridden per area pair in `areas.yaml`.
2. At day start, the client calls `weather.day` and caches the result in the save.
3. Each frame, `weather.ts` samples the blend field at Angie's position (bilinear between cells) and mixes the areas' parameters. `WeatherRenderer` eases toward the target over about 1 s.
4. `PhotoScene` receives the blended parameters at the spot's position.

Debugging: `?debug=weather` shows an overlay with each area's values, the blend weights, and the result, plus sliders to override them.

### 4.5 World streaming
- **Chunks:** 32×32 tiles. Each chunk file holds packed tile layers, a collision bitset, objects, and blend cells, gzipped and named by content hash.
- **Active window:** the chunks under the camera plus a 1-chunk margin. Prefetch extends one more ring in the direction of travel, or follows the route polyline during rides.
- **Decoding** happens in the streaming worker. **Baking** to render textures happens on the main thread, at most one chunk per frame.
- **Caching:** an in-memory LRU of about 64 decoded chunks, with the service worker caching the files.
- **Entities** are simulated only in the live zone. Vehicles come from `transit.vehicles`.

Debugging: `?debug=chunks` draws chunk borders and shows load state, cache hits, and bake times.

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

### 5.4 The world: `content/world/`
- `city.world` is a Tiled world file that places many region `.tmj` maps side by side. Edit one region at a time; `worldbuild` stitches them together.
- Tiles are 16×16, and tilesets must follow the palette rules.
- Layers: `ground`, `detail`, `collision` (any tile is solid), `overhead`, `areas` (one tile per area ID, painted coarsely), and `objects`.
- Object types: `spawn`, `door` (`to_map`, `to_spawn`), `npc` (`npc_id`), `spot` (`spot_id`), `bird` (`species`, `count`), `ledge` (`dir`), `tall_grass` (rect), `gate` (`requires_item`), `collectible` (`item`, `flag`), `stop` (`stop_id`), and `route` (polyline, `line_id`) for on-map bus/tram paths.
- Interiors (homes, shops, metro stations) are separate maps in `content/interiors/`.
- Open sea doesn't need painting. Chunks outside the authored regions are filled by the `fill` rule in the world properties.

### 5.5 Transit: `content/transit.yaml`
```yaml
modes: [bus, tram, metro, ferry, teleport]
lines:
  - id: tram_north_shore
    mode: tram
    name: North Shore Tram
    stops: [west_terminus, market_street, harbour_gardens, east_terminus]
    route: tram_north_shore          # polyline object in the world
    speed: 40                        # px/s on the map
    headway: { morning: 4, afternoon: 6, evening: 8 }   # in-game minutes
    fare: 3
  - id: ferry_outlying_1
    mode: ferry
    stops: [central_pier, lantern_island_pier]
    duration: 35
    fare: 18
    slot_cost: 1
    suspend_at_signal: 8
stops:
  - { id: market_street, name: Market Street, kind: tram_stop }
```
Validation checks that every stop exists in the world, every on-map line has a route, and every metro or ferry stop has an interior or pier.

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
Background music lives in `content/music/<id>.yaml` (multi-track, same note format, with an instrument per track from the 16-bit sample bank) or as `.mid` files. Use original or public-domain music only.

### 5.7 Hazards, gear and enemies
```yaml
# content/hazards.yaml
- id: high_uv
  when: { uv_at_least: 8 }
  status: sunburnt
  drain_per_min: 0.5              # Energy per in-game minute outdoors
  severe: { uv_at_least: 11, drain_per_min: 1.2 }
  countered_by: [sun_hat, sunscreen, umbrella]
- id: strong_wind
  when: { wind_at_least: 0.7 }
  status: windswept
  push: 20                        # px/s sideways along the wind direction
  breaks: { item: umbrella, wind_at_least: 0.8 }
  countered_by: [windbreaker]
```
```yaml
# content/items.yaml (excerpt)
- { id: umbrella, slot: hand, price: 40, counters: [heavy_rain, high_uv], encounter: { block: true, breaks_on_fail: true } }
- { id: sunscreen, kind: consumable, bag_size: 1, duration_slots: 1, counters: [high_uv] }
- { id: water_bottle, kind: consumable, bag_size: 1, refills_at: [fountain, shop], restores: 15, counters: [heat] }
```
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

### 5.8 Students, missions, events, dialogue
- Students: `content/students.yaml` (name, level, home, repertoire, mistake `tendencies`, fee).
- Missions: `content/missions.yaml`. See SPEC.md §9.5 for the schema and objective types.
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

- **Manifest:** `web/public/assets/manifest.json` maps IDs to files and metadata:
  ```json
  { "char_angie": { "type": "spritesheet", "file": "chars/angie.png", "frameWidth": 16, "frameHeight": 24, "palette": "pal_angie" } }
  ```
- **Palettes:** the master palette is `web/public/assets/palette.gpl` (≤ 256 colors). Each sprite or tile uses at most 15 colors plus transparency. Palette swaps (seasons, plumage variants, time-of-day tint) are defined in `palettes.json` and applied with a palette-lookup shader.
- **Placeholders:** `make assets` generates placeholders with the same IDs, sizes, frame layouts, and palette rules as the final art.
- **Replacing an asset:** drop the new file at the same path with the same dimensions and frame layout. `make lint` (`assetgen check`) then verifies the palette and size.
- **Character sheets:** 16×24 frames. Rows are down, left, right, up; columns are idle and walk 1–3.
- **Audio:** a small 16-bit-style sample bank (`.sf2`) for music and effects, plus a clearer piano `.sf2` for lessons. There are no large streamed audio files.
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

**Benchmark (`make bench`):** a scripted walk across several districts plus a bus and ferry ride, run in headless Chromium with mobile CPU throttling. It fails if p95 frame time exceeds 33 ms, if any frame exceeds 50 ms during streaming, or if memory exceeds the budget.

**Manual:** test on at least one iOS Safari and one Android Chrome device per milestone, covering touch controls, audio unlock, latency calibration, offline play, and installing as an app.

## 8. Building and deploying

```sh
make build        # → dist/ (static site: HTML, JS, core.wasm, content, world chunks, assets)
```
- **Host `dist/` on any static host** (GitHub Pages, Netlify, Cloudflare Pages, S3+CDN). Serve `.wasm` as `application/wasm` and give hashed chunk and asset files long-lived `Cache-Control: immutable`.
- **Optional update server:**
  ```sh
  make pack VERSION=1.1.0     # → packs/base-1.1.0.pack + updated manifest
  go run ./server/cmd/birdie-server -addr :8080 -packs ./packs
  ```
  The game finds the server through `VITE_UPDATE_SERVER` at build time or the `?updates=` URL parameter. Run it behind HTTPS and enable CORS for the game's origin.
- **Packs are additive:** bump `minClient` when a pack needs newer client code.

## 9. Workflow

1. Pick a task in TODO.md and mark it `[~]`.
2. Implement it with tests. Keep content in `content/` and shared logic in `core/`.
3. Run `make gen` if the models changed, then `make test` and `make lint`. Also run `make bench` if you touched performance-sensitive code.
4. Update SPEC.md, user_guide.md, or this guide if behavior or workflow changed.
5. Mark the task `[x]` in TODO.md and commit with a scoped message.
