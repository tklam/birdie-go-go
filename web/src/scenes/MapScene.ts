import Phaser from 'phaser';
import type { WorldIndex, WorldObject } from '../core/types.gen';
import { InputReader } from '../systems/input';
import { FollowerTrail } from '../systems/party';
import type { Session } from '../systems/session';
import { showAlbum } from '../ui/album';
import { Hud } from '../ui/hud';
import { showMenu } from '../ui/menu';
import { modal } from '../ui/overlay';
import { showPanel } from '../ui/panel';
import { downloadSave, pickSave } from '../systems/backup';
import { toast } from '../ui/toast';
import { TouchControls } from '../ui/touchControls';
import { CHUNK_TILES, type ChunkData } from '../world/chunk';
import { ChunkRenderer, DEPTH } from '../world/ChunkRenderer';
import { createWorkerChunkLoader } from '../world/loader';
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
  /** Set when returning from a task scene, to end the time slot. */
  from?: 'Photo' | 'Piano';
  spotId?: string;
  studentId?: string;
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
  private busy = false;

  constructor() {
    super('Map');
  }

  create(data: MapSceneData): void {
    this.session = this.registry.get('session') as Session;
    this.index = this.registry.get('world') as WorldIndex;
    this.birds = [];
    this.ready = false;
    this.busy = false;
    this.area = null;
    this.makeAnimations();

    this.chunkRenderer = new ChunkRenderer(this, this.index.tileset, this.index.tileSize);
    this.store = new ChunkStore(this.index, createWorkerChunkLoader(), {
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
    const spawn = this.index.spawns[state.position.spawn ?? this.session.content.game.startSpawn];
    this.pos = {
      x: state.position.x ?? spawn?.x ?? 0,
      y: state.position.y ?? spawn?.y ?? 0,
    };
    this.angie = this.add.sprite(this.pos.x, this.pos.y, 'char_angie', 0).setOrigin(0.5, 1);
    this.trail.reset(this.pos.x, this.pos.y);
    if (state.party.includes('oboy')) {
      this.oboy = this.add.sprite(this.pos.x, this.pos.y, 'char_oboy', 0).setOrigin(0.5, 1).play('oboy-idle');
    }

    const worldW = this.index.widthChunks * CHUNK_TILES * this.index.tileSize;
    const worldH = this.index.heightChunks * CHUNK_TILES * this.index.tileSize;
    this.cameras.main.setBounds(0, 0, worldW, worldH).setRoundPixels(true);
    this.cameras.main.startFollow(this.angie, true, 1, 1);
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.touch = new TouchControls();
    this.input2 = new InputReader(this, this.touch);
    this.hud = new Hud();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.touch.destroy();
      this.hud.destroy();
    });

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

    if (moving) {
      const ts = this.index.tileSize;
      const next = move(this.pos, input.x * speed * dt, input.y * speed * dt, FEET, (tx, ty) => this.store.collisionAt(tx, ty), ts);
      this.pos = next;
      this.facing = Math.abs(input.x) > Math.abs(input.y) ? (input.x < 0 ? 'left' : 'right') : input.y < 0 ? 'up' : 'down';
      this.angie.anims.play(`angie-walk-${this.facing}`, true);
      this.angie.anims.timeScale = input.sneak ? 0.5 : 1;
    } else {
      this.angie.anims.stop();
      this.angie.setFrame(FACING_ROW[this.facing] * 4);
    }
    this.angie.setPosition(this.pos.x, this.pos.y).setDepth(DEPTH.entities + this.pos.y);
    this.trail.push(this.pos.x, this.pos.y);
    if (this.oboy) {
      const side = this.facing === 'left' ? 3 : -3;
      this.oboy.setPosition(this.pos.x + side, this.pos.y - 15).setDepth(DEPTH.entities + this.pos.y + 1);
    }

    this.session.state.position = { map: 'world', x: Math.round(this.pos.x), y: Math.round(this.pos.y) };
    this.updateArea();
    this.updateBirds(time, moving && !input.sneak);

    this.hud.update(this.session.state);
    if (input.menu && this.ready && !this.busy) void this.openMenu();
    const target = this.ready && !this.busy ? this.interactionTarget() : null;
    this.touch.setAction(target?.label ?? null);
    if (input.action && target) void this.interact(target);
  }

  private updateArea(): void {
    const ts = this.index.tileSize;
    const area = this.store.areaAt(Math.floor(this.pos.x / ts), Math.floor((this.pos.y - 2) / ts));
    if (!area || area === this.area) return;
    const first = this.area === null;
    this.area = area;
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
          await this.leaveTo('Photo', { spotId: o.props.spot_id, returnTo: 'Map' });
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
          toast('The door is locked. (Interiors are coming soon.)');
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  private async leaveTo(scene: string, data: object): Promise<void> {
    if (!this.scene.manager.keys[scene]) {
      toast('Coming soon!');
      return;
    }
    await this.session.save();
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(scene, data));
  }

  private async openMenu(): Promise<void> {
    this.busy = true;
    const s = this.session;
    const items = [
      { label: 'Album', run: async () => (await showAlbum(s.content, s.state), true) },
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

  private updateBirds(time: number, noisy: boolean): void {
    for (const b of this.birds) {
      if (b.flushed) continue;
      const d = Math.hypot(b.sprite.x - this.pos.x, b.sprite.y - this.pos.y);
      if (noisy && d < FLUSH_RADIUS) {
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
