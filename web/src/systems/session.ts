import type { CoreClient } from '../core/client';
import type { ContentBundle, WeatherArea, WeatherDay, WorldIndex } from '../core/types.gen';
import { showDialogue } from '../ui/dialogue';
import { EventRunner, visibleLines, type TriggerInput } from './events';
import { IndexedDBSaveStore, MemorySaveStore, type SaveStore } from './save';
import { newGame, type GameState } from './state';
import { tickConsumables } from './hazards';
import { runTrailCameras } from './gadgets';
import { completeMission, lessonMissionsMet, photoMissionsMet, startMission, type PhotoResult } from './missions';
import { showPanel } from '../ui/panel';
import { advanceSlot } from './time';

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
  private weatherCache = new Map<number, Promise<WeatherDay>>();

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

  /** Starts over with a fresh state. */
  newGame(): void {
    this.state = newGame(this.content, (Math.random() * 2 ** 32) >>> 0);
    this.weatherCache.clear();
  }

  fire(trigger: TriggerInput): Promise<string[]> {
    return this.events.fire(trigger, this.state);
  }

  /** Ends the current time slot and fires the resulting triggers. */
  async endSlot(): Promise<void> {
    tickConsumables(this.state);
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
    const lines = visibleLines(d, this.state).map((l) => ({ speaker: speakerName(l.speaker, this.content), text: l.text }));
    await showDialogue(lines);
  }
}
