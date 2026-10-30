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
- [ ] *(Parked for future development.)* PWA: verify install and offline play on a real phone
- [x] CI workflow written (lint, test, build with TinyGo)
- [ ] *(Parked for future development.)* CI: confirm it passes on GitHub after the first push
- [ ] *(Parked for future development.)* HTTPS dev server for phone testing (needs an approved plugin, e.g. `@vitejs/plugin-basic-ssl`)

## M1: Vertical slice
Goal: one in-game day in Tseung Kwan O (estates and mall area + waterfront park on Junk Bay) with both minigames working, offline.

### Foundation
- [x] Content schema + validation (`core/content`), with tests; Tseung Kwan O starter content (areas, 3 birds, 2 spots, 1 student, 2 songs, prologue events)
- [x] Asset manifest + loader; master palette; `assetgen` placeholders + `check`
- [x] Pixel-perfect scaling, letterboxing, rotate-to-landscape prompt
- [x] Input layer that unifies touch and keyboard (mouse: via touch controls; click-to-move later)
- [x] 16-bit UI kit: window frames, dialogue box with typewriter, area toast pixel font (Press Start 2P), menus, album list, speaker portraits
- [x] Touch controls: floating joystick, Action button (context label), Menu button
- [x] Audio: unlock on first gesture, synthesized piano, metronome, SFX, looping chiptune music per area (3 original themes) with crossfades
- [x] Sampled piano for lessons (Salamander Grand Piano, CC BY 3.0; the synth plays until the samples load)

### World and streaming (§4.10, §9.7)
- [x] `worldbuild`: chunking, collision, areas, objects, content-hashed files, world index
- [x] Streaming worker: fetch + gunzip + decode
- [x] Active window, prefetch, LRU, one-bake-per-frame scheduler
- [x] `?debug=chunks` overlay
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
- [x] Optional tap-to-move (A* within loaded chunks; Settings → Controls)

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
- [x] Prologue events (arrival, first photo, first lesson)

## M2: Transit (§4.11)
- [x] `transit.yaml` schema + validation; stop objects indexed by worldbuild
- [x] `core/transit`: network graph, timetables, `VehicleAt`, route planner, tested
- [x] On-map vehicles from timetables (no off-screen sim)
- [x] Bus rides on the map with route prefetch and Skip (Green Minibus 16: TKO Plaza ↔ Po Toi O)
- [x] Trams (Harbourfront Tram, three stops); get off at intermediate stops (planner)
- [x] Metro: Harbour and Wetland Lines, destination via the planner, a platform and in-car scene (route strip, tunnel lights, Skip)
- [x] Ferry rides on the map (Junk Bay Pier ↔ Po Toi O Pier)
- [x] Ferry deck photos (Deck button on ferry rides, `ferry_deck` spot)
- [x] Fares paid with the Harbour Pass transit card; top-ups at shops and stop kiosks (save v3)
- [x] Route planner UI with transfers (boarding menu, multi-leg rides, game clock)
- [x] Stop discovery; line unlocks via events (`unlock_line`, `unlock_teleport`, `stop_discovered`)
- [x] World map (Menu → Map): one-pixel-per-tile overview built by worldbuild, markers for Angie, birding spots, transit, open gateways, shop and homes
- [x] World map: zoom levels (×1–×3, scrolls to Angie), discovered-areas fog (`overview_areas.png`), transit lines
- [x] Teleport waypoints: Kei's gateways (digitalization/undigitalization through his digital kingdom) (plaza, country park, Po Toi O), glitch-dissolve transition, unlocked once dating with bond 45+
- [x] Kei's digital realm: decided, it can't be visited for now (gateways only pass through it)

## M3: Companions (§7)
- [x] Bond system (outings together +2; story events)
- [x] O Boy join event (Chapter 1: rumour on day 2, guaranteed parrotlet at the waterfront, naming scene, joins the party); shoulder perch; alert slowdown in photo scenes
- [~] O Boy: bobs to the beat in lessons; contact call at bond 40+ (Call button / C); voice from real parrotlet recordings (chirps, call, squawk); spotting and travel carrier parked for future development
- [x] Party selection (Menu → Party)
- [x] Kei join event (Chapter 3: sticky shutter, camera shop in the plaza); follower movement; bird-call app in photo sessions
- [x] Kei `friends` piano ability: faint trace of the notes actually played
- [ ] *(Parked for future development.)* Folding ladder (Kei build)
- [x] Kei romance stages through `married` (story events)
- [x] Kei's workshop: trail cameras (dating; photograph a bird each morning), tracking AF and stabilizer (engaged) from camera parts; first-visit intro
- [ ] *(Parked for future development.)* Kei: practice drills for students, home workshop (married)
- [x] O Boy jealousy arc → `oboy_accepts_kei` (birds jumpier with both along until then)
- [x] Combo ability (Kei's app + O Boy's call bring a hidden bird); party banter on entering areas

