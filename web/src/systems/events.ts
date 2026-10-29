// The data-driven event system (SPEC.md §9.4). Events come from the content
// bundle; this module matches triggers, evaluates conditions against the
// GameState, applies state-changing actions and hands presentation actions
// to an async host (the scenes). No Phaser here, so it's unit-tested.
import type {
  Action,
  Condition,
  ContentBundle,
  Dialogue,
  DialogueLine,
  Event,
} from '../core/types.gen';
import {
  clampBond,
  isCompanion,
  isKeiStage,
  KEI_STAGES,
  season,
  type GameState,
} from './state';

/** A trigger as raised by the game, e.g. {type: 'photo_session_end', params: {spot: 'tko_waterfront'}}. */
export interface TriggerInput {
  type: string;
  params?: Record<string, string>;
}

/** Evaluates one condition type that the state alone can't answer (e.g. weather). */
export type ConditionEvaluator = (value: unknown, state: GameState) => boolean;

export interface ConditionContext {
  /** Called for unknown condition/action types and malformed values. */
  onWarn?: (message: string) => void;
  /**
   * Extra condition types supplied by the caller (weather, energy_at_least,
   * mission_state …). They take precedence over the built-in ones.
   */
  custom?: Record<string, ConditionEvaluator>;
}

/**
 * The scenes' side of the event system. Calls are awaited in order, so a
 * dialogue finishes before the next action runs.
 */
export interface EventHost {
  showDialogue(id: string): Promise<void> | void;
  startScene(value: unknown): Promise<void> | void;
  /** Any other action (unlock_area, start_mission, …): handle, log or ignore. */
  other(action: Action): Promise<void> | void;
}

