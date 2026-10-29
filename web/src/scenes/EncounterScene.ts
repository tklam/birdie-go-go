import Phaser from 'phaser';
import type { Enemy, Item } from '../core/types.gen';
import {
  checkTimeout,
  comboParams,
  generateCombo,
  inputSymbol,
  isDirection,
  keySymbol,
  startAttempt,
  swipeDirection,
  timeLeft,
  type ComboAttempt,
  type ComboStatus,
  type ComboSymbol,
  type Direction,
} from '../encounter/combo';
import {
  DODGE_WINDOW_MS,
  dodgeDirection,
  nextDodgeDelay,
  raceParams,
  startRace,
  stepRace,
  type RaceParams,
  type RaceState,
  type RaceStatus,
} from '../encounter/race';
import { encounterSeed, rng } from '../encounter/random';
import {
  MAX_CATCHES,
  addItems,
  applyResolveHit,
  comboResolveHit,
  halveResolve,
  introLine,
  isDog,
  resultText,
  rollDrops,
  skipCost,
  successText,
  takeDamage,
  usableItems,
  type EncounterResult,
  type Outcome,
} from '../encounter/rules';
import { iris } from '../fx/iris';
import { reducedMotion } from '../fx/motion';
import { useItem } from '../systems/hazards';
import type { Session } from '../systems/session';
import { MAX_ENERGY } from '../systems/state';
import { showMenu } from '../ui/menu';
import { modal, overlay } from '../ui/overlay';
import { showPanel } from '../ui/panel';
import { TEXT } from '../ui/text';

export interface EncounterSceneData {
  enemyId: string;
  /** Scene to return to (default 'Map'). */
  returnTo?: string;
  /** Extra data passed back to returnTo's create(). */
  returnData?: Record<string, unknown>;
}

/** What returnTo's create() receives (merged with returnData). */
export interface EncounterReturnData {
  from: 'Encounter';
  encounter: EncounterResult;
}

type Choice = 'escape' | 'confront' | 'item' | 'skip' | 'help';

const ARROW: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

/** True on touch devices (the overlay marks itself on the first touch). */
function touchMode(): boolean {
  return document.getElementById('ui')?.classList.contains('touch') ?? matchMedia('(pointer: coarse)').matches;
}

/** Plain-language rules, worded for touch or keyboard: three short paragraphs. */
export function howToPlayLines(touch: boolean): string[] {
  return touch
    ? [
        'ESCAPE: tap anywhere, fast, to outrun it. When an arrow flashes, swipe that way to dodge.',
        'CONFRONT: enter the combo shown (e.g. ← → A) before the bar runs out. Swipe on the LEFT half for arrows; tap A / B on the right. Each combo weakens it.',
        'USE ITEM: folklore remedies are strong. Dogs: stand your ground, running is hard.',
      ]
    : [
        'ESCAPE: press Space fast to outrun it. When an arrow flashes, press that arrow key to dodge.',
        'CONFRONT: enter the combo shown (e.g. ← → A) before the bar runs out. Arrow keys for arrows, Z for A, X for B. Each combo weakens it.',
        'USE ITEM: folklore remedies are strong. Dogs: stand your ground, running is hard.',
      ];
}
type Phase = 'idle' | 'combo' | 'race';

const W = 320;
const H = 180;
const GROUND_Y = 132;
const ANGIE_X = 84;
const ENEMY_X = 232;
/** Minimum swipe length in CSS px. */
const SWIPE_MIN_PX = 12;
const TILE = 18;

const SKY: Record<string, [number, number, number]> = {
  // top, bottom, ground
  dog: [0x3f6fbf, 0xf0b070, 0x6f8f3f],
  monster: [0x1b1438, 0x6a3f7f, 0x3f4f3f],
};

/**
 * A wild dog or monster encounter (SPEC.md §4.13): Escape (mash race) or
 * Confront (combos), plus items and the Skip accessibility option.
 * `scene.start('Encounter', { enemyId, returnTo: 'Map', returnData })`.
 */
