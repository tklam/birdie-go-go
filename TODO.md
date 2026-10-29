# TODO

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.
Milestones are ordered, and each one ends in something playable. `§n` refers to [SPEC.md](SPEC.md).

## M0: Project scaffold
- [x] Design docs: SPEC.md, AGENTS.md, TODO.md, developer_guide.md, user_guide.md
- [x] `git init`, `.gitignore`, `.editorconfig`
- [x] Go module; `core/` skeleton with `core.wasm` and a worker "ping" round trip (verified in headless Chromium, dev and production builds)
- [ ] Verify the TinyGo build of `core.wasm` (TinyGo wasn't installed locally; the standard Go fallback is used)
- [x] Vite + TypeScript + Phaser 3 app at 320×180 with pixel-perfect integer scaling (in device pixels)
- [x] `tools/contentbuild` and `tools/worldbuild` skeletons (world index only; chunking is M1)
- [x] `Makefile`: `dev`, `core`, `content`, `world`, `assets`, `gen`, `test`, `lint`, `bench`, `build`, `server`, `pack` (`bench`, `pack`, and `assets gen` are stubs that fail with a pointer to their milestone)
- [x] `make dev` rebuilds core/content/world on change and reloads the page
- [x] `tygo` config and first `types.gen.ts`
- [x] Optional update server skeleton: health, manifest, pack files, CORS
- [x] PWA: manifest + service worker precaching
- [ ] PWA: verify offline start and install on a real phone
- [x] CI workflow written (lint, test, build with TinyGo)
- [ ] CI: confirm it passes on GitHub after the first push
- [ ] HTTPS dev server for phone testing (needs an approved plugin, e.g. `@vitejs/plugin-basic-ssl`)

## M1: Vertical slice
Goal: one in-game day in Tseung Kwan O (estates and mall area + waterfront park on Junk Bay) with both minigames working, offline.

### Foundation
- [x] Content schema + validation (`core/content`), with tests; Tseung Kwan O starter content (areas, 3 birds, 2 spots, 1 student, 2 songs, prologue events)
- [ ] Asset manifest + loader; master palette; `assetgen` placeholders + `check`
- [ ] Pixel-perfect scaling, letterboxing, rotate-to-landscape prompt
- [ ] Input layer that unifies touch, mouse, and keyboard
- [ ] 16-bit UI kit: window frames, pixel font, cursor, dialogue box with portrait, menus
- [ ] Touch controls: floating joystick, Action button, Menu button
- [ ] Audio: unlock on first gesture, SoundFont synth, music sequencer

### World and streaming (§4.10, §9.7)
- [ ] `worldbuild`: chunking, collision bitsets, objects, content-hashed files, world index
- [ ] Streaming worker: fetch + decode
- [ ] Active window, prefetch, LRU, one-bake-per-frame scheduler
- [ ] `?debug=chunks` overlay
- [ ] `make bench` with frame-time and memory budgets

### Overworld (§4)
- [ ] Tseung Kwan O starter maps: housing estates, footbridges, mall plaza, waterfront promenade and park; interiors for Angie's flat and a student's flat
- [ ] Free 8-direction movement with wall sliding; walk/sneak
- [ ] Follow camera snapped to whole pixels
- [ ] Interiors with fade transitions
- [ ] `overhead` layer; tall grass; ledges
- [ ] NPCs and context actions (Talk / Look / Enter / Photograph)
- [ ] Overworld birds that flush unless Angie sneaks
- [ ] Area name display on entering an area
- [ ] Optional tap-to-move (A* within loaded chunks)

### Photo (§5)
- [ ] Photo scene with parallax background, iris-wipe entry
- [ ] 3 placeholder species with behavior AI: red-whiskered bulbul, oriental magpie-robin, little egret
- [ ] Viewfinder: relative drag, hold-to-focus, release-to-shoot
- [ ] Shot scoring (§5.3), unit tested
- [ ] Alert meter and fleeing (§5.4)
- [ ] Shot budget; results screen; album storage

### Piano (§6)
- [ ] Song format + 2 placeholder songs
- [ ] `core/lesson` generator (§6.2), deterministic, tested
- [ ] `core/lesson` grader (§6.3), tested
- [ ] Piano roll, playhead, Mistake button
- [ ] Latency calibration (§6.4)
- [ ] Results screen revealing mistakes

### Systems
- [ ] Event system (§9.4), unit tested
- [ ] Time slots and day cycle
- [ ] IndexedDB saves, autosave, export/import, migrations
- [ ] Prologue events (tutorial)

## M2: Transit (§4.11)
- [ ] `transit.yaml` schema + world consistency validation
- [ ] `core/transit`: network graph, timetables, `VehicleAt`, route planner, tested
- [ ] On-map vehicles from timetables (no off-screen sim)
- [ ] Bus and tram rides on the map with route prefetch; Get off / Skip
- [ ] Metro: station interiors, destination picker, in-car scene
- [ ] Ferry: pier, deck scene, ferry-deck photo spots
- [ ] Transit card: fares, top-up
- [ ] Route planner UI with transfers
- [ ] Stop discovery; line unlocks via events
- [ ] World map scene (pyramid images, discovered areas, lines)
- [ ] Teleport waypoints: Kei's real-to-digital gateways, digital-dissolve transition, unlocked through his story

## M3: Companions (§7)
- [ ] Bond system
- [ ] O Boy join event (Chapter 1); shoulder perch; abilities; travel carrier
- [ ] Party selection (home / talk to companion)
- [ ] Kei join event (Chapter 3); follower movement; `friends` abilities
- [ ] Kei romance stages and abilities through `married`
- [ ] O Boy jealousy arc → `oboy_accepts_kei`
- [ ] Combo ability; party-dependent dialogue

## M4: World and progression
- [ ] More districts beyond Tseung Kwan O: Clear Water Bay country park and peaks, fishing village cove, harbourfront, peak trails, country park, NW wetlands, villages, beaches, an outlying island
- [ ] Seasons with palette-swapped foliage
- [ ] Regional weather (§4.9)
  - [ ] Climate profiles in `areas.yaml` + validation
  - [ ] `core/weather`: drifting regional front, local variation, smoothing, deterministic, tested
  - [ ] Typhoon fronts + signals; rainstorm warnings; effects on transit, spots, lessons
  - [ ] Blend field in `worldbuild` + tests
  - [ ] Client blend sampling (pure TS) + tests
  - [ ] WeatherRenderer: rain, fog, haze line-scroll, tint, sway, waves, ambience, muffled interiors
  - [ ] Weather in photo scenes; weather-dependent bird tables; sheltering
  - [ ] Radio forecast at home; `?debug=weather`
- [ ] Gear gating (§4.6)
- [ ] Hidden collectibles: feathers, camera parts, sheet music
- [ ] Shop, gear, Kei-built upgrades from parts
- [ ] Students: profiles, progress, new songs
- [ ] Missions (§9.5): requests, contests, transit missions
- [ ] Trail cameras
- [ ] Album milestones

## M4b: Hazards and encounters (§4.12–4.13)
- [ ] Energy meter, HUD, recovery (food, benches, home); no-game-over faint flow (clinic/home, lost slot, fee)
- [ ] `uv` weather parameter in `core/weather`
- [ ] `hazards.yaml` + `hazards.ts`: UV, heat, heavy rain, strong wind, cold, typhoon; status effects; tests
- [ ] Gear slots + bag capacity; packing UI at home
- [ ] Hazard gear items: sun hat, sunscreen, umbrella (breaks in strong wind), raincoat, windbreaker, jacket, water bottle
- [ ] Hazard effects in the photo scene (fogged lens, heat haze)
- [ ] `enemies.yaml`; enemy roaming, detection (noise/sight), chase on the map
- [ ] Encounter transition (swirl/mosaic) + Encounter Scene
- [ ] Escape: mash meter + dodge prompts
- [ ] Confront: combo sequences (swipe directions + A/B), time windows, enemy resolve; tests
- [ ] Wild dogs (driven off)
- [ ] Zombies (incl. folklore-style hopping zombies) with telegraphed patterns
- [ ] First folklore creatures, each with a lore-based weakness
- [ ] Gear and companion assists in encounters
- [ ] Accessibility: hold instead of mash, slower prompts, skip encounter
- [ ] Radio forecast includes UV / heat / wind / rain warnings

## M5: Content updates (optional server, §9.6)
- [ ] `make pack`: build update packs (content + replaced chunks), manifest, SHA-256
- [ ] `server/cmd/birdie-server`: serve manifest and packs, CORS, immutable caching
- [ ] Client: check manifest, background download, validate via core, apply at title / day start
- [ ] Live missions with real-world date windows
- [ ] Graceful handling of removed or expired IDs in saves
- [ ] (Later) cloud save sync

## M6: Story (§8)
- [ ] Chapters 1–5 and finale events and dialogue
- [ ] Wedding scene and shared home
- [ ] Post-game free play
- [ ] O Boy past-owner side quest

## M7: Polish
- [ ] Settings: volume, control scheme, window color, recalibrate, text speed
- [ ] Accessibility: captions for audio cues, color-blind-safe UI, reduced motion (disables mosaic/wave effects)
- [ ] Low-end phone performance pass
- [ ] Replace placeholder art and music with final 16-bit assets

## Open questions
See SPEC.md §11.
