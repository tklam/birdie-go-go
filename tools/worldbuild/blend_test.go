package main

import "testing"

// Two areas side by side on a 32×4 strip: A in columns 0–15, B in 16–31.
func strip() (w, h int, in func(a int) func(x, y int) bool) {
	return 32, 4, func(a int) func(x, y int) bool {
		return func(x, _ int) bool { return (x < 16) == (a == 0) }
	}
}

func TestBFSDistances(t *testing.T) {
	w, h, in := strip()
	d := bfs(w, h, 8, in(1)) // distances to B
	for _, tc := range []struct{ x, want int }{{16, 0}, {15, 1}, {12, 4}, {9, 7}, {8, 8}, {0, 8}} {
		if got := int(d[2*w+tc.x]); got != tc.want {
			t.Errorf("distance at x=%d is %d, want %d", tc.x, got, tc.want)
		}
	}
}

func TestCellWeights(t *testing.T) {
	w, h, in := strip()
	dists := [][]uint8{bfs(w, h, 8, in(0)), bfs(w, h, 8, in(1))}
	sum := func(c [blendSlots][2]uint8) int {
		s := 0
		for _, p := range c {
			if p[0] != noArea {
				s += int(p[1])
			}
		}
		return s
	}

	deep := cellWeights(2, 2, w, dists, 8)
	if deep[0] != [2]uint8{0, 255} || deep[1][0] != noArea {
		t.Errorf("deep inside A = %v, want only A at 255", deep)
	}

	// Right at the boundary each side is 1 tile from the other: A 1.0 vs
	// B 0.875 on A's last column.
	edge := cellWeights(15, 2, w, dists, 8)
	if edge[0][0] != 0 || edge[1][0] != 1 || sum(edge) != 255 {
		t.Fatalf("edge = %v", edge)
	}
	if edge[0][1] < 128 || edge[0][1] > 140 {
		t.Errorf("edge weight of A = %d, want just over half", edge[0][1])
	}

	// Symmetric across the boundary.
	other := cellWeights(16, 2, w, dists, 8)
	if other[0][0] != 1 || other[0][1] != edge[0][1] {
		t.Errorf("mirror cell = %v, edge = %v", other, edge)
	}

	// A cell outside both areas' bands has no weights.
	none := cellWeights(2, 2, w, [][]uint8{bfs(w, h, 8, func(int, int) bool { return false })}, 8)
	if none[0][0] != noArea {
		t.Errorf("no area = %v", none)
	}
}
