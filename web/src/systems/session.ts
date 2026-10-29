import type { CoreClient } from '../core/client';
import type { ContentBundle, WeatherArea, WeatherDay, WorldIndex } from '../core/types.gen';
import { showDialogue } from '../ui/dialogue';
import { EventRunner, visibleLines, type TriggerInput } from './events';
import { IndexedDBSaveStore, MemorySaveStore, type SaveStore } from './save';
import { newGame, type GameState } from './state';
import { tickConsumables } from './hazards';
import { runTrailCameras } from './gadgets';
import { completeMission, lessonMissionsMet, photoMissionsMet, reminderMission, startMission, type PhotoResult } from './missions';
import { showPanel } from '../ui/panel';
import { advanceSlot } from './time';
import { billsDue, payBills } from './economy';
import { albumMilestones } from './milestones';
import { clockMinutes } from './transit';

/** The autosave slot. */
export const AUTOSAVE = 'auto';

const FIXED_NAMES: Record<string, string> = { angie: 'Angie', oboy: 'O Boy', kei: 'Kei', neighbour: 'Mrs Chan' };

/** Display name for a dialogue speaker id. */
export function speakerName(id: string, content: Pick<ContentBundle, 'students'>): string {
  return (
    FIXED_NAMES[id] ??
    content.students.find((s) => s.id === id)?.name ??
    id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Everything about the game in progress, shared by all scenes through the
 * Phaser registry ('session'): content, state, the core worker, saves and
 * the event runner.
 */
export class Session {
  readonly events: EventRunner;
  /** Called with the speaker id as each dialogue line appears (voices, e.g. O Boy's chirps). */
  voice: (speaker: string) => void = () => {};
  private weatherCache = new Map<number, Promise<WeatherDay>>();
  /** Time slots since the last mission reminder; starts full so a loaded game reminds once. */
  private slotsSinceReminder = Number.POSITIVE_INFINITY;
  private reminderTurn = 0;
  /** In-game minutes played in the current slot (one per real second on the map). */
  slotMinutes = 0;
  private transitLoaded: Promise<unknown> | null = null;

  constructor(
    readonly content: ContentBundle,
    public state: GameState,
    readonly core: CoreClient,
    readonly saves: SaveStore,
  ) {
    this.events = new EventRunner(content, {
      showDialogue: (id) => this.dialogue(id),
      startScene: (value) => console.info('event start_scene not wired yet', value),
      other: async (action) => {
        if (action.type === 'start_mission' && typeof action.value === 'string' && startMission(this.state, action.value)) {
          const m = this.content.missions.find((x) => x.id === action.value);
          if (m) await showPanel(`New mission: ${m.title}`, [m.description]);
          return;
        }
        console.info('event action not handled yet', action.type, action.value);
      },
    });
  }

  static async open(content: ContentBundle, core: CoreClient): Promise<{ session: Session; hasSave: boolean }> {
    let saves: SaveStore = new IndexedDBSaveStore();
    let existing: GameState | null = null;
    try {
      existing = await saves.load(AUTOSAVE);
    } catch (err) {
      console.warn('saves unavailable, progress will not persist', err);
      saves = new MemorySaveStore();
    }
    const state = existing ?? newGame(content, (Math.random() * 2 ** 32) >>> 0);
    return { session: new Session(content, state, core, saves), hasSave: existing !== null };
  }

  /** Starts over with a fresh state, keeping the player's settings. */
  newGame(): void {
    const settings = this.state.settings;
    this.state = newGame(this.content, (Math.random() * 2 ** 32) >>> 0);
    this.state.settings = { ...this.state.settings, ...settings };
    this.weatherCache.clear();
  }

  fire(trigger: TriggerInput): Promise<string[]> {
    return this.events.fire(trigger, this.state);
  }

  /**
   * An active mission to remind the player about, once every
   * game.missionReminderSlots time slots (SPEC.md §9.5); otherwise null.
   */
  missionReminder(): string | null {
    const every = this.content.game.missionReminderSlots ?? 0;
    if (every <= 0 || this.slotsSinceReminder < every) return null;
    const m = reminderMission(this.state, this.content, this.reminderTurn);
    if (!m) return null;
    this.slotsSinceReminder = 0;
    this.reminderTurn++;
    return m.title;
  }

  /** Now, in absolute in-game minutes (SPEC.md §4.11). */
  clock(): number {
    return clockMinutes(this.state.day, this.state.slot, this.slotMinutes);
  }

  /** Loads the transit network into the core once (stop positions from the world index). */
  transitReady(stopPositions: Record<string, { x: number; y: number }>): Promise<unknown> {
    this.transitLoaded ??= this.core.transitLoad({ transit: this.content.transit, stopPositions }).catch((err: unknown) => {
      this.transitLoaded = null;
      throw err;
    });
    return this.transitLoaded;
  }

  /** Fires the album milestones the album has reached (SPEC.md §5.6). */
  async checkAlbum(): Promise<void> {
    for (const t of albumMilestones(this.state, this.content.events)) await this.fire(t);
  }

  /** Deducts the bills due this morning and shows what was paid (SPEC.md §3.2). */
  private async payMorningBills(): Promise<void> {
    const due = billsDue(this.content.game.bills, this.state.day);
    if (due.length === 0) return;
    const { total, unpaid } = payBills(this.state, due);
    await showPanel('Morning bills', [
      ...due.map((b) => `${b.name}: -$${b.amount}`),
      `Total: -$${total}. Money left: $${this.state.money}`,
      ...(unpaid > 0 ? [`Angie couldn't cover $${unpaid}. Time to earn some money!`] : []),
    ]);
  }

  /** Ends the current time slot and fires the resulting triggers. */
  async endSlot(): Promise<void> {
    tickConsumables(this.state);
    this.slotsSinceReminder++;
    this.slotMinutes = 0;
    const triggers = advanceSlot(this.state);
    if (triggers.some((t) => t.type === 'day_start')) {
      // Overnight, trail cameras catch a bird each.
      const caught = runTrailCameras(this.state, this.content);
      if (caught.length) {
        const name = (id: string) => this.content.birds.find((b) => b.id === id)?.name ?? id;
        const spot = (id: string) => this.content.spots.find((x) => x.id === id)?.name ?? id;
        await showPanel(
          'Trail cameras',
          caught.map((c) => `${spot(c.spot)}: ${name(c.species)} (${c.score})${c.isNew ? ' NEW!' : ''}`),
        );
      }
      await this.payMorningBills();
      if (caught.length) await this.checkAlbum();
    }
    for (const t of triggers) await this.fire(t);
  }

  /**
   * The generated weather for a day (SPEC.md §4.9), computed by the Go core
   * from the save's world seed and cached. Area centres come from the city
   * index.
   */
  weather(day: number, world: WorldIndex): Promise<WeatherDay> {
    let w = this.weatherCache.get(day);
    if (!w) {
      const areas: WeatherArea[] = this.content.areas.map((a) => ({
        id: a.id,
        climate: a.climate,
        center: world.areaCenters[a.id] ?? { x: 0, y: 0 },
        altitude: a.altitude,
      }));
      w = this.core.call<WeatherDay>('weather.day', { seed: this.state.worldSeed, day, areas });
      w.catch(() => this.weatherCache.delete(day));
      this.weatherCache.set(day, w);
      if (this.weatherCache.size > 4) this.weatherCache.delete(this.weatherCache.keys().next().value as number);
    }
    return w;
  }

  /** Outings together raise bond with everyone along (SPEC.md §7.1). */
  growBond(amount = 2): void {
    for (const who of this.state.party) {
      if (who === 'oboy' || who === 'kei') this.state.bond[who] = Math.min(100, this.state.bond[who] + amount);
    }
  }

  /** Completes any missions met by a photo session or a lesson, with rewards and mission_complete events. */
  async checkMissions(done: { photos?: PhotoResult[]; lesson?: { studentId: string; score: number } }): Promise<void> {
    const met = [
      ...(done.photos ? photoMissionsMet(this.state, this.content, done.photos) : []),
      ...(done.lesson ? lessonMissionsMet(this.state, this.content, done.lesson.studentId, done.lesson.score) : []),
    ];
    for (const m of met) {
      completeMission(this.state, m);
      const items = m.reward.items.map((id) => this.content.items.find((i) => i.id === id)?.name ?? id);
      await showPanel(`Mission complete: ${m.title}`, [`Reward: $${m.reward.money}${items.length ? ` + ${items.join(', ')}` : ''}`]);
      await this.fire({ type: 'mission_complete', params: { mission: m.id } });
    }
  }

  async save(): Promise<void> {
    try {
      await this.saves.save(AUTOSAVE, this.state);
    } catch (err) {
      console.warn('autosave failed', err);
    }
  }

  async dialogue(id: string): Promise<void> {
    const d = this.content.dialogue.find((x) => x.id === id);
    if (!d) {
      console.warn(`unknown dialogue ${id}`);
      return;
    }
    const visible = visibleLines(d, this.state);
    const lines = visible.map((l) => ({ speaker: speakerName(l.speaker, this.content), text: l.text }));
    await showDialogue(lines, (i) => this.voice(visible[i].speaker));
  }
}
