# TODO

Legend: `[ ]` not started · `[~]` in progress · `[x]` done.
Milestones are ordered, and each one ends in something playable. `§n` refers to [SPEC.md](SPEC.md).

## M0: Project scaffold
- [x] Design docs: SPEC.md, AGENTS.md, TODO.md, developer_guide.md, user_guide.md
- [x] `git init`, `.gitignore`, `.editorconfig`
- [x] Go module; `core/` skeleton with `core.wasm` and a worker "ping" round trip (verified in headless Chromium, dev and production builds)
- [x] Verify the TinyGo build of `core.wasm` (≈485 KB; standard Go fallback ≈3 MB)
- [x] Vite + TypeScript + Phaser 3 app at 320×180 with pixel-perfect integer scaling (in device pixels)
- [x] `tools/contentbuild` and `tools/worldbuild` skeletons (world index only; chunking is M1)
- [x] `Makefile`: `dev`, `core`, `content`, `world`, `assets`, `gen`, `test`, `lint`, `bench`, `build`, `server`, `pack` (`bench`, `pack`, and `assets gen` are stubs that fail with a pointer to their milestone)
- [x] `make dev` rebuilds core/content/world on change and reloads the page
- [x] `tygo` config and first `types.gen.ts`
- [x] Optional update server skeleton: health, manifest, pack files, CORS
- [x] PWA: manifest + service worker precaching
- [x] PWA: offline start verified in headless Chromium (service worker precaches game, content, chunks, font)
- [ ] PWA: verify install and offline play on a real phone
- [x] CI workflow written (lint, test, build with TinyGo)
- [ ] CI: confirm it passes on GitHub after the first push
- [ ] HTTPS dev server for phone testing (needs an approved plugin, e.g. `@vitejs/plugin-basic-ssl`)

## M1: Vertical slice
Goal: one in-game day in Tseung Kwan O (estates and mall area + waterfront park on Junk Bay) with both minigames working, offline.

### Foundation
- [x] Content schema + validation (`core/content`), with tests; Tseung Kwan O starter content (areas, 3 birds, 2 spots, 1 student, 2 songs, prologue events)
- [x] Asset manifest + loader; master palette; `assetgen` placeholders + `check`
- [x] Pixel-perfect scaling, letterboxing, rotate-to-landscape prompt
- [x] Input layer that unifies touch and keyboard (mouse: via touch controls; click-to-move later)
- [~] 16-bit UI kit: window frames, dialogue box with typewriter, area toast pixel font (Press Start 2P), menus, album list (still to do: portraits)
- [x] Touch controls: floating joystick, Action button (context label), Menu button
- [x] Audio: unlock on first gesture, synthesized piano, metronome, SFX, looping chiptune music per area (3 original themes) with crossfades
- [ ] SoundFont sample bank (optional upgrade over the synth)

### World and streaming (§4.10, §9.7)
- [x] `worldbuild`: chunking, collision, areas, objects, content-hashed files, world index
- [x] Streaming worker: fetch + gunzip + decode
- [x] Active window, prefetch, LRU, one-bake-per-frame scheduler
- [ ] `?debug=chunks` overlay
- [x] `make bench` with frame-time and memory budgets (p95 16.7 ms at 4× CPU throttle, heap ≈12 MB)

### Overworld (§4)
- [x] Tseung Kwan O starter map (generated placeholder): housing estates, footbridge, mall plaza, estate garden, waterfront park, hillside trail
- [x] Interiors for Angie's flat (bed: sleep to the next day) and Mei's flat (piano, Mei), linked by doors; built like the world (one map = one streamed index)
- [x] Free 8-direction movement with wall sliding; walk/sneak
- [x] Follow camera snapped to whole pixels
- [x] Interiors with fade transitions
- [x] `overhead` layer; tall grass (rustles, scares birds from further, hides Angie when sneaking); ledges
- [x] NPCs and context actions (Talk / Enter / Photograph)
- [x] Overworld birds that flush unless Angie sneaks
- [x] Area name display on entering an area
- [ ] Optional tap-to-move (A* within loaded chunks)

