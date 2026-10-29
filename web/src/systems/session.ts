import type { CoreClient } from '../core/client';
import type { ContentBundle } from '../core/types.gen';
import { showDialogue } from '../ui/dialogue';
import { EventRunner, visibleLines, type TriggerInput } from './events';
import { IndexedDBSaveStore, MemorySaveStore, type SaveStore } from './save';
import { newGame, type GameState } from './state';
import { advanceSlot } from './time';

/** The autosave slot. */
export const AUTOSAVE = 'auto';

const FIXED_NAMES: Record<string, string> = { angie: 'Angie', oboy: 'O Boy', kei: 'Kei' };

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

  constructor(
    readonly content: ContentBundle,
    public state: GameState,
    readonly core: CoreClient,
    readonly saves: SaveStore,
  ) {
    this.events = new EventRunner(content, {
      showDialogue: (id) => this.dialogue(id),
      startScene: (value) => console.info('event start_scene not wired yet', value),
      other: (action) => console.info('event action not handled yet', action.type, action.value),
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
  }

  fire(trigger: TriggerInput): Promise<string[]> {
    return this.events.fire(trigger, this.state);
  }

  /** Ends the current time slot and fires the resulting triggers. */
  async endSlot(): Promise<void> {
    for (const t of advanceSlot(this.state)) await this.fire(t);
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
