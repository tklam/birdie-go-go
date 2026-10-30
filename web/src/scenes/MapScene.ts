import Phaser from 'phaser';
import type { AmbientNPC, Enemy, TransitItinerary, TransitLeg, TransitVehicle, WeatherDay, WeatherParams, WorldIndex, WorldObject } from '../core/types.gen';
import { rng } from '../photo/birds';
import { nextStopAhead, pathLength, pointAt, stopsAlong, type Pt, type StopOnPath } from '../world/path';
import { arrowToward, edgePoint, nearby } from '../world/nearby';
import { build, buildStatus, CAMERA_PART, placeTrailCamera, TRAIL_CAMERA, trailCamFlag } from '../systems/gadgets';
import { floatingButton } from '../ui/panel';
import { CHUNK_TILES } from '../world/chunk';
import { blendAt, easeWeather, mixWeather } from '../weather/blend';
import { WeatherRenderer } from '../weather/renderer';
import { CONTROL_SCHEMES, MAX_ENERGY, TEXT_SPEEDS, TIME_SLOTS, WINDOW_COLORS, season } from '../systems/state';
import { findPath, type Tile } from '../world/pathfind';
import { activeMissions, doneMissions, type PhotoResult } from '../systems/missions';
import { bestRating } from '../systems/photoScore';
import { assess, breakItem, drain, protection, toggleGear, useItem, type HazardReport } from '../systems/hazards';
import { InputReader } from '../systems/input';
import { FollowerTrail } from '../systems/party';
import type { Session } from '../systems/session';
import { showAlbum } from '../ui/album';
import { Hud } from '../ui/hud';
import { showMenu } from '../ui/menu';
import { showDialogue } from '../ui/dialogue';
import { landmarkShown, showMinimap, type MapMarker } from '../ui/minimap';
import { iris } from '../fx/iris';
import { glitch } from '../fx/glitch';
import { activityCost, crossedLow, type FaintCause, faintOutcome, walkCost } from '../systems/economy';
import { collect, isCollected } from '../systems/collectibles';
import { cloudDownload, cloudUpload, formatCode, normalizeCode } from '../systems/cloud';
import { updateServer } from '../systems/updates';
import { closedGateAt, gateFrom, openWaterAt, spotBlocked, type Gate } from '../systems/gates';
import { bagUsed, pack, stow, takesSpace, unpack } from '../systems/bag';
import { clockLabel, discoverStop, openLines, payFare, stopFlag, topUp } from '../systems/transit';
import { closureReason, hazardForecast, warningAnnouncement, warningTag, warningsAt, type Warnings } from '../systems/warnings';
import { modal } from '../ui/overlay';
import { showPanel } from '../ui/panel';
import { downloadSave, pickSave } from '../systems/backup';
import { loadJSON } from '../systems/data';
import type { Manifest } from '../systems/assets';
import { toast } from '../ui/toast';
import { applyUiPrefs } from '../ui/prefs';
import { TouchControls } from '../ui/touchControls';
import type { AudioEngine } from '../audio/AudioEngine';
import { oboyChirp } from '../audio/oboy';
import { DRY_RAIN, placeSound } from '../audio/cues';
import { soundscapes, type SoundscapePlayer } from '../audio/soundscape';
import type { MusicPlayer } from '../audio/music';
import type { ChunkData } from '../world/chunk';
import { ChunkRenderer, DEPTH } from '../world/ChunkRenderer';
import { workerChunkLoader } from '../world/loader';
import { move, type Box } from '../world/movement';
import { ChunkStore, chunkKey, wantedChunks } from '../world/streaming';

/** Walking speeds in px/s (SPEC.md §4.4). */
const WALK_SPEED = 72;
const SNEAK_SPEED = 34;
/** Angie's collision box relative to her feet. */
const FEET: Box = { ox: -5, oy: -5, w: 10, h: 5 };
/** How far in front of Angie interactions reach. */
const REACH = 22;
/** Distance at which a non-sneaking Angie flushes overworld birds. */
const FLUSH_RADIUS = 44;

type Facing = 'down' | 'left' | 'right' | 'up';
const FACING_ROW: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };

interface Passerby {
  def: AmbientNPC;
  sprite: Phaser.GameObjects.Sprite;
  /** Opened when it rains, if this person carries one (most do). */
  umbrella: Phaser.GameObjects.Sprite | null;
  chunk: string;
  target: { x: number; y: number };
  pauseUntil: number;
  nextShot: number;
  line: string;
}

const PASSERBY_SPEED = 26;
/** The spot used for photos from a ferry's deck. */
const FERRY_DECK = 'ferry_deck';
/** Where Angie lives: her flat, then the home she shares with Kei after the wedding. */
function homeMap(flags: Record<string, true>): string {
  return flags.wedding_done ? 'shared_home' : 'angie_flat';
}
/** The first bedtime reminder of an evening waits until any area toast has gone. */
const BEDTIME_FIRST_MS = 8000;

interface OverworldNpc {
  object: WorldObject;
  sprite: Phaser.GameObjects.Sprite;
  umbrella?: Phaser.GameObjects.Sprite;
  chunk: string;
}

interface OverworldEnemy {
  enemy: Enemy;
  /** The spawn point's name: each spawn is dealt with separately. */
  spawn: string;
  sprite: Phaser.GameObjects.Sprite;
  chunk: string;
  homeX: number;
  homeY: number;
  state: 'wander' | 'chase' | 'return';
  target: { x: number; y: number };
  nextWander: number;
}

/**
 * Remembers which spawn points were dealt with today, the spawn whose
 * encounter is in progress, and short post-escape calm.
 */
const settled = { day: 0, ids: new Set<string>(), pending: '', calmUntil: 0 };

/** The last outdoor rain and wind levels, heard muffled from indoors (SPEC.md §4.9). */
const ambience = { rain: 0, wind: 0, next: 0 };
/** How far (px) bird calls and vehicle bells carry, and the least time (ms) between bird calls. */
const HEAR_RANGE = 160;
const CALL_GAP_MS = 900;

interface OverworldBird {
  sprite: Phaser.GameObjects.Sprite;
  species: string;
  chunk: string;
  homeX: number;
  homeY: number;
  flushed: boolean;
  nextHop: number;
  /** When it may next call (performance time, ms). */
  nextCall: number;
}

export interface MapSceneData {
  /** Map to show: "world" (default) or an interior id. */
  map?: string;
  /** Spawn to place Angie at (otherwise her saved position). */
  spawn?: string;
  /** Name to show on arrival (e.g. from a door's title). */
  title?: string;
  /** Set when returning from a task scene, to end the time slot. */
  from?: 'Photo' | 'Piano' | 'Encounter';
  encounter?: { enemyId: string; outcome: 'won' | 'escaped' | 'lost' | 'skipped' };
  spotId?: string;
  studentId?: string;
  /** Legs still to ride after the metro (transfers). */
  legs?: TransitLeg[];
}

/** Where a map's index and chunks live under the site root. */
function mapPath(map: string): string {
  return map === 'world' ? 'world/' : `world/maps/${map}/`;
}

/** The streamed top-down overworld (SPEC.md §4). */
export class MapScene extends Phaser.Scene {
  private session!: Session;
  private index!: WorldIndex;
  private store!: ChunkStore;
  private chunkRenderer!: ChunkRenderer;
  private input2!: InputReader;
  private touch!: TouchControls;
  private hud!: Hud;
  private angie!: Phaser.GameObjects.Sprite;
  private oboy: Phaser.GameObjects.Sprite | null = null;
  /** Angie's path, for Kei to follow once he joins (Chapter 3). */
  private trail = new FollowerTrail();
  private pos = { x: 0, y: 0 };
  private facing: Facing = 'down';
  private area: string | null = null;
  private birds: OverworldBird[] = [];
  private nextBirdCall = 0;
  /** Vehicles on the map that have rung their bell near Angie. */
  private rung = new Set<string>();
  private enemies: OverworldEnemy[] = [];
  private npcs: OverworldNpc[] = [];
  private gateways: { object: WorldObject; sprite: Phaser.GameObjects.Sprite; chunk: string }[] = [];
  private sparkles: { object: WorldObject; sprite: Phaser.GameObjects.Sprite; chunk: string }[] = [];
  /** Gear gates of loaded chunks (SPEC.md §4.6), and when a bumped gate's hint may show again. */
  private gates: (Gate & { chunk: string })[] = [];
  private bumpedGate: Gate | null = null;
  private nextGateHint = 0;
  private passersby: Passerby[] = [];
  private glints!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** Wave crests on visible water (SPEC.md §4.9), more in wind. */
  private waves!: Phaser.GameObjects.Particles.ParticleEmitter;
  private waterTile = -1;
  private nextWave = 0;
  /** The ride in progress (SPEC.md §4.11), if any. */
  private ride: {
    vehicle: Phaser.GameObjects.Sprite;
    path: Pt[];
    length: number;
    distance: number;
    speed: number;
    to: string;
    line: string;
    /** Legs still to ride after this one (transfers). */
    next: TransitLeg[];
    removeSkip: () => void;
    /** On ferries: the Deck button for photos from the deck. */
    removeDeck?: () => void;
    /** Stops the ride passes before `to`, for getting off early. */
    stops: StopOnPath[];
    /** The Next stop button, while there is a stop ahead to get off at. */
    removeAlight?: () => void;
  } | null = null;
  /** Timetabled vehicles drawn on the map (SPEC.md §4.11): the last poll and its sprites. */
  private vehicles = { list: [] as TransitVehicle[], clock: 0, pending: false, nextPoll: 0, sprites: new Map<string, Phaser.GameObjects.Sprite>() };
  private kei: Phaser.GameObjects.Sprite | null = null;
  /** Umbrellas held over Angie's and Kei's heads (SPEC.md §4.12). */
  private umbrellas: { angie: Phaser.GameObjects.Sprite | null; kei: Phaser.GameObjects.Sprite | null } = { angie: null, kei: null };
  /** ?debug=chunks / ?debug=weather overlays (developer_guide.md §4.4–4.5). */
  private debug: { chunks: boolean; weather: boolean; g?: Phaser.GameObjects.Graphics; text?: Phaser.GameObjects.Text } = { chunks: false, weather: false };
  private flushedChunks = new Set<string>();
  private ready = false;
  private loaded = false;
  private mapId = 'world';
  /** Today's weather (outdoors only), the eased weather at Angie, and its renderer. */
  private weatherDay: WeatherDay | null = null;
  private weatherLoading = -1;
  private weatherNow: WeatherParams | null = null;
  /** Time (ms) of O Boy's next idle chirp on the map. */
  private nextChirp = 0;
  /** When the next bedtime reminder shows (0 = not scheduled), and whose turn it is. */
  private nextBedtime = 0;
  private bedtimeTurn = 0;
  private weatherRenderer: WeatherRenderer | null = null;
  private hazards: HazardReport | null = null;
  private fainting = false;
  /** Why Energy ran out, for the faint notice: a lost encounter, or else the weather. */
  private faintCause: FaintCause = 'weather';
  /** The last warning announced ("day:slot:tag"), so each is announced once. */
  private lastWarning = '';
  /** Riding the metro: the map waits while the screen is dark. */
  private underground = false;
  /** Leaving for another scene from a ride: the map stands still (state.position is already set). */
  private leaving = false;
  /** Tap-to-move: the tiles still to walk (SPEC.md §4.4). */
  private tapPath: Tile[] = [];
  /** Whether Angie walked this frame (walking outdoors costs Energy). */
  private walking = false;
  private exiting = false;
  /** Birding-spot indicators: icons over visible spots, arrows at the edge for nearby ones. */
  private spotMarks: Phaser.GameObjects.Graphics | null = null;
  /** The tune this place should play (area music outdoors, none indoors). */
  private wantMusic: string | null = null;
  /** Ground value of tall grass (atlas frame + 1), or −1 if the atlas has none. */
  private tallGrass = -1;
  /** Ground value of benches, or −1. */
  private benchTile = -1;
  private rustle!: Phaser.GameObjects.Particles.ParticleEmitter;
  private busy = false;

  constructor() {
    super('Map');
  }