export class EncounterScene extends Phaser.Scene {
  private session!: Session;
  private enemy!: Enemy;
  private params!: EncounterSceneData;
  private random: () => number = Math.random;
  private run = 0;
  private phase: Phase = 'idle';
  private resolve = 0;
  /** Companion assists (SPEC.md §4.13): O Boy's squawk shortens one combo; Kei's flash widens windows. */
  private squawkReady = false;
  private windowBonus = 1;
  private energyLost = 0;
  private catches = 0;
  private weaknessUsed = false;
  private outcome: Outcome | null = null;

  // Combo phase.
  private attempt: ComboAttempt | null = null;
  private comboDone: ((s: ComboStatus) => void) | null = null;
  // Race phase.
  private race: RaceState = { run: 0, chase: 0 };
  private raceTuning!: RaceParams;
  private raceDone: ((s: RaceStatus) => void) | null = null;
  private taps = 0;
  private dodge: { dir: Direction; until: number } | null = null;
  private dodgeResult: 'hit' | 'miss' | undefined;
  private nextDodgeAt = 0;

  private angie!: Phaser.GameObjects.Sprite;
  private foe!: Phaser.GameObjects.Sprite;
  private hud!: Phaser.GameObjects.Graphics;
  private prompt!: Phaser.GameObjects.Graphics;
  private energyText!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private letters: Phaser.GameObjects.Text[] = [];
  private space!: Phaser.Input.Keyboard.Key;
  private swipeStart: { x: number; y: number } | null = null;
  private dom: HTMLElement[] = [];

  constructor() {
    super('Encounter');
  }