### Photo (§5)
- [x] Photo scene with parallax background and iris-wipe entry
- [x] 3 species with behavior AI (arrive, perch/idle poses, hop, wade, leave): red-whiskered bulbul, oriental magpie-robin, little egret
- [x] Viewfinder: relative drag (touch), follow (mouse), arrows; hold-to-focus, release-to-shoot
- [x] Shot scoring (§5.3), unit tested
- [x] Alert meter and fleeing (§5.4)
- [x] Shot budget; results panel; album storage (album viewer still to do)

### Piano (§6)
- [x] Song format + 2 placeholder songs
- [x] `core/lesson` generator (§6.2), deterministic, tested
- [x] `core/lesson` grader (§6.3), tested
- [x] Piano roll, playhead, Mistake button
- [x] Latency calibration (§6.4)
- [x] Results screen revealing mistakes
- [x] Roll stays in sync with the audio after hesitations (core reports pauses; client maps performance → score time)

### Systems
- [x] Event system (§9.4), unit tested
- [x] Time slots and day cycle (photo sessions and lessons end the slot); HUD shows day/slot/season/money
- [x] IndexedDB saves, autosave, migrations, export/import from the menu
- [~] Prologue events (arrival, first photo, first lesson; placeholder text)

## M2: Transit (§4.11)
- [x] `transit.yaml` schema + validation; stop objects indexed by worldbuild
- [ ] `core/transit`: network graph, timetables, `VehicleAt`, route planner, tested
- [ ] On-map vehicles from timetables (no off-screen sim)
- [x] Bus rides on the map with route prefetch and Skip (Green Minibus 16: TKO Plaza ↔ Po Toi O)
- [ ] Trams; Get off at intermediate stops
- [ ] Metro: station interiors, destination picker, in-car scene
- [x] Ferry rides on the map (Junk Bay Pier ↔ Po Toi O Pier)
- [ ] Ferry deck scene and ferry-deck photo spots
- [~] Fares paid from money (a separate transit card and top-up still to do)
- [ ] Route planner UI with transfers
- [ ] Stop discovery; line unlocks via events
- [ ] World map scene (pyramid images, discovered areas, lines)
- [x] Teleport waypoints: Kei's gateways (digitalization/undigitalization through his digital kingdom) (plaza, country park, Po Toi O), glitch-dissolve transition, unlocked once dating with bond 45+
- [ ] Visiting Kei's digital realm itself (open question, SPEC §11)

## M3: Companions (§7)
- [x] Bond system (outings together +2; story events)
- [x] O Boy join event (Chapter 1: rumour on day 2, guaranteed parrotlet at the waterfront, naming scene, joins the party); shoulder perch; alert slowdown in photo scenes
- [~] O Boy: bobs to the beat in lessons; contact call at bond 40+ (Call button / C); spotting and travel carrier still to do
- [x] Party selection (Menu → Party)
- [x] Kei join event (Chapter 3: sticky shutter, camera shop in the plaza); follower movement; bird-call app in photo sessions
- [x] Kei `friends` piano ability: faint trace of the notes actually played
- [ ] Folding ladder (Kei build)
- [x] Kei romance stages through `married` (story events)
- [x] Kei's workshop: trail cameras (dating; photograph a bird each morning), tracking AF and stabilizer (engaged) from camera parts
- [ ] Kei: practice drills for students, home workshop (married)
- [x] O Boy jealousy arc → `oboy_accepts_kei` (birds jumpier with both along until then)
- [ ] Combo ability; party-dependent dialogue

## M4: World and progression
- [x] Clear Water Bay Country Park and Po Toi O fishing village (seamless region east of TKO)
- [ ] More districts: peaks, harbourfront, peak trails, country park, NW wetlands, villages, beaches, an outlying island
- [ ] Seasons with palette-swapped foliage
- [ ] Regional weather (§4.9)
  - [x] Climate profiles in `areas.yaml` + validation
  - [x] `core/weather`: drifting regional front, local variation, smoothing, deterministic, tested
  - [~] Typhoon fronts + signals done (shown in the HUD); rainstorm warnings and effects on transit/spots/lessons still to do
  - [x] Blend field in `worldbuild` + tests
  - [x] Client blend sampling (pure TS) + tests
  - [~] WeatherRenderer: rain, dithered fog, cloud/evening tint done (haze line-scroll, sway, waves, ambience, muffled interiors still to do)
  - [~] Weather in photo scenes (focus time, sharpness, visuals) done; weather-dependent bird tables and sheltering still to do
  - [~] Radio forecast at home done; `?debug=weather` still to do