  create(data: MapSceneData): void {
    this.session = this.registry.get('session') as Session;
    this.birds = [];
    this.rung.clear();
    this.enemies = [];
    this.npcs = [];
    this.gateways = [];
    this.sparkles = [];
    this.gates = [];
    this.underground = false;
    this.leaving = false;
    this.passersby = [];
    this.ride = null;
    this.kei = null;
    this.umbrellas = { angie: null, kei: null };
    this.flushedChunks.clear();
    this.ready = false;
    this.loaded = false;
    this.busy = true;
    this.area = null;
    this.mapId = data.map ?? this.session.state.position.map ?? 'world';
    this.wantMusic = null;
    this.weatherDay = null;
    this.weatherLoading = -1;
    this.weatherNow = null;
    this.weatherRenderer = null;
    this.hazards = null;
    this.fainting = false;
    this.faintCause = 'weather';
    this.exiting = false;
    this.spotMarks = null;
    // Events' staged scenes (start_scene) run over the paused map.
    this.session.sceneRunner = (scene, data) =>
      this.scene.manager.keys[scene]
        ? new Promise<void>((resolve) => {
            const release = this.holdMap();
            this.scene.launch(scene, {
              ...data,
              done: () => {
                release();
                resolve();
              },
            });
          })
        : typeof data.dialogue === 'string'
          ? this.session.dialogue(data.dialogue)
          : Promise.resolve();
    // Mini games (SPEC.md §4.14) run over the paused map, one scene per type.
    this.session.minigameRunner = (game) => {
      const key = `MG_${game.type}`;
      if (!this.scene.manager.keys[key]) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const release = this.holdMap();
        this.scene.launch(key, {
          game,
          done: (won: boolean) => {
            release();
            resolve(won);
          },
        });
      });
    };
    this.touch = new TouchControls();
    this.touch.setJoystick(this.session.state.settings.controlScheme !== 'tap');
    this.input2 = new InputReader(this, this.touch);
    this.tapPath = [];
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.tapTo(p.worldX, p.worldY));
    this.hud = new Hud();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.touch.destroy();
      this.hud.destroy();
    });
    this.cameras.main.fadeIn(250, 0, 0, 0);
    const index =
      this.mapId === 'world'
        ? Promise.resolve(this.registry.get('world') as WorldIndex)
        : loadJSON<WorldIndex>(`${mapPath(this.mapId)}index.json`);
    void index.then(
      (i) => this.setup(i, data),
      (err: unknown) => {
        console.error(`map ${this.mapId} failed to load`, err);
        toast(`Couldn't load this place.`);
        if (this.mapId !== 'world') this.scene.restart({ map: 'world' });
      },
    );
  }

  /**
   * Pauses the map (HUD and touch controls hidden) under a staged scene or
   * mini game; the returned function undoes it. Only a running map is
   * paused, and only a map this paused is resumed: Phaser warns about
   * pausing a scene that is still starting, already paused or shut down
   * (e.g. a second runner while the first holds the map).
   */
  private holdMap(): () => void {
    const paused = this.sys.isActive();
    if (paused) this.scene.pause();
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    return () => {
      this.hud.setVisible(true);
      this.touch.setVisible(true);
      if (paused && this.sys.isPaused()) this.scene.resume();
    };
  }

  private setup(index: WorldIndex, data: MapSceneData): void {
    this.index = index;
    this.makeAnimations();
    this.tallGrass = this.index.tileNames.indexOf('tall_grass') + 1 || -1;
    this.benchTile = this.index.tileNames.indexOf('bench') + 1 || -1;
    this.waterTile = this.index.tileNames.indexOf('water') + 1 || -1;
    this.makeRustle();
    this.makeGlints();
    this.makeWaves();

    // Outdoors, foliage follows the season: a palette-swapped atlas if there is one (SPEC.md §1.3).
    const seasonal = `${this.index.tileset}_${season(this.session.state.day)}`;
    const tileset = this.mapId === 'world' && this.textures.exists(seasonal) ? seasonal : this.index.tileset;
    this.chunkRenderer = new ChunkRenderer(this, tileset, this.index.tileSize);
    this.store = new ChunkStore(this.index, workerChunkLoader(`${mapPath(this.mapId)}chunks/`), {
      loaded: (c) => {
        this.chunkRenderer.enqueue(c);
        this.spawnBirds(c);
        this.spawnEnemies(c);
        this.spawnNpcs(c);
        this.spawnGateways(c);
        this.spawnSparkles(c);
        for (const o of c.objects) {
          const g = o.type === 'gate' ? gateFrom(o, this.index.tileSize) : null;
          if (g) this.gates.push({ ...g, chunk: chunkKey(c.cx, c.cy) });
        }
        this.spawnPassersby(c);
      },
      evicted: (c) => {
        this.chunkRenderer.remove(c);
        this.despawnBirds(c);
        this.despawnEnemies(c);
        this.despawnNpcs(c);
        this.gateways = this.gateways.filter((g) => (g.chunk === chunkKey(c.cx, c.cy) ? (g.sprite.destroy(), false) : true));
        this.sparkles = this.sparkles.filter((g) => (g.chunk === chunkKey(c.cx, c.cy) ? (g.sprite.destroy(), false) : true));
        this.gates = this.gates.filter((g) => g.chunk !== chunkKey(c.cx, c.cy));
        this.despawnPassersby(c);
      },
      failed: (key, err) => console.warn(`chunk ${key} failed to load`, err),
    });

    const state = this.session.state;
    const saved = state.position.map === this.mapId && !data.spawn ? state.position : null;
    const spawn =
      this.index.spawns[data.spawn ?? state.position.spawn ?? this.session.content.game.startSpawn] ??
      Object.values(this.index.spawns)[0];
    this.pos = {
      x: saved?.x ?? spawn?.x ?? 0,
      y: saved?.y ?? spawn?.y ?? 0,
    };
    this.oboy = null;
    this.angie = this.add.sprite(this.pos.x, this.pos.y, 'char_angie', 0).setOrigin(0.5, 1);
    this.trail.reset(this.pos.x, this.pos.y);

    // Camera bounds come from the placed maps, not the chunk grid, so small
    // interiors don't show fill around them.
    const worldW = Math.max(...this.index.regions.map((r) => r.x + r.width), 1);
    const worldH = Math.max(...this.index.regions.map((r) => r.y + r.height), 1);
    const cam = this.cameras.main.setRoundPixels(true);
    const bw = Math.max(worldW, cam.width);
    const bh = Math.max(worldH, cam.height);
    cam.setBounds(Math.floor((worldW - bw) / 2), Math.floor((worldH - bh) / 2), bw, bh);
    cam.startFollow(this.angie, true, 1, 1);
    if (data.title) toast(data.title);
    if (this.mapId === 'world') this.weatherRenderer = new WeatherRenderer(this);
    const flags = new URLSearchParams(location.search).getAll('debug');
    this.debug = { chunks: flags.includes('chunks'), weather: flags.includes('weather') };
    if (this.debug.chunks || this.debug.weather) {
      this.debug.g = this.add.graphics().setDepth(DEPTH.overhead + 100);
      this.debug.text = this.add
        .text(2, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffff80', backgroundColor: '#000000a0' })
        .setScrollFactor(0)
        .setDepth(DEPTH.overhead + 101);
    }
    this.loaded = true;

    void this.arrive(data);
  }

  /** Story and time bookkeeping when the scene (re)starts. */
  private async arrive(data: MapSceneData): Promise<void> {
    this.busy = true;
    await this.waitForWorld();
    const s = this.session;
    if (data.from === 'Photo' || data.from === 'Piano') s.growBond();
    if (data.from === 'Photo') {
      const shots = (this.registry.get('lastPhotos') as { species: string; result: { rating: PhotoResult['rating'] } }[] | undefined) ?? [];
      const best = bestRating(shots.map((p) => p.result.rating));
      await s.fire({ type: 'photo_session_end', params: data.spotId ? { spot: data.spotId, best } : { best } });
      const area = s.content.spots.find((x) => x.id === data.spotId)?.area ?? '';
      await s.checkMissions({ photos: shots.map((p) => ({ species: p.species, rating: p.result.rating, area })) });
      await s.checkAlbum();
      await s.endSlot();
    } else if (data.from === 'Piano') {
      const last = this.registry.get('lastLesson') as { studentId: string; result: { score: number } } | undefined;
      if (last) await s.checkMissions({ lesson: { studentId: last.studentId, score: last.result.score } });
      await s.fire({ type: 'lesson_complete', params: data.studentId ? { student: data.studentId } : {} });
      await s.endSlot();
    } else if (data.from === 'Encounter' && data.encounter) {
      const e = data.encounter;
      if (e.outcome === 'won' || e.outcome === 'escaped' || e.outcome === 'skipped') {
        this.settle(settled.pending || e.enemyId, e.outcome === 'won');
        await s.fire({ type: e.outcome === 'won' ? 'encounter_won' : 'encounter_escaped', params: { enemy: e.enemyId } });
      } else if (e.outcome === 'lost') {
        s.state.energy = 0;
        this.faintCause = 'encounter';
      }
    } else if (!s.state.firedEvents['prologue_arrival']) {
      await s.fire({ type: 'new_game' });
    }
    await s.save();
    this.busy = false;
    // Transfers after a metro ride carry on from the station.
    const [leg, ...rest] = data.legs ?? [];
    if (leg) this.startLeg(leg, rest);
    this.remindMission();
  }

  /**
   * In the evening, away from home, a toast now and then suggests going
   * home to sleep (SPEC.md §3.1). The first comes a few seconds in.
   */
  private updateBedtime(time: number): void {
    const r = this.session.content.game.bedtimeReminder;
    const away = this.session.state.slot === 'evening' && this.mapId !== homeMap(this.session.state.flags);
    if (!away || !r?.everySeconds || !r.lines.length) {
      this.nextBedtime = 0;
      return;
    }
    if (!this.ready || this.busy || modal.open) return;
    if (this.nextBedtime === 0) this.nextBedtime = time + BEDTIME_FIRST_MS;
    if (time < this.nextBedtime) return;
    toast(r.lines[this.bedtimeTurn++ % r.lines.length], 3500);
    this.nextBedtime = time + r.everySeconds * 1000;
  }

  /** Rain and wind sounds from the weather at Angie, muffled indoors; four times a second. */
  private updateAmbience(time: number): void {
    if (time < ambience.next) return;
    ambience.next = time + 250;
    const w = this.weatherNow;
    if (this.weatherRenderer && w) {
      ambience.rain = Math.max(0, (w.precip - 0.12) / 0.8);
      ambience.wind = Math.max(0, (w.wind - 0.3) / 0.7);
    }
    (this.registry.get('audio') as AudioEngine | undefined)?.setAmbience(ambience.rain, ambience.wind, !this.weatherRenderer);
    // The area's soundscape; indoors the last one carries on, muffled.
    const sounds = this.sounds();
    if (!sounds) return;
    const area = this.weatherRenderer ? this.session.content.areas.find((a) => a.id === this.area) : undefined;
    if (area) sounds.set(this.session.content.sounds.soundscapes.find((x) => x.id === area.soundscape) ?? null);
    sounds.update(this.session.state.slot, season(this.session.state.day), ambience.rain);
  }

  /** The soundscape and cue player (null until audio is unlocked). */
  private sounds(): SoundscapePlayer | null {
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    return audio?.ready ? soundscapes(audio, this.session.content.sounds.cues) : null;
  }

  /** A line's bell (the tram's ding-ding) from a vehicle at (x, y), or aboard when no position is given. */
  private ringBell(lineId: string, x?: number, y?: number): void {
    const bell = this.session.content.transit.lines.find((l) => l.id === lineId)?.bell;
    if (!bell) return;
    if (x === undefined || y === undefined) {
      this.sounds()?.cue(bell, { outdoor: true });
      return;
    }
    const { gain, pan } = placeSound(x, y, this.pos.x, this.pos.y, HEAR_RANGE * 1.5);
    if (gain > 0.02) this.sounds()?.cue(bell, { gain, pan, outdoor: true, silent: gain < 0.3 });
  }

  /** Now and then, a toast about an active mission (SPEC.md §9.5). */
  private remindMission(): void {
    const title = this.session.missionReminder();
    // After the area-name toast has had its moment.
    if (title) this.time.delayedCall(2500, () => toast(`Mission: ${title}`, 3500));
  }

  private waitForWorld(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.ready) resolve();
        else this.time.delayedCall(50, check);
      };
      check();
    });
  }

  update(time: number, delta: number): void {
    if (!this.loaded) return;
    const dt = Math.min(delta, 50) / 1000;
    const input = this.followTapPath(this.input2.read());
    if (this.ride) {
      this.updateRide(time, dt);
      return;
    }
    if (this.underground || this.leaving) return;
    const speed = input.sneak ? SNEAK_SPEED : WALK_SPEED;
    const moving = this.ready && !this.busy && modal.open === 0 && (input.x !== 0 || input.y !== 0);
    this.walking = moving;
    // The in-game clock: one minute per real second of play (SPEC.md §4.11).
    if (this.ready && !this.busy && modal.open === 0) this.session.slotMinutes += dt;

    // Stream the world around the camera, a ring ahead when moving.
    const view = this.cameras.main.worldView;
    this.store.update(
      wantedChunks({ x: view.x, y: view.y, w: view.width || 320, h: view.height || 180 }, this.store.chunkPx, this.index, 1, {
        x: moving ? input.x : 0,
        y: moving ? input.y : 0,
      }),
    );
    this.chunkRenderer.update();
    if (!this.ready && this.store.ready && this.chunkRenderer.pendingCount === 0) this.ready = true;

    const push = this.ready && !this.busy && modal.open === 0 ? (this.hazards?.push ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    if (moving || push.x || push.y) {
      const ts = this.index.tileSize;
      const vx = (moving ? input.x * speed : 0) + push.x;
      const vy = (moving ? input.y * speed : 0) + push.y;
      this.bumpedGate = null;
      this.pos = move(this.pos, vx * dt, vy * dt, FEET, (tx, ty) => this.collisionAt(tx, ty), ts);
      // The collision callback above sets bumpedGate.
      const bumped = this.bumpedGate as Gate | null;
      if (bumped && time >= this.nextGateHint) {
        toast(bumped.hint || 'The way is blocked.', 3000);
        this.nextGateHint = time + 4000;
      }
    }
    if (moving) {
      this.facing = Math.abs(input.x) > Math.abs(input.y) ? (input.x < 0 ? 'left' : 'right') : input.y < 0 ? 'up' : 'down';
      this.angie.anims.play(`angie-walk-${this.facing}`, true);
      this.angie.anims.timeScale = input.sneak ? 0.5 : 1;
    } else {
      this.angie.anims.stop();
      this.angie.setFrame(FACING_ROW[this.facing] * 4);
    }
    this.angie.setPosition(this.pos.x, this.pos.y).setDepth(DEPTH.entities + this.pos.y);
    this.trail.push(this.pos.x, this.pos.y);
    if (!this.oboy && this.session.state.party.includes('oboy')) {
      this.oboy = this.add.sprite(this.pos.x, this.pos.y, 'char_oboy', 0).setOrigin(0.5, 1).play('oboy-idle');
    }
    this.updateKei();
    this.updateNpcs();
    for (const g of this.gateways) g.sprite.setVisible(this.gatewayOpen(g.object)).setFrame(Math.floor(time / 300) % 2);
    for (const g of this.sparkles) g.sprite.setFrame(Math.floor(time / 400 + g.object.x) % 2);
    this.discoverStops();
    this.updateVehicles(time);
    this.updateWaves(time);
    this.updatePassersby(time, dt);
    this.updateUmbrellas();
    this.drawSpotMarks(time);
    if (this.oboy) {
      // Now and then he chirps to himself.
      if (time > this.nextChirp) {
        if (this.nextChirp > 0 && !modal.open) oboyChirp(this.registry.get('audio') as AudioEngine | undefined);
        this.nextChirp = time + 25_000 + Math.random() * 35_000;
      }
      // Perched on the shoulder away from where she's facing.
      const side = this.facing === 'left' ? 5 : -5;
      this.oboy.setFlipX(this.facing === 'left').setPosition(this.pos.x + side, this.pos.y - 11).setDepth(DEPTH.entities + this.pos.y + 1);
    }

    this.session.state.position = { map: this.mapId, x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    this.updateArea();
    if (moving) this.walkOutIfOnExit();
    const inGrass = this.inTallGrass();
    if (moving && inGrass && !input.sneak && Math.random() < 0.3) this.rustle.emitParticleAt(this.pos.x, this.pos.y - 2, 2);
    // Walking through tall grass rustles and scares birds from further away;
    // sneaking through it hides Angie completely (SPEC.md §4.5).
    const flushRadius = inGrass ? (input.sneak ? 0 : FLUSH_RADIUS * 1.6) : FLUSH_RADIUS;
    this.updateBirds(time, moving && !input.sneak, flushRadius);
    this.updateEnemies(time, dt, input.sneak, inGrass);

    this.updateWeather(delta);
    this.updateHazards(delta);
    this.hud.update(this.session.state, this.weatherLabel(), this.hazards?.exposed.map((e) => e.hazard.status) ?? []);
    this.updateMusic();
    this.updateAmbience(time);
    this.updateBedtime(time);
    this.drawDebug();
    if (input.menu && this.ready && !this.busy) void this.openMenu();
    const target = this.ready && !this.busy ? this.interactionTarget() : null;
    this.touch.setAction(target?.label ?? null);
    if (input.action && target) void this.interact(target);
  }

  /** Loads the day's weather, blends it at Angie's position and draws it. */
  private updateWeather(delta: number): void {
    if (!this.weatherRenderer) return;
    const s = this.session;
    const day = s.state.day;
    if (this.weatherDay?.day !== day && this.weatherLoading !== day) {
      this.weatherLoading = day;
      const world = this.registry.get('world') as WorldIndex;
      s.weather(day, world).then(
        (w) => {
          if (s.state.day === w.day) this.weatherDay = w;
        },
        (err: unknown) => console.warn('weather unavailable', err),
      );
    }
    this.announceWarnings();
    const target = this.weatherAt(this.pos.x, this.pos.y - 4);
    if (!target) return;
    this.weatherNow = this.weatherNow ? easeWeather(this.weatherNow, target, delta) : target;
    this.weatherRenderer.update(this.weatherNow, s.state.slot, delta, s.state.settings.reducedMotion);
  }

  /**
   * Hazards outdoors: drain Energy (one in-game minute per real second),
   * push in strong wind, break umbrellas; recover slowly indoors (SPEC.md §4.12).
   */
  private updateHazards(delta: number): void {
    const s = this.session;
    const minutes = Math.min(delta, 100) / 1000;
    const rules = s.content.game.energy;
    if (!this.weatherRenderer) {
      this.hazards = null;
      s.state.energy = Math.min(MAX_ENERGY, s.state.energy + (rules?.indoorRecoveryPerMin ?? 0.3) * minutes);
      return;
    }
    if (!this.weatherNow || !this.weatherDay || this.busy || modal.open || this.fainting) return;
    const signal = this.weatherDay.typhoonSignal[TIME_SLOTS.indexOf(s.state.slot)] ?? 0;
    const worn = new Set(Object.values(s.state.equipped).filter((x): x is string => !!x));
    this.hazards = assess(s.content.hazards, { ...this.weatherNow, signal }, protection(s.state), worn);
    for (const id of this.hazards.breaks) {
      breakItem(s.state, id);
      toast(`Your ${s.content.items.find((i) => i.id === id)?.name.toLowerCase() ?? id} broke in the wind!`);
    }
    const before = s.state.energy;
    s.state.energy = drain(s.state.energy, this.hazards.exposed, minutes);
    if (this.walking) {
      const area = s.content.areas.find((a) => a.id === this.area);
      s.state.energy = Math.max(0, s.state.energy - walkCost(rules, area, minutes));
    }
    if (crossedLow(rules, before, s.state.energy)) toast(rules?.lowWarningText ?? '', 3500);
    if (s.state.energy <= 0) void this.faint();
  }

  /** No game over: a passer-by helps Angie home (SPEC.md §4.12). */
  private async faint(): Promise<void> {
    if (this.fainting) return;
    this.fainting = true;
    this.busy = true;
    const s = this.session;
    const out = faintOutcome(s.content.game.energy, this.faintCause, s.state.money);
    this.faintCause = 'weather';
    this.cameras.main.fadeOut(900, 0, 0, 0);
    await new Promise((r) => this.time.delayedCall(1000, r));
    await showPanel(out.title, out.lines);
    s.state.money -= out.fee;
    s.state.energy = out.recoverTo;
    await s.endSlot();
    const home = homeMap(s.state.flags);
    s.state.position = { map: home, spawn: 'front_door' };
    await s.save();
    this.scene.restart({ map: home, spawn: 'front_door', title: home === 'angie_flat' ? "Angie's flat" : 'Home' });
  }

  /** The blended weather at a world position, or null if unknown. */
  private weatherAt(x: number, y: number): WeatherParams | null {
    const w = this.weatherDay;
    if (!w) return null;
    const slot = TIME_SLOTS.indexOf(this.session.state.slot);
    const weights = blendAt((cx, cy) => this.store.get(cx, cy), x, y, this.index.tileSize);
    return mixWeather(weights, (a) => w.areas.find((aw) => aw.area === this.index.areas[a])?.slots[slot]);
  }

  /** Announces a newly raised typhoon signal or rainstorm warning once per slot (SPEC.md §4.9). */
  private announceWarnings(): void {
    const s = this.session;
    if (!this.weatherDay || !this.ready || modal.open) return;
    const w = warningsAt(this.weatherDay, s.state.slot);
    const key = `${s.state.day}:${s.state.slot}:${warningTag(w)}`;
    if (key === this.lastWarning) return;
    this.lastWarning = key;
    const text = warningAnnouncement(w);
    if (!text) return;
    toast(text, 4500);
    if (w.signal) void s.fire({ type: 'weather_warning', params: { kind: 'typhoon', level: String(w.signal) } });
    if (w.rainstorm) void s.fire({ type: 'weather_warning', params: { kind: 'rainstorm', level: w.rainstorm } });
  }

  /** Today's warnings for the current slot, indoors or out (the weather is cached). */
  private async warningsNow(): Promise<Warnings> {
    const s = this.session;
    try {
      return warningsAt(await s.weather(s.state.day, this.registry.get('world') as WorldIndex), s.state.slot);
    } catch {
      return { signal: 0, rainstorm: '' };
    }
  }

  /** "Rain 21°C", the named weather of the current area, or "" indoors. */
  private weatherLabel(): string {
    const w = this.weatherDay;
    if (!w || !this.area || !this.weatherNow) return '';
    const slot = TIME_SLOTS.indexOf(this.session.state.slot);
    const named = w.areas.find((a) => a.area === this.area)?.named[slot] ?? '';
    const tag = warningTag(warningsAt(w, this.session.state.slot));
    const name = named.charAt(0).toUpperCase() + named.slice(1);
    return `${name} ${Math.round(this.weatherNow.temp)}°C${tag ? ` ${tag}` : ''}`;
  }

  private drawDebug(): void {
    const { g, text } = this.debug;
    if (!g || !text) return;
    g.clear();
    const lines: string[] = [];
    if (this.debug.chunks) {
      const px = this.store.chunkPx;
      let n = 0;
      for (const c of this.store.chunks()) {
        n++;
        g.lineStyle(1, 0xff00ff, 0.8).strokeRect(c.cx * px, c.cy * px, px, px);
      }
      lines.push(`chunks ${n} baking ${this.chunkRenderer.pendingCount} fps ${Math.round(this.game.loop.actualFps)}`);
    }
    if (this.debug.weather && this.weatherNow) {
      const w = this.weatherNow;
      const weights = blendAt((cx, cy) => this.store.get(cx, cy), this.pos.x, this.pos.y - 4, this.index.tileSize);
      const mix = [...weights].map(([a, v]) => `${this.index.areas[a]} ${Math.round(v * 100)}%`).join(', ');
      lines.push(
        `cloud ${w.cloud.toFixed(2)} rain ${w.precip.toFixed(2)} fog ${w.fog.toFixed(2)} wind ${w.wind.toFixed(2)} ${Math.round(w.temp)}C uv ${w.uv.toFixed(1)}`,
        `blend: ${mix}`,
      );
      if (this.hazards) lines.push(`hazards: ${this.hazards.exposed.map((e) => e.hazard.id).join(', ') || '-'} energy ${this.session.state.energy.toFixed(1)}`);
    }
    text.setText(lines.join('\n'));
  }

  /** Starts the wanted tune once audio is unlocked (retried every frame, cheap). */
  private updateMusic(): void {
    const player = this.registry.get('music') as MusicPlayer | undefined;
    if (!player || player.playing === this.wantMusic) return;
    const music = this.session.content.music.find((m) => m.id === this.wantMusic) ?? null;
    player.play(music);
  }

  private updateArea(): void {
    const ts = this.index.tileSize;
    const area = this.store.areaAt(Math.floor(this.pos.x / ts), Math.floor((this.pos.y - 2) / ts));
    if (!area || area === this.area) return;
    const first = this.area === null;
    this.area = area;
    // Entered areas are lifted from the map's fog (SPEC.md §4.10).
    this.session.state.flags[`area:${area}`] = true;
    this.wantMusic = this.session.content.areas.find((a) => a.id === area)?.music ?? null;
    const name = this.session.content.areas.find((a) => a.id === area)?.name ?? area;
    toast(name);
    if (!first) {
      const s = this.session;
      void s.fire({ type: 'enter_area', params: { area } }).then(() => s.checkMissions({ visit: area }));
    }
  }

  // --- Interaction -------------------------------------------------------

  private interactionTarget(): { label: string; object: WorldObject } | null {
    const dir = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.facing];
    const px = this.pos.x + dir[0] * 10;
    const py = this.pos.y - 4 + dir[1] * 10;
    let best: { label: string; object: WorldObject; d: number } | null = null;
    for (const chunk of this.store.chunks()) {
      for (const o of chunk.objects) {
        const label = labelFor(o);
        if (!label || (o.type === 'npc' && !this.npcVisible(o)) || (o.type === 'gateway' && !this.gatewayOpen(o))) continue;
        if (o.type === 'collectible' && isCollected(this.session.state, o.name)) continue;
        const reach = o.type === 'spot' ? REACH * 2 : REACH;
        const d = Math.hypot(o.x - px, o.y - py);
        if (d <= reach && (!best || d < best.d)) best = { label, object: o, d };
      }
    }
    if (!best) {
      for (const p of this.passersby) {
        const d = Math.hypot(p.sprite.x - px, p.sprite.y - 6 - py);
        if (d <= REACH && (!best || d < best.d)) {
          best = { label: 'Talk', object: { name: p.def.name, type: 'passerby', x: p.sprite.x, y: p.sprite.y, props: { line: p.line } }, d };
        }
      }
    }
    if (best) return best;
    // Benches are tiles, not objects: sit on the one in front of Angie.
    const ts = this.index.tileSize;
    if (this.benchTile > 0 && this.store.groundAt(Math.floor(px / ts), Math.floor(py / ts)) === this.benchTile) {
      return { label: 'Sit', object: { name: 'bench', type: 'bench', x: px, y: py, props: {} } };
    }
    // Near unflushed overworld birds: photograph at the area's spot.
    const bird = this.birds.find((b) => !b.flushed && Math.hypot(b.sprite.x - this.pos.x, b.sprite.y - this.pos.y) < 40);
    const spot = bird && this.session.content.spots.find((s) => s.area === this.area && !spotBlocked(s, this.session.state));
    if (spot) return { label: 'Photograph', object: { name: spot.id, type: 'spot', x: 0, y: 0, props: { spot_id: spot.id } } };
    return null;
  }

  private async interact(target: { label: string; object: WorldObject }): Promise<void> {
    const o = target.object;
    this.busy = true;
    try {
      switch (o.type) {
        case 'spot': {
          const spotId = o.props.spot_id;
          const spotDef = this.session.content.spots.find((x) => x.id === spotId);
          const blocked = spotDef ? spotBlocked(spotDef, this.session.state) : null;
          if (blocked === 'needs') {
            const item = this.session.content.items.find((i) => i.id === spotDef?.requiresItem);
            toast(`You'll need ${item ? `the ${item.name}` : 'the right gear'} for this spot.`, 3000);
            return;
          }
          if (blocked === 'closed') {
            toast(`Come back in the ${spotDef?.slots?.join(' or ')}.`, 3000);
            return;
          }
          const closed = closureReason(await this.warningsNow());
          if (closed) {
            toast(`${closed}: the birding spots are closed. Stay safe!`, 3500);
            return;
          }
          const st = this.session.state;
          if ((st.items[TRAIL_CAMERA] ?? 0) > 0 && !st.flags[trailCamFlag(spotId)]) {
            let choice: 'photo' | 'trail' | null = null;
            await showMenu('Birding spot', [
              { label: 'Photograph', run: async () => ((choice = 'photo'), false) },
              { label: 'Place trail camera', run: async () => ((choice = 'trail'), false) },
              { label: 'Not now', run: async () => false },
            ]);
            if (choice === 'trail') {
              placeTrailCamera(st, spotId);
              toast('Trail camera placed. Check the album tomorrow morning!');
              await this.session.save();
              return;
            }
            if (choice !== 'photo') return;
          }
          if (!this.spendEnergy(activityCost(this.session.content.game.energy, 'photo'))) return;
          const slot = TIME_SLOTS.indexOf(this.session.state.slot);
          const named = this.weatherDay?.areas.find((a) => a.area === this.area)?.named[slot];
          const statuses = this.hazards?.exposed.map((e) => e.hazard.id) ?? [];
          await this.leaveTo('Photo', { spotId, returnTo: 'Map', weather: this.weatherNow, named, statuses });
          return;
        }
        case 'npc': {
          const student = o.props.student;
          const fired = await this.session.fire({ type: 'talk', params: { npc: o.props.npc_id ?? o.name } });
          if (fired.length > 0 && !student) break;
          if (student && this.scene.manager.keys['Piano']) {
            const closed = closureReason(await this.warningsNow());
            if (closed) {
              toast(`${closed}: lessons are cancelled. Stay safe at home!`, 3500);
              return;
            }
            if (!this.spendEnergy(activityCost(this.session.content.game.energy, 'lesson'))) return;
            await this.leaveTo('Piano', { studentId: student, returnTo: 'Map' });
            return;
          }
          break;
        }
        case 'door':
          await this.goThrough(o);
          return;
        case 'bed':
          await this.sleep();
          break;
        case 'storage':
          await this.packBag();
          return;
        case 'photo_wall':
          await this.photoWall();
          return;
        case 'radio':
          await this.radio();
          break;
        case 'bench':
          await this.rest();
          break;
        case 'stop':
          await this.boardAt(o.props.stop_id);
          return;
        case 'gateway':
          await this.useGateway(o);
          return;
        case 'collectible':
          this.pickUp(o);
          return;
        case 'passerby':
          await showDialogue([{ speaker: o.name, text: o.props.line }]);
          break;
        case 'shop':
          await this.shop(o);
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  /** Indoors, stepping onto the exit mat leads outside (no Action needed). */
  private walkOutIfOnExit(): void {
    if (this.mapId === 'world' || this.exiting || this.busy) return;
    for (const chunk of this.store.chunks()) {
      for (const o of chunk.objects) {
        if (o.type !== 'door' || o.props.to_map !== 'world') continue;
        if (Math.abs(this.pos.x - o.x) < 8 && Math.abs(this.pos.y - 4 - o.y) < 8) {
          this.exiting = true;
          void this.goThrough(o);
          return;
        }
      }
    }
  }

  /** Through a door; `alt_map`/`alt_title` replace the target once `alt_flag` is set (e.g. the shared home). */
  private async goThrough(door: WorldObject): Promise<void> {
    const alt = door.props.alt_flag && this.session.state.flags[door.props.alt_flag] && door.props.alt_map;
    const map = alt ? door.props.alt_map : door.props.to_map;
    if (!map) return;
    const data: MapSceneData = { map, spawn: door.props.to_spawn, title: (alt && door.props.alt_title) || door.props.title };
    this.session.state.position = { map, spawn: door.props.to_spawn };
    await this.session.save();
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(data));
  }

  /** The radio reads tomorrow's forecast per area (SPEC.md §4.9). */
  private async radio(): Promise<void> {
    const s = this.session;
    const world = this.registry.get('world') as WorldIndex;
    let lines: string[];
    try {
      const w = await s.weather(s.state.day, world);
      const name = (id: string) => s.content.areas.find((a) => a.id === id)?.name ?? id;
      const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
      lines = w.forecast.map((f) => `${name(f.area)}: ${cap(f.named[0])}, then ${f.named[1]}. ${Math.round(f.slots[1].temp)}°C`);
      lines.push(...hazardForecast(s.content.hazards, w.forecast, name));
      if (w.typhoonSignal.some((x) => x > 0)) lines.unshift(`Typhoon signal No. ${Math.max(...w.typhoonSignal)} is in force!`);
    } catch {
      lines = ['Only static on the radio...'];
    }
    await showPanel("Tomorrow's weather", lines);
  }

  /** A shop's stock (shops.yaml, by the object's shop_id), or everything for sale. */
  private async shop(o: WorldObject): Promise<void> {
    const s = this.session;
    const def = s.content.shops.find((x) => x.id === o.props.shop_id);
    const title = def?.title ?? o.props.title ?? 'Shop';
    const stock = def ? s.content.items.filter((i) => def.stock.includes(i.id)) : s.content.items.filter((i) => i.price > 0);
    const card = s.content.game.transitCard;
    await showMenu(
      () => `${title}  $${s.state.money}`,
      [
        ...stock.map((item) => ({
          label: `${item.name} $${item.price}`,
          detail: () => {
            const owned = s.state.items[item.id] ?? 0;
            const afford = s.state.money >= item.price ? 'Choose it again to buy.' : "You can't afford it yet.";
            return `${item.description} Owned: ${owned}. ${afford}`;
          },
          run: async () => {
            if (s.state.money < item.price) {
              toast("You can't afford that.");
              return true;
            }
            s.state.money -= item.price;
            const where = stow(s.state, item, s.content.game.bagCapacity ?? 0, s.content.items);
            toast(where === 'bag' ? `Bought ${item.name}.` : `Bought ${item.name}. Your bag is full, so it's sent home.`, 3000);
            await s.save();
            return true;
          },
        })),
        ...(card
          ? [
              {
                label: `Top up ${card.name} $${card.topUp}`,
                detail: () => `Your ${card.name} has $${s.state.card}. Choose it again to add $${card.topUp}.`,
                run: async () => {
                  toast(topUp(s.state, card) ? `${card.name} topped up: $${s.state.card}` : "You can't afford that.");
                  await s.save();
                  return true;
                },
              },
            ]
          : []),
        { label: 'Leave', run: async () => false },
      ],
      { tapToSelect: true },
    );
  }

  /** The city map with Angie and landmarks (SPEC.md §4.10). */
  private async worldMap(): Promise<boolean> {
    const world = this.registry.get('world') as WorldIndex;
    if (!world.overview) {
      toast('No map available.');
      return true;
    }
    const s = this.session;
    const indoors = this.mapId !== 'world';
    // Only what Angie has found: places in areas she's been to, discovered
    // stops (SPEC.md §4.11) and open gateways.
    const shown = world.landmarks.filter((l) => landmarkShown(l, s.state.flags));
    const markers: MapMarker[] = shown
      .map((l) => ({
        x: l.x,
        y: l.y,
        kind: l.type as MapMarker['kind'],
        label: l.title || s.content.spots.find((x) => x.id === l.id)?.name || s.content.transit.stops.find((x) => x.id === l.id)?.name || l.id,
      }));
    // Indoors, show Angie at the door she came in by.
    const here = indoors ? world.spawns[`${this.mapId.replace(/_(flat|house)$/, '')}_home_out`] ?? null : this.pos;
    if (here) markers.push({ x: here.x, y: here.y, kind: 'angie' });
    const area = indoors ? 'Indoors' : (s.content.areas.find((a) => a.id === this.area)?.name ?? 'Map');
    const spotName = (id: string) => s.content.spots.find((x) => x.id === id)?.name ?? id;
    const close = here ? nearby(shown.filter((l) => l.type === 'spot'), here.x, here.y, MapScene.SPOT_RADIUS) : [];
    for (const m of markers) if (m.kind === 'spot' && close.some((c) => c.x === m.x && c.y === m.y)) m.near = true;
    const note = close.length
      ? `Nearby: ${close.map((c) => `${spotName(c.id)} ${arrowToward(here?.x ?? 0, here?.y ?? 0, c.x, c.y)}`).join(', ')}`
      : 'No birding spots nearby.';
    // Lines with a discovered stop, among those Angie can ride.
    const open = openLines(s.content.transit.lines, s.state);
    const lines = s.content.transit.lines
      .filter((l) => open.includes(l.id) && l.stops.some((id) => s.state.flags[stopFlag(id)]))
      .map((l) => ({ points: l.path, mode: l.mode }));
    await showMinimap({
      title: `Map · ${area}`,
      imageUrl: `${import.meta.env.BASE_URL}world/${world.overview}`,
      widthTiles: world.widthChunks * world.chunkTiles,
      heightTiles: world.heightChunks * world.chunkTiles,
      tileSize: world.tileSize,
      markers,
      lines,
      fog: world.overviewAreas
        ? { url: `${import.meta.env.BASE_URL}world/${world.overviewAreas}`, discovered: (a) => s.state.flags[`area:${world.areas[a]}`] === true }
        : undefined,
      note,
    });
    return true;
  }

  /**
   * Cloud saves on the optional server (SPEC.md §9.6): upload under the sync
   * code (made on the first upload), or download by code on another device.
   */
  private async cloudMenu(): Promise<void> {
    const s = this.session;
    const server = updateServer();
    if (!server) return;
    const st = s.state.settings;
    await showMenu(
      () => `Cloud save${st.cloudCode ? ` · ${formatCode(st.cloudCode)}` : ''}`,
      [
        {
          label: 'Upload this save',
          detail: () => (st.cloudCode ? 'Updates the save under your code.' : 'Makes a sync code for this save.'),
          run: async () => {
            try {
              st.cloudCode = await cloudUpload(server, s.state, st.cloudCode);
              await s.save();
              await showPanel('Uploaded', [`Your sync code: ${formatCode(st.cloudCode)}`, 'Enter it on another device to download this save.']);
            } catch (err) {
              await showPanel('Upload failed', [err instanceof Error ? err.message : String(err)]);
            }
            return true;
          },
        },
        {
          label: 'Download a save',
          detail: () => 'Replaces the game on this device with the save under a sync code.',
          run: async () => {
            const code = normalizeCode(window.prompt('Sync code (12 letters and numbers):') ?? '');
            if (!code) return true;
            try {
              const state = await cloudDownload(server, code);
              state.settings.cloudCode = code;
              s.state = state;
              applyUiPrefs(s.state.settings);
              await s.save();
              this.scene.restart({});
              return false;
            } catch (err) {
              await showPanel('Download failed', [err instanceof Error ? err.message : String(err)]);
              return true;
            }
          },
        },
        { label: 'Back', run: async () => false },
      ],
      { tapToSelect: true },
    );
  }

  /** Volume, accessibility and audio-latency settings (SPEC.md §4.13, §6.4). */
  private async settingsMenu(): Promise<boolean> {
    const s = this.session;
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    const st = s.state.settings;
    const steps = [0, 0.25, 0.5, 0.75, 1];
    // The next step above the current value, wrapping to 0 after 100%.
    const next = (v: number) => steps.find((x) => x > v + 0.01) ?? 0;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    let again = true;
    const cursor = { selected: 0 };
    while (again) {
      again = false;
      const items: { label: string; run: () => Promise<boolean> }[] = [
        {
          label: `Music: ${pct(st.musicVolume)}`,
          run: async () => {
            st.musicVolume = next(st.musicVolume);
            audio?.setVolume('music', st.musicVolume);
            again = true;
            return false;
          },
        },
        {
          label: `Sound: ${pct(st.sfxVolume)}`,
          run: async () => {
            st.sfxVolume = next(st.sfxVolume);
            audio?.setVolume('sfx', st.sfxVolume);
            audio?.setVolume('piano', Math.max(0.25, st.sfxVolume));
            again = true;
            return false;
          },
        },
        {
          label: `Controls: ${st.controlScheme === 'tap' ? 'tap to move' : 'joystick'}`,
          run: async () => {
            st.controlScheme = cycle(CONTROL_SCHEMES, st.controlScheme);
            this.touch.setJoystick(st.controlScheme !== 'tap');
            this.tapPath = [];
            again = true;
            return false;
          },
        },
        {
          label: `Text speed: ${st.textSpeed}`,
          run: async () => {
            st.textSpeed = cycle(TEXT_SPEEDS, st.textSpeed);
            applyUiPrefs(st);
            again = true;
            return false;
          },
        },
        {
          label: `Windows: ${st.windowColor}`,
          run: async () => {
            st.windowColor = cycle(WINDOW_COLORS, st.windowColor);
            applyUiPrefs(st);
            again = true;
            return false;
          },
        },
        {
          label: `Captions: ${st.captions ? 'on' : 'off'}`,
          run: async () => ((st.captions = !st.captions), applyUiPrefs(st), (again = true), false),
        },
        {
          label: `Colour-blind safe: ${st.colorBlindSafe ? 'on' : 'off'}`,
          run: async () => ((st.colorBlindSafe = !st.colorBlindSafe), applyUiPrefs(st), (again = true), false),
        },
        {
          label: `Less motion: ${st.reducedMotion ? 'on' : 'off'}`,
          run: async () => ((st.reducedMotion = !st.reducedMotion), (again = true), false),
        },
        {
          label: `Hold, not mash: ${st.holdInsteadOfMash ? 'on' : 'off'}`,
          run: async () => ((st.holdInsteadOfMash = !st.holdInsteadOfMash), (again = true), false),
        },
        {
          label: `Slow prompts: ${st.slowerPrompts ? 'on' : 'off'}`,
          run: async () => ((st.slowerPrompts = !st.slowerPrompts), (again = true), false),
        },
        {
          label: `Skip fights: ${st.skipEncounters ? 'on' : 'off'}`,
          run: async () => ((st.skipEncounters = !st.skipEncounters), (again = true), false),
        },
      ];
      if (this.scene.manager.keys['Calibration']) {
        items.push({
          label: 'Lesson timing',
          run: async () => {
            await s.save();
            this.scene.start('Calibration', { returnTo: 'Map', returnData: {} });
            return false;
          },
        });
      }
      items.push({ label: 'Back', run: async () => false });
      await showMenu('Settings', items, cursor);
    }
    await s.save();
    return true;
  }

  /** Kei builds gadgets from camera parts (SPEC.md §7.2). */
  private async workshop(): Promise<void> {
    const s = this.session;
    // The first visit plays Kei's introduction (an `interact` event in content).
    await s.fire({ type: 'interact', params: { target: 'workshop' } });
    const buildable = s.content.items.filter((i) => i.build);
    const why = { ok: '', stage: ' (later)', parts: '', owned: ' (built)', 'not-buildable': '' } as const;
    await showMenu(
      () => `Kei's workshop · parts ${s.state.items[CAMERA_PART] ?? 0}`,
      [
        ...buildable.map((item) => ({
          label: `${item.name}${why[buildStatus(s.state, item)]}`,
          detail: () => `${item.build?.parts} parts. ${item.description}`,
          run: async () => {
            const status = buildStatus(s.state, item);
            if (build(s.state, item)) {
              await showPanel(`Kei built a ${item.name}!`, [item.description]);
              await s.save();
            } else if (status === 'parts') {
              toast('Not enough camera parts. Monsters drop them.');
            } else if (status === 'stage') {
              toast('Kei is still working on that one.');
            }
            return false;
          },
        })),
        { label: 'Back', run: async () => false },
      ],
      { tapToSelect: true },
    );
  }

  /** Choose who comes along (SPEC.md §7): alone, O Boy, Kei, or both. */
  private async partyMenu(): Promise<void> {
    const s = this.session;
    const names: Record<string, string> = { oboy: 'O Boy', kei: 'Kei' };
    await showMenu(
      'Who comes along?',
      [
        ...s.state.joined.map((id) => ({
          label: `${names[id] ?? id}: ${s.state.party.includes(id) ? 'with you' : 'at home'}`,
          run: async () => {
            if (s.state.party.includes(id)) s.state.party = s.state.party.filter((x) => x !== id);
            else s.state.party = [...s.state.party, id];
            if (id === 'oboy' && !s.state.party.includes('oboy')) {
              this.oboy?.destroy();
              this.oboy = null;
            }
            if (id === 'kei' && s.state.party.includes('kei')) this.trail.reset(this.pos.x, this.pos.y);
            return false;
          },
        })),
        { label: 'Done', run: async () => false },
      ],
    );
  }

  /** The photo wall at home (SPEC.md §8): Angie's six best album photos. */
  private async photoWall(): Promise<void> {
    const s = this.session;
    const best = Object.values(s.state.album)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((e) => `${s.content.birds.find((b) => b.id === e.species)?.name ?? e.species}: ${e.rating} (${e.score}), day ${e.day}`);
    await showPanel('Our photo wall', best.length ? best : ['Empty frames, waiting for your best shots.']);
  }

  /**
   * Packing at home (SPEC.md §4.12): move supplies between the cupboard and
   * the bag, which only fits so much.
   */
  private async packBag(): Promise<void> {
    const s = this.session;
    const cap = s.content.game.bagCapacity ?? 0;
    const supplies = s.content.items.filter((i) => takesSpace(i) && ((s.state.items[i.id] ?? 0) > 0 || (s.state.stored[i.id] ?? 0) > 0));
    if (supplies.length === 0) {
      toast('Nothing to pack. The shop sells snacks and supplies.');
      return;
    }
    let selected = 0;
    for (;;) {
      let picked: { item: (typeof supplies)[number]; dir: 'in' | 'out' } | null = null;
      const opts = { selected, tapToSelect: true };
      await showMenu(
        () => `Pack · bag ${bagUsed(s.state.items, s.content.items)}${cap ? `/${cap}` : ''}`,
        [
          ...supplies.map((item) => ({
            label: `${item.name}: bag ${s.state.items[item.id] ?? 0} · home ${s.state.stored[item.id] ?? 0}`,
            detail: () => 'Choose it again to pack one into the bag.',
            run: async () => ((picked = { item, dir: 'in' as const }), false),
          })),
          ...supplies
            .filter((item) => (s.state.items[item.id] ?? 0) > 0)
            .map((item) => ({ label: `Leave a ${item.name} at home`, run: async () => ((picked = { item, dir: 'out' }), false) })),
          { label: 'Done', run: async () => false },
        ],
        opts,
      );
      selected = opts.selected ?? 0;
      const choice = picked as { item: (typeof supplies)[number]; dir: 'in' | 'out' } | null;
      if (!choice) break;
      if (choice.dir === 'out') unpack(s.state, choice.item);
      else if (!pack(s.state, choice.item, cap, s.content.items)) {
        toast((s.state.stored[choice.item.id] ?? 0) > 0 ? 'Your bag is full.' : `No ${choice.item.name} left at home.`);
      }
    }
    await s.save();
  }

  /** The bag: wear/remove gear, use snacks and sunscreen. */
  private async bag(): Promise<boolean> {
    const s = this.session;
    const owned = s.content.items.filter((i) => (s.state.items[i.id] ?? 0) > 0);
    if (owned.length === 0) {
      await showPanel('Bag', ['Your bag is empty.', 'Try the convenience store in the mall plaza.']);
      return true;
    }
    await showMenu(
      `Bag${s.content.game.bagCapacity ? ` ${bagUsed(s.state.items, s.content.items)}/${s.content.game.bagCapacity}` : ''} · Energy ${Math.ceil(s.state.energy)}`,
      [
        ...owned.map((item) => {
          const worn = Object.values(s.state.equipped).includes(item.id);
          const count = s.state.items[item.id] ?? 0;
          const label = item.kind === 'gear' ? `${item.name}${worn ? ' (worn)' : ''}` : `${item.name} x${count}`;
          return {
            label,
            run: async () => {
              if (item.kind === 'gear') {
                const r = toggleGear(s.state, item);
                toast(r === 'worn' ? `Wearing the ${item.name.toLowerCase()}.` : `Took off the ${item.name.toLowerCase()}.`);
              } else if (useItem(s.state, item)) {
                toast(item.restores ? `Energy +${item.restores}!` : `Used the ${item.name.toLowerCase()}.`);
              }
              return false;
            },
          };
        }),
        { label: 'Close', run: async () => false },
      ],
    );
    return true;
  }

  /** A short rest on a bench restores some Energy (SPEC.md §4.12). */
  private async rest(): Promise<void> {
    const s = this.session;
    if (s.state.energy >= MAX_ENERGY) {
      toast('Angie enjoys the view for a moment.');
      return;
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    await new Promise((r) => this.time.delayedCall(500, r));
    const before = s.state.energy;
    s.state.energy = Math.min(MAX_ENERGY, s.state.energy + 20);
    this.cameras.main.fadeIn(300, 0, 0, 0);
    toast(`A nice rest on the bench. Energy +${Math.round(s.state.energy - before)}`);
  }

  private async sleep(): Promise<void> {
    const s = this.session;
    if (s.state.slot !== 'evening') {
      toast("It's too early to sleep.");
      return;
    }
    this.cameras.main.fadeOut(600, 0, 0, 0);
    await new Promise((r) => this.time.delayedCall(700, r));
    await s.endSlot();
    s.state.energy = MAX_ENERGY;
    await s.save();
    this.cameras.main.fadeIn(600, 0, 0, 0);
    toast(`Good morning! Day ${s.state.day}`);
    this.remindMission();
  }

  /**
   * Pays an activity's Energy cost (SPEC.md §4.12). Returns false, with a
   * hint to eat or rest, when Angie is too tired.
   */
  private spendEnergy(cost: number): boolean {
    const s = this.session.state;
    if (cost <= 0) return true;
    if (s.energy < cost) {
      toast(this.session.content.game.energy?.tooTiredText ?? '', 3500);
      return false;
    }
    s.energy -= cost;
    return true;
  }

  /** Saves and irises out (onto `focus`, by default Angie) into another scene. */
  private async leaveTo(scene: string, data: object, focus: { x: number; y: number } = { x: this.pos.x, y: this.pos.y - 12 }): Promise<void> {
    if (!this.scene.manager.keys[scene]) {
      toast('Coming soon!');
      return;
    }
    await this.session.save();
    // Lessons need quiet to hear the student's mistakes.
    if (scene === 'Piano') {
      (this.registry.get('audio') as AudioEngine | undefined)?.setAmbience(0, 0, true);
      this.sounds()?.set(null);
    }
    // Iris onto Angie, the classic way into a minigame.
    await iris(this, 'out', focus.x, focus.y);
    this.scene.start(scene, data);
  }

  private async openMenu(): Promise<void> {
    this.busy = true;
    const s = this.session;
    const items = [
      { label: 'Map', run: () => this.worldMap() },
      { label: 'Album', run: async () => (await showAlbum(s.content, s.state, this.registry.get('manifest') as Manifest), true) },
      { label: 'Bag', run: () => this.bag() },
      ...(s.state.joined.includes('kei')
        ? [
            {
              label: 'Workshop',
              run: async () => {
                await this.workshop();
                return true;
              },
            },
          ]
        : []),
      ...(s.state.joined.length
        ? [
            {
              label: 'Party',
              run: async () => {
                await this.partyMenu();
                return true;
              },
            },
          ]
        : []),
      {
        label: 'Missions',
        run: async () => {
          const active = activeMissions(s.state, s.content).map((m) => `▶ ${m.title}: ${m.description}`);
          const done = doneMissions(s.state, s.content).map((m) => `✓ ${m.title}`);
          await showPanel('Missions', active.length || done.length ? [...active, ...done] : ['No missions yet.']);
          return true;
        },
      },
      {
        label: 'Export save',
        run: async () => {
          downloadSave(s.state);
          return true;
        },
      },
      ...(updateServer()
        ? [
            {
              label: 'Cloud save',
              run: async () => {
                await this.cloudMenu();
                return true;
              },
            },
          ]
        : []),
      {
        label: 'Import save',
        run: async () => {
          try {
            const state = await pickSave();
            if (!state) return true;
            s.state = state;
            applyUiPrefs(s.state.settings);
            await s.save();
            this.scene.restart({});
          } catch (err) {
            await showPanel('Import failed', [err instanceof Error ? err.message : String(err)]);
            return true;
          }
          return false;
        },
      },
    ];
    items.push({ label: 'Settings', run: () => this.settingsMenu() });
    items.push({ label: 'Close', run: async () => false });
    await showMenu('Menu', items);
    this.busy = false;
  }

  // --- Kei's gateways (SPEC.md §4.11) ----------------------------------------

  private gatewayOpen(o: WorldObject): boolean {
    return this.session.state.flags[`gateway:${o.props.gateway_id}`] === true;
  }

  private spawnGateways(chunk: ChunkData): void {
    if (!this.textures.exists('gateway_pad')) return;
    for (const o of chunk.objects) {
      if (o.type !== 'gateway') continue;
      const sprite = this.add.sprite(o.x, o.y + 8, 'gateway_pad', 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + o.y - 8);
      this.gateways.push({ object: o, sprite, chunk: chunkKey(chunk.cx, chunk.cy) });
    }
  }

  /** Tap-to-move: plans a walk to the tapped tile within the loaded chunks. */
  private tapTo(wx: number, wy: number): void {
    if (this.session.state.settings.controlScheme !== 'tap' || !this.ready || this.busy || this.ride || modal.open) return;
    const ts = this.index.tileSize;
    const start: Tile = [Math.floor(this.pos.x / ts), Math.floor((this.pos.y - 3) / ts)];
    const goal: Tile = [Math.floor(wx / ts), Math.floor(wy / ts)];
    this.tapPath = findPath(start, goal, (tx, ty) => this.collisionAt(tx, ty) !== 0) ?? [];
  }

  /** Turns the tap-to-move path into a walking direction while no key or stick is used. */
  private followTapPath(input: ReturnType<InputReader['read']>): ReturnType<InputReader['read']> {
    if (input.x !== 0 || input.y !== 0 || this.busy || modal.open) {
      if (input.x !== 0 || input.y !== 0) this.tapPath = [];
      return input;
    }
    const ts = this.index.tileSize;
    while (this.tapPath.length) {
      const [tx, ty] = this.tapPath[0];
      const dx = tx * ts + ts / 2 - this.pos.x;
      const dy = ty * ts + ts / 2 + 3 - this.pos.y;
      const d = Math.hypot(dx, dy);
      // Within a frame's step of the tile centre counts as there.
      if (d < 4) {
        this.tapPath.shift();
        continue;
      }
      return { ...input, x: dx / d, y: dy / d };
    }
    return input;
  }

  /** Tile collision, with gear gates closed until Angie owns their item (SPEC.md §4.6). */
  private collisionAt(tx: number, ty: number): number {
    const c = this.store.collisionAt(tx, ty);
    if (this.gates.length === 0) return c;
    // A kayak takes Angie over the water of its channel.
    if (c && this.store.groundAt(tx, ty) === this.waterTile && openWaterAt(this.gates, tx, ty, this.session.state.items)) return 0;
    if (c) return c;
    const g = closedGateAt(this.gates, tx, ty, this.session.state.items);
    if (!g) return c;
    this.bumpedGate = g;
    return 1;
  }

  // --- Hidden collectibles (SPEC.md §4.5) ------------------------------------

  private spawnSparkles(chunk: ChunkData): void {
    if (!this.textures.exists('collectible_sparkle')) return;
    for (const o of chunk.objects) {
      if (o.type !== 'collectible' || isCollected(this.session.state, o.name)) continue;
      const sprite = this.add.sprite(o.x, o.y, 'collectible_sparkle', 0).setDepth(DEPTH.entities + o.y);
      this.sparkles.push({ object: o, sprite, chunk: chunkKey(chunk.cx, chunk.cy) });
    }
  }

  private pickUp(o: WorldObject): void {
    const s = this.session;
    const found = collect(s.state, o.name, { item: o.props.item, song: o.props.song }, s.content);
    if (!found) return;
    this.sparkles = this.sparkles.filter((g) => (g.object === o ? (g.sprite.destroy(), false) : true));
    toast(`Found ${found}!`, 3000);
    void s.save();
  }

  /** Pick another open gateway; pass through the digital realm to it. */
  private async useGateway(from: WorldObject): Promise<void> {
    const s = this.session;
    const open = Object.entries(this.index.gateways).filter(([id]) => id !== from.props.gateway_id && s.state.flags[`gateway:${id}`]);
    if (open.length === 0) {
      toast('The gateway hums quietly.');
      return;
    }
    let target: string | null = null;
    await showMenu(from.props.title ?? 'Gateway', [
      ...open.map(([id, g]) => ({ label: g.title || id, run: async () => ((target = id), false) })),
      { label: 'Stay here', run: async () => false },
    ]);
    const dest = target ? this.index.gateways[target as string] : undefined;
    if (!dest) return;
    this.busy = true;
    await glitch(this, 'out');
    this.pos = { x: dest.x, y: dest.y + 14 };
    this.angie.setPosition(this.pos.x, this.pos.y);
    this.trail.reset(this.pos.x, this.pos.y);
    // Let the destination stream in behind the effect.
    await new Promise((r) => this.time.delayedCall(350, r));
    await glitch(this, 'in');
    toast(dest.title || 'Gateway');
    await s.save();
    this.busy = false;
  }

  // --- Transit (SPEC.md §4.11) ----------------------------------------------

  /**
   * The route planner at a stop (SPEC.md §4.11): every reachable stop on open
   * lines, with the core's best itinerary (transfers included) from now.
   * Choosing one pays the whole fare and starts the first leg.
   */
  private async boardAt(stopId: string): Promise<void> {
    const s = this.session;
    const t = s.content.transit;
    const name = (id: string) => t.stops.find((x) => x.id === id)?.name ?? id;
    const lineName = (id: string) => t.lines.find((l) => l.id === id)?.name ?? id;
    discoverStop(s.state, stopId);
    const closed = closureReason(await this.warningsNow());
    try {
      await s.transitReady(this.index.stops);
    } catch {
      toast('The timetable board is blank today.');
      return;
    }
    const now = s.clock();
    const lines = openLines(t.lines, s.state);
    const excludeModes = closed ? ['ferry'] : [];
    const plans = (
      await Promise.all(
        t.stops
          .filter((x) => x.id !== stopId)
          .map((x) => s.core.transitPlan({ from: stopId, to: x.id, time: now, lines, excludeModes }).catch(() => null)),
      )
    ).filter((p): p is TransitItinerary => p !== null && p.legs.length > 0);
    if (plans.length === 0) {
      toast(closed ? `${closed}: ferries are suspended.` : 'No services from here yet.', 3500);
      return;
    }
    plans.sort((a, b) => a.arrive - b.arrive);
    const describe = (p: TransitItinerary) => {
      const legs = p.legs.map((l) => `${lineName(l.line)} at ${clockLabel(l.depart)} to ${name(l.to)}`).join(', then ');
      return `${legs}. Arrive ${clockLabel(p.arrive)}${p.transfers ? ` (${p.transfers} change${p.transfers > 1 ? 's' : ''})` : ''}.`;
    };
    const card = s.content.game.transitCard;
    let picked: TransitItinerary | null = null;
    await showMenu(
      () => `${name(stopId)} ${clockLabel(now)}  ${card ? `${card.name} $${s.state.card}` : `$${s.state.money}`}`,
      [
        ...plans.map((p) => ({
          label: `${name(p.to)} $${p.fare}`,
          detail: () => describe(p),
          run: async () => ((picked = p), false),
        })),
        ...(card
          ? [
              {
                label: `Top up ${card.name} $${card.topUp}`,
                detail: () => `Cash $${s.state.money}. The kiosk adds $${card.topUp} to your ${card.name}.`,
                run: async () => {
                  toast(topUp(s.state, card) ? `${card.name} topped up: $${s.state.card}` : "You don't have enough cash.");
                  return true;
                },
              },
            ]
          : []),
        { label: 'Not now', run: async () => false },
      ],
      { tapToSelect: true },
    );
    const choice = picked as TransitItinerary | null;
    if (!choice) return;
    if (!payFare(s.state, choice.fare, card)) {
      toast(card ? `Not enough on your ${card.name}. Top up at the kiosk or a shop.` : "You can't afford the fare.", 3500);
      return;
    }
    this.startLeg(choice.legs[0], choice.legs.slice(1));
  }

  /** Waits for and rides one leg of a trip; the rest follow as transfers. */
  private startLeg(leg: TransitLeg, next: TransitLeg[]): void {
    const s = this.session;
    const line = s.content.transit.lines.find((l) => l.id === leg.line);
    if (line && leg.mode === 'metro') {
      void this.rideMetro(leg, next);
      return;
    }
    const key = vehicleTexture(leg.mode);
    const path = leg.path.map(([x, y]): Pt => [x, y]);
    if (!line || path.length < 2 || !this.textures.exists(key)) return;
    if (leg.wait >= 1) toast(`Waited ${Math.round(leg.wait)} min for the ${line.name}.`);
    s.slotMinutes += leg.wait;
    const start = pointAt(path, 0);
    const vehicle = this.add.sprite(start.x, start.y, key, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + start.y);
    this.angie.setVisible(false);
    this.oboy?.setVisible(false);
    this.kei?.setVisible(false);
    this.umbrellas.angie?.setVisible(false);
    this.umbrellas.kei?.setVisible(false);
    for (const v of this.vehicles.sprites.values()) v.destroy();
    this.vehicles.sprites.clear();
    this.rung.clear();
    this.cameras.main.startFollow(vehicle, true, 1, 1);
    const removeSkip = floatingButton('Skip', 'back', () => {
      const r = this.ride;
      if (!r) return;
      s.slotMinutes += (r.length - r.distance) / r.speed;
      r.distance = r.length;
    });
    const removeDeck = leg.mode === 'ferry' && s.content.spots.some((x) => x.id === FERRY_DECK) ? floatingButton('Deck', 'deck', () => void this.toDeck()) : undefined;
    // The stops between boarding and alighting, in riding order (SPEC.md §4.11).
    const a = line.stops.indexOf(leg.from);
    const b = line.stops.indexOf(leg.to);
    const between = a >= 0 && b >= 0 ? line.stops.slice(Math.min(a, b) + 1, Math.max(a, b)) : [];
    const stops = stopsAlong(
      path,
      between.flatMap((id) => (this.index.stops[id] ? [{ id, ...this.index.stops[id] }] : [])),
    );
    const removeAlight = stops.length ? floatingButton('Next stop', 'alight', () => this.alightNext()) : undefined;
    this.ride = { vehicle, path, length: pathLength(path), distance: 0, speed: line.speed, to: leg.to, line: line.id, next, removeSkip, removeDeck, stops, removeAlight };
    this.ringBell(line.id);
    const name = s.content.transit.stops.find((x) => x.id === leg.to)?.name ?? leg.to;
    toast(`${line.name} to ${name}`);
  }

  /**
   * The metro (SPEC.md §4.11): pays the clock for the wait and ride, puts
   * Angie at the destination station and plays the platform and in-car
   * scene; any further legs continue when the map comes back.
   */
  private async rideMetro(leg: TransitLeg, next: TransitLeg[]): Promise<void> {
    const s = this.session;
    this.underground = true;
    const line = s.content.transit.lines.find((l) => l.id === leg.line);
    const name = (id: string) => s.content.transit.stops.find((x) => x.id === id)?.name ?? id;
    s.slotMinutes += leg.wait + leg.ride;
    discoverStop(s.state, leg.to);
    await s.fire({ type: 'ride_complete', params: { line: leg.line } });
    await s.checkMissions({ ride: { line: leg.line, stop: leg.to } });
    const stop = this.index.stops[leg.to];
    if (stop) s.state.position = { map: 'world', x: Math.round(stop.x), y: Math.round(stop.y + 4) };
    await s.save();
    const order = line?.stops ?? [leg.from, leg.to];
    const a = order.indexOf(leg.from);
    const b = order.indexOf(leg.to);
    const ids = a >= 0 && b >= 0 ? (a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1).reverse()) : [leg.from, leg.to];
    if (!this.scene.manager.keys['Metro']) {
      this.scene.restart({ title: name(leg.to), legs: next });
      return;
    }
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('Metro', { lineName: line?.name ?? 'Metro', stops: ids.map(name), legs: next }),
    );
  }

  /**
   * Get off at the next stop instead (SPEC.md §4.11): the ride ends there and
   * any later legs are dropped; the fare stays paid.
   */
  private alightNext(): void {
    const r = this.ride;
    if (!r) return;
    const stop = nextStopAhead(r.stops, r.distance);
    r.removeAlight?.();
    r.removeAlight = undefined;
    if (!stop) return;
    r.to = stop.id;
    r.length = stop.at;
    r.next = [];
    r.stops = [];
    const name = this.session.content.transit.stops.find((x) => x.id === stop.id)?.name ?? stop.id;
    toast(`Getting off at ${name}.`);
  }

  private updateRide(time: number, dt: number): void {
    const r = this.ride;
    if (!r) return;
    // No stop left to get off at: the button goes.
    if (r.removeAlight && !nextStopAhead(r.stops, r.distance)) {
      r.removeAlight();
      r.removeAlight = undefined;
    }
    const view = this.cameras.main.worldView;
    const here = pointAt(r.path, r.distance);
    // Stream ahead along the route.
    this.store.update(wantedChunks({ x: view.x, y: view.y, w: view.width || 320, h: view.height || 180 }, this.store.chunkPx, this.index, 1, { x: here.dx, y: here.dy }));
    this.chunkRenderer.update();
    // Wait for the road ahead to load rather than drive into the void.
    const ts = this.index.tileSize;
    const ahead = pointAt(r.path, r.distance + 64);
    if (!this.store.get(Math.floor(ahead.x / ts / CHUNK_TILES), Math.floor(ahead.y / ts / CHUNK_TILES))) return;
    r.distance = Math.min(r.length, r.distance + r.speed * dt);
    this.session.slotMinutes += dt;
    const p = pointAt(r.path, r.distance);
    if (Math.abs(p.dx) > 0.1) r.vehicle.setFlipX(p.dx < 0);
    r.vehicle.setPosition(p.x, p.y).setDepth(DEPTH.entities + p.y).setFrame(Math.floor(time / 150) % 2);
    this.updateWeather(dt * 1000);
    this.hud.update(this.session.state, this.weatherLabel());
    if (r.distance >= r.length) void this.arrive_(r);
  }

  private async arrive_(r: NonNullable<MapScene['ride']>): Promise<void> {
    this.ride = null;
    r.removeSkip();
    r.removeDeck?.();
    r.removeAlight?.();
    const s = this.session;
    const name = s.content.transit.stops.find((x) => x.id === r.to)?.name ?? r.to;
    discoverStop(s.state, r.to);
    r.vehicle.destroy();
    this.ringBell(r.line);
    await s.fire({ type: 'ride_complete', params: { line: r.line } });
    await s.checkMissions({ ride: { line: r.line, stop: r.to } });
    const [leg, ...rest] = r.next;
    if (leg) {
      toast(`Change at ${name}.`);
      this.startLeg(leg, rest);
      return;
    }
    const stop = this.index.stops[r.to];
    this.pos = { x: stop?.x ?? r.vehicle.x, y: (stop?.y ?? r.vehicle.y) + 4 };
    this.angie.setVisible(true).setPosition(this.pos.x, this.pos.y);
    this.oboy?.setVisible(true);
    this.kei?.setVisible(true);
    this.trail.reset(this.pos.x, this.pos.y);
    this.cameras.main.startFollow(this.angie, true, 1, 1);
    toast(`Arrived at ${name}.`);
    await s.save();
  }

  /**
   * Photos from the ferry's deck (SPEC.md §4.11): a photo session on the
   * crossing; afterwards Angie is at the trip's destination.
   */
  private async toDeck(): Promise<void> {
    const r = this.ride;
    const s = this.session;
    if (!r || !this.spendEnergy(activityCost(s.content.game.energy, 'photo'))) return;
    this.ride = null;
    r.removeSkip();
    r.removeDeck?.();
    r.removeAlight?.();
    s.slotMinutes += (r.length - r.distance) / r.speed;
    const dest = r.next.length ? r.next[r.next.length - 1].to : r.to;
    discoverStop(s.state, r.to);
    discoverStop(s.state, dest);
    // The map stands still from here, so update() doesn't put the saved
    // position back on the departure pier while the iris closes.
    this.leaving = true;
    const stop = this.index.stops[dest];
    if (stop) s.state.position = { map: 'world', x: Math.round(stop.x), y: Math.round(stop.y + 4) };
    await s.fire({ type: 'ride_complete', params: { line: r.line } });
    await s.checkMissions({ ride: { line: r.line, stop: r.to } });
    this.busy = true;
    await this.leaveTo('Photo', { spotId: FERRY_DECK, returnTo: 'Map', weather: this.weatherNow, statuses: [] }, { x: r.vehicle.x, y: r.vehicle.y - 12 });
  }

  /** Stops Angie walks past are discovered and show on the map (SPEC.md §4.11). */
  private discoverStops(): void {
    if (this.mapId !== 'world') return;
    for (const [id, p] of Object.entries(this.index.stops)) {
      if (Math.hypot(p.x - this.pos.x, p.y - this.pos.y) < 40 && discoverStop(this.session.state, id)) {
        toast(`New stop: ${this.session.content.transit.stops.find((x) => x.id === id)?.name ?? id}`);
      }
    }
  }

  /**
   * Buses and ferries on the map, from the timetables in the core (polled
   * twice a second, moved along their heading in between). Only those in
   * view get sprites; nothing is simulated off-screen.
   */
  private updateVehicles(time: number): void {
    if (this.mapId !== 'world' || !this.ready) return;
    const s = this.session;
    const v = this.vehicles;
    if (!v.pending && time >= v.nextPoll) {
      v.pending = true;
      v.nextPoll = time + 500;
      const clock = s.clock();
      s.transitReady(this.index.stops)
        .then(() => s.core.transitVehicles({ time: clock, lines: openLines(s.content.transit.lines, s.state) }))
        .then((r) => {
          v.list = r.vehicles;
          v.clock = clock;
        })
        .catch(() => undefined)
        .finally(() => (v.pending = false));
    }
    const since = s.clock() - v.clock;
    const view = this.cameras.main.worldView;
    const seen = new Set<string>();
    for (const veh of v.list) {
      const line = s.content.transit.lines.find((l) => l.id === veh.line);
      if (!line) continue;
      const x = Math.round(veh.x + veh.dx * line.speed * since);
      const y = Math.round(veh.y + veh.dy * line.speed * since);
      if (x < view.x - 48 || x > view.right + 48 || y < view.y - 48 || y > view.bottom + 48) continue;
      // Metro trains run underground.
      if (line.mode === 'metro') continue;
      const key = `${veh.line}:${veh.direction}:${veh.depart}`;
      const texture = vehicleTexture(line.mode);
      if (!this.textures.exists(texture)) continue;
      seen.add(key);
      let sprite = v.sprites.get(key);
      if (!sprite) {
        sprite = this.add.sprite(x, y, texture, 0).setOrigin(0.5, 1);
        v.sprites.set(key, sprite);
      }
      if (Math.abs(veh.dx) > 0.1) sprite.setFlipX(veh.dx < 0);
      // Once per vehicle, ring as it nears Angie.
      if (!this.rung.has(key) && Math.hypot(x - this.pos.x, y - this.pos.y) < HEAR_RANGE) {
        this.rung.add(key);
        this.ringBell(veh.line, x, y);
      }
      sprite.setPosition(x, y).setDepth(DEPTH.entities + y).setFrame(Math.floor(time / 150) % 2);
    }
    for (const [key, sprite] of v.sprites) {
      if (!seen.has(key)) {
        sprite.destroy();
        v.sprites.delete(key);
        this.rung.delete(key);
      }
    }
  }

  // --- Passers-by (SPEC.md §4.3) --------------------------------------------

  /** Spawns each kind of passer-by on open tiles of its areas in a newly loaded chunk (same spots all day). */
  private spawnPassersby(chunk: ChunkData): void {
    const s = this.session;
    const key = chunkKey(chunk.cx, chunk.cy);
    for (const def of s.content.ambient) {
      if (def.slots.length && !def.slots.includes(s.state.slot)) continue;
      if (!this.textures.exists(def.sprite)) continue;
      const areaIdx = def.areas.map((a) => this.index.areas.indexOf(a)).filter((i) => i >= 0);
      const open: number[] = [];
      for (let i = 0; i < chunk.area.length; i++) {
        if (chunk.collision[i] === 0 && areaIdx.includes(chunk.area[i]) && this.walkable(chunk.ground[i])) open.push(i);
      }
      if (open.length < 20) continue;
      const random = rng(s.state.worldSeed ^ (s.state.day * 7919) ^ (chunk.cx * 131 + chunk.cy * 977) ^ def.id.length * 31);
      for (let n = 0; n < def.perChunk; n++) {
        const i = open[Math.floor(random() * open.length)];
        const ts = this.index.tileSize;
        const x = (chunk.cx * CHUNK_TILES + (i % CHUNK_TILES)) * ts + ts / 2;
        const y = (chunk.cy * CHUNK_TILES + Math.floor(i / CHUNK_TILES)) * ts + ts - 2;
        const sprite = this.add.sprite(x, y, def.sprite, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + y);
        const line = def.lines[Math.floor(random() * def.lines.length)];
        // Most people carry an umbrella in one of four colours.
        const umbrella =
          random() < 0.75 && this.textures.exists('umbrella')
            ? this.add.sprite(x, y, 'umbrella', Math.floor(random() * 4)).setOrigin(0.5, 1).setVisible(false)
            : null;
        this.passersby.push({ def, sprite, umbrella, chunk: key, target: { x, y }, pauseUntil: 0, nextShot: 0, line });
      }
    }
  }

  private despawnPassersby(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.passersby = this.passersby.filter((p) => {
      if (p.chunk !== key) return true;
      p.sprite.destroy();
      p.umbrella?.destroy();
      return false;
    });
  }

  /** Passers-by stroll between nearby spots; birders stop to photograph birds. */
  private updatePassersby(time: number, dt: number): void {
    const ts = this.index.tileSize;
    for (const p of this.passersby) {
      const sx = p.sprite.x;
      const sy = p.sprite.y;
      if (p.def.kind === 'birder') {
        const bird = this.birds.find((b) => !b.flushed && Math.hypot(b.sprite.x - sx, b.sprite.y - sy) < 72);
        if (bird) {
          // Face the bird and take pictures every so often.
          const dx = bird.sprite.x - sx;
          const dy = bird.sprite.y - sy;
          const row = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
          p.sprite.setFrame(row * 4);
          if (time >= p.nextShot) {
            p.nextShot = time + 1200 + Math.random() * 2600;
            this.glints.emitParticleAt(sx + (dx < 0 ? -4 : 4), sy - 13, 1);
          }
          continue;
        }
      }
      if (time < p.pauseUntil) {
        p.sprite.setFrame((Number(p.sprite.frame.name) >> 2) * 4);
        continue;
      }
      const mx = p.target.x - sx;
      const my = p.target.y - sy;
      const m = Math.hypot(mx, my);
      if (m < 2) {
        // Pick somewhere new nearby (on an open tile) after a short pause.
        p.pauseUntil = time + 800 + Math.random() * 3200;
        for (let tries = 0; tries < 6; tries++) {
          const tx = sx + (Math.random() - 0.5) * 140;
          const ty = sy + (Math.random() - 0.5) * 90;
          const gx = Math.floor(tx / ts);
          const gy = Math.floor((ty - 2) / ts);
          if (this.store.collisionAt(gx, gy) === 0 && this.walkable(this.store.groundAt(gx, gy))) {
            p.target = { x: tx, y: ty };
            break;
          }
        }
        continue;
      }
      const step = Math.min(m, PASSERBY_SPEED * dt);
      const next = move({ x: sx, y: sy }, (mx / m) * step, (my / m) * step, FEET, (x, y) => this.store.collisionAt(x, y), ts);
      if (next.x === sx && next.y === sy) p.target = { x: sx, y: sy }; // blocked: rethink
      const row = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 1 : 2) : my < 0 ? 3 : 0;
      p.sprite.setPosition(next.x, next.y).setDepth(DEPTH.entities + next.y).setFrame(row * 4 + 1 + (Math.floor(time / 160) % 3));
    }
  }

  /** Where passers-by may walk: not on roads (they use pavements and paths). */
  private walkable(ground: number): boolean {
    const name = this.index.tileNames[ground - 1];
    return name !== 'road' && name !== 'road_line';
  }

  /** Birding spots within this many px get an edge arrow when off screen. */
  private static readonly SPOT_RADIUS = 640;

  private drawSpotMarks(time: number): void {
    if (this.mapId !== 'world') return;
    const world = this.registry.get('world') as WorldIndex;
    this.spotMarks ??= this.add.graphics().setScrollFactor(0).setDepth(DEPTH.overhead + 30);
    const g = this.spotMarks.clear();
    const cam = this.cameras.main.worldView;
    const view = { x: Math.round(cam.x), y: Math.round(cam.y), w: cam.width || 320, h: cam.height || 180 };
    const spots = world.landmarks.filter((l) => l.type === 'spot');
    const bob = Math.floor(time / 400) % 2;
    for (const s of nearby(spots, this.pos.x, this.pos.y, MapScene.SPOT_RADIUS)) {
      // The bottom strip is left free for the HUD window.
      const edge = edgePoint({ ...view, h: view.h - 30 }, s.x, s.y, 12);
      if (!edge || (s.x >= view.x && s.x < view.x + view.w && s.y >= view.y && s.y < view.y + view.h - 30)) {
        // On screen: a small camera icon bobbing above the spot.
        cameraIcon(g, Math.round(s.x - view.x), Math.round(s.y - view.y) - 18 - bob);
        continue;
      }
      // Off screen: a camera icon at the edge with a pointer toward the spot.
      const ex = Math.round(edge.x);
      const ey = Math.round(edge.y);
      g.fillStyle(0x101018, 0.6).fillCircle(ex, ey, 7);
      cameraIcon(g, ex, ey);
      const a = Math.atan2(s.y - (view.y + view.h / 2), s.x - (view.x + view.w / 2));
      const tipX = ex + Math.cos(a) * 10;
      const tipY = ey + Math.sin(a) * 10;
      g.fillStyle(0xf0d050, 1).fillTriangle(
        tipX,
        tipY,
        ex + Math.cos(a + 2.5) * 6,
        ey + Math.sin(a + 2.5) * 6,
        ex + Math.cos(a - 2.5) * 6,
        ey + Math.sin(a - 2.5) * 6,
      );
    }
  }

  /** Whether it's raining enough for umbrellas where Angie is (outdoors only). */
  private raining(): boolean {
    return !!this.weatherRenderer && (this.weatherNow?.precip ?? 0) >= 0.25;
  }

  /** Puts an umbrella over a character (origin at their feet) or hides it. */
  private holdUmbrella(u: Phaser.GameObjects.Sprite | null, who: Phaser.GameObjects.Sprite, open: boolean): void {
    if (!u) return;
    u.setVisible(open && who.visible);
    if (open) u.setPosition(Math.round(who.x), Math.round(who.y) - 14).setDepth(who.depth + 2);
  }

  private updateUmbrellas(): void {
    if (!this.textures.exists('umbrella')) return;
    const st = this.session.state;
    // Angie's is pink (frame 4).
    this.umbrellas.angie ??= this.add.sprite(0, 0, 'umbrella', 4).setOrigin(0.5, 1).setVisible(false);
    // Angie only opens hers when she's equipped it and is outdoors.
    this.holdUmbrella(this.umbrellas.angie, this.angie, !!this.weatherRenderer && st.equipped.hand === 'umbrella');
    if (this.kei) {
      this.umbrellas.kei ??= this.add.sprite(0, 0, 'umbrella', 1).setOrigin(0.5, 1).setVisible(false);
      this.holdUmbrella(this.umbrellas.kei, this.kei, this.raining());
    } else {
      this.umbrellas.kei?.setVisible(false);
    }
    const rain = this.raining();
    for (const p of this.passersby) this.holdUmbrella(p.umbrella, p.sprite, rain);
    for (const [i, n] of this.npcs.entries()) {
      if (rain && !n.umbrella) n.umbrella = this.add.sprite(0, 0, 'umbrella', 2 + (i % 2)).setOrigin(0.5, 1);
      this.holdUmbrella(n.umbrella ?? null, n.sprite, rain);
    }
  }

  private makeWaves(): void {
    const key = 'wave-crest';
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xf0f8ff).fillRect(1, 0, 3, 1).fillStyle(0xc8e8f8).fillRect(0, 1, 5, 1);
      g.generateTexture(key, 5, 2);
      g.destroy();
    }
    this.waves = this.add
      .particles(0, 0, key, { lifespan: 900, alpha: { start: 0.9, end: 0 }, speedX: { min: -4, max: 4 }, emitting: false })
      .setDepth(DEPTH.entities - 1);
  }

  /** A few wave crests a moment on visible water tiles; windier water is choppier. */
  private updateWaves(time: number): void {
    if (this.waterTile < 0 || time < this.nextWave || !this.weatherRenderer) return;
    const wind = this.weatherNow?.wind ?? 0.3;
    this.nextWave = time + (this.session.state.settings.reducedMotion ? 400 : 120) / (0.5 + wind);
    const view = this.cameras.main.worldView;
    const ts = this.index.tileSize;
    for (let i = 0; i < 3; i++) {
      const x = view.x + Math.random() * view.width;
      const y = view.y + Math.random() * view.height;
      if (this.store.groundAt(Math.floor(x / ts), Math.floor(y / ts)) === this.waterTile) this.waves.emitParticleAt(Math.round(x), Math.round(y), 1);
    }
  }

  private makeGlints(): void {
    const key = 'camera-glint';
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xffffff).fillRect(1, 0, 1, 3).fillRect(0, 1, 3, 1);
      g.generateTexture(key, 3, 3);
      g.destroy();
    }
    this.glints = this.add
      .particles(0, 0, key, { lifespan: 180, scale: { start: 1, end: 0.4 }, speed: 0, emitting: false })
      .setDepth(DEPTH.overhead - 2);
  }

  // --- NPCs and Kei ------------------------------------------------------------

  /** Whether an NPC object is present now (its requires_flag/unless_flag props). */
  private npcVisible(o: WorldObject): boolean {
    const f = this.session.state.flags;
    return (!o.props.requires_flag || f[o.props.requires_flag] === true) && (!o.props.unless_flag || f[o.props.unless_flag] !== true);
  }

  private spawnNpcs(chunk: ChunkData): void {
    for (const o of chunk.objects) {
      if (o.type !== 'npc' || !o.props.sprite || !this.textures.exists(o.props.sprite)) continue;
      const sprite = this.add.sprite(o.x, o.y + 8, o.props.sprite, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + o.y + 8);
      this.npcs.push({ object: o, sprite, chunk: chunkKey(chunk.cx, chunk.cy) });
    }
  }

  private despawnNpcs(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.npcs = this.npcs.filter((n) => {
      if (n.chunk !== key) return true;
      n.sprite.destroy();
      n.umbrella?.destroy();
      return false;
    });
  }

  /** NPCs appear/disappear with story flags and face Angie when she's near. */
  private updateNpcs(): void {
    for (const n of this.npcs) {
      const visible = this.npcVisible(n.object);
      n.sprite.setVisible(visible);
      if (!visible) continue;
      const dx = this.pos.x - n.sprite.x;
      const dy = this.pos.y - n.sprite.y;
      if (Math.hypot(dx, dy) > 40) continue;
      const row = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
      n.sprite.setFrame(row * 4);
    }
  }

  /** Kei follows Angie along her path once he's in the party (SPEC.md §4.8). */
  private updateKei(): void {
    const along = this.session.state.party.includes('kei');
    if (!along) {
      this.kei?.destroy();
      this.kei = null;
      return;
    }
    const p = this.trail.positionAt(18);
    if (!p) return;
    if (!this.kei) this.kei = this.add.sprite(p.x, p.y, 'char_kei', 0).setOrigin(0.5, 1);
    const dx = p.x - this.kei.x;
    const dy = p.y - this.kei.y;
    const moving = Math.hypot(dx, dy) > 0.2;
    const row = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
    if (moving) this.kei.setFrame(row * 4 + 1 + (Math.floor(this.time.now / 125) % 3));
    else this.kei.setFrame((Number(this.kei.frame.name) >> 2) * 4);
    this.kei.setPosition(p.x, p.y).setDepth(DEPTH.entities + p.y);
  }

  // --- Enemies (SPEC.md §4.13) --------------------------------------------

  /** Marks a spawn point as dealt with: defeated/driven off for the day, or calm for a while after an escape. */
  private settle(spawn: string, beaten: boolean): void {
    if (settled.day !== this.session.state.day) {
      settled.day = this.session.state.day;
      settled.ids.clear();
    }
    if (beaten) settled.ids.add(spawn);
    settled.calmUntil = this.time.now + 15000;
  }

  private spawnEnemies(chunk: ChunkData): void {
    const s = this.session;
    if (settled.day !== s.state.day) {
      settled.day = s.state.day;
      settled.ids.clear();
    }
    for (const o of chunk.objects) {
      if (o.type !== 'enemy') continue;
      const enemy = s.content.enemies.find((e) => e.id === o.props.enemy_id);
      const spawn = o.name || `${enemy?.id}@${o.x},${o.y}`;
      if (!enemy || settled.ids.has(spawn) || !this.textures.exists(enemy.sprite)) continue;
      if (enemy.slots.length && !enemy.slots.includes(s.state.slot)) continue;
      const sprite = this.add.sprite(o.x, o.y, enemy.sprite, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + o.y);
      this.enemies.push({ enemy, spawn, sprite, chunk: chunkKey(chunk.cx, chunk.cy), homeX: o.x, homeY: o.y, state: 'wander', target: { x: o.x, y: o.y }, nextWander: 0 });
    }
  }

  private despawnEnemies(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.enemies = this.enemies.filter((e) => {
      if (e.chunk !== key) return true;
      e.sprite.destroy();
      return false;
    });
  }

  /** Enemies wander near home, notice Angie (half as far when she sneaks or hides in grass), chase, and start an encounter on contact. */
  private updateEnemies(time: number, dt: number, sneaking: boolean, inGrass: boolean): void {
    if (!this.ready || this.busy || modal.open) return;
    const calm = time < settled.calmUntil;
    for (const e of this.enemies) {
      const dx = this.pos.x - e.sprite.x;
      const dy = this.pos.y - e.sprite.y;
      const d = Math.hypot(dx, dy);
      const sight = e.enemy.sight * (sneaking ? 0.5 : 1) * (inGrass && sneaking ? 0.5 : 1);
      if (!calm && d < sight) e.state = 'chase';
      else if (e.state === 'chase' && (d > e.enemy.sight * 2 || calm)) e.state = 'return';
      let tx = e.target.x;
      let ty = e.target.y;
      let speed = e.enemy.speed * 0.35;
      if (e.state === 'chase') {
        tx = this.pos.x;
        ty = this.pos.y;
        speed = e.enemy.speed;
      } else if (e.state === 'return') {
        tx = e.homeX;
        ty = e.homeY;
        if (Math.hypot(tx - e.sprite.x, ty - e.sprite.y) < 4) e.state = 'wander';
      } else if (time >= e.nextWander) {
        e.nextWander = time + 1500 + Math.random() * 2500;
        e.target = { x: e.homeX + (Math.random() - 0.5) * 48, y: e.homeY + (Math.random() - 0.5) * 32 };
      }
      const mx = tx - e.sprite.x;
      const my = ty - e.sprite.y;
      const m = Math.hypot(mx, my);
      if (m > 1) {
        const step = Math.min(m, speed * dt);
        const ts = this.index.tileSize;
        const next = move({ x: e.sprite.x, y: e.sprite.y }, (mx / m) * step, (my / m) * step, FEET, (x, y) => this.store.collisionAt(x, y), ts);
        e.sprite.setPosition(next.x, next.y).setFlipX(mx < 0).setDepth(DEPTH.entities + next.y);
        e.sprite.setFrame(Math.floor(time / 200) % 2);
      }
      if (e.state === 'chase' && d < 10) {
        void this.startEncounter(e);
        return;
      }
    }
  }

  private async startEncounter(e: OverworldEnemy): Promise<void> {
    if (!this.scene.manager.keys['Encounter']) {
      // The encounter scene isn't available yet: just shoo them off.
      toast(`The ${e.enemy.name.toLowerCase()} wandered off.`);
      this.settle(e.spawn, true);
      e.sprite.destroy();
      this.enemies = this.enemies.filter((x) => x !== e);
      return;
    }
    this.busy = true;
    settled.pending = e.spawn;
    await this.leaveTo('Encounter', { enemyId: e.enemy.id, returnTo: 'Map', returnData: {} });
  }

  // --- Overworld birds ---------------------------------------------------

  private spawnBirds(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    if (this.flushedChunks.has(key)) return;
    for (const o of chunk.objects) {
      if (o.type !== 'bird') continue;
      const species = o.props.species;
      const textureKey = `owbird_${species}`;
      if (!this.textures.exists(textureKey)) continue;
      const count = Number(o.props.count ?? 1);
      for (let i = 0; i < count; i++) {
        const x = o.x + (i - (count - 1) / 2) * 10;
        const y = o.y + ((i * 7) % 9) - 4;
        const sprite = this.add.sprite(x, y, textureKey, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + y);
        this.birds.push({ sprite, species, chunk: key, homeX: x, homeY: y, flushed: false, nextHop: 0, nextCall: 0 });
      }
    }
  }

  private despawnBirds(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.flushedChunks.delete(key);
    this.birds = this.birds.filter((b) => {
      if (b.chunk !== key) return true;
      b.sprite.destroy();
      return false;
    });
  }

  private inTallGrass(): boolean {
    const ts = this.index.tileSize;
    return this.store.groundAt(Math.floor(this.pos.x / ts), Math.floor((this.pos.y - 2) / ts)) === this.tallGrass;
  }

  private makeRustle(): void {
    const key = 'rustle-leaf';
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0x78c058).fillRect(0, 0, 2, 1).fillStyle(0x3c8c3c).fillRect(0, 1, 1, 1);
      g.generateTexture(key, 2, 2);
      g.destroy();
    }
    this.rustle = this.add
      .particles(0, 0, key, { speed: { min: 10, max: 30 }, angle: { min: 200, max: 340 }, gravityY: 80, lifespan: 350, emitting: false })
      .setDepth(DEPTH.overhead - 1);
  }

  private updateBirds(time: number, noisy: boolean, flushRadius = FLUSH_RADIUS): void {
    for (const b of this.birds) {
      if (b.flushed) continue;
      const d = Math.hypot(b.sprite.x - this.pos.x, b.sprite.y - this.pos.y);
      if (noisy && d < flushRadius) {
        this.flush(b);
        continue;
      }
      if (d < HEAR_RANGE && time >= b.nextCall && time >= this.nextBirdCall) {
        b.nextCall = time + 4000 + Math.random() * 9000;
        // Not every bird calls the moment it may; and none in the rain.
        if (Math.random() < 0.5 && ambience.rain <= DRY_RAIN) {
          this.birdCall(b);
          this.nextBirdCall = time + CALL_GAP_MS;
        }
      }
      if (time >= b.nextHop) {
        b.nextHop = time + 600 + Math.random() * 1800;
        b.sprite.setFrame(1);
        b.sprite.setFlipX(Math.random() < 0.5);
        const nx = Phaser.Math.Clamp(b.sprite.x + (Math.random() - 0.5) * 6, b.homeX - 8, b.homeX + 8);
        this.tweens.add({ targets: b.sprite, x: nx, duration: 120, onComplete: () => b.sprite.setFrame(0) });
      }
    }
  }

  /** A bird's call (birds.yaml `call`), placed where it sits; louder when it's alarmed. */
  private birdCall(b: OverworldBird, alarm = false): void {
    const def = this.session.content.birds.find((x) => x.id === b.species);
    if (!def?.call) return;
    const { gain, pan } = placeSound(b.sprite.x, b.sprite.y, this.pos.x, this.pos.y, HEAR_RANGE);
    const loud = alarm ? Math.max(gain, 0.6) : gain;
    if (loud < 0.02) return;
    const vary = 0.95 + Math.random() * 0.1;
    this.sounds()?.cue(def.call, { pitch: (def.callPitch || 1) * vary, gain: loud, pan, outdoor: true, silent: loud < 0.35, caption: `${def.name} calls` });
  }

  private flush(b: OverworldBird): void {
    if (Math.random() < 0.6) this.birdCall(b, true);
    b.flushed = true;
    this.flushedChunks.add(b.chunk);
    const away = b.sprite.x >= this.pos.x ? 1 : -1;
    b.sprite.setFlipX(away < 0).setFrame(1);
    this.tweens.add({
      targets: b.sprite,
      x: b.sprite.x + away * 140,
      y: b.sprite.y - 120,
      alpha: 0,
      duration: 1100,
      ease: 'Quad.easeIn',
      onComplete: () => b.sprite.setVisible(false),
    });
  }

  // --- Animations --------------------------------------------------------

  private makeAnimations(): void {
    const anims = this.anims;
    for (const [facing, row] of Object.entries(FACING_ROW)) {
      const key = `angie-walk-${facing}`;
      if (anims.exists(key)) continue;
      anims.create({
        key,
        frames: anims.generateFrameNumbers('char_angie', { frames: [row * 4 + 1, row * 4 + 2, row * 4 + 3, row * 4 + 2] }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!anims.exists('oboy-idle')) {
      anims.create({ key: 'oboy-idle', frames: anims.generateFrameNumbers('char_oboy', { frames: [0, 0, 0, 1] }), frameRate: 3, repeat: -1 });
    }
  }
}

/** A tiny camera icon (7×5) centred on (x, y), drawn on a camera-fixed Graphics. */
function cameraIcon(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x101018, 1).fillRect(x - 4, y - 3, 9, 7);
  g.fillStyle(0xf0f0f0, 1).fillRect(x - 3, y - 2, 7, 5);
  g.fillStyle(0x101018, 1).fillRect(x - 1, y - 1, 3, 3);
  g.fillStyle(0xf0f0f0, 1).fillRect(x - 3, y - 4, 2, 1);
}

/** The map sprite for a transit mode. */
function vehicleTexture(mode: string): string {
  return mode === 'ferry' ? 'vehicle_ferry' : mode === 'tram' ? 'vehicle_tram' : 'vehicle_bus';
}

function labelFor(o: WorldObject): string | null {
  switch (o.type) {
    case 'gateway':
      return 'Warp';
    case 'stop':
      return 'Board';
    case 'shop':
      return 'Shop';
    case 'radio':
      return 'Listen';
    case 'storage':
      return 'Pack';
    case 'photo_wall':
      return 'Look';
    case 'bed':
      return 'Sleep';
    case 'spot':
      return 'Photograph';
    case 'npc':
      return 'Talk';
    case 'door':
      return 'Enter';
    case 'collectible':
      return 'Pick up';
    default:
      return null;
  }
}

/** The value after `current` in `values`, wrapping around. */
function cycle<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length];
}