  create(data: EncounterSceneData): void {
    (this.registry.get('music') as { stop(): void } | undefined)?.stop();
    this.run++;
    this.params = { returnTo: 'Map', ...data };
    this.session = this.registry.get('session') as Session;
    const state = this.session.state;
    const enemy = this.session.content.enemies.find((e) => e.id === data.enemyId);
    this.phase = 'idle';
    this.outcome = null;
    this.energyLost = 0;
    this.catches = 0;
    this.weaknessUsed = false;
    this.attempt = null;
    this.dodge = null;
    this.letters = [];
    this.dom = [];
    if (!enemy) {
      console.warn(`encounter: unknown enemy ${data.enemyId}`);
      this.time.delayedCall(0, () => this.leave({ enemyId: data.enemyId, outcome: 'escaped', energyLost: 0, drops: [] }));
      return;
    }
    this.enemy = enemy;
    this.resolve = enemy.resolve;
    const party = state.party;
    this.squawkReady = party.includes('oboy');
    this.windowBonus = 1;
    const keiStages = ['friends', 'dating', 'engaged', 'married'];
    const keiAlong = party.includes('kei') && keiStages.includes(state.keiStage);
    if (keiAlong && enemy.kind === 'dog') {
      // Kei's ultrasonic whistle unsettles the dogs from the start.
      this.resolve = Math.round(this.resolve * 0.75);
      this.time.delayedCall(400, () => this.setMessage("Kei's whistle unsettles the dogs!"));
    } else if (keiAlong && keiStages.indexOf(state.keiStage) >= 1) {
      // From dating on, Kei's camera-flash gadget stuns monsters: more time per combo.
      this.windowBonus = 1.3;
      this.time.delayedCall(400, () => this.setMessage("Kei's flash dazzles it!"));
    }
    this.random = rng(encounterSeed(state.worldSeed, state.day, enemy.id, `play:${state.slot}`));

    this.drawBackdrop();
    this.angie = this.add.sprite(ANGIE_X, GROUND_Y, 'char_angie', 8).setOrigin(0.5, 1).setScale(2).setDepth(5);
    if (!this.textures.exists('char_angie')) this.angie.setVisible(false);
    this.foe = this.add.sprite(ENEMY_X, GROUND_Y + 4, this.portraitKey(), 0).setOrigin(0.5, 1).setScale(2).setDepth(5);
    // Portrait sheets face right; turn them towards Angie.
    this.foe.setFlipX(true);
    this.tweens.add({ targets: this.foe, y: GROUND_Y + 2, duration: 500, yoyo: true, repeat: -1, ease: 'Stepped' });
    this.hud = this.add.graphics().setDepth(20);
    this.prompt = this.add.graphics().setDepth(20);
    const shadow = (t: Phaser.GameObjects.Text) => t.setShadow(1, 1, '#101018', 0);
    shadow(this.add.text(6, 4, 'Angie', TEXT).setDepth(21));
    this.energyText = shadow(this.add.text(92, 13, '', TEXT).setDepth(21));
    shadow(this.add.text(314, 4, enemy.name, TEXT).setOrigin(1, 0).setDepth(21));
    this.message = shadow(this.add.text(W / 2, 76, '', { ...TEXT, color: '#f0d050' }).setOrigin(0.5).setDepth(21));
    this.hint = shadow(this.add.text(W / 2, 172, '', TEXT).setOrigin(0.5).setDepth(21));

    this.setupInput();
    this.makeButtons();
    const run = this.run;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.run++;
      this.phase = 'idle';
      for (const el of this.dom) el.remove();
      this.dom = [];
    });
    void iris(this, 'in').then(() => {
      if (run === this.run) void this.main(run);
    });
  }

  // --- Setup -------------------------------------------------------------

  /** The portrait sheet, or a generated 2-frame placeholder if it's missing. */
  private portraitKey(): string {
    const key = this.enemy.portrait;
    if (key && this.textures.exists(key)) return key;
    const ph = `enc_placeholder_${this.enemy.kind}`;
    if (this.textures.exists(ph)) return ph;
    const g = this.make.graphics({}, false);
    const body = isDog(this.enemy) ? 0x8f6f4f : 0x6fafaf;
    for (let f = 0; f < 2; f++) {
      const ox = f * 48;
      g.fillStyle(0x101018).fillRect(ox + 8, 14, 32, 30);
      g.fillStyle(f ? 0xdf4f4f : body).fillRect(ox + 10, 16, 28, 26);
      g.fillStyle(0xf0f0f0).fillRect(ox + 16, 22, 4, 4).fillRect(ox + 28, 22, 4, 4);
    }
    g.generateTexture(ph, 96, 48);
    g.destroy();
    const tex = this.textures.get(ph);
    tex.add(0, 0, 0, 0, 48, 48);
    tex.add(1, 0, 48, 0, 48, 48);
    return ph;
  }

  /** A 16-bit battle backdrop: banded gradient sky and a ground strip. */
  private drawBackdrop(): void {
    const [top, bottom, ground] = SKY[this.enemy.kind] ?? SKY.monster;
    const g = this.add.graphics().setDepth(0);
    const a = Phaser.Display.Color.IntegerToColor(top);
    const b = Phaser.Display.Color.IntegerToColor(bottom);
    const bands = 12;
    const skyH = GROUND_Y - 12;
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, bands - 1, i);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      g.fillRect(0, Math.floor((i * skyH) / bands), W, Math.ceil(skyH / bands) + 1);
    }
    // Distant hills.
    g.fillStyle(Phaser.Display.Color.IntegerToColor(ground).darken(30).color);
    for (let x = 0; x < W; x += 8) {
      const h = 10 + Math.round(6 * Math.sin(x / 23) + 4 * Math.sin(x / 7));
      g.fillRect(x, skyH - h, 8, h);
    }
    g.fillStyle(ground).fillRect(0, skyH, W, H - skyH);
    g.fillStyle(Phaser.Display.Color.IntegerToColor(ground).darken(15).color);
    for (let y = skyH + 4; y < H; y += 6) for (let x = (y * 7) % 16; x < W; x += 16) g.fillRect(x, y, 4, 1);
    g.fillStyle(0x000000, 0.3).fillEllipse(ANGIE_X, GROUND_Y, 28, 6).fillEllipse(ENEMY_X, GROUND_Y + 2, 64, 8);
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (kb) {
      this.space = kb.addKey('SPACE');
      kb.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
      kb.on('keydown', (e: KeyboardEvent) => {
        if (modal.open || e.repeat) return;
        if (e.code === 'Space') this.onTap();
        const s = keySymbol(e.code);
        if (s) this.onSymbol(s);
      });
    }
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (modal.open) return;
      this.swipeStart = { x: p.x, y: p.y };
      this.onTap();
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const start = this.swipeStart;
      this.swipeStart = null;
      if (!start || modal.open) return;
      // Combos read swipes on the left half (A/B live on the right).
      if (this.phase === 'combo' && start.x >= W / 2) return;
      const css = this.cssPerGamePx();
      const dir = swipeDirection((p.x - start.x) * css, (p.y - start.y) * css, SWIPE_MIN_PX);
      if (dir) this.onSymbol(dir);
    });
  }

  private cssPerGamePx(): number {
    const w = this.game.canvas.getBoundingClientRect().width;
    return w > 0 ? w / W : 1;
  }

  /** The big A/B buttons (touch and mouse), shown during combos. */
  private makeButtons(): void {
    for (const sym of ['B', 'A'] as const) {
      const b = document.createElement('button');
      b.className = `btn enc-btn enc-${sym.toLowerCase()} enc-hidden`;
      b.textContent = sym;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!modal.open) this.onSymbol(sym);
      });
      overlay().appendChild(b);
      this.dom.push(b);
    }
  }

  private showButtons(on: boolean): void {
    for (const b of this.dom) b.classList.toggle('enc-hidden', !on);
  }

  // --- Flow --------------------------------------------------------------

  private alive(run: number): boolean {
    return run === this.run;
  }

  private async main(run: number): Promise<void> {
    // Explain the rules the first time.
    const flags = this.session.state.flags;
    if (!flags.encounter_tutorial_seen) {
      flags.encounter_tutorial_seen = true;
      await this.howToPlay();
    }
    while (!this.outcome && this.alive(run)) {
      const choice = await this.choose();
      if (!this.alive(run)) return;
      if (choice === 'help') {
        await this.howToPlay();
        continue;
      }
      if (choice === 'escape') await this.escape(run);
      else if (choice === 'confront') await this.confront(run);
      else if (choice === 'item') await this.itemMenu();
      else if (choice === 'skip') this.skip();
      if (!this.alive(run)) return;
      if (!this.outcome && this.session.state.energy <= 0) this.outcome = 'lost';
    }
    if (this.alive(run)) await this.finish(run);
  }

  private choices(): Choice[] {
    const out: Choice[] = ['escape', 'confront'];
    const state = this.session.state;
    if (usableItems(this.enemy, state.items, this.session.content.items, this.weaknessUsed).length) out.push('item');
    if (state.settings.skipEncounters) out.push('skip');
    out.push('help');
    return out;
  }

  private howToPlay(): Promise<void> {
    const panel = showPanel('How to play', howToPlayLines(touchMode()), 'Got it');
    overlay().lastElementChild?.classList.add('enc-help');
    return panel;
  }

  /** The Escape / Confront / Use item / Skip menu. Reopens if dismissed. */
  private async choose(): Promise<Choice> {
    const labels: Record<Choice, string> = {
      escape: 'Escape',
      confront: 'Confront',
      item: 'Use item',
      skip: `Skip (-${skipCost(this.enemy)} Energy)`,
      help: 'How to play',
    };
    this.setMessage('');
    this.hint.setText('');
    for (;;) {
      let picked: Choice | null = null;
      const menu = showMenu(
        introLine(this.enemy),
        this.choices().map((c) => ({ label: labels[c], run: () => void (picked = c) })),
      );
      overlay().lastElementChild?.classList.add('enc-menu');
      await menu;
      if (picked) return picked;
    }
  }

  // --- Confront ----------------------------------------------------------

  private async confront(run: number): Promise<void> {
    const settings = this.session.state.settings;
    while (this.resolve > 0 && this.alive(run)) {
      const p = comboParams(this.enemy, this.resolve / Math.max(1, this.enemy.resolve), settings.slowerPrompts);
      let length = p.length;
      if (this.squawkReady && length > 1) {
        // O Boy squawks once per encounter: one step fewer.
        this.squawkReady = false;
        length -= 1;
        this.setMessage('O Boy squawks! It looks away!');
        await this.wait(700);
        if (!this.alive(run)) return;
      }
      const combo = generateCombo(length, this.random);
      this.setMessage('Ready…');
      this.drawCombo(combo, 0, 1, true);
      this.showButtons(true);
      this.hint.setText(touchMode() ? 'Swipe arrows on the left · tap A / B' : 'Arrow keys · Z = A · X = B');
      await this.wait(500);
      if (!this.alive(run)) return;
      this.setMessage('');
      const status = await this.playCombo(combo, Math.round(p.windowMs * this.windowBonus));
      if (!this.alive(run)) return;
      if (status === 'complete') {
        const left = this.attempt ? timeLeft(this.attempt, this.time.now) : 0;
        this.resolve = applyResolveHit(this.resolve, comboResolveHit(this.enemy, combo.length, left));
        this.setMessage(successText(this.enemy, this.random));
        this.animateSuccess();
        await this.wait(800);
      } else {
        this.setMessage(status === 'timeout' ? 'Too slow!' : 'Oops!');
        this.hurt(this.enemy.damage);
        await this.wait(900);
        break;
      }
    }
    this.clearPrompt();
    this.showButtons(false);
    if (!this.alive(run)) return;
    if (this.resolve <= 0) {
      this.outcome = 'won';
      await this.animateWin();
    }
  }

  private playCombo(combo: ComboSymbol[], windowMs: number): Promise<ComboStatus> {
    this.attempt = startAttempt(combo, windowMs, this.time.now);
    this.phase = 'combo';
    return new Promise((resolve) => {
      this.comboDone = (s) => {
        this.phase = 'idle';
        this.comboDone = null;
        resolve(s);
      };
    });
  }

  // --- Escape ------------------------------------------------------------

  private async escape(run: number): Promise<void> {
    const hold = this.session.state.settings.holdInsteadOfMash;
    this.race = startRace(this.catches);
    this.raceTuning = raceParams(this.enemy.mashRate);
    this.taps = 0;
    this.dodge = null;
    this.dodgeResult = undefined;
    this.nextDodgeAt = this.time.now + nextDodgeDelay(this.random);
    this.hint.setText(
      touchMode() ? (hold ? 'Hold your finger down to run!' : 'Tap anywhere, fast, to run!') : hold ? 'Hold Space to run!' : 'Press Space fast to run!',
    );
    this.setMessage('Run!');
    this.phase = 'race';
    const status = await new Promise<RaceStatus>((resolve) => {
      this.raceDone = (s) => {
        this.phase = 'idle';
        this.raceDone = null;
        resolve(s);
      };
    });
    if (!this.alive(run)) return;
    this.clearPrompt();
    this.hint.setText('');
    if (status === 'escaped') {
      this.outcome = 'escaped';
      this.setMessage('Got away!');
      this.tweens.add({ targets: this.angie, x: -20, duration: 500 });
      await this.wait(600);
      return;
    }
    this.catches++;
    this.setMessage('Caught!');
    this.hurt(this.enemy.damage);
    await this.wait(900);
    if (!this.alive(run)) return;
    this.resetPositions();
    if (this.catches >= MAX_CATCHES) this.outcome = 'lost';
  }

  // --- Items and skip ----------------------------------------------------

  private async itemMenu(): Promise<void> {
    const state = this.session.state;
    const usable = usableItems(this.enemy, state.items, this.session.content.items, this.weaknessUsed);
    let picked: { item: Item; effect: string } | null = null;
    const menu = showMenu('Use which item?', [
      ...usable.map((u) => ({ label: `${u.item.name} x${u.count}`, run: () => void (picked = u) })),
      { label: 'Back', run: () => undefined },
    ]);
    overlay().lastElementChild?.classList.add('enc-menu');
    await menu;
    const choice = picked as { item: Item; effect: string } | null;
    if (!choice || !useItem(state, choice.item)) return;
    if (choice.effect === 'treat') {
      this.outcome = 'escaped';
      this.setMessage('The dogs go for the treat!');
      this.tweens.add({ targets: this.angie, x: -20, duration: 700, delay: 300 });
      await this.wait(1000);
    } else if (choice.effect === 'weakness') {
      this.weaknessUsed = true;
      this.resolve = halveResolve(this.resolve);
      this.setMessage(`${choice.item.name}! It recoils!`);
      this.animateSuccess();
      await this.wait(900);
    } else {
      this.setMessage(`${choice.item.name}: +${choice.item.restores ?? 0} Energy`);
      await this.wait(900);
    }
  }

  private skip(): void {
    this.energyLost += takeDamage(this.session.state, skipCost(this.enemy));
    this.outcome = 'skipped';
  }

  // --- End ---------------------------------------------------------------

  private async finish(run: number): Promise<void> {
    const state = this.session.state;
    const outcome = this.outcome ?? 'escaped';
    const drops =
      outcome === 'won' && !isDog(this.enemy) ? rollDrops(this.enemy, encounterSeed(state.worldSeed, state.day, this.enemy.id)) : [];
    addItems(state, drops);
    const result: EncounterResult = { enemyId: this.enemy.id, outcome, energyLost: this.energyLost, drops };
    this.showButtons(false);
    this.clearPrompt();
    this.setMessage('');
    this.hint.setText('');
    const itemName = (id: string) => this.session.content.items.find((i) => i.id === id)?.name ?? id;
    const text = resultText(this.enemy, result, itemName);
    const panel = showPanel(text.title, text.lines, 'Continue');
    overlay().lastElementChild?.classList.add('enc-panel');
    await panel;
    if (!this.alive(run)) return;
    this.leave(result);
  }

  private leave(result: EncounterResult): void {
    this.registry.set('lastEncounter', result);
    const keys = this.scene.manager.keys as Record<string, unknown>;
    const target = this.params.returnTo && keys[this.params.returnTo] ? this.params.returnTo : 'Map';
    const data: EncounterReturnData & Record<string, unknown> = { ...this.params.returnData, from: 'Encounter', encounter: result };
    const run = this.run;
    void iris(this, 'out').then(() => run === this.run && this.scene.start(target, data));
  }

  // --- Input -------------------------------------------------------------

  private onTap(): void {
    if (this.phase === 'race') this.taps++;
  }

  private onSymbol(s: ComboSymbol): void {
    if (this.phase === 'combo' && this.attempt) {
      const r = inputSymbol(this.attempt, s, this.time.now);
      this.attempt = r.attempt;
      if (r.status !== 'pending') this.comboDone?.(r.status);
    } else if (this.phase === 'race' && this.dodge && isDirection(s)) {
      this.dodgeResult = s === this.dodge.dir ? 'hit' : 'miss';
      this.setMessage(this.dodgeResult === 'hit' ? 'Dodged!' : 'Stumbled!');
      this.dodge = null;
    }
  }

  // --- Frame -------------------------------------------------------------

  update(time: number, delta: number): void {
    if (!this.enemy) return;
    if (this.phase === 'combo' && this.attempt) {
      const status = checkTimeout(this.attempt, time);
      if (status !== 'pending') this.comboDone?.(status);
      else this.drawCombo(this.attempt.combo, this.attempt.index, timeLeft(this.attempt, time), false);
    } else if (this.phase === 'race') {
      this.updateRace(time, delta);
    }
    this.drawHud();
  }

  private updateRace(time: number, delta: number): void {
    const window = DODGE_WINDOW_MS * (this.session.state.settings.slowerPrompts ? 1.5 : 1);
    if (this.dodge && time > this.dodge.until) {
      this.dodgeResult = 'miss';
      this.dodge = null;
      this.setMessage('Too slow!');
    }
    if (!this.dodge && time >= this.nextDodgeAt) {
      this.dodge = { dir: dodgeDirection(this.random), until: time + window };
      this.nextDodgeAt = time + window + nextDodgeDelay(this.random);
      this.setMessage(`Dodge! ${touchMode() ? 'Swipe' : 'Press'} ${ARROW[this.dodge.dir] ?? ''}`);
    }
    const holding = this.session.state.settings.holdInsteadOfMash && !modal.open && (this.input.activePointer.isDown || !!this.space?.isDown);
    const r = stepRace(this.race, this.raceTuning, {
      dtMs: modal.open ? 0 : Math.min(delta, 50),
      taps: this.taps,
      holding,
      dodge: this.dodgeResult,
    });
    this.taps = 0;
    this.dodgeResult = undefined;
    this.race = r.state;
    // Angie runs left as her meter fills; the enemy closes in with its own.
    this.angie.setX(Math.round(ANGIE_X - (this.race.run / 100) * 40));
    this.foe.setX(Math.round(ENEMY_X - (this.race.chase / 100) * (ENEMY_X - ANGIE_X - 24)));
    this.angie.setFrame(holding || this.race.run > 0 ? 4 + (Math.floor(time / 120) % 3) + 1 : 4);
    this.drawRace(time);
    if (r.status !== 'running') this.raceDone?.(r.status);
  }

  // --- Drawing -----------------------------------------------------------

  private setMessage(text: string): void {
    this.message.setText(text);
  }

  private drawHud(): void {
    const g = this.hud.clear();
    const energy = this.session.state.energy;
    bar(g, 6, 14, 84, 6, energy / MAX_ENERGY, energy > 25 ? 0x5fcf5f : 0xdf5f3f);
    bar(g, 230, 14, 84, 6, this.resolve / Math.max(1, this.enemy.resolve), 0xdf8f3f);
    this.energyText.setText(String(Math.round(energy)));
  }

  private clearPrompt(): void {
    this.prompt.clear();
    for (const t of this.letters) t.destroy();
    this.letters = [];
  }

  /** The combo row: done symbols dim, the next one highlighted, a timer bar below. */
  private drawCombo(combo: readonly ComboSymbol[], index: number, left: number, preview: boolean): void {
    this.clearPrompt();
    const g = this.prompt;
    const gap = 4;
    const total = combo.length * TILE + (combo.length - 1) * gap;
    const x0 = Math.round(W / 2 - total / 2);
    const y = 40;
    combo.forEach((s, i) => {
      const x = x0 + i * (TILE + gap);
      const done = i < index;
      const next = i === index && !preview;
      g.fillStyle(0x101018).fillRect(x - 1, y - 1, TILE + 2, TILE + 2);
      g.fillStyle(done ? 0x2f5f2f : next ? 0x3f7fdf : 0x1b2a4a).fillRect(x, y, TILE, TILE);
      const fg = done ? 0x7f9f7f : 0xf0f0f0;
      if (isDirection(s)) arrow(g, x + TILE / 2, y + TILE / 2, s, fg);
      else {
        const t = this.add
          .text(x + TILE / 2 + 1, y + TILE / 2 + 1, s, { ...TEXT, color: done ? '#7f9f7f' : s === 'A' ? '#f07070' : '#f0d050' })
          .setOrigin(0.5)
          .setDepth(21);
        this.letters.push(t);
      }
    });
    bar(g, Math.round(W / 2 - 60), y + TILE + 5, 120, 4, left, left > 0.3 ? 0xf0f0f0 : 0xdf5f3f);
  }

  private drawRace(time: number): void {
    this.clearPrompt();
    const g = this.prompt;
    bar(g, 100, 148, 120, 6, this.race.run / 100, 0x5fcfdf);
    bar(g, 100, 158, 120, 6, this.race.chase / 100, 0xdf5f3f);
    this.letters.push(
      this.add.text(96, 147, 'RUN', TEXT).setOrigin(1, 0).setDepth(21),
      this.add.text(96, 157, 'FOE', TEXT).setOrigin(1, 0).setDepth(21),
    );
    if (this.dodge && Math.floor(time / 120) % 2 === 0) {
      const x = W / 2 - 14;
      const y = 44;
      g.fillStyle(0x101018).fillRect(x - 1, y - 1, 30, 30);
      g.fillStyle(0xf0d050).fillRect(x, y, 28, 28);
      arrow(g, x + 14, y + 14, this.dodge.dir, 0x101018, 8);
    }
  }

  // --- Animation ---------------------------------------------------------

  private hurt(damage: number): void {
    this.energyLost += takeDamage(this.session.state, damage);
    this.foe.setFrame(1);
    const x = this.foe.x;
    this.tweens.add({
      targets: this.foe,
      x: x - 24,
      duration: 120,
      yoyo: true,
      onComplete: () => this.foe.setFrame(0),
    });
    if (!reducedMotion(this)) this.cameras.main.shake(180, 0.01);
    this.angie.setTint(0xff7070);
    this.time.delayedCall(250, () => this.angie.clearTint());
  }

  private animateSuccess(): void {
    this.tweens.add({ targets: this.angie, y: GROUND_Y - 6, duration: 90, yoyo: true });
    this.foe.setTintFill(0xf0f0f0);
    this.time.delayedCall(90, () => this.foe.clearTint());
    const x = this.foe.x;
    this.tweens.add({ targets: this.foe, x: x + 8, duration: 80, yoyo: true });
  }

  private animateWin(): Promise<void> {
    this.tweens.killTweensOf(this.foe);
    return new Promise((resolve) => {
      if (isDog(this.enemy)) {
        this.setMessage(`${this.enemy.name} ${/s$/i.test(this.enemy.name) ? 'back' : 'backs'} off…`);
        this.foe.setFlipX(false);
        this.tweens.add({ targets: this.foe, x: W + 60, duration: 1100, ease: 'Quad.easeIn', onComplete: () => resolve() });
      } else {
        this.setMessage(`${this.enemy.name} fades away…`);
        this.tweens.add({ targets: this.foe, alpha: 0, scaleY: 3, scaleX: 1, duration: 900, onComplete: () => resolve() });
      }
    });
  }

  private resetPositions(): void {
    this.angie.setX(ANGIE_X).setFlipX(false).setFrame(8);
    this.tweens.add({ targets: this.foe, x: ENEMY_X, duration: 300 });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}

