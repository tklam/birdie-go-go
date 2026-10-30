// Companions fighting alongside Angie (SPEC.md §4.13): O Boy's song and
// Kei's digital guardian. They help, never win on their own (AGENTS.md rule
// 12): longer combo windows, softer and blocked counter-hits, extra resolve
// damage, and one free success when both act together. Pure.
import type { CompanionAbilities } from '../core/types.gen';
import { KEI_STAGES, type KeiStage } from '../systems/state';

export type Ability = 'sing' | 'guardian';

export interface AssistState {
  /** Uses left this encounter. */
  uses: Record<Ability, number>;
  /** Combos the song and the guardian still last. */
  singTurns: number;
  guardianTurns: number;
  /** Counter-hits the guardian will still block. */
  guards: number;
  /** The song softens the next counter-hit. */
  soften: boolean;
  /** Both acting together: the next combo succeeds on its own. */
  freeSuccess: boolean;
  /** The duet has been used (once per encounter). */
  duetUsed: boolean;
}

/** Whether Kei is in the party and at least at `stage` (an unknown stage counts as `met`). */
export function keiAtLeast(party: readonly string[], keiStage: KeiStage, stage: string): boolean {
  const need = KEI_STAGES.indexOf(stage as KeiStage);
  return party.includes('kei') && KEI_STAGES.indexOf(keiStage) >= (need < 0 ? KEI_STAGES.indexOf('met') : need);
}

/** Abilities this party can use at all (companion along, Kei far enough in the story). */
export function partyAbilities(cfg: CompanionAbilities | undefined, party: readonly string[], keiStage: KeiStage): Ability[] {
  const out: Ability[] = [];
  if (cfg?.sing && party.includes('oboy')) out.push('sing');
  const g = cfg?.guardian;
  if (g && keiAtLeast(party, keiStage, g.minStage)) out.push('guardian');
  return out;
}

export function startAssists(cfg: CompanionAbilities | undefined, abilities: readonly Ability[]): AssistState {
  return {
    uses: {
      sing: abilities.includes('sing') ? (cfg?.sing?.uses ?? 0) : 0,
      guardian: abilities.includes('guardian') ? (cfg?.guardian?.uses ?? 0) : 0,
    },
    singTurns: 0,
    guardianTurns: 0,
    guards: 0,
    soften: false,
    freeSuccess: false,
    duetUsed: false,
  };
}

/** Abilities that can be used right now. */
export function readyAbilities(s: AssistState): Ability[] {
  return (['sing', 'guardian'] as const).filter((a) => s.uses[a] > 0);
}

/**
 * Uses an ability. When the other one is still active and the duet is
 * unused, the two act together: the next combo is a free success.
 */
export function activate(s: AssistState, which: Ability, cfg: CompanionAbilities | undefined): { state: AssistState; duet: boolean } {
  if (s.uses[which] <= 0) return { state: s, duet: false };
  const next: AssistState = { ...s, uses: { ...s.uses, [which]: s.uses[which] - 1 } };
  if (which === 'sing') {
    next.singTurns = cfg?.sing?.turns ?? 0;
    next.soften = true;
  } else {
    next.guardianTurns = cfg?.guardian?.turns ?? 0;
    next.guards = cfg?.guardian?.guards ?? 0;
  }
  const duet = !s.duetUsed && !!cfg?.duet && next.singTurns > 0 && next.guardianTurns > 0;
  if (duet) {
    next.freeSuccess = true;
    next.duetUsed = true;
  }
  return { state: next, duet };
}

/** How much longer the next combo's window is (the song). */
export function windowScale(s: AssistState, cfg: CompanionAbilities | undefined): number {
  return s.singTurns > 0 ? (cfg?.sing?.windowScale ?? 1) : 1;
}

/**
 * After a completed combo: the guardian's extra resolve damage, and both
 * effects tick down a turn.
 */
export function afterSuccess(s: AssistState, cfg: CompanionAbilities | undefined): { state: AssistState; bonusHit: number } {
  const bonusHit = s.guardianTurns > 0 ? (cfg?.guardian?.bonusHit ?? 0) : 0;
  return { state: tick({ ...s, freeSuccess: false }), bonusHit };
}

/**
 * A counter-hit: the guardian blocks it while it has guards left; otherwise
 * the song softens it once. Both effects tick down a turn.
 */
export function counterHit(s: AssistState, damage: number, cfg: CompanionAbilities | undefined): { state: AssistState; damage: number; blocked: boolean } {
  if (s.guardianTurns > 0 && s.guards > 0) return { state: tick({ ...s, guards: s.guards - 1 }), damage: 0, blocked: true };
  const scale = s.soften ? (cfg?.sing?.damageScale ?? 1) : 1;
  return { state: tick({ ...s, soften: false }), damage: Math.round(damage * scale), blocked: false };
}

function tick(s: AssistState): AssistState {
  const guardianTurns = Math.max(0, s.guardianTurns - 1);
  return { ...s, singTurns: Math.max(0, s.singTurns - 1), guardianTurns, guards: guardianTurns > 0 ? s.guards : 0 };
}
