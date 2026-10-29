# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project

**Birdie Go Go** is a cozy, touch-friendly browser JRPG in **16-bit retro style**. Its world is a huge map modelled on **Hong Kong** (dense city, green spaces inside the city, hills, wetlands, islands), with a top-down Zelda-style overworld. The player is **Angie**, who photographs birds and teaches piano. She's joined by **O Boy** (a blue-green Pacific parrotlet) and **Kei** (an engineer, later her boyfriend and then husband). She gets around on foot or by bus, tram, metro, ferry, and teleport. Along the way she faces occasional wild dogs and monsters (short input-challenge encounters) and harsh weather that calls for the right gear.

- Game design: [`SPEC.md`](SPEC.md), the source of truth.
- Setup, architecture, workflows: [`developer_guide.md`](developer_guide.md).
- Player-facing behavior: [`user_guide.md`](user_guide.md).
- Work plan and status: [`TODO.md`](TODO.md).

Status: M0 done; M1 (the Tseung Kwan O vertical slice) mostly done. See TODO.md.

## Architecture in one paragraph

The game is a **static web app**: no server is needed to play. A TypeScript + Phaser 3 frontend handles rendering, input, audio, and events. A **Go core** compiled to WebAssembly (TinyGo) runs in a Web Worker and handles lesson generation and grading, weather, transit routing, and content-pack validation. **Go build tools** validate content and turn the Tiled world into streamable chunks. An **optional Go server** delivers content updates (maps, tasks, missions, events) and, later, cloud saves.

## Layout

- `core/`: Go packages, compiled to `core.wasm` and tested natively.
- `tools/`: Go build tools (`contentbuild`, `worldbuild`, `assetgen`).
- `server/`: optional Go update server.
- `content/`: YAML data, Tiled world and interiors.
- `web/`: TypeScript, Phaser 3, Vite, plus an HTML/CSS overlay for UI.

## Commands

```sh
make dev       # build core.wasm + content + world, run Vite on :5173 (rebuilds on change)
make server    # run the optional update server on :8080
make test      # go test ./... and vitest
make lint      # go vet + staticcheck, eslint + tsc --noEmit, asset palette check
make gen       # regenerate web/src/core/types.gen.ts from core/model (tygo)
make bench     # streaming/frame-time benchmark in a headless browser
make build     # static site in dist/ (deploy anywhere)
```

Before declaring a task done, run `make test` and `make lint`. If you touched streaming, rendering, entities, or transit, also run `make bench`. Whenever `core/model` changes, run `make gen` and commit the generated file.

## Rules

