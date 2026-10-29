package lesson

import (
	"cmp"
	"fmt"
	"math"
	"slices"

	"birdiegogo/core/model"
)

// score is a song converted to milliseconds and grouped by onset.
type score struct {
	// notes are sorted by start, then pitch.
	notes []model.PerfNote
	// groups are the distinct note onsets in time order.
	groups []group
	// inKey marks the pitch classes the song uses.
	inKey      [12]bool
	durationMs float64
}

// group is the set of notes that start together (a chord or a single note).
type group struct {
	startMs float64
	// notes index score.notes, lowest pitch first; the last is the melody.
	notes []int
}

// top returns the index of the group's highest (melody) note.
func (g group) top() int {
	return g.notes[len(g.notes)-1]
}

// prevStart and nextStart return the neighbouring group onsets, or ±Inf
// at the ends of the piece.
func (sc score) prevStart(g int) float64 {
	if g == 0 {
		return math.Inf(-1)
	}
	return sc.groups[g-1].startMs
}

func (sc score) nextStart(g int) float64 {
	if g+1 >= len(sc.groups) {
		return math.Inf(1)
	}
	return sc.groups[g+1].startMs
}

// newScore validates the song and converts beats to milliseconds.
func newScore(s model.Song) (score, error) {
	if !(s.Tempo > 0) || math.IsInf(s.Tempo, 0) {
		return score{}, fmt.Errorf("%w: tempo %v must be a positive number", ErrInvalidSong, s.Tempo)
	}
	if len(s.Notes) == 0 {
		return score{}, fmt.Errorf("%w: no notes", ErrInvalidSong)
	}
	msPerBeat := 60000 / s.Tempo
	sc := score{notes: make([]model.PerfNote, 0, len(s.Notes))}
	for i, n := range s.Notes {
		if err := checkNote(n); err != nil {
			return score{}, fmt.Errorf("%w: note %d: %w", ErrInvalidSong, i, err)
		}
		sc.notes = append(sc.notes, model.PerfNote{
			Pitch: n.Pitch, StartMs: n.Start * msPerBeat, DurMs: n.Dur * msPerBeat, Vel: n.Vel,
		})
		sc.inKey[n.Pitch%12] = true
	}
	slices.SortStableFunc(sc.notes, func(a, b model.PerfNote) int {
		return cmp.Or(cmp.Compare(a.StartMs, b.StartMs), cmp.Compare(a.Pitch, b.Pitch))
	})
	for i, n := range sc.notes {
		if len(sc.groups) == 0 || sc.groups[len(sc.groups)-1].startMs != n.StartMs {
			sc.groups = append(sc.groups, group{startMs: n.StartMs})
		}
		g := &sc.groups[len(sc.groups)-1]
		g.notes = append(g.notes, i)
		sc.durationMs = max(sc.durationMs, n.StartMs+n.DurMs)
	}
	if len(sc.groups) < 2 {
		return score{}, fmt.Errorf("%w: need at least two note onsets", ErrInvalidSong)
	}
	return sc, nil
}

func checkNote(n model.Note) error {
	switch {
	case n.Pitch < 0 || n.Pitch > 127:
		return fmt.Errorf("pitch %d outside 0–127", n.Pitch)
	case !(n.Start >= 0) || math.IsInf(n.Start, 0):
		return fmt.Errorf("start %v must be a non-negative number", n.Start)
	case !(n.Dur > 0) || math.IsInf(n.Dur, 0):
		return fmt.Errorf("dur %v must be a positive number", n.Dur)
	case n.Vel < 1 || n.Vel > 127:
		return fmt.Errorf("vel %d outside 1–127", n.Vel)
	}
	return nil
}
