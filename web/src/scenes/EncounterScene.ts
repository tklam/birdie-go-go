import Phaser from 'phaser';
import { goodBad } from '../ui/prefs';
import type { Enemy, Item } from '../core/types.gen';
import {
  checkTimeout,
  comboParams,
  generateCombo,
  inputSymbol,
  isDirection,
  keySymbol,
  SLOWER_PROMPTS_FACTOR,
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
  blockingItem,
  comboResolveHit,
  halveResolve,
  introLine,
  isDog,
  resultText,
  rollDrops,
  skipCost,
  startResolve,
  successText,
  takeDamage,
  usableItems,
  type EncounterResult,
  type Outcome,
} from '../encounter/rules';
import { oboyCall } from '../audio/oboy';
import { soundscapes } from '../audio/soundscape';
import { activate, afterSuccess, counterHit, keiAtLeast, partyAbilities, readyAbilities, startAssists, windowScale, type Ability, type AssistState } from '../encounter/assists';
import type { AudioEngine } from '../audio/AudioEngine';
import { iris } from '../fx/iris';
import { reducedMotion } from '../fx/motion';
import { breakItem, useItem } from '../systems/hazards';
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

type Choice = 'escape' | 'confront' | 'sing' | 'guardian' | 'item' | 'skip' | 'help';

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
  /** Companions fighting alongside (SPEC.md §4.13): O Boy's song and Kei's guardian. */
  private assists!: AssistState;
  private oboySprite: Phaser.GameObjects.Sprite | null = null;
  private guardian: Phaser.GameObjects.Container | null = null;
  /** The guardian's silhouette mask (moved with it). */
  private guardianMask: Phaser.GameObjects.Graphics | null = null;
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
    this.resolve = startResolve(enemy.resolve, state.items, this.session.content.items);
    if (this.resolve < enemy.resolve) this.time.delayedCall(1200, () => this.setMessage('Angie blows her whistle!'));
    const cfg = this.session.content.game.companionAbilities;
    this.assists = startAssists(cfg, partyAbilities(cfg, state.party, state.keiStage));
    const whistle = cfg?.dogWhistle;
    if (whistle && isDog(enemy) && keiAtLeast(state.party, state.keiStage, whistle.minStage)) {
      // Kei's ultrasonic whistle unsettles the dogs from the start.
      this.resolve = Math.round(this.resolve * whistle.resolveScale);
      this.time.delayedCall(400, () => this.setMessage("Kei's whistle unsettles the dogs!"));
    }
    this.guardian = null;
    this.random = rng(encounterSeed(state.worldSeed, state.day, enemy.id, `play:${state.slot}`));

    this.drawBackdrop();
    this.angie = this.add.sprite(ANGIE_X, GROUND_Y, 'char_angie', 8).setOrigin(0.5, 1).setScale(2).setDepth(5);
    if (!this.textures.exists('char_angie')) this.angie.setVisible(false);
    // Companions in the party stand (and perch) with her.
    if (state.party.includes('kei') && this.textures.exists('char_kei')) this.add.sprite(ANGIE_X - 34, GROUND_Y, 'char_kei', 8).setOrigin(0.5, 1).setScale(2).setDepth(5);
    this.oboySprite = state.party.includes('oboy') && this.textures.exists('char_oboy') ? this.add.sprite(ANGIE_X + 10, GROUND_Y - 50, 'char_oboy', 0).setScale(2).setDepth(6) : null;
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
    this.message = shadow(this.add.text(W / 2, 76, '', { ...TEXT, color: '#f0d050', align: 'center', wordWrap: { width: W - 16 } }).setOrigin(0.5).setDepth(21));
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
      else if (choice === 'sing' || choice === 'guardian') {
        await this.useAbility(choice, run);
        if (this.alive(run)) await this.confront(run);
      }
      else if (choice === 'item') await this.itemMenu();
      else if (choice === 'skip') this.skip();
      if (!this.alive(run)) return;
      if (!this.outcome && this.session.state.energy <= 0) this.outcome = 'lost';
    }
    if (this.alive(run)) await this.finish(run);
  }

  private choices(): Choice[] {
    const out: Choice[] = ['escape', 'confront', ...readyAbilities(this.assists)];
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
      sing: `O Boy: Sing (${this.assists.uses.sing})`,
      guardian: "Kei: Guardian",
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
      const cfg = this.session.content.game.companionAbilities;
      const p = comboParams(this.enemy, this.resolve / Math.max(1, this.enemy.resolve), settings.slowerPrompts);
      const combo = generateCombo(p.length, this.random);
      if (this.assists.freeSuccess) {
        // The duet: O Boy's song guides the guardian's strike.
        this.setMessage('Duet! The song guides the strike!');
        this.resolve = applyResolveHit(this.resolve, comboResolveHit(this.enemy, combo.length, 0.5));
        await this.guardianStrike(run);
        if (!this.alive(run)) return;
        this.assists = afterSuccess(this.assists, cfg).state;
        this.dismissGuardianIfDone();
        await this.wait(600);
        continue;
      }
      this.setMessage('Ready…');
      this.drawCombo(combo, 0, 1, true);
      this.showButtons(true);
      this.hint.setText(touchMode() ? 'Swipe arrows on the left · tap A / B' : 'Arrow keys · Z = A · X = B');
      await this.wait(500);
      if (!this.alive(run)) return;
      this.setMessage('');
      const status = await this.playCombo(combo, Math.round(p.windowMs * windowScale(this.assists, cfg)));
      if (!this.alive(run)) return;
      if (status === 'complete') {
        const left = this.attempt ? timeLeft(this.attempt, this.time.now) : 0;
        this.resolve = applyResolveHit(this.resolve, comboResolveHit(this.enemy, combo.length, left));
        this.setMessage(successText(this.enemy, this.random));
        this.animateSuccess();
        await this.wait(800);
        if (!this.alive(run)) return;
        const after = afterSuccess(this.assists, cfg);
        this.assists = after.state;
        if (after.bonusHit > 0 && this.resolve > 0) {
          this.setMessage("Kei's guardian strikes!");
          this.resolve = applyResolveHit(this.resolve, after.bonusHit);
          await this.guardianStrike(run);
        }
        this.dismissGuardianIfDone();
      } else {
        this.setMessage(status === 'timeout' ? 'Too slow!' : 'Oops!');
        await this.wait(500);
        if (!this.alive(run)) return;
        await this.takeHit(run);
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
    await this.wait(500);
    if (!this.alive(run)) return;
    await this.takeHit(run);
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
    bar(g, 6, 14, 84, 6, energy / MAX_ENERGY, energy > 25 ? goodBad().good : goodBad().bad);
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
    bar(g, Math.round(W / 2 - 60), y + TILE + 5, 120, 4, left, left > 0.3 ? 0xf0f0f0 : goodBad().bad);
  }

  private drawRace(time: number): void {
    this.clearPrompt();
    const g = this.prompt;
    bar(g, 100, 148, 120, 6, this.race.run / 100, 0x5fcfdf);
    bar(g, 100, 158, 120, 6, this.race.chase / 100, goodBad().bad);
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

  /**
   * The enemy lands a hit. With worn gear that blocks (an umbrella), a quick
   * one-symbol prompt comes first: answer it to block; miss it and Angie is
   * hurt and the gear breaks (SPEC.md §4.13).
   */
  private async takeHit(run: number): Promise<void> {
    const state = this.session.state;
    const hit = counterHit(this.assists, this.enemy.damage, this.session.content.game.companionAbilities);
    this.assists = hit.state;
    if (hit.blocked) {
      this.setMessage("Kei's guardian blocks the blow!");
      this.guardianBlock();
      this.dismissGuardianIfDone();
      return;
    }
    this.dismissGuardianIfDone();
    const shield = blockingItem(state.equipped, this.session.content.items);
    if (shield?.assist) {
      const name = shield.name.toLowerCase();
      const combo = generateCombo(1, this.random);
      this.setMessage(`Block with the ${name}!`);
      this.drawCombo(combo, 0, 1, true);
      this.showButtons(true);
      const windowMs = (shield.assist.blockWindowMs ?? 1000) * (state.settings.slowerPrompts ? SLOWER_PROMPTS_FACTOR : 1);
      const status = await this.playCombo(combo, Math.round(windowMs));
      this.clearPrompt();
      this.showButtons(false);
      if (!this.alive(run)) return;
      if (status === 'complete') {
        this.setMessage(`Blocked with the ${name}!`);
        this.animateSuccess();
        return;
      }
      breakItem(state, shield.id);
      this.setMessage(`Ouch! The ${name} broke!`);
    }
    if (hit.damage < this.enemy.damage) this.setMessage("O Boy's song softens the blow.");
    this.hurt(hit.damage);
  }

  // --- Companions (SPEC.md §4.13) ------------------------------------------

  /** O Boy sings or Kei calls his guardian; both together make a duet. */
  private async useAbility(which: Ability, run: number): Promise<void> {
    const cfg = this.session.content.game.companionAbilities;
    const r = activate(this.assists, which, cfg);
    this.assists = r.state;
    if (which === 'sing') await this.sing(run);
    else await this.summonGuardian(run);
    if (!this.alive(run)) return;
    if (r.duet) {
      this.setMessage('O Boy and Kei work together!');
      await this.wait(900);
    }
  }

  private cue(id: string): void {
    const audio = this.registry.get('audio') as AudioEngine | undefined;
    if (audio?.ready) soundscapes(audio, this.session.content.sounds.cues).cue(id);
  }

  /** O Boy flies up and sings; notes drift over to the enemy, which sways, drowsy. */
  private async sing(run: number): Promise<void> {
    this.setMessage('O Boy sings! It sways, drowsy…');
    oboyCall(this.registry.get('audio') as AudioEngine | undefined);
    this.time.delayedCall(350, () => this.cue('oboy_song'));
    const still = reducedMotion(this);
    const bird = this.oboySprite;
    if (bird && !still) {
      this.tweens.add({ targets: bird, y: GROUND_Y - 78, duration: 400, ease: 'Sine.easeOut' });
      // Wings flap while he sings.
      this.time.addEvent({ delay: 120, repeat: 14, callback: () => bird.setFrame(bird.frame.name === '1' ? 0 : 1) });
    }
    const fromX = bird?.x ?? ANGIE_X;
    const fromY = (bird?.y ?? GROUND_Y - 60) - (still ? 0 : 20);
    for (let i = 0; i < 6; i++) {
      const note = this.add.graphics().setDepth(15);
      // A pixel quaver: head, stem and flag.
      note.fillStyle(0xfff3a0).fillRect(0, 4, 3, 2).fillRect(2, 0, 1, 5).fillRect(3, 0, 2, 1);
      note.setPosition(fromX, fromY);
      this.tweens.add({
        targets: note,
        x: ENEMY_X - 10 + (i % 3) * 8,
        y: GROUND_Y - 60 + Math.sin(i) * 12,
        alpha: 0,
        delay: i * 220,
        duration: still ? 600 : 1400,
        ease: 'Sine.easeInOut',
        onComplete: () => note.destroy(),
      });
    }
    if (!still) this.tweens.add({ targets: this.foe, angle: { from: -6, to: 6 }, duration: 500, yoyo: true, repeat: 2, onComplete: () => this.foe.setAngle(0) });
    await this.wait(1800);
    if (!this.alive(run) || !bird) return;
    this.tweens.add({ targets: bird, y: GROUND_Y - 50, duration: 400 });
  }

  /**
   * Kei's digital guardian: a hulking, horned figure of falling green code
   * rising behind him, out of the data of his digital kingdom.
   */
  private async summonGuardian(run: number): Promise<void> {
    this.setMessage('Kei calls his guardian out of the code!');
    this.cue('guardian_summon');
    this.guardian?.destroy();
    this.guardianMask?.destroy();
    const still = reducedMotion(this);
    // Centred behind Kei and Angie, clear of the screen edge.
    const baseX = ANGIE_X - 14;
    // The silhouette, in scene coordinates: horns, head, broad shoulders, clawed arms.
    const shape: [number, number][] = [
      [-10, -112], [-6, -98], [6, -98], [10, -112], [12, -96], [14, -86], [34, -80], [44, -66], [48, -40], [56, -24], [50, -22],
      [44, -34], [40, -18], [30, 0], [-30, 0], [-40, -18], [-44, -34], [-50, -22], [-56, -24], [-48, -40], [-44, -66], [-34, -80],
      [-14, -86], [-12, -96],
    ].map(([x, y]) => [baseX + x, GROUND_Y + y]);
    const maskShape = this.make.graphics({}, false);
    maskShape.fillStyle(0xffffff).fillPoints(shape.map(([x, y]) => new Phaser.Geom.Point(x, y)), true);
    const g = this.add.container(0, 0).setDepth(4);
    const glow = this.add.graphics();
    glow.fillStyle(0x0b2a14, 0.85).fillPoints(shape.map(([x, y]) => new Phaser.Geom.Point(x, y)), true);
    g.add(glow);
    // Columns of code glyphs falling through the figure.
    const glyphs = '0123456789ABCDEF{}<>=+;:/*#';
    const columns: Phaser.GameObjects.Text[] = [];
    for (let x = baseX - 56; x <= baseX + 56; x += 6) {
      let text = '';
      for (let i = 0; i < 26; i++) text += glyphs[Math.floor(this.random() * glyphs.length)] + '\n';
      const col = this.add.text(x, GROUND_Y - 240 + this.random() * 120, text, { ...TEXT, fontSize: '8px', color: '#5dff8a', lineSpacing: -1 }).setAlpha(0.9);
      columns.push(col);
      g.add(col);
      if (!still) this.tweens.add({ targets: col, y: col.y + 120, duration: 900 + this.random() * 900, repeat: -1 });
    }
    g.setMask(maskShape.createGeometryMask());
    // Outline and burning eyes, outside the mask.
    const face = this.add.graphics().setDepth(4);
    face.lineStyle(1, 0x9dffb4, 0.9).strokePoints(shape.map(([x, y]) => new Phaser.Geom.Point(x, y)), true);
    face.fillStyle(0xd8ffe0).fillRect(baseX - 7, GROUND_Y - 92, 4, 2).fillRect(baseX + 3, GROUND_Y - 92, 4, 2);
    g.add(face);
    g.setAlpha(0);
    this.guardian = g;
    this.guardianMask = maskShape;
    if (still) g.setAlpha(1);
    else this.tweens.add({ targets: g, alpha: { from: 0, to: 1 }, duration: 90, yoyo: true, repeat: 3, onComplete: () => g.setAlpha(1) });
    await this.wait(1100);
    if (!this.alive(run)) return;
  }

  /** The guardian lunges at the enemy. */
  private async guardianStrike(run: number): Promise<void> {
    this.cue('guardian_strike');
    const g = this.guardian;
    if (g && !reducedMotion(this)) this.tweens.add({ targets: [g, this.guardianMask], x: 60, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
    this.time.delayedCall(140, () => {
      this.foe.setFrame(1).setTint(0x9dffb4);
      this.time.delayedCall(200, () => this.foe.setFrame(0).clearTint());
    });
    await this.wait(700);
    if (!this.alive(run)) return;
  }

  /** The guardian takes the blow. */
  private guardianBlock(): void {
    this.cue('guardian_strike');
    const g = this.guardian;
    if (!g) return;
    g.setAlpha(0.5);
    this.time.delayedCall(180, () => g.setAlpha(1));
  }

  /** Fades the guardian away once its turns are over. */
  private dismissGuardianIfDone(): void {
    const g = this.guardian;
    if (!g || this.assists.guardianTurns > 0) return;
    const mask = this.guardianMask;
    this.guardian = null;
    this.guardianMask = null;
    this.tweens.add({ targets: g, alpha: 0, duration: 400, onComplete: () => (g.destroy(), mask?.destroy()) });
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