1. **The server is optional.** No feature may require the update server to be reachable. The game must start, play, and save fully offline.
2. **Content is data.** Story, dialogue, birds, spots, areas, songs, students, items, missions, transit lines, and events all live in `content/`. Never hardcode story beats, names, or balance numbers. If the event system can't express something, extend it and document the change in SPEC.md §9.4 and developer_guide.md.
3. **Canon is fixed.** Angie; O Boy (blue-green Pacific parrotlet); Kei (CS/engineering, joins mid-game). Kei's stages are `met → friends → dating → engaged → married`.
4. **Original content.** The 16-bit look and the Zelda-style overworld are *style* references. Never copy maps, characters, sprites, music, or names from existing games. The world is Hong Kong-*inspired*: no real transit or shop logos or trademarks in assets. Use original or lightly fictionalized names.
5. **16-bit constraints.** Native 320×180, integer scaling, whole-pixel positions, 16-color palettes per sprite/tile from the master palette (SPEC.md §1.3). `make lint` checks palettes.
6. **Touch first.** Every interaction must work on a touchscreen. No hover-only UI. Tap targets must be at least 44 CSS px. Mouse and keyboard are equivalent alternatives, not the primary path.
7. **Performance is a feature.** The map is huge. Only the active chunk window is loaded and simulated. Never iterate over the whole world at runtime, never simulate off-screen vehicles (they're computed from timetables), and do at most one chunk bake per frame. Respect the budgets in SPEC.md §4.10.
8. **Single source of truth in Go.** Lesson generation and grading, weather, and route planning live in `core/` only. Don't reimplement them in TypeScript; call the worker.
9. **Determinism.** Lessons and weather must be deterministic for a given seed. Never use global `math/rand` state.
10. **Audio timing on the client.** Schedule all music and lesson audio against `AudioContext.currentTime`.
11. **Assets by ID.** Reference assets only through `web/public/assets/manifest.json`. Placeholders must match the final asset's ID, size, frame layout, and palette rules (SPEC.md §9.9).
12. **Companion abilities are hints**, never automatic success (SPEC.md §7.2, §4.13).
13. **No game over.** Encounters and hazards cost Energy and time, never story progress. Every encounter must be avoidable, and accessibility options (hold instead of mash, slower prompts, skip encounter) must keep working.
14. **Keep docs in sync.** Gameplay rules go in SPEC.md, workflows in developer_guide.md, and controls or player-visible behavior in user_guide.md. Check off finished work in TODO.md.
15. **Dependencies.** Prefer the standard library. Ask before adding a Go module or npm package that developer_guide.md doesn't list. Code in `core/` must build with TinyGo.

## Conventions

- **Go:** `gofmt`, table-driven tests, errors wrapped with `%w`, no global state outside `main` or the WASM entry point. `core/` packages are pure: no file, network, or `syscall/js` access outside `core/wasm`.
- **TypeScript:** `strict` mode, no `any` in committed code, one Phaser scene per file in `web/src/scenes/`, and cross-scene logic in `web/src/systems/`. Pure logic (photo scoring, blending, pathfinding, event evaluation) stays free of Phaser so it can be unit-tested.
- **YAML:** `snake_case` IDs, unique per content type. Every new ID must pass `contentbuild` validation.
- **Commits:** imperative mood with a scope prefix (`core:`, `web:`, `tools:`, `server:`, `content:`, `docs:`).

## Where to look

| Task | Location |
|---|---|
| Add a bird species | `content/birds.yaml`, sprites in `web/public/assets/birds/`, manifest entry |
| Add a birding spot | `content/spots.yaml` + `spot` object in the world `.tmj` |
| Add or change an area | `content/areas.yaml` + paint the `areas` layer in the world |
| Edit the world map | `content/world/*.tmj` (Tiled world `city.world`), then `make world` |
| Edit an interior | `content/interiors/<id>.tmj`, then `make world` |
| Bird art from real photos | `art/birds/sources.yaml`, `tools/birdphoto`, `art/birds/CREDITS.md` |
| Add a transit line or stop | `content/transit.yaml` + `stop`/`route` objects in the world |
| Add a mission | `content/missions.yaml` |
| Add a song or music | `content/songs/<id>.yaml`, `content/music/<id>.yaml` |
| Add story or dialogue | `content/events/*.yaml`, `content/dialogue/*.yaml` |
| Overworld movement and camera | `web/src/scenes/MapScene.ts`, `web/src/systems/input.ts` |
| Chunk streaming | `web/src/world/`, `tools/worldbuild/`, SPEC.md §9.7 |
| Weather | `core/weather/`, `web/src/systems/weather.ts`, SPEC.md §4.9 |
| Transit | `core/transit/`, `web/src/scenes/TransitScene.ts`, SPEC.md §4.11 |
| Weather hazards, Energy, gear | `content/hazards.yaml`, `content/items.yaml`, `web/src/systems/hazards.ts`, SPEC.md §4.12 |
| Enemies and encounters | `content/enemies.yaml`, `web/src/scenes/EncounterScene.ts`, `web/src/systems/combo.ts`, SPEC.md §4.13 |
| Photo scoring | `web/src/systems/photoScore.ts`, SPEC.md §5.3 |
| Lesson generation and grading | `core/lesson/`, `core/rpc/`, `web/src/scenes/PianoScene.ts`, SPEC.md §6.2–6.3 |
| Content updates | `server/internal/updates/`, `web/src/systems/updates.ts`, SPEC.md §9.6 |
