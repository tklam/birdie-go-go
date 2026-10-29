// Lesson result summaries and labels (SPEC.md §6.3).
import type { GradedMistake } from '../core/types.gen';

export const MISTAKE_ORDER = ['wrong_note', 'missed_note', 'extra_note', 'rush', 'drag', 'hesitation'] as const;

export const MISTAKE_LABELS: Record<string, string> = {
  wrong_note: 'Wrong note',
  missed_note: 'Missed note',
  extra_note: 'Extra note',
  rush: 'Rushed',
  drag: 'Dragged',
  hesitation: 'Hesitated',
};

/** Human label for a mistake type; unknown types get a tidied-up id. */
export function mistakeLabel(type: string): string {
  const known = MISTAKE_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Mistake';
}

export interface MistakeSummaryRow {
  type: string;
  label: string;
  total: number;
  hit: number;
}

/** Per-type counts in a fixed order (known types first), only types that occurred. */
export function summarizeMistakes(mistakes: readonly Pick<GradedMistake, 'type' | 'hit'>[]): MistakeSummaryRow[] {
  const rows = new Map<string, MistakeSummaryRow>();
  for (const m of mistakes) {
    const row = rows.get(m.type) ?? { type: m.type, label: mistakeLabel(m.type), total: 0, hit: 0 };
    row.total++;
    if (m.hit) row.hit++;
    rows.set(m.type, row);
  }
  const rank = (t: string) => {
    const i = (MISTAKE_ORDER as readonly string[]).indexOf(t);
    return i < 0 ? MISTAKE_ORDER.length : i;
  };
  return [...rows.values()].sort((a, b) => rank(a.type) - rank(b.type) || a.type.localeCompare(b.type));
}

/** Money paid for a lesson: half the fee at score 0, the full fee at 100. */
export function lessonPay(fee: number, score: number): number {
  const s = Math.min(100, Math.max(0, score));
  return Math.round(fee * (0.5 + s / 200));
}

/** m:ss.t for a time in ms. */
export function formatTime(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100));
  const tenths = t % 10;
  const secs = Math.floor(t / 10) % 60;
  const mins = Math.floor(t / 600);
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}
