import Phaser from 'phaser';
import type { AmbientNPC, Enemy, WeatherDay, WeatherParams, WorldIndex, WorldObject } from '../core/types.gen';
import { rng } from '../photo/birds';
import { pathLength, pointAt, ridePath, type Pt } from '../world/path';
import { build, buildStatus, CAMERA_PART, placeTrailCamera, TRAIL_CAMERA, trailCamFlag } from '../systems/gadgets';
import { floatingButton } from '../ui/panel';
import { CHUNK_TILES } from '../world/chunk';
import { blendAt, easeWeather, mixWeather } from '../weather/blend';
import { WeatherRenderer } from '../weather/renderer';
import { MAX_ENERGY, TIME_SLOTS } from '../systems/state';
import { activeMissions, doneMissions, type PhotoResult } from '../systems/missions';
import { assess, breakItem, drain, protection, toggleGear, useItem, type HazardReport } from '../systems/hazards';
import { InputReader } from '../systems/input';
import { FollowerTrail } from '../systems/party';
import type { Session } from '../systems/session';
import { showAlbum } from '../ui/album';
import { Hud } from '../ui/hud';
import { showMenu } from '../ui/menu';
import { showDialogue } from '../ui/dialogue';
import { showMinimap, type MapMarker } from '../ui/minimap';
import { iris } from '../fx/iris';
import { glitch } from '../fx/glitch';
import { modal } from '../ui/overlay';
import { showPanel } from '../ui/panel';
import { downloadSave, pickSave } from '../systems/backup';
import { loadJSON } from '../systems/data';
import type { Manifest } from '../systems/assets';
import { toast } from '../ui/toast';
import { TouchControls } from '../ui/touchControls';
import type { AudioEngine } from '../audio/AudioEngine';
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
  chunk: string;
  target: { x: number; y: number };
  pauseUntil: number;
  nextShot: number;
  line: string;
}

const PASSERBY_SPEED = 26;

interface OverworldNpc {
  object: WorldObject;
  sprite: Phaser.GameObjects.Sprite;
  chunk: string;
}

interface OverworldEnemy {
  enemy: Enemy;
  sprite: Phaser.GameObjects.Sprite;
  chunk: string;
  homeX: number;
  homeY: number;
  state: 'wander' | 'chase' | 'return';
  target: { x: number; y: number };
  nextWander: number;
}

/** Remembers which enemies were dealt with today, and short post-escape calm. */
const settled = { day: 0, ids: new Set<string>(), calmUntil: 0 };

interface OverworldBird {
  sprite: Phaser.GameObjects.Sprite;
  species: string;
  chunk: string;
  homeX: number;
  homeY: number;
  flushed: boolean;
  nextHop: number;
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
  private enemies: OverworldEnemy[] = [];
  private npcs: OverworldNpc[] = [];
  private gateways: { object: WorldObject; sprite: Phaser.GameObjects.Sprite; chunk: string }[] = [];
  private passersby: Passerby[] = [];
  private glints!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** The ride in progress (SPEC.md §4.11), if any. */
  private ride: { vehicle: Phaser.GameObjects.Sprite; path: Pt[]; length: number; distance: number; speed: number; to: string; line: string; removeSkip: () => void } | null = null;
  private kei: Phaser.GameObjects.Sprite | null = null;
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
  private weatherRenderer: WeatherRenderer | null = null;
  private hazards: HazardReport | null = null;
  private fainting = false;
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
    this.enemies = [];
    this.npcs = [];
    this.gateways = [];
    this.passersby = [];
    this.ride = null;
    this.kei = null;
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
    this.touch = new TouchControls();
    this.input2 = new InputReader(this, this.touch);
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

