import Phaser from 'phaser';
import type { Bird, Spot, WeatherParams } from '../core/types.gen';
import { WeatherRenderer } from '../weather/renderer';
import { weatherOptics, withMods, withStatuses } from '../photo/optics';
import { available, hiddenBird, idlePose, landingSpots, rng, shelterPenalty, visitors, type Pose } from '../photo/birds';
import type { Manifest, ManifestEntry } from '../systems/assets';
import { frameIndex } from '../systems/assets';
import {
  addToAlbum,
  OBOY_ALERT_SLOWDOWN,
  pickSubject,
  scoreShot,
  shouldFlee,
  updateAlert,
  type Rect,
  type ShotResult,
} from '../systems/photoScore';
import type { Session } from '../systems/session';
import { season } from '../systems/state';
import { modal } from '../ui/overlay';
import { floatingButton, showPanel } from '../ui/panel';
import { TEXT as PIXEL_TEXT } from '../ui/text';
import { oboyCall, oboyChirp } from '../audio/oboy';
import type { AudioEngine } from '../audio/AudioEngine';
import { iris } from '../fx/iris';
import { reducedMotion } from '../fx/motion';

/** Default lens and body (SPEC.md §5); upgrades come with gear. */
const FRAME_W = 80;
const FRAME_H = 54;
/** Keyboard aiming speed in px/s. */
const AIM_SPEED = 110;
/** Viewfinder speed above which focus restarts. */
const STEADY_SPEED = 40;
/** Minimum hold before a release counts as a shot (so quick drags only aim). */
const MIN_SHOT_HOLD_MS = 100;

const RATING_LABEL = { perfect: '★★★ Perfect!', great: '★★ Great', good: '★ Good', blurry: 'Blurry…' } as const;

type BirdState = 'arriving' | 'perched' | 'leaving' | 'gone';

interface SceneBird {
  species: Bird;
  sprite: Phaser.GameObjects.Sprite;
  state: BirdState;
  pose: Pose;
  nextPose: number;
  leaveAt: number;
  last: { x: number; y: number };
  speed: number;
}

export interface PhotoSceneData {
  spotId: string;
  returnTo?: string;
  /** The weather at the spot when the session started (SPEC.md §4.9). */
  weather?: WeatherParams | null;
  /** The named weather there (clear, rain, …): some birds only come in some weather. */
  named?: string;
  /** Hazards Angie was exposed to on the way (SPEC.md §4.12): soaked, overheated, … */
  statuses?: string[];
}

/** The birding action view (SPEC.md §5). */
export class PhotoScene extends Phaser.Scene {
  private session!: Session;
  private spot!: Spot;
  private bgEntry!: ManifestEntry;
  private random!: () => number;
  private birds: SceneBird[] = [];
  private toSpawn: string[] = [];
  private nextSpawn = 0;
  private vf = { x: 160, y: 90 };
  private vfLast = { x: 160, y: 90 };
  private focusing = false;
  private focusStart = 0;
  private shotsLeft = 0;
  private alert = 0;
  private results: { species: string; result: ShotResult }[] = [];
  private layers: Phaser.GameObjects.Image[] = [];
  private graphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private popup!: Phaser.GameObjects.Text;
  private bboxes = new Map<string, Rect[]>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private removeBack: () => void = () => {};
  private removeCall: () => void = () => {};
  /** Other birders in the foreground, clicking away (they can unsettle birds a little). */
  private photographers: { sprite: Phaser.GameObjects.Sprite; nextShot: number }[] = [];
  /** O Boy's contact call: once per session at bond 40+ (SPEC.md §7.2). */
  private callReady = false;
  private ending = false;
  private returnTo = 'Map';
  private optics = weatherOptics(null);
  private weather: WeatherParams | null = null;
  private weatherRenderer: WeatherRenderer | null = null;

  constructor() {
    super('Photo');
  }

