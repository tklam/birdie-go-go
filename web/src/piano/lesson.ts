// Lesson setup and bookkeeping around the Go core's lesson ops.
import type { Song, Student } from '../core/types.gen';
import type { GameState, StudentProgress } from '../systems/state';
import { lessonPay } from './results';

/** Flag set once the player has done latency calibration. */
export const CALIBRATED_FLAG = 'latency_calibrated';

export function isLatencyCalibrated(state: Pick<GameState, 'flags'>): boolean {
  return state.flags[CALIBRATED_FLAG] === true;
}

/** Stores a calibration result in the save. */
export function setLatencyOffset(
  state: Pick<GameState, 'flags'> & { settings: Pick<GameState['settings'], 'latencyOffsetMs'> },
  offsetMs: number,
): void {
  state.settings.latencyOffsetMs = offsetMs;
  state.flags[CALIBRATED_FLAG] = true;
}

/** Lesson difficulty 1–5 from the student's level. */
export function lessonDifficulty(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level) || 1));
}

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** uint32 lesson seed: the same world, day and student give the same lesson. */
export function lessonSeed(worldSeed: number, day: number, studentId: string): number {
  return fnv1a(`${worldSeed >>> 0}:${day}:${studentId}`);
}

/** The song with `songId` if given and known, else the first song of the student's repertoire that exists. */
export function pickSong(student: Student, songs: readonly Song[], songId?: string, progress = 0): Song | undefined {
  const byId = (id: string) => songs.find((s) => s.id === id);
  if (songId) {
    const s = byId(songId);
    if (s) return s;
  }
  // Students move on to the next piece of their repertoire as they progress
  // (each lesson adds score/100 to progress).
  const known = student.repertoire.map(byId).filter((s): s is Song => !!s);
  if (known.length === 0) return undefined;
  return known[Math.min(known.length - 1, Math.max(0, Math.floor(progress)))];
}

export interface LessonOutcome {
  pay: number;
  progress: StudentProgress;
}

/** Pays for the lesson and advances the student's progress (mutates state). */
export function applyLessonResult(state: Pick<GameState, 'money' | 'students'>, student: Pick<Student, 'id' | 'fee'>, score: number): LessonOutcome {
  const pay = lessonPay(student.fee, score);
  const prev = state.students[student.id] ?? { progress: 0, lessons: 0 };
  const progress = { progress: prev.progress + Math.min(100, Math.max(0, score)) / 100, lessons: prev.lessons + 1 };
  state.students[student.id] = progress;
  state.money += pay;
  return { pay, progress };
}
