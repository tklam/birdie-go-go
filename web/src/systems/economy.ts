// Everyday Energy costs and the morning bills (SPEC.md §3.2, §4.12). Pure:
// the map scene and the session apply them.
import type { Area, Bill, Contribution, EnergyRules } from '../core/types.gen';
import type { GameState } from './state';

/** Bills due on the morning of `day` (day 1 is the first morning). */
export function billsDue(bills: readonly Bill[] | undefined, day: number): Bill[] {
  return (bills ?? []).filter((b) => day % Math.max(1, b.everyDays) === 0);
}

/** One companion's share of his earnings for the morning. */
export interface ChipIn {
  companion: string;
  from: string;
  amount: number;
}

/**
 * What the companions in Angie's party chip in this morning (SPEC.md §3.2):
 * each one's income × his share (Kei's by relationship stage), rounded;
 * companions away from the party, or with nothing to give, are left out.
 */
export function morningChipIns(contributions: readonly Contribution[] | undefined, state: Pick<GameState, 'party' | 'keiStage'>): ChipIn[] {
  const out: ChipIn[] = [];
  for (const c of contributions ?? []) {
    if (!state.party.includes(c.companion)) continue;
    const share = c.byStage?.[state.keiStage] ?? c.share;
    const amount = Math.round(c.income * share);
    if (amount > 0) out.push({ companion: c.companion, from: c.from, amount });
  }
  return out;
}

/**
 * Pays the bills due this morning. Money never goes below 0; `unpaid` is the
 * part Angie couldn't cover. Mutates state.
 */
export function payBills(state: Pick<GameState, 'money'>, due: readonly Bill[]): { total: number; unpaid: number } {
  const total = due.reduce((sum, b) => sum + b.amount, 0);
  const paid = Math.min(total, state.money);
  state.money -= paid;
  return { total, unpaid: total - paid };
}

/** The Energy an activity costs to start (0 when the rules don't set one). */
export function activityCost(rules: EnergyRules | undefined, activity: 'photo' | 'lesson'): number {
  if (!rules) return 0;
  return activity === 'photo' ? rules.photoSession : rules.lesson;
}

/** Energy lost walking for `minutes` in an area (its walk effort scales the cost). */
export function walkCost(rules: EnergyRules | undefined, area: Pick<Area, 'walkEffort'> | undefined, minutes: number): number {
  if (!rules) return 0;
  return rules.walkPerMin * (area?.walkEffort || 1) * minutes;
}

/** Whether Energy just fell below the low warning level. */
export function crossedLow(rules: EnergyRules | undefined, before: number, after: number): boolean {
  return !!rules?.lowWarning && before >= rules.lowWarning && after < rules.lowWarning;
}

export type FaintCause = 'weather' | 'encounter';

/** The fallback when game.yaml sets no energy.faint rules. */
const FAINT_FALLBACK = { fee: 0, recoverTo: 60, title: 'Angie needs a rest...', lines: ['A kind neighbour helped her home.'] };

/**
 * What happens when Energy runs out (SPEC.md §4.12): the notice for the
 * cause, the fee (capped by Angie's money, "{fee}" filled in) and the
 * Energy she wakes with.
 */
export function faintOutcome(
  rules: EnergyRules | undefined,
  cause: FaintCause,
  money: number,
): { title: string; lines: string[]; fee: number; recoverTo: number } {
  const f = rules?.faint;
  const text = f ? (cause === 'encounter' ? f.encounter : f.weather) : FAINT_FALLBACK;
  const fee = Math.max(0, Math.min(money, f?.fee ?? FAINT_FALLBACK.fee));
  return {
    title: text.title,
    lines: text.lines.map((l) => l.replaceAll('{fee}', String(fee))),
    fee,
    recoverTo: f?.recoverTo ?? FAINT_FALLBACK.recoverTo,
  };
}