  create(data: PhotoSceneData): void {
    (this.registry.get('music') as { stop(): void } | undefined)?.stop();
    this.session = this.registry.get('session') as Session;
    const content = this.session.content;
    const manifest = this.registry.get('manifest') as Manifest;
    const spot = content.spots.find((s) => s.id === data.spotId);
    if (!spot) throw new Error(`unknown spot ${data.spotId}`);
    this.spot = spot;
    this.returnTo = data.returnTo ?? 'Map';
    this.bgEntry = manifest[spot.background] ?? { type: 'background', layers: [] };
    const state = this.session.state;
    this.random = rng(state.worldSeed ^ (state.day * 977) ^ hash(spot.id) ^ (state.slot.length * 131));
    this.birds = [];
    this.results = [];
    this.alert = 0;
    this.ending = false;
    this.focusing = false;
    this.shotsLeft = spot.shots;
    this.vf = { x: 160, y: 90 };
    this.vfLast = { ...this.vf };
    this.weather = data.weather ?? null;
    const exposed = content.hazards.filter((h) => data.statuses?.includes(h.id));
    this.optics = withStatuses(withMods(weatherOptics(this.weather), state.items), exposed);

    this.layers = (this.bgEntry.layers ?? []).map((id, i) => this.add.image(0, 0, id).setOrigin(0, 0).setDepth(i));
    this.graphics = this.add.graphics().setDepth(100);
    this.hud = this.add.text(316, 3, '', PIXEL_TEXT).setOrigin(1, 0).setDepth(101).setShadow(1, 1, '#101018', 0);
    this.popup = this.add.text(160, 22, '', { ...PIXEL_TEXT, color: '#f0d050' }).setOrigin(0.5).setDepth(101).setAlpha(0);
    this.add.text(104, 3, 'ALERT', PIXEL_TEXT).setDepth(101).setShadow(1, 1, '#101018', 0);
    this.add.text(4, 170, spot.name, { ...PIXEL_TEXT, color: '#f0f0f0' }).setDepth(101).setShadow(1, 1, '#101018', 0);

    // Visitors for this session, chosen by the spot's bird table.
    const table = available(spot, { slot: state.slot, season: season(state.day), flags: state.flags, weather: data.named });
    // Birds shelter from rain: fewer visitors (SPEC.md §4.9).
    this.toSpawn = visitors(table, Math.max(1, 3 + Math.floor(this.random() * 3) - shelterPenalty(data.named)), this.random);
    this.nextSpawn = this.time.now + 600;
    for (const id of new Set(this.toSpawn)) this.measure(`bird_${id}`);

    this.weatherRenderer = this.weather ? new WeatherRenderer(this, 50) : null;
    this.addPhotographers();
    this.setupInput();
    // Statuses carried in from the map: a fogged lens, heat haze.
    const effects = exposed.filter((h) => h.photo);
    if (effects.length) {
      const what = (h: (typeof effects)[number]) => `${h.status}: ${h.photo?.focusScale ? 'the lens fogs up' : 'heat haze softens shots'}`;
      this.time.delayedCall(1800, () => this.showPopup(effects.map(what).join(' · ')));
    }
    // Kei's bird-call app names the birds it can hear (SPEC.md §7.2).
    if (state.party.includes('kei') && this.toSpawn.length) {
      const names = [...new Set(this.toSpawn)].map((id) => content.birds.find((b) => b.id === id)?.name ?? id);
      this.time.delayedCall(700, () => this.showPopup(`Kei's app hears: ${names.join(', ')}`));
    }
    // O Boy + Kei together (SPEC.md §7.2): Kei's app picks out a hidden bird
    // and O Boy calls it in, once per session, once they get along.
    const hidden =
      state.party.includes('kei') && state.party.includes('oboy') && state.flags.oboy_accepts_kei
        ? hiddenBird(table, this.toSpawn, state.album, this.random)
        : null;
    if (hidden) {
      this.toSpawn.push(hidden);
      this.measure(`bird_${hidden}`);
      const name = content.birds.find((b) => b.id === hidden)?.name ?? hidden;
      this.time.delayedCall(2600, () => {
        this.showPopup(`Kei's app finds a hidden ${name}. O Boy calls it in!`);
        oboyCall(this.registry.get('audio') as AudioEngine | undefined);
      });
    }
    this.removeBack = floatingButton('Back', 'back', () => void this.end());
    this.callReady = state.party.includes('oboy') && state.bond.oboy >= 40;
    this.removeCall = this.callReady ? floatingButton('Call', 'call', () => this.contactCall()) : () => {};
    this.input.keyboard?.on('keydown-C', () => this.contactCall());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeBack();
      this.removeCall();
    });
    void iris(this, 'in');
  }

  // --- Input -------------------------------------------------------------

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('keyboard input unavailable');
    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-SPACE', () => this.startFocus());
    kb.on('keyup-SPACE', () => this.release());
    kb.on('keydown-ESC', () => void this.end());

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (modal.open) return;
      if (p.wasTouch) {
        // Relative drag, like a trackpad: the finger never hides the subject.
        if (p.isDown) this.moveViewfinder(p.x - p.prevPosition.x, p.y - p.prevPosition.y);
      } else {
        this.vf = { x: p.x, y: p.y };
        this.clampViewfinder();
      }
    });
    this.input.on('pointerdown', () => this.startFocus());
    this.input.on('pointerup', () => this.release());
  }

  private moveViewfinder(dx: number, dy: number): void {
    this.vf.x += dx * 1.2;
    this.vf.y += dy * 1.2;
    this.clampViewfinder();
  }

  private clampViewfinder(): void {
    this.vf.x = Phaser.Math.Clamp(this.vf.x, FRAME_W / 2, 320 - FRAME_W / 2);
    this.vf.y = Phaser.Math.Clamp(this.vf.y, FRAME_H / 2, 180 - FRAME_H / 2);
  }

  private startFocus(): void {
    if (this.ending || modal.open) return;
    this.focusing = true;
    this.focusStart = this.time.now;
  }

  private release(): void {
    if (!this.focusing) return;
    this.focusing = false;
    const held = this.time.now - this.focusStart;
    if (held >= MIN_SHOT_HOLD_MS) this.shoot(held);
  }

  // --- Shooting ----------------------------------------------------------

  private frameRect(): Rect {
    return { x: this.vf.x - FRAME_W / 2, y: this.vf.y - FRAME_H / 2, w: FRAME_W, h: FRAME_H };
  }

  private shoot(heldMs: number): void {
    if (this.shotsLeft <= 0 || this.ending) return;
    this.shotsLeft--;
    this.alert = updateAlert(this.alert, this.alertInput(0, 0, true));
    if (!reducedMotion(this)) this.cameras.main.flash(80, 240, 240, 240);

    const frame = this.frameRect();
    const visible = this.birds
      .filter((b) => b.state !== 'gone')
      .map((b) => ({ bird: b, bbox: this.bbox(b) }));
    const subject = pickSubject(frame, visible);
    if (!subject) {
      this.showPopup('No bird in frame');
    } else {
      const b = subject.bird;
      const result = scoreShot({
        frame,
        bird: { bbox: subject.bbox, pose: b.pose.startsWith('flying') ? 'flying' : b.pose, speed: b.speed },
        species: b.species,
        heldMs,
        focusTimeMs: this.optics.focusTimeMs,
        shutterThreshold: this.optics.shutterThreshold,
      });
      this.results.push({ species: b.species.id, result });
      this.showPopup(`${RATING_LABEL[result.rating]} ${b.species.name} ${result.score}`);
    }
    if (this.shotsLeft === 0) this.time.delayedCall(900, () => void this.end());
  }

  private showPopup(text: string): void {
    this.popup.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.popup);
    this.tweens.add({ targets: this.popup, alpha: 0, delay: 1300, duration: 400 });
  }

  /** Birders who frequent this area show up in the foreground (1–2 of them). */
  private addPhotographers(): void {
    this.photographers = [];
    const state = this.session.state;
    const birders = this.session.content.ambient.some(
      (a) => a.kind === 'birder' && a.areas.includes(this.spot.area) && (!a.slots.length || a.slots.includes(state.slot)),
    );
    if (!birders || !this.textures.exists('photographer_back')) return;
    const count = this.random() < 0.45 ? 2 : 1;
    const xs = count === 2 ? [46, 268] : [this.random() < 0.5 ? 46 : 268];
    for (const x of xs) {
      const sprite = this.add.sprite(x, 182, 'photographer_back', 0).setOrigin(0.5, 1).setDepth(60).setFlipX(x > 160);
      this.photographers.push({ sprite, nextShot: this.time.now + 1500 + this.random() * 3000 });
    }
  }

  private updatePhotographers(time: number): void {
    for (const p of this.photographers) {
      if (time < p.nextShot) continue;
      p.nextShot = time + 1800 + this.random() * 3500;
      p.sprite.setFrame(1);
      this.time.delayedCall(120, () => p.sprite.setFrame(0));
      // Their shutters unsettle the birds a little.
      if (this.birds.some((b) => b.state === 'perched')) this.alert = Math.min(100, this.alert + 3);
    }
  }

  /** O Boy chirps; one curious perched bird hops to the perch nearest the viewfinder. */
  private contactCall(): void {
    if (!this.callReady || this.ending || modal.open) return;
    const perches = this.bgEntry.perches ?? [];
    const bird = this.birds.find((b) => b.state === 'perched');
    if (!bird || perches.length === 0) {
      oboyChirp(this.registry.get('audio') as AudioEngine | undefined);
      this.showPopup('O Boy chirps... nobody answers.');
      return;
    }
    this.callReady = false;
    this.removeCall();
    const [px, py] = perches.reduce((best, p) =>
      Math.hypot(p[0] - this.vf.x, p[1] - this.vf.y) < Math.hypot(best[0] - this.vf.x, best[1] - this.vf.y) ? p : best,
    );
    oboyCall(this.registry.get('audio') as AudioEngine | undefined);
    this.showPopup(`O Boy calls! The ${bird.species.name} comes closer.`);
    bird.state = 'arriving';
    bird.sprite.setFlipX(px < bird.sprite.x);
    this.tweens.add({
      targets: bird.sprite,
      x: px,
      y: py,
      duration: Math.max(300, (Math.hypot(px - bird.sprite.x, py - bird.sprite.y) / bird.species.speed) * 1000),
      ease: 'Sine.easeInOut',
      onComplete: () => {
        bird.state = 'perched';
        this.setPose(bird, 'perched_alert');
        bird.leaveAt = this.time.now + 8000;
      },
    });
  }

  // --- Birds -------------------------------------------------------------

  /** Measures the opaque box of every frame of a bird sheet (relative to its feet). */
  private measure(key: string): void {
    if (this.bboxes.has(key) || !this.textures.exists(key)) return;
    const texture = this.textures.get(key);
    const rects: Rect[] = [];
    for (let f = 0; f < texture.frameTotal - 1; f++) {
      const frame = texture.get(f);
      let x0 = frame.width;
      let y0 = frame.height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          if ((this.textures.getPixelAlpha(x, y, key, f) ?? 0) > 0) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      }
      rects.push(
        x1 < 0
          ? { x: -8, y: -16, w: 16, h: 16 }
          : { x: x0 - frame.width / 2, y: y0 - frame.height, w: x1 - x0 + 1, h: y1 - y0 + 1 },
      );
    }
    this.bboxes.set(key, rects);
  }

  private bbox(b: SceneBird): Rect {
    const key = `bird_${b.species.id}`;
    const r = this.bboxes.get(key)?.[Number(b.sprite.frame.name)] ?? { x: -12, y: -20, w: 24, h: 20 };
    const flip = b.sprite.flipX;
    return { x: b.sprite.x + (flip ? -(r.x + r.w) : r.x), y: b.sprite.y + r.y, w: r.w, h: r.h };
  }

  private setPose(b: SceneBird, pose: Pose): void {
    b.pose = pose;
    const entry = (this.registry.get('manifest') as Manifest)[`bird_${b.species.id}`];
    b.sprite.setFrame(frameIndex(entry, pose));
  }

  private spawn(speciesId: string): void {
    const species = this.session.content.birds.find((b) => b.id === speciesId);
    if (!species || !this.textures.exists(`bird_${speciesId}`)) return;
    const [lx, ly] = landingSpots(species, this.bgEntry.perches ?? [], this.bgEntry.ground, this.random, this.bgEntry.groundX);
    const fromLeft = this.random() < 0.5;
    const sx = fromLeft ? -24 : 344;
    const sy = Math.max(30, ly - 60 - this.random() * 40);
    const sprite = this.add.sprite(sx, sy, `bird_${speciesId}`, 0).setOrigin(0.5, 1).setDepth(10 + ly / 1000);
    sprite.setFlipX(!fromLeft);
    const b: SceneBird = {
      species,
      sprite,
      state: 'arriving',
      pose: 'flying1',
      nextPose: 0,
      leaveAt: 0,
      last: { x: sx, y: sy },
      speed: 0,
    };
    this.birds.push(b);
    const duration = (Math.hypot(lx - sx, ly - sy) / species.speed) * 1000;
    this.tweens.add({
      targets: sprite,
      x: lx,
      y: ly,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => {
        b.state = 'perched';
        this.setPose(b, 'perched');
        b.nextPose = this.time.now + 600;
        b.leaveAt = this.time.now + 7000 + this.random() * 9000;
      },
    });
  }

  private leave(b: SceneBird): void {
    if (b.state === 'leaving' || b.state === 'gone') return;
    this.tweens.killTweensOf(b.sprite);
    b.state = 'leaving';
    const right = this.random() < 0.5;
    b.sprite.setFlipX(!right);
    this.tweens.add({
      targets: b.sprite,
      x: right ? 360 : -40,
      y: -30,
      duration: (300 / b.species.speed) * 1000,
      ease: 'Quad.easeIn',
      onComplete: () => {
        b.state = 'gone';
        b.sprite.setVisible(false);
      },
    });
  }

  // --- Frame -------------------------------------------------------------

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    if (!modal.open && !this.ending) {
      const k = this.keys;
      const ax = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
      const ay = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
      if (ax || ay) this.moveViewfinder((ax * AIM_SPEED * dt) / 1.2, (ay * AIM_SPEED * dt) / 1.2);
    }
    const vfSpeed = Math.hypot(this.vf.x - this.vfLast.x, this.vf.y - this.vfLast.y) / Math.max(dt, 1e-3);
    this.vfLast = { ...this.vf };
    if (this.focusing && vfSpeed > STEADY_SPEED) this.focusStart = time;

    // Birds.
    if (this.toSpawn.length > 0 && time >= this.nextSpawn && this.birds.filter((b) => b.state !== 'gone').length < 3) {
      this.spawn(this.toSpawn.shift() as string);
      this.nextSpawn = time + 2000 + this.random() * 3000;
    }
    for (const b of this.birds) {
      if (b.state === 'gone') continue;
      b.speed = Math.hypot(b.sprite.x - b.last.x, b.sprite.y - b.last.y) / Math.max(dt, 1e-3);
      b.last = { x: b.sprite.x, y: b.sprite.y };
      if (b.state !== 'perched') {
        this.setPose(b, Math.floor(time / 120) % 2 ? 'flying1' : 'flying2');
        continue;
      }
      if (time >= b.leaveAt) {
        this.leave(b);
        continue;
      }
      if (time >= b.nextPose) {
        this.setPose(b, idlePose(this.random, this.alert));
        b.nextPose = time + 700 + this.random() * 1800;
        if (b.species.behaviors.includes('hop') && this.random() < 0.3) {
          this.tweens.add({ targets: b.sprite, x: b.sprite.x + (this.random() - 0.5) * 16, duration: 140 });
        }
      }
    }
    this.updatePhotographers(time);
    this.alert = updateAlert(this.alert, this.alertInput(delta, vfSpeed, false));
    if (shouldFlee(this.alert)) {
      for (const b of this.birds) this.leave(b);
      this.toSpawn = [];
      this.alert = 60;
    }
    const allGone = this.toSpawn.length === 0 && this.birds.length > 0 && this.birds.every((b) => b.state === 'gone');
    if (allGone && !this.ending) this.time.delayedCall(600, () => void this.end());

    // Gentle parallax on the far layers.
    const px = (this.vf.x - 160) / 160;
    this.layers.forEach((l, i) => l.setX(i < 2 ? -px * (i + 1) * 2 : 0));
    if (this.weather) this.weatherRenderer?.update(this.weather, this.session.state.slot, delta, this.session.state.settings.reducedMotion);
    this.draw(time);
  }

  private alertInput(dtMs: number, viewfinderSpeed: number, shotFired: boolean) {
    const present = this.birds.filter((b) => b.state === 'perched' || b.state === 'arriving');
    const skittishness = present.reduce((m, b) => Math.max(m, b.species.skittishness), 0);
    const st = this.session.state;
    let slowdown = st.party.includes('oboy') ? OBOY_ALERT_SLOWDOWN : 1;
    // Until O Boy accepts Kei, having both along makes the birds jumpier (SPEC.md §7.2).
    if (st.party.includes('oboy') && st.party.includes('kei') && !st.flags.oboy_accepts_kei) slowdown = 1.2;
    return { dtMs, viewfinderSpeed, shotFired, skittishness, slowdown };
  }

  private draw(time: number): void {
    const g = this.graphics.clear();
    const f = this.frameRect();
    const x0 = Math.round(f.x);
    const y0 = Math.round(f.y);
    const x1 = x0 + FRAME_W - 1;
    const y1 = y0 + FRAME_H - 1;
    // Viewfinder corners and center.
    const corner = 8;
    g.lineStyle(1, 0xf0f0f0, 1);
    for (const [cx, cy, sx, sy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ]) {
      g.lineBetween(cx, cy, cx + sx * corner, cy);
      g.lineBetween(cx, cy, cx, cy + sy * corner);
    }
    const cx = Math.round(this.vf.x);
    const cy = Math.round(this.vf.y);
    g.lineBetween(cx - 3, cy, cx + 3, cy);
    g.lineBetween(cx, cy - 3, cx, cy + 3);
    // Focus ring fills while holding steady.
    if (this.focusing) {
      const p = Math.min(1, (time - this.focusStart) / this.optics.focusTimeMs);
      g.lineStyle(2, p >= 1 ? 0x78c058 : 0xf0d050, 1);
      g.beginPath();
      g.arc(cx, cy, 9, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      g.strokePath();
    }
    // Alert meter.
    g.fillStyle(0x101018, 0.8).fillRect(129, 4, 62, 7);
    g.fillStyle(this.alert > 70 ? 0xc83c3c : this.alert > 40 ? 0xe88a2c : 0x78c058, 1).fillRect(130, 5, Math.round(this.alert * 0.6), 5);
    this.hud.setText(`SHOTS ${this.shotsLeft}`);
  }

  // --- End ---------------------------------------------------------------

  private async end(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    this.focusing = false;
    const state = this.session.state;
    const lines: string[] = [];
    const best = new Map<string, ShotResult>();
    for (const r of this.results) {
      const prev = best.get(r.species);
      if (!prev || r.result.score > prev.score) best.set(r.species, r.result);
    }
    for (const [species, result] of best) {
      const name = this.session.content.birds.find((b) => b.id === species)?.name ?? species;
      const album = addToAlbum(state, {
        species,
        score: result.score,
        rating: result.rating,
        day: state.day,
        slot: state.slot,
        area: this.spot.area,
        spot: this.spot.id,
        companions: [...state.party],
      });
      const tag = album.newSpecies ? ' NEW!' : album.newBest ? ' Best!' : '';
      lines.push(`${name}: ${RATING_LABEL[result.rating]} (${result.score})${tag}`);
    }
    if (lines.length === 0) lines.push(this.results.length ? 'No usable photos this time.' : 'No photos taken.');
    this.registry.set('lastPhotos', this.results);
    await showPanel(`${this.spot.name} — ${this.results.length} shot(s)`, lines, 'Back to the map');
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start(this.returnTo, { from: 'Photo', spotId: this.spot.id }),
    );
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