/** A framed meter. */
function bar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fraction: number, color: number): void {
  const f = Math.max(0, Math.min(1, fraction));
  g.fillStyle(0x101018).fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(0x3a3a4a).fillRect(x, y, w, h);
  g.fillStyle(color).fillRect(x, y, Math.round(w * f), h);
}

/** A pixel arrow centred on (cx, cy). */
function arrow(g: Phaser.GameObjects.Graphics, cx: number, cy: number, dir: Direction, color: number, r = 6): void {
  const pts: Record<Direction, [number, number][]> = {
    up: [[0, -r], [r, 0], [r / 2, 0], [r / 2, r], [-r / 2, r], [-r / 2, 0], [-r, 0]],
    down: [[0, r], [r, 0], [r / 2, 0], [r / 2, -r], [-r / 2, -r], [-r / 2, 0], [-r, 0]],
    left: [[-r, 0], [0, -r], [0, -r / 2], [r, -r / 2], [r, r / 2], [0, r / 2], [0, r]],
    right: [[r, 0], [0, -r], [0, -r / 2], [-r, -r / 2], [-r, r / 2], [0, r / 2], [0, r]],
  };
  g.fillStyle(color).fillPoints(
    pts[dir].map(([x, y]) => new Phaser.Geom.Point(Math.round(cx + x), Math.round(cy + y))),
    true,
  );
}
