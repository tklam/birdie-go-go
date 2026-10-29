import Phaser from 'phaser';
import type { WeatherDay, WeatherParams, WorldIndex, WorldObject } from '../core/types.gen';
import { blendAt, easeWeather, mixWeather } from '../weather/blend';
import { WeatherRenderer } from '../weather/renderer';
import { MAX_ENERGY, TIME_SLOTS } from '../systems/state';
import { assess, breakItem, drain, protection, toggleGear, useItem, type HazardReport } from '../systems/hazards';
import { InputReader } from '../systems/input';
import { FollowerTrail } from '../systems/party';
import type { Session } from '../systems/session';
import { showAlbum } from '../ui/album';
import { Hud } from '../ui/hud';
import { showMenu } from '../ui/menu';
import { iris } from '../fx/iris';
import { modal } from '../ui/overlay';
import { showPanel } from '../ui/panel';
import { downloadSave, pickSave } from '../systems/backup';
import { loadJSON } from '../systems/data';
import type { Manifest } from '../systems/assets';
import { toast } from '../ui/toast';
import { TouchControls } from '../ui/touchControls';
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
  from?: 'Photo' | 'Piano';
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
  private rustle!: Phaser.GameObjects.Particles.ParticleEmitter;
  private busy = false;

  constructor() {
    super('Map');
  }

  create(data: MapSceneData): void {
    this.session = this.registry.get('session') as Session;
    this.birds = [];
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
    this.makeRustle();

    this.chunkRenderer = new ChunkRenderer(this, this.index.tileset, this.index.tileSize);
    this.store = new ChunkStore(this.index, workerChunkLoader(`${mapPath(this.mapId)}chunks/`), {
      loaded: (c) => {
        this.chunkRenderer.enqueue(c);
        this.spawnBirds(c);
      },
      evicted: (c) => {
        this.chunkRenderer.remove(c);
        this.despawnBirds(c);
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
    this.loaded = true;

    void this.arrive(data);
  }

  /** Story and time bookkeeping when the scene (re)starts. */
  private async arrive(data: MapSceneData): Promise<void> {
    this.busy = true;
    await this.waitForWorld();
    const s = this.session;
    if (data.from === 'Photo') {
      await s.fire({ type: 'photo_session_end', params: data.spotId ? { spot: data.spotId } : {} });
      await s.endSlot();
    } else if (data.from === 'Piano') {
      await s.fire({ type: 'lesson_complete', params: data.studentId ? { student: data.studentId } : {} });
      await s.endSlot();
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

    this.updateWeather(delta);
    this.updateHazards(delta);
    this.hud.update(this.session.state, this.weatherLabel(), this.hazards?.exposed.map((e) => e.hazard.status) ?? []);
    this.updateMusic();
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
        if (!label) continue;
        const reach = o.type === 'spot' ? REACH * 2 : REACH;
        const d = Math.hypot(o.x - px, o.y - py);
        if (d <= reach && (!best || d < best.d)) best = { label, object: o, d };
      }
    }
    if (best) return best;
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
        case 'spot':
          await this.leaveTo('Photo', { spotId: o.props.spot_id, returnTo: 'Map', weather: this.weatherNow });
          return;
        case 'npc': {
          const student = o.props.student;
          await this.session.fire({ type: 'talk', params: { npc: o.props.npc_id ?? o.name } });
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
        ...s.content.items.map((item) => ({
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
      { label: 'Album', run: async () => (await showAlbum(s.content, s.state, this.registry.get('manifest') as Manifest), true) },
      { label: 'Bag', run: () => this.bag() },
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
    if (this.scene.manager.keys['Calibration']) {
      items.push({
        label: 'Recalibrate audio',
        run: async () => {
          await s.save();
          this.scene.start('Calibration', { returnTo: 'Map', returnData: {} });
          return false;
        },
      });
    }
    items.push({ label: 'Close', run: async () => false });
    await showMenu('Menu', items);
    this.busy = false;
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