/** True when the event listens to this trigger type and all its params match. */
export function matchesTrigger(event: Event, trigger: TriggerInput): boolean {
  if (event.trigger.type !== trigger.type) return false;
  const given = trigger.params ?? {};
  for (const [key, value] of Object.entries(event.trigger.params ?? {})) {
    if (given[key] !== value) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A string, or a list of strings meaning "any of". */
function stringOrList(value: unknown): string[] | null {
  if (isNonEmptyString(value)) return [value];
  if (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)) return value;
  return null;
}

/** Parses `item` or `{item, count}` (count defaults to 1). */
function itemCount(value: unknown): { item: string; count: number } | null {
  if (isNonEmptyString(value)) return { item: value, count: 1 };
  if (isRecord(value) && isNonEmptyString(value.item)) {
    if (value.count === undefined) return { item: value.item, count: 1 };
    if (isNumber(value.count)) return { item: value.item, count: value.count };
  }
  return null;
}

/** Parses `{who, amount}` with who a companion id. */
function whoAmount(value: unknown): { who: 'oboy' | 'kei'; amount: number } | null {
  if (isRecord(value) && isCompanion(value.who) && isNumber(value.amount)) {
    return { who: value.who, amount: value.amount };
  }
  return null;
}

type Check = (value: unknown, state: GameState) => boolean | null;

/** Built-in conditions. `null` means the value was malformed. */
const CONDITIONS: Record<string, Check> = {
  flag_set: (v, s) => (isNonEmptyString(v) ? s.flags[v] === true : null),
  flag_not_set: (v, s) => (isNonEmptyString(v) ? s.flags[v] !== true : null),
  chapter_at_least: (v, s) => (isNumber(v) ? s.chapter >= v : null),
  bond_at_least: (v, s) => {
    const p = whoAmount(v);
    return p ? s.bond[p.who] >= p.amount : null;
  },
  kei_stage: (v, s) =>
    isKeiStage(v) ? KEI_STAGES.indexOf(s.keiStage) >= KEI_STAGES.indexOf(v) : null,
  party_has: (v, s) => (isNonEmptyString(v) ? s.party.includes(v) : null),
  party_lacks: (v, s) => (isNonEmptyString(v) ? !s.party.includes(v) : null),
  has_item: (v, s) => {
    const p = itemCount(v);
    return p ? (s.items[p.item] ?? 0) >= p.count : null;
  },
  money_at_least: (v, s) => (isNumber(v) ? s.money >= v : null),
  season: (v, s) => {
    const list = stringOrList(v);
    return list ? list.includes(season(s.day)) : null;
  },
  time_slot: (v, s) => {
    const list = stringOrList(v);
    return list ? list.includes(s.slot) : null;
  },
  album_has: (v, s) => (isNonEmptyString(v) ? s.album[v] !== undefined : null),
};

/**
 * Evaluates one condition. Unknown types and malformed values are false and
 * reported through ctx.onWarn.
 */
export function checkCondition(cond: Condition, state: GameState, ctx: ConditionContext = {}): boolean {
  const custom = ctx.custom?.[cond.type];
  if (custom) return custom(cond.value, state);
  const check = CONDITIONS[cond.type];
  if (!check) {
    ctx.onWarn?.(`unknown condition type "${cond.type}"`);
    return false;
  }
  const result = check(cond.value, state);
  if (result === null) {
    ctx.onWarn?.(`malformed value for condition "${cond.type}": ${JSON.stringify(cond.value)}`);
    return false;
  }
  return result;
}

/** True when every condition holds (an empty list holds). */
export function checkAll(conds: readonly Condition[] | undefined, state: GameState, ctx?: ConditionContext): boolean {
  return (conds ?? []).every((c) => checkCondition(c, state, ctx));
}

/** The lines of a dialogue whose `if` conditions all hold. */
export function visibleLines(dialogue: Dialogue, state: GameState, ctx?: ConditionContext): DialogueLine[] {
  return dialogue.lines.filter((line) => checkAll(line.if, state, ctx));
}

/**
 * Applies a state-changing action to `state` (mutating it). Returns false if
 * the action isn't a state action, so the caller can pass it to the host.
 * Malformed values are skipped with a warning (and still count as handled).
 */
export function applyStateAction(action: Action, state: GameState, ctx: ConditionContext = {}): boolean {
  const v = action.value;
  const bad = () => ctx.onWarn?.(`malformed value for action "${action.type}": ${JSON.stringify(v)}`);
  switch (action.type) {
    case 'set_flag':
      if (isNonEmptyString(v)) state.flags[v] = true;
      else bad();
      return true;
    case 'clear_flag':
      if (isNonEmptyString(v)) delete state.flags[v];
      else bad();
      return true;
    case 'set_chapter':
      if (isNumber(v)) state.chapter = v;
      else bad();
      return true;
    case 'join_party':
      if (isNonEmptyString(v)) {
        if (!state.joined.includes(v)) state.joined.push(v);
        if (!state.party.includes(v)) state.party.push(v);
      } else bad();
      return true;
    case 'add_bond': {
      const p = whoAmount(v);
      if (p) state.bond[p.who] = clampBond(state.bond[p.who] + p.amount);
      else bad();
      return true;
    }
    case 'set_kei_stage':
      if (isKeiStage(v)) state.keiStage = v;
      else bad();
      return true;
    case 'give_item': {
      const p = itemCount(v);
      if (p) {
        const n = (state.items[p.item] ?? 0) + p.count;
        if (n > 0) state.items[p.item] = n;
        else delete state.items[p.item];
      } else bad();
      return true;
    }
    case 'give_money':
      if (isNumber(v)) state.money = Math.max(0, state.money + v);
      else bad();
      return true;
    default:
      return false;
  }
}

/** Runs one action: state actions on `state`, the rest through `host`. */
export async function runAction(
  action: Action,
  state: GameState,
  host: EventHost,
  ctx: ConditionContext = {},
): Promise<void> {
  if (applyStateAction(action, state, ctx)) return;
  if (action.type === 'dialogue') {
    if (isNonEmptyString(action.value)) await host.showDialogue(action.value);
    else ctx.onWarn?.(`malformed value for action "dialogue": ${JSON.stringify(action.value)}`);
    return;
  }
  if (action.type === 'start_scene') {
    await host.startScene(action.value);
    return;
  }
  await host.other(action);
}

/**
 * Fires a trigger: every matching event, in content order, whose conditions
 * hold runs its actions in order (awaiting the host). Each event's conditions
 * are checked just before it runs, so an earlier event's effects are visible
 * to later ones. Once-events are marked in state.firedEvents before their
 * actions run, so a re-entrant fire of the same trigger can't repeat them.
 * Mutates `state`. Returns the ids of the events that fired.
 */
export async function fire(
  trigger: TriggerInput,
  state: GameState,
  content: Pick<ContentBundle, 'events'>,
  host: EventHost,
  ctx: ConditionContext = {},
): Promise<string[]> {
  const fired: string[] = [];
  for (const event of content.events) {
    if (!matchesTrigger(event, trigger)) continue;
    if (event.once && state.firedEvents[event.id]) continue;
    if (!checkAll(event.conditions, state, ctx)) continue;
    if (event.once) state.firedEvents[event.id] = true;
    fired.push(event.id);
    for (const action of event.actions) await runAction(action, state, host, ctx);
  }
  return fired;
}

/** Convenience wrapper that binds content, host and context once. */
export class EventRunner {
  constructor(
    private readonly content: Pick<ContentBundle, 'events'>,
    private readonly host: EventHost,
    private readonly ctx: ConditionContext = {},
  ) {}

  fire(trigger: TriggerInput, state: GameState): Promise<string[]> {
    return fire(trigger, state, this.content, this.host, this.ctx);
  }
}