- [ ] Gear gating (§4.6)
- [ ] Hidden collectibles: feathers, camera parts, sheet music
- [ ] Shop, gear, Kei-built upgrades from parts
- [ ] Students: profiles, progress, new songs
- [ ] *(Parked for future development.)* eBird data for realism: species lists and seasonality per area (Tseung Kwan O, Junk Bay, …) feeding bird tables. Needs a free eBird API key kept outside git; build-time tool only. eBird/Macaulay photos are NOT freely licensed, so don't use them as art.
- [x] Missions (§9.5): photograph and lesson objectives, rewards, Menu → Missions; Chapter 2 missions (magazine egret shot, Mei's recital)
- [ ] Contests, transit missions, live missions from updates
- [x] Trail cameras
- [ ] Album milestones

## M4b: Hazards and encounters (§4.12–4.13)
- [x] Energy meter in the HUD, recovery (snacks, indoors, sleep); no-game-over faint flow (helped home, lost slot, fee)
- [x] Rest on benches (+20 Energy)
- [x] `uv` weather parameter in `core/weather`
- [x] `hazards.yaml` + `hazards.ts`: UV, heat, heavy rain, strong wind, cold, typhoon; status effects; tests
- [x] Gear slots; Bag menu to wear gear and use consumables; convenience store in the mall plaza
- [ ] Bag capacity and packing at home
- [x] Hazard gear items: sun hat, sunscreen, umbrella (breaks in strong wind), raincoat, windbreaker, jacket, water bottle; snacks (milk tea, pineapple bun)
- [~] Weather effects in the photo scene (slower focus, lower sharpness); soaked/overheated status effects still to do
- [x] `enemies.yaml`; enemy roaming, detection (sight, sneaking, tall grass), chase on the map
- [x] Encounter transition (iris) + Encounter Scene
- [x] Escape: mash meter + dodge prompts
- [x] Confront: combo sequences (swipe directions + A/B), time windows, enemy resolve; tests
- [x] Wild dogs (driven off)
- [x] Hopping zombie (jiangshi) and water ghost (shui gwai) with folklore weaknesses
- [ ] First folklore creatures, each with a lore-based weakness
- [x] Companion assists in encounters: O Boy's squawk (one combo step fewer), Kei's whistle vs dogs (−25% resolve) and flash vs monsters (longer windows, from dating)
- [ ] Gear assists in encounters: umbrella block, whistle item
- [x] Accessibility: hold instead of mash, slower prompts, skip encounter (Settings)
- [~] Radio forecast per area done; explicit UV / heat / wind warnings still to do

## M5: Content updates (optional server, §9.6)
- [x] `make pack VERSION=x.y.z`: validated content pack + manifest entry with size and SHA-256
- [ ] Map updates in packs (replaced chunks / new regions)
- [x] `server/cmd/birdie-server`: serve manifest and packs, CORS, immutable caching
- [x] Client: background manifest check (`?updates=` or VITE_UPDATE_SERVER), SHA-256 check, validation in the Go core (`content.validate`), IndexedDB storage, merge by id at next start
- [~] Live missions via packs work (verified end to end); real-world date windows still to do
- [ ] Graceful handling of removed or expired IDs in saves
- [ ] (Later) cloud save sync

## M6: Story (§8)
- [x] Chapters 1–5 and finale events and dialogue (placeholder text: Bird Paradise traveller, magazine, recitals, first date, contest, proposal, wedding)
- [ ] Write the real story text
- [~] Wedding (dialogue) done; wedding scene and shared home still to do
- [ ] Post-game free play

## M7: Polish
- [x] Settings: music/sound volume, encounter accessibility (hold, slow prompts, skip), lesson timing recalibration
- [ ] Settings: control scheme, window color, text speed, reduced motion
- [ ] Accessibility: captions for audio cues, color-blind-safe UI, reduced motion (disables mosaic/wave effects)
- [ ] Low-end phone performance pass
- [ ] Replace placeholder art and music with final 16-bit assets

## Open questions
See SPEC.md §11.