  private setup(index: WorldIndex, data: MapSceneData): void {
    this.index = index;
    this.makeAnimations();
    this.tallGrass = this.index.tileNames.indexOf('tall_grass') + 1 || -1;
    this.benchTile = this.index.tileNames.indexOf('bench') + 1 || -1;
    this.makeRustle();
    this.makeGlints();

    this.chunkRenderer = new ChunkRenderer(this, this.index.tileset, this.index.tileSize);
    this.store = new ChunkStore(this.index, workerChunkLoader(`${mapPath(this.mapId)}chunks/`), {
      loaded: (c) => {
        this.chunkRenderer.enqueue(c);
        this.spawnBirds(c);
        this.spawnEnemies(c);
        this.spawnNpcs(c);
        this.spawnGateways(c);
        this.spawnPassersby(c);
      },
      evicted: (c) => {
        this.chunkRenderer.remove(c);
        this.despawnBirds(c);
        this.despawnEnemies(c);
        this.despawnNpcs(c);
        this.gateways = this.gateways.filter((g) => (g.chunk === chunkKey(c.cx, c.cy) ? (g.sprite.destroy(), false) : true));
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
      await s.fire({ type: 'photo_session_end', params: data.spotId ? { spot: data.spotId } : {} });
      const area = s.content.spots.find((x) => x.id === data.spotId)?.area ?? '';
      const shots = (this.registry.get('lastPhotos') as { species: string; result: { rating: PhotoResult['rating'] } }[] | undefined) ?? [];
      await s.checkMissions({ photos: shots.map((p) => ({ species: p.species, rating: p.result.rating, area })) });
      await s.endSlot();
    } else if (data.from === 'Piano') {
      const last = this.registry.get('lastLesson') as { studentId: string; result: { score: number } } | undefined;
      if (last) await s.checkMissions({ lesson: { studentId: last.studentId, score: last.result.score } });
      await s.fire({ type: 'lesson_complete', params: data.studentId ? { student: data.studentId } : {} });
      await s.endSlot();
    } else if (data.from === 'Encounter' && data.encounter) {
      const e = data.encounter;
      if (e.outcome === 'won' || e.outcome === 'escaped' || e.outcome === 'skipped') {
        this.settle(e.enemyId, e.outcome === 'won');
        await s.fire({ type: e.outcome === 'won' ? 'encounter_won' : 'encounter_escaped', params: { enemy: e.enemyId } });
      } else if (e.outcome === 'lost') {
        s.state.energy = 0;
      }
    } else if (!s.state.firedEvents['prologue_arrival']) {
      await s.fire({ type: 'new_game' });
    }
    await s.save();
    this.busy = false;
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
    const input = this.input2.read();
    if (this.ride) {
      this.updateRide(time, dt);
      return;
    }
    const speed = input.sneak ? SNEAK_SPEED : WALK_SPEED;
    const moving = this.ready && !this.busy && modal.open === 0 && (input.x !== 0 || input.y !== 0);

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
      this.pos = move(this.pos, vx * dt, vy * dt, FEET, (tx, ty) => this.store.collisionAt(tx, ty), ts);
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
    this.updatePassersby(time, dt);
    if (this.oboy) {
      // Perched on the shoulder away from where she's facing.
      const side = this.facing === 'left' ? 5 : -5;
      this.oboy.setFlipX(this.facing === 'left').setPosition(this.pos.x + side, this.pos.y - 11).setDepth(DEPTH.entities + this.pos.y + 1);
    }

    this.session.state.position = { map: this.mapId, x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    this.updateArea();
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
    const target = this.weatherAt(this.pos.x, this.pos.y - 4);
    if (!target) return;
    this.weatherNow = this.weatherNow ? easeWeather(this.weatherNow, target, delta) : target;
    this.weatherRenderer.update(this.weatherNow, s.state.slot, delta);
  }

  /**
   * Hazards outdoors: drain Energy (one in-game minute per real second),
   * push in strong wind, break umbrellas; recover slowly indoors (SPEC.md §4.12).
   */
  private updateHazards(delta: number): void {
    const s = this.session;
    const minutes = Math.min(delta, 100) / 1000;
    if (!this.weatherRenderer) {
      this.hazards = null;
      s.state.energy = Math.min(MAX_ENERGY, s.state.energy + 0.3 * minutes);
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
    s.state.energy = drain(s.state.energy, this.hazards.exposed, minutes);
    if (s.state.energy <= 0) void this.faint();
  }

  /** No game over: a passer-by helps Angie home (SPEC.md §4.12). */
  private async faint(): Promise<void> {
    if (this.fainting) return;
    this.fainting = true;
    this.busy = true;
    const s = this.session;
    const fee = Math.min(s.state.money, 50);
    this.cameras.main.fadeOut(900, 0, 0, 0);
    await new Promise((r) => this.time.delayedCall(1000, r));
    await showPanel('You feel dizzy...', [
      'Angie sat down, exhausted by the weather.',
      `A kind neighbour helped her home. (-$${fee})`,
      'Pack the right gear next time!',
    ]);
    s.state.money -= fee;
    s.state.energy = 60;
    await s.endSlot();
    s.state.position = { map: 'angie_flat', spawn: 'front_door' };
    await s.save();
    this.scene.restart({ map: 'angie_flat', spawn: 'front_door', title: "Angie's flat" });
  }

  /** The blended weather at a world position, or null if unknown. */
  private weatherAt(x: number, y: number): WeatherParams | null {
    const w = this.weatherDay;
    if (!w) return null;
    const slot = TIME_SLOTS.indexOf(this.session.state.slot);
    const weights = blendAt((cx, cy) => this.store.get(cx, cy), x, y, this.index.tileSize);
    return mixWeather(weights, (a) => w.areas.find((aw) => aw.area === this.index.areas[a])?.slots[slot]);
  }

  /** "Rain 21°C", the named weather of the current area, or "" indoors. */
  private weatherLabel(): string {
    const w = this.weatherDay;
    if (!w || !this.area || !this.weatherNow) return '';
    const slot = TIME_SLOTS.indexOf(this.session.state.slot);
    const named = w.areas.find((a) => a.area === this.area)?.named[slot] ?? '';
    const signal = w.typhoonSignal[slot];
    const name = named.charAt(0).toUpperCase() + named.slice(1);
    return `${name} ${Math.round(this.weatherNow.temp)}°C${signal ? ` T${signal}` : ''}`;
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
    this.wantMusic = this.session.content.areas.find((a) => a.id === area)?.music ?? null;
    const name = this.session.content.areas.find((a) => a.id === area)?.name ?? area;
    toast(name);
    if (!first) void this.session.fire({ type: 'enter_area', params: { area } });
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
    const spot = bird && this.session.content.spots.find((s) => s.area === this.area);
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
          await this.leaveTo('Photo', { spotId, returnTo: 'Map', weather: this.weatherNow });
          return;
        }
        case 'npc': {
          const student = o.props.student;
          const fired = await this.session.fire({ type: 'talk', params: { npc: o.props.npc_id ?? o.name } });
          if (fired.length > 0 && !student) break;
          if (student && this.scene.manager.keys['Piano']) {
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
        case 'passerby':
          await showDialogue([{ speaker: o.name, text: o.props.line }]);
          break;
        case 'shop':
          await this.shop(o.props.title ?? 'Shop');
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  private async goThrough(door: WorldObject): Promise<void> {
    const map = door.props.to_map;
    if (!map) return;
    const data: MapSceneData = { map, spawn: door.props.to_spawn, title: door.props.title };
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
      if (w.typhoonSignal.some((x) => x > 0)) lines.unshift(`Typhoon signal No. ${Math.max(...w.typhoonSignal)} is in force!`);
    } catch {
      lines = ['Only static on the radio...'];
    }
    await showPanel("Tomorrow's weather", lines);
  }

  private async shop(title: string): Promise<void> {
    const s = this.session;
    await showMenu(
      `${title}  $${s.state.money}`,
      [
        ...s.content.items.filter((item) => item.price > 0).map((item) => ({
          label: `${item.name} $${item.price}`,
          run: async () => {
            if (s.state.money < item.price) {
              toast("You can't afford that.");
              return true;
            }
            s.state.money -= item.price;
            s.state.items[item.id] = (s.state.items[item.id] ?? 0) + 1;
            toast(`Bought ${item.name}.`);
            await s.save();
            return true;
          },
        })),
        { label: 'Leave', run: async () => false },
      ],
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
    const markers: MapMarker[] = world.landmarks
      .filter((l) => l.type !== 'gateway' || s.state.flags[`gateway:${l.id}`])
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
    await showMinimap({
      title: `Map · ${area}`,
      imageUrl: `${import.meta.env.BASE_URL}world/${world.overview}`,
      widthTiles: world.widthChunks * world.chunkTiles,
      heightTiles: world.heightChunks * world.chunkTiles,
      tileSize: world.tileSize,
      markers,
    });
    return true;
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
      await showMenu('Settings', items);
    }
    await s.save();
    return true;
  }

  /** Kei builds gadgets from camera parts (SPEC.md §7.2). */
  private async workshop(): Promise<void> {
    const s = this.session;
    const buildable = s.content.items.filter((i) => i.build);
    const parts = s.state.items[CAMERA_PART] ?? 0;
    const why = { ok: '', stage: ' (later)', parts: '', owned: ' (built)', 'not-buildable': '' } as const;
    await showMenu(`Kei's workshop · parts ${parts}`, [
      ...buildable.map((item) => {
        const status = buildStatus(s.state, item);
        return {
          label: `${item.name}: ${item.build?.parts} parts${why[status]}`,
          run: async () => {
            if (build(s.state, item)) {
              await showPanel(`Kei built a ${item.name}!`, [item.description]);
              await s.save();
            } else if (status === 'parts') {
              toast('Not enough camera parts. Monsters sometimes drop them...');
            } else if (status === 'stage') {
              toast("Kei says he's still working on that one.");
            }
            return false;
          },
        };
      }),
      { label: 'Back', run: async () => false },
    ]);
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

  /** The bag: wear/remove gear, use snacks and sunscreen. */
  private async bag(): Promise<boolean> {
    const s = this.session;
    const owned = s.content.items.filter((i) => (s.state.items[i.id] ?? 0) > 0);
    if (owned.length === 0) {
      await showPanel('Bag', ['Your bag is empty.', 'Try the convenience store in the mall plaza.']);
      return true;
    }
    await showMenu(
      `Bag · Energy ${Math.ceil(s.state.energy)}`,
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
  }

  private async leaveTo(scene: string, data: object): Promise<void> {
    if (!this.scene.manager.keys[scene]) {
      toast('Coming soon!');
      return;
    }
    await this.session.save();
    // Iris onto Angie, the classic way into a minigame.
    await iris(this, 'out', this.pos.x, this.pos.y - 12);
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
      {
        label: 'Import save',
        run: async () => {
          try {
            const state = await pickSave();
            if (!state) return true;
            s.state = state;
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

  /** Lists rides from a stop; boarding pays the fare and starts the ride. */
  private async boardAt(stopId: string): Promise<void> {
    const s = this.session;
    const t = s.content.transit;
    const name = (id: string) => t.stops.find((x) => x.id === id)?.name ?? id;
    const options = t.lines.flatMap((line) =>
      line.stops.includes(stopId) ? line.stops.filter((x) => x !== stopId).map((to) => ({ line, to })) : [],
    );
    if (options.length === 0) {
      toast('No services from here yet.');
      return;
    }
    let picked: (typeof options)[number] | null = null;
    await showMenu(`${name(stopId)}  $${s.state.money}`, [
      ...options.map((o) => ({
        label: `${o.line.name} → ${name(o.to)} $${o.line.fare}`,
        run: async () => ((picked = o), false),
      })),
      { label: 'Not now', run: async () => false },
    ]);
    const choice = picked as (typeof options)[number] | null;
    if (!choice) return;
    if (s.state.money < choice.line.fare) {
      toast("You can't afford the fare.");
      return;
    }
    const path = ridePath(choice.line.path as Pt[], choice.line.stops, stopId, choice.to);
    const key = choice.line.mode === 'ferry' ? 'vehicle_ferry' : 'vehicle_bus';
    if (!path || !this.textures.exists(key)) return;
    s.state.money -= choice.line.fare;
    const start = pointAt(path, 0);
    const vehicle = this.add.sprite(start.x, start.y, key, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + start.y);
    this.angie.setVisible(false);
    this.oboy?.setVisible(false);
    this.kei?.setVisible(false);
    this.cameras.main.startFollow(vehicle, true, 1, 1);
    const removeSkip = floatingButton('Skip', 'back', () => {
      if (this.ride) this.ride.distance = this.ride.length;
    });
    this.ride = { vehicle, path, length: pathLength(path), distance: 0, speed: choice.line.speed, to: choice.to, line: choice.line.id, removeSkip };
    toast(`${choice.line.name} to ${name(choice.to)}`);
  }

  private updateRide(time: number, dt: number): void {
    const r = this.ride;
    if (!r) return;
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
    const stop = this.index.stops[r.to];
    this.pos = { x: stop?.x ?? r.vehicle.x, y: (stop?.y ?? r.vehicle.y) + 4 };
    r.vehicle.destroy();
    this.angie.setVisible(true).setPosition(this.pos.x, this.pos.y);
    this.oboy?.setVisible(true);
    this.kei?.setVisible(true);
    this.trail.reset(this.pos.x, this.pos.y);
    this.cameras.main.startFollow(this.angie, true, 1, 1);
    const s = this.session;
    toast(`Arrived at ${s.content.transit.stops.find((x) => x.id === r.to)?.name ?? r.to}.`);
    await s.fire({ type: 'ride_complete', params: { line: r.line } });
    await s.save();
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
        this.passersby.push({ def, sprite, chunk: key, target: { x, y }, pauseUntil: 0, nextShot: 0, line });
      }
    }
  }

  private despawnPassersby(chunk: ChunkData): void {
    const key = chunkKey(chunk.cx, chunk.cy);
    this.passersby = this.passersby.filter((p) => {
      if (p.chunk !== key) return true;
      p.sprite.destroy();
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

  /** Marks an enemy as dealt with: defeated/driven off for the day, or calm for a while after an escape. */
  private settle(enemyId: string, beaten: boolean): void {
    if (settled.day !== this.session.state.day) {
      settled.day = this.session.state.day;
      settled.ids.clear();
    }
    if (beaten) settled.ids.add(enemyId);
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
      if (!enemy || settled.ids.has(enemy.id) || !this.textures.exists(enemy.sprite)) continue;
      if (enemy.slots.length && !enemy.slots.includes(s.state.slot)) continue;
      const sprite = this.add.sprite(o.x, o.y, enemy.sprite, 0).setOrigin(0.5, 1).setDepth(DEPTH.entities + o.y);
      this.enemies.push({ enemy, sprite, chunk: chunkKey(chunk.cx, chunk.cy), homeX: o.x, homeY: o.y, state: 'wander', target: { x: o.x, y: o.y }, nextWander: 0 });
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
      this.settle(e.enemy.id, true);
      e.sprite.destroy();
      this.enemies = this.enemies.filter((x) => x !== e);
      return;
    }
    this.busy = true;
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
        this.birds.push({ sprite, species, chunk: key, homeX: x, homeY: y, flushed: false, nextHop: 0 });
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
      if (time >= b.nextHop) {
        b.nextHop = time + 600 + Math.random() * 1800;
        b.sprite.setFrame(1);
        b.sprite.setFlipX(Math.random() < 0.5);
        const nx = Phaser.Math.Clamp(b.sprite.x + (Math.random() - 0.5) * 6, b.homeX - 8, b.homeX + 8);
        this.tweens.add({ targets: b.sprite, x: nx, duration: 120, onComplete: () => b.sprite.setFrame(0) });
      }
    }
  }

  private flush(b: OverworldBird): void {
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
    case 'bed':
      return 'Sleep';
    case 'spot':
      return 'Photograph';
    case 'npc':
      return 'Talk';
    case 'door':
      return 'Enter';
    default:
      return null;
  }
}
