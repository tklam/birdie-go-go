// Beats → milliseconds for songs, matching the Go core's conversion
// (core/lesson/score.go: ms = beats × 60000 / tempo).
import type { PerfNote, Song } from '../core/types.gen';

/** Milliseconds per beat at the song's tempo (0 for a non-positive tempo). */
export function msPerBeat(song: Pick<Song, 'tempo'>): number {
  return song.tempo > 0 ? 60000 / song.tempo : 0;
}

/**
 * Maps a performance time to the score time it corresponds to, given the
 * performance's hesitation pauses (sorted by score time): during a pause the
 * score position stands still, and after it the performance runs late by
 * the pause length.
 */
export function perfToScoreMs(perfMs: number, pauses: readonly { scoreMs: number; ms: number }[]): number {
  let late = 0;
  for (const p of pauses) {
    const pauseStart = p.scoreMs + late;
    if (perfMs < pauseStart) break;
    if (perfMs < pauseStart + p.ms) return p.scoreMs;
    late += p.ms;
  }
  return perfMs - late;
}

/** The song as written, in ms from its start, sorted by start then pitch. */
export function songToNotes(song: Song): PerfNote[] {
  const k = msPerBeat(song);
  return song.notes
    .map((n) => ({ pitch: n.pitch, startMs: n.start * k, durMs: n.dur * k, vel: n.vel }))
    .sort((a, b) => a.startMs - b.startMs || a.pitch - b.pitch);
}

/** End of the last note in ms. */
export function notesEndMs(notes: readonly PerfNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.startMs + n.durMs), 0);
}

/** Beats per bar from the time signature (defaults to 4). */
export function beatsPerBar(song: Pick<Song, 'timeSignature'>): number {
  const top = song.timeSignature?.[0];
  return top && top > 0 ? top : 4;
}