## M4: World and progression
- [x] Clear Water Bay Country Park and Po Toi O fishing village (seamless region east of TKO)
- [x] More districts: Harbour Island (harbourfront, park, peak trail), the Fishpond Wetlands (Wetland Line from chapter 2) and Pebble Island (village, hilltop, beach; Island Ferry from Po Toi O)
- [x] 20 districts: plus Sai Kung (seafront, geopark), Old Town (typhoon shelter, market with bird garden), Lion Ridge (ridge, estate), Border Fields (Long Valley fields, walled village), Lantern Island (tea plateau, stilt village); Minibus 1A, Ridge Line, Lantern Ferry, Harbour Line to Old Town
- [x] Seasons with palette-swapped foliage (autumn and winter tile atlases on the world map)
- [x] Regional weather (§4.9)
  - [x] Climate profiles in `areas.yaml` + validation
  - [x] `core/weather`: drifting regional front, local variation, smoothing, deterministic, tested
  - [x] Typhoon fronts + signals and rainstorm warnings (HUD, announcements, `weather_warning`); ferries, spots and lessons close at T8+ or black rain
  - [x] Blend field in `worldbuild` + tests
  - [x] Client blend sampling (pure TS) + tests
  - [x] WeatherRenderer: rain, fog, cloud/evening tint, heat haze, wind-blown leaves, wave crests; rain and wind ambience, muffled indoors
  - [x] Weather in photo scenes (focus time, sharpness, visuals), weather-dependent bird tables and sheltering
  - [x] Radio forecast at home; `?debug=weather` overlay
- [x] Gear gating (§4.6): gates, wading boots (mudflats), night lens (Night Woods), kayak (Sea Cave off Po Toi O); the ladder is parked with Kei's extras
- [x] Hidden collectibles: feathers, camera parts, sheet music (9 placed; two new pieces, Egret's Lullaby and Tram Bell Rag)
- [x] Shops with their own stock (`shops.yaml`): Plaza Convenience Store, Harbour Outdoors, Po Toi O Village Store
- [x] Students progress through their repertoire; second student Ah Fai in Po Toi O (his house and piano); two new original pieces
- [x] More students and songs: Mrs Ho (retired teacher, ho_flat) and three new pieces (Evening Tea, Egret's Lullaby, Tram Bell Rag)
- [ ] *(Parked for future development.)* eBird data for realism: species lists and seasonality per area (Tseung Kwan O, Junk Bay, …) feeding bird tables. Needs a free eBird API key kept outside git; build-time tool only. eBird/Macaulay photos are NOT freely licensed, so don't use them as art.
- [x] Missions (§9.5): photograph and lesson objectives, rewards, Menu → Missions; Chapter 2 missions (magazine egret shot, Mei's recital)
- [x] Contests, transit missions, live missions (`ride`/`visit` objectives, `available` and real-date `window`)
- [x] Trail cameras
- [x] Mission reminders every few time slots (`mission_reminder_slots`)
- [x] Bedtime reminders in the evening away from home (`bedtime_reminder`)
- [x] Townspeople at stops who explain the minibus, ferry and gateways
- [x] Morning bills (electricity, phone, water and gas, rent) from `game.yaml`
- [x] Rain balance: spring ~35% and summer ~40% wet slots (was 60–70%), autumn and winter mostly dry
- [x] 104 bird species from freely licensed photos (birdphoto + segmentation masks + vision-checked auto picks), spread over the four spots by habitat and season
- [x] Paged album for 100+ species
- [x] More birding spots: Po Toi O mudflat and Deep Bay Mudflat (waders), Fishpond Bird Hide (ducks, spoonbills), Night Woods (owls), Harbourfront Park (cockatoos), Peak Trail (raptors)
- [x] Album milestones (5, 10, 25, 50, 100 species; Birding Society rewards)

## M4b: Hazards and encounters (§4.12–4.13)
- [x] Energy meter in the HUD, recovery (snacks, indoors, sleep); no-game-over faint flow (helped home, lost slot, fee)
- [x] Rest on benches (+20 Energy)
- [x] Everyday Energy costs: walking outdoors (scaled by area `walk_effort`, hills cost more), photo sessions and lessons; too tired to start when low; low-Energy warning; more food
- [x] `uv` weather parameter in `core/weather`
- [x] `hazards.yaml` + `hazards.ts`: UV, heat, heavy rain, strong wind, cold, typhoon; status effects; tests
- [x] Gear slots; Bag menu to wear gear and use consumables; convenience store in the mall plaza
- [x] Bag capacity and packing at home (cupboard, save v4)
- [x] Hazard gear items: sun hat, sunscreen, umbrella (breaks in strong wind), raincoat, windbreaker, jacket, water bottle; snacks (milk tea, pineapple bun)
- [x] Weather effects in the photo scene (slower focus, lower sharpness); soaked/overheated status effects
- [x] `enemies.yaml`; enemy roaming, detection (sight, sneaking, tall grass), chase on the map
- [x] Encounter transition (iris) + Encounter Scene
- [x] Escape: mash meter + dodge prompts
- [x] Confront: combo sequences (swipe directions + A/B), time windows, enemy resolve; tests
- [x] Wild dogs (driven off)
- [x] Hopping zombie (jiangshi) and water ghost (shui gwai) with folklore weaknesses
- [x] Tougher enemies, more spawn points, each spawn cleared separately
- [x] First folklore creatures, each with a lore-based weakness (hopping zombie, water ghost)
- [x] Companion assists in encounters: O Boy's squawk (one combo step fewer), Kei's whistle vs dogs (−25% resolve) and flash vs monsters (longer windows, from dating)
- [x] Gear assists in encounters: umbrella block, whistle item
- [x] Accessibility: hold instead of mash, slower prompts, skip encounter (Settings)
- [x] Radio forecast per area with hazard warnings (UV, heat, wind, cold, rain) and areas

## M5: Content updates (optional server, §9.6)
- [x] `make pack VERSION=x.y.z`: validated content pack + manifest entry with size and SHA-256
- [ ] *(Parked for future development.)* Map updates in packs (replaced chunks / new regions)
- [x] `server/cmd/birdie-server`: serve manifest and packs, CORS, immutable caching
- [x] Client: background manifest check (`?updates=` or VITE_UPDATE_SERVER), SHA-256 check, validation in the Go core (`content.validate`), IndexedDB storage, merge by id at next start
- [x] Live missions via packs work (verified end to end), with real-world date windows
- [ ] *(Parked for future development.)* Graceful handling of removed or expired IDs in saves
- [x] Cloud save sync (sync codes on the optional server; Settings → Cloud save)

## M6: Story (§8)
- [x] Chapters 1–5 and finale events and dialogue (placeholder text: Bird Paradise traveller, magazine, recitals, first date, contest, proposal, wedding)
- [x] Write the real story text (first draft of every scene; side characters Uncle Chan and Siu Ming; epilogue)
- [x] Wedding scene (staged at the waterfront park, via `start_scene`) and the shared home (photo wall, bed, piano, cupboard)
- [x] Post-game free play (epilogue; seasonal and live missions, album and students continue)

## M7: Polish
- [x] Settings: music/sound volume, encounter accessibility (hold, slow prompts, skip), lesson timing recalibration
- [x] Settings: window color, text speed, reduced motion, control scheme
- [x] Companions fight in encounters: O Boy's song, Kei's digital guardian, their duet (content-tuned)
- [x] Splash poster (SVG illustration, full resolution, outside the 16-bit look)
- [x] Sound effects and soundscapes from data (content/sounds.yaml): area ambience (city, market, harbour, forest, wetland, beach, village), bird calls for every species, tram bell, ferry horn, minibus beep
- [x] Accessibility: reduced motion (fades for wipes/glitch, no shake/flash, calm rain), captions for sound cues, colour-blind-safe palette
- [x] Health-check fixes: the closing key no longer reopens a dialogue; ferry deck photos land at the destination; unique collectible names and enemies kept away from arrivals (worldbuild checks); encounter-loss notice (`energy.faint`); scrolling notice panels and 44 px menu rows; Menu button for mouse; Skip/Back in the timing check; Leave in every mini game; queued dialogues; map markers hidden in unvisited areas
- [x] "Next stop" during on-map rides (buses, trams, ferries): get off at the next stop on the way; later legs are dropped, the fare stays paid
- [ ] *(Parked for future development.)* Low-end phone performance pass
- [~] Replace placeholder art and music with final 16-bit assets (characters redrawn in a top-down adventure style; birds from real photos; tiles and music still placeholders)

## Open questions
See SPEC.md §11.

## Place stories and mini games (§4.14)
- [x] Mini game framework (`start_minigame`, `minigame_complete`, minigame mission objectives, `minigames.yaml`)
- [x] Six types: quiz, memory, rhythm, catch, find, slide
- [x] A history story and favour for each of the 20 districts
