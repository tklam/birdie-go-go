package transit

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	"birdiegogo/core/model"
)

const day = MinutesPerDay

func stops(ids ...string) []model.TransitStop {
	out := make([]model.TransitStop, len(ids))
	for i, id := range ids {
		out[i] = model.TransitStop{ID: id, Name: strings.ToUpper(id)}
	}
	return out
}

// testNetwork: line fast runs a–b–c east along y=0 (600 px at 60 px/min, so
// 10 min end to end, b halfway), every 10 min 06:00–08:00. Line cross runs
// c–d south (300 px at 30 px/min, 10 min), every 20 min 06:00–22:00. Line
// boat is a ferry d–e. Stop x has no service. Line night runs y–z (900 px at
// 10 px/min, 90 min), hourly 23:00–25:00.
func testNetwork(t *testing.T) *Network {
	t.Helper()
	tr := model.Transit{
		Stops: stops("a", "b", "c", "d", "e", "x", "y", "z"),
		Lines: []model.TransitLine{
			{ID: "fast", Mode: "bus", Fare: 8, Stops: []string{"a", "b", "c"}, Path: [][2]float64{{0, 0}, {600, 0}}, Speed: 60, Headway: 10, First: "06:00", Last: "08:00"},
			{ID: "cross", Mode: "tram", Fare: 3, Stops: []string{"c", "d"}, Path: [][2]float64{{600, 0}, {600, 300}}, Speed: 30, Headway: 20, First: "06:00", Last: "22:00"},
			{ID: "boat", Mode: "ferry", Fare: 15, Stops: []string{"d", "e"}, Path: [][2]float64{{600, 300}, {600, 600}}, Speed: 30},
			{ID: "night", Mode: "bus", Fare: 5, Stops: []string{"y", "z"}, Path: [][2]float64{{0, 1000}, {900, 1000}}, Speed: 10, Headway: 60, First: "23:00", Last: "25:00"},
		},
	}
	n, err := Build(tr, map[string]model.Point{"b": {X: 300, Y: 12}})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func TestParseClock(t *testing.T) {
	tests := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"06:00", 360, true},
		{"6:05", 365, true},
		{"00:00", 0, true},
		{"25:30", 1530, true},
		{"47:59", 2879, true},
		{"48:00", 0, false},
		{"06:60", 0, false},
		{"0600", 0, false},
		{"06:0", 0, false},
		{"", 0, false},
		{"ab:cd", 0, false},
	}
	for _, tt := range tests {
		got, err := ParseClock(tt.in)
		if (err == nil) != tt.ok || got != tt.want {
			t.Errorf("ParseClock(%q) = %v, %v; want %v, ok=%v", tt.in, got, err, tt.want, tt.ok)
		}
	}
}

func TestBuildGeometryAndDefaults(t *testing.T) {
	n := testNetwork(t)
	if n.StopCount() != 8 || len(n.Lines()) != 4 {
		t.Fatalf("got %d stops, %d lines", n.StopCount(), len(n.Lines()))
	}
	fast, _ := n.Line("fast")
	if !reflect.DeepEqual(fast.StopDist, []float64{0, 300, 600}) || fast.Length() != 600 || fast.Duration() != 10 || fast.Trips() != 13 {
		t.Errorf("fast: dist %v length %v duration %v trips %d", fast.StopDist, fast.Length(), fast.Duration(), fast.Trips())
	}
	boat, _ := n.Line("boat")
	if boat.HeadwayMin != DefaultHeadway || boat.FirstMin != DefaultFirst || boat.LastMin != DefaultLast {
		t.Errorf("boat defaults: %v %v %v", boat.HeadwayMin, boat.FirstMin, boat.LastMin)
	}
	if _, ok := n.Line("nope"); ok {
		t.Error("unknown line found")
	}

	// Stop placement on an L-shaped path: placed stops snap past the previous
	// stop, unplaced ones are spaced evenly between placed neighbours.
	path := [][2]float64{{0, 0}, {400, 0}, {400, 400}}
	tests := []struct {
		name      string
		stops     []string
		positions map[string]model.Point
		want      []float64
	}{
		{"ends only", []string{"s0", "s3"}, nil, []float64{0, 800}},
		{"none placed", []string{"s0", "s1", "s2", "s3"}, nil, []float64{0, 800.0 / 3, 1600.0 / 3, 800}},
		{"snap to corner leg", []string{"s0", "s1", "s3"}, map[string]model.Point{"s1": {X: 390, Y: 200}}, []float64{0, 600, 800}},
		{"one placed one even", []string{"s0", "s1", "s2", "s3"}, map[string]model.Point{"s1": {X: 100, Y: -5}}, []float64{0, 100, 450, 800}},
		{"snaps forward only", []string{"s0", "s1", "s2", "s3"}, map[string]model.Point{"s1": {X: 400, Y: 300}, "s2": {X: 200, Y: 0}}, []float64{0, 700, 700, 800}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := model.Transit{Stops: stops("s0", "s1", "s2", "s3"), Lines: []model.TransitLine{{ID: "l", Mode: "bus", Stops: tt.stops, Path: path, Speed: 1}}}
			n, err := Build(tr, tt.positions)
			if err != nil {
				t.Fatal(err)
			}
			l, _ := n.Line("l")
			for i := range tt.want {
				if !near(l.StopDist[i], tt.want[i]) {
					t.Fatalf("StopDist = %v, want %v", l.StopDist, tt.want)
				}
			}
		})
	}
}

func TestBuildErrors(t *testing.T) {
	good := func() model.TransitLine {
		return model.TransitLine{ID: "l", Mode: "bus", Stops: []string{"a", "b"}, Path: [][2]float64{{0, 0}, {10, 0}}, Speed: 1}
	}
	tests := []struct {
		name   string
		mutate func(*model.Transit)
		want   string
	}{
		{"unknown stop", func(tr *model.Transit) { tr.Lines[0].Stops[1] = "zz" }, `unknown stop "zz"`},
		{"one stop", func(tr *model.Transit) { tr.Lines[0].Stops = []string{"a"} }, "two stops"},
		{"short path", func(tr *model.Transit) { tr.Lines[0].Path = [][2]float64{{0, 0}} }, "two points"},
		{"zero length", func(tr *model.Transit) { tr.Lines[0].Path = [][2]float64{{5, 5}, {5, 5}} }, "zero length"},
		{"zero speed", func(tr *model.Transit) { tr.Lines[0].Speed = 0 }, "speed"},
		{"negative headway", func(tr *model.Transit) { tr.Lines[0].Headway = -1 }, "headway"},
		{"bad first", func(tr *model.Transit) { tr.Lines[0].First = "6am" }, "first"},
		{"first past midnight", func(tr *model.Transit) { tr.Lines[0].First = "24:30"; tr.Lines[0].Last = "25:00" }, "before 24:00"},
		{"last before first", func(tr *model.Transit) { tr.Lines[0].First = "10:00"; tr.Lines[0].Last = "09:00" }, "after the first"},
		{"service over a day", func(tr *model.Transit) { tr.Lines[0].First = "06:00"; tr.Lines[0].Last = "30:00" }, "within a day"},
		{"duplicate line", func(tr *model.Transit) { tr.Lines = append(tr.Lines, good()) }, "duplicated"},
		{"duplicate stop", func(tr *model.Transit) { tr.Stops = append(tr.Stops, tr.Stops[0]) }, "duplicated"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tr := model.Transit{Stops: stops("a", "b"), Lines: []model.TransitLine{good()}}
			tt.mutate(&tr)
			_, err := Build(tr, nil)
			if !errors.Is(err, ErrInvalidNetwork) || !strings.Contains(err.Error(), tt.want) {
				t.Errorf("err = %v, want ErrInvalidNetwork containing %q", err, tt.want)
			}
		})
	}
}

func TestNextDeparture(t *testing.T) {
	n := testNetwork(t)
	fast, _ := n.Line("fast")
	night, _ := n.Line("night")
	tests := []struct {
		name             string
		l                *Line
		dir, stop        int
		t                float64
		wantDep, wantPas float64
	}{
		{"on the dot", fast, 1, 0, 360, 360, 360},
		{"just missed", fast, 1, 0, 360.5, 370, 370},
		{"mid stop forward", fast, 1, 1, 366, 370, 375},
		{"mid stop backward", fast, -1, 1, 366, 370, 375},
		{"backward end", fast, -1, 0, 361, 360, 370},
		{"before service", fast, 1, 0, 100, 360, 360},
		{"after last, next day", fast, 1, 0, 481, day + 360, day + 360},
		{"later day", fast, 1, 2, 5*day + 400, 5*day + 390, 5*day + 400},
		{"night past midnight", night, 1, 0, 2*day + 10, 2*day + 60, 2*day + 60},
		{"night after last", night, 1, 0, 2*day + 61, 2*day + 23*60, 2*day + 23*60},
		{"negative time", fast, 1, 0, -day + 365, -day + 370, -day + 370},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dep, pass := tt.l.NextDeparture(tt.dir, tt.stop, tt.t)
			if !near(dep, tt.wantDep) || !near(pass, tt.wantPas) {
				t.Errorf("NextDeparture = %v, %v; want %v, %v", dep, pass, tt.wantDep, tt.wantPas)
			}
		})
	}
}

func TestVehicleAt(t *testing.T) {
	n := testNetwork(t)
	type v struct {
		dir      int
		depart   float64
		x, y, dx float64
		progress float64
	}
	tests := []struct {
		name string
		line string
		t    float64
		want []v
	}{
		{"before service", "fast", 300, nil},
		{"first trips", "fast", 363, []v{{1, 360, 180, 0, 1, 0.3}, {-1, 360, 420, 0, -1, 0.3}}},
		{"trip hand-over", "fast", 370, []v{{1, 370, 0, 0, 1, 0}, {-1, 370, 600, 0, -1, 0}}},
		{"last trips", "fast", 485, []v{{1, 480, 300, 0, 1, 0.5}, {-1, 480, 300, 0, -1, 0.5}}},
		{"after service", "fast", 495, nil},
		{"next day", "fast", 3*day + 365, []v{{1, 3*day + 360, 300, 0, 1, 0.5}, {-1, 3*day + 360, 300, 0, -1, 0.5}}},
		// Night trips leave 23:00, 24:00 and 25:00 and run 90 min.
		{"night at 00:30", "night", 3*day + 30, []v{{1, 3 * day, 300, 1000, 1, 1.0 / 3}, {-1, 3 * day, 600, 1000, -1, 1.0 / 3}}},
		{"night two trips", "night", 3*day + 80, []v{
			{1, 3 * day, 800, 1000, 1, 80.0 / 90}, {1, 3*day + 60, 200, 1000, 1, 20.0 / 90},
			{-1, 3 * day, 100, 1000, -1, 80.0 / 90}, {-1, 3*day + 60, 700, 1000, -1, 20.0 / 90},
		}},
		{"night done", "night", 3*day + 150, nil},
		{"night on day 0", "night", 30, []v{{1, 0, 300, 1000, 1, 1.0 / 3}, {-1, 0, 600, 1000, -1, 1.0 / 3}}},
		{"night evening", "night", 23*60 + 45, []v{{1, 23 * 60, 450, 1000, 1, 0.5}, {-1, 23 * 60, 450, 1000, -1, 0.5}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := n.VehicleAt(tt.line, tt.t)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("got %d vehicles %+v, want %d", len(got), got, len(tt.want))
			}
			for i, w := range tt.want {
				g := got[i]
				if g.Line != tt.line || g.Direction != w.dir || !near(g.Depart, w.depart) || !near(g.X, w.x) || !near(g.Y, w.y) || !near(g.DX, w.dx) || !near(g.Progress, w.progress) {
					t.Errorf("vehicle %d = %+v, want %+v", i, g, w)
				}
			}
		})
	}
	if _, err := n.VehicleAt("nope", 0); !errors.Is(err, ErrUnknownLine) {
		t.Errorf("unknown line: err = %v", err)
	}
}

func TestVehicleAtMatchesNextDeparture(t *testing.T) {
	// A vehicle shown at a stop is the one the planner would board there.
	n := testNetwork(t)
	fast, _ := n.Line("fast")
	for _, dir := range []int{1, -1} {
		dep, pass := fast.NextDeparture(dir, 1, 401)
		vs, _ := n.VehicleAt("fast", pass)
		found := false
		for _, v := range vs {
			if v.Direction == dir && near(v.Depart, dep) && near(v.X, 300) {
				found = true
			}
		}
		if !found {
			t.Errorf("dir %d: no vehicle at b at %v: %+v", dir, pass, vs)
		}
	}
}

func TestVehicles(t *testing.T) {
	n := testNetwork(t)
	all, err := n.Vehicles(model.TransitVehiclesPayload{Time: 363})
	if err != nil {
		t.Fatal(err)
	}
	// fast ×2, cross ×2, boat ×2 at 06:03; night is not running.
	if len(all.Vehicles) != 6 || all.Vehicles[0].Line != "fast" || all.Vehicles[4].Line != "boat" {
		t.Errorf("all vehicles = %+v", all.Vehicles)
	}
	some, _ := n.Vehicles(model.TransitVehiclesPayload{Lines: []string{"cross"}, Time: 363})
	if len(some.Vehicles) != 2 || some.Vehicles[0].Line != "cross" {
		t.Errorf("cross vehicles = %+v", some.Vehicles)
	}
	if _, err := n.Vehicles(model.TransitVehiclesPayload{Lines: []string{"nope"}}); !errors.Is(err, ErrUnknownLine) {
		t.Errorf("unknown line: %v", err)
	}
	none, _ := n.Vehicles(model.TransitVehiclesPayload{Lines: []string{"fast", "cross"}, Time: 100})
	if none.Vehicles == nil || len(none.Vehicles) != 0 {
		t.Errorf("before service = %#v, want empty non-nil", none.Vehicles)
	}
}

type leg struct {
	line     string
	from, to string
	dir      int
	wait     float64
	depart   float64
	arrive   float64
	fare     int
}

func checkItinerary(t *testing.T, got model.TransitItinerary, arrive float64, fare, transfers int, legs []leg) {
	t.Helper()
	if !near(got.Arrive, arrive) || !near(got.Duration, got.Arrive-got.Depart) || got.Fare != fare || got.Transfers != transfers || len(got.Legs) != len(legs) {
		t.Fatalf("itinerary = %+v, want arrive %v fare %d transfers %d, %d legs", got, arrive, fare, transfers, len(legs))
	}
	for i, w := range legs {
		g := got.Legs[i]
		if g.Line != w.line || g.From != w.from || g.To != w.to || g.Direction != w.dir || !near(g.Wait, w.wait) ||
			!near(g.Depart, w.depart) || !near(g.Arrive, w.arrive) || !near(g.Ride, w.arrive-w.depart) || g.Fare != w.fare {
			t.Errorf("leg %d = %+v, want %+v", i, g, w)
		}
	}
}

func TestPlan(t *testing.T) {
	n := testNetwork(t)
	tests := []struct {
		name      string
		p         model.TransitPlanPayload
		arrive    float64
		fare      int
		transfers int
		legs      []leg
	}{
		{"direct", model.TransitPlanPayload{From: "a", To: "c", Time: 360}, 370, 8, 0,
			[]leg{{"fast", "a", "c", 1, 0, 360, 370, 8}}},
		{"direct with wait", model.TransitPlanPayload{From: "a", To: "c", Time: 361}, 380, 8, 0,
			[]leg{{"fast", "a", "c", 1, 9, 370, 380, 8}}},
		{"from intermediate stop", model.TransitPlanPayload{From: "b", To: "c", Time: 360}, 370, 8, 0,
			[]leg{{"fast", "b", "c", 1, 5, 365, 370, 8}}},
		{"backward", model.TransitPlanPayload{From: "b", To: "a", Time: 366}, 380, 8, 0,
			[]leg{{"fast", "b", "a", -1, 9, 375, 380, 8}}},
		{"transfer", model.TransitPlanPayload{From: "a", To: "d", Time: 360}, 390, 11, 1,
			[]leg{{"fast", "a", "c", 1, 0, 360, 370, 8}, {"cross", "c", "d", 1, 10, 380, 390, 3}}},
		{"two transfers", model.TransitPlanPayload{From: "a", To: "e", Time: 360}, 400, 26, 2,
			[]leg{{"fast", "a", "c", 1, 0, 360, 370, 8}, {"cross", "c", "d", 1, 10, 380, 390, 3}, {"boat", "d", "e", 1, 0, 390, 400, 15}}},
		{"overnight wait", model.TransitPlanPayload{From: "a", To: "c", Time: 600}, day + 370, 8, 0,
			[]leg{{"fast", "a", "c", 1, day + 360 - 600, day + 360, day + 370, 8}}},
		{"ignore timetable", model.TransitPlanPayload{From: "a", To: "d", Time: 361, IgnoreTimetable: true}, 381, 11, 1,
			[]leg{{"fast", "a", "c", 1, 0, 361, 371, 8}, {"cross", "c", "d", 1, 0, 371, 381, 3}}},
		{"same stop", model.TransitPlanPayload{From: "a", To: "a", Time: 360}, 360, 0, 0, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := n.Plan(tt.p)
			if err != nil {
				t.Fatal(err)
			}
			if got.From != tt.p.From || got.To != tt.p.To || got.Depart != tt.p.Time {
				t.Errorf("header = %+v", got)
			}
			checkItinerary(t, got, tt.arrive, tt.fare, tt.transfers, tt.legs)
		})
	}
}

func TestPlanLegPath(t *testing.T) {
	tr := model.Transit{Stops: stops("a", "b", "c"), Lines: []model.TransitLine{
		{ID: "l", Mode: "bus", Stops: []string{"a", "b", "c"}, Path: [][2]float64{{0, 0}, {100, 0}, {100, 100}, {200, 100}}, Speed: 10},
	}}
	n, err := Build(tr, map[string]model.Point{"b": {X: 100, Y: 50}})
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		from, to string
		want     [][2]float64
	}{
		{"a", "c", [][2]float64{{0, 0}, {100, 0}, {100, 100}, {200, 100}}},
		{"a", "b", [][2]float64{{0, 0}, {100, 0}, {100, 50}}},
		{"c", "b", [][2]float64{{200, 100}, {100, 100}, {100, 50}}},
		{"b", "a", [][2]float64{{100, 50}, {100, 0}, {0, 0}}},
	}
	for _, tt := range tests {
		got, err := n.Plan(model.TransitPlanPayload{From: tt.from, To: tt.to, Time: 400, IgnoreTimetable: true})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.Legs[0].Path, tt.want) {
			t.Errorf("%s→%s path = %v, want %v", tt.from, tt.to, got.Legs[0].Path, tt.want)
		}
	}
}

func TestPlanErrors(t *testing.T) {
	n := testNetwork(t)
	tests := []struct {
		name        string
		p           model.TransitPlanPayload
		want        error
		unreachable bool
	}{
		{"no service at stop", model.TransitPlanPayload{From: "a", To: "x"}, ErrUnreachable, true},
		{"disconnected", model.TransitPlanPayload{From: "a", To: "z"}, ErrUnreachable, true},
		{"locked line", model.TransitPlanPayload{From: "a", To: "d", Lines: []string{"fast", "boat", "gone"}}, ErrUnreachable, true},
		{"suspended ferry", model.TransitPlanPayload{From: "a", To: "e", ExcludeModes: []string{"ferry"}}, ErrUnreachable, true},
		{"unknown from", model.TransitPlanPayload{From: "nope", To: "a"}, ErrUnknownStop, false},
		{"unknown to", model.TransitPlanPayload{From: "a", To: "nope"}, ErrUnknownStop, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := n.Plan(tt.p)
			if !errors.Is(err, tt.want) {
				t.Fatalf("err = %v, want %v", err, tt.want)
			}
			var ue *UnreachableError
			if errors.As(err, &ue) != tt.unreachable || (tt.unreachable && (ue.From != tt.p.From || ue.To != tt.p.To)) {
				t.Errorf("UnreachableError = %v, want %v", ue, tt.unreachable)
			}
		})
	}
}

// TestPlanTies covers the tie-breaks: earliest arrival, then fare, then
// transfers, then content order. All lines run every 60 min from 06:00
// except link, which leaves q at 06:10.
func TestPlanTies(t *testing.T) {
	line := func(id string, fare int, from, to string, length float64, first string) model.TransitLine {
		return model.TransitLine{ID: id, Mode: "bus", Fare: fare, Stops: []string{from, to}, Path: [][2]float64{{0, 0}, {length, 0}}, Speed: 1, Headway: 60, First: first}
	}
	tr := model.Transit{Stops: stops("p", "q", "r"), Lines: []model.TransitLine{
		line("mid", 4, "p", "q", 5, "06:00"),      // q at 06:05
		line("dear", 20, "p", "r", 15, "06:00"),   // arrives 06:15
		line("twin_a", 5, "p", "r", 15, "06:00"),  // arrives 06:15
		line("twin_b", 5, "p", "r", 15, "06:00"),  // identical to twin_a
		line("express", 10, "p", "q", 2, "06:00"), // q at 06:02
		line("local", 1, "p", "q", 8, "06:00"),    // q at 06:08
		line("link", 1, "q", "r", 5, "06:10"),     // r at 06:15
		line("slow", 0, "p", "r", 30, "06:00"),    // free but arrives 06:30
	}}
	n, err := Build(tr, nil)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name  string
		lines []string
		want  []string
		fare  int
	}{
		{"time beats fare", []string{"dear", "slow"}, []string{"dear"}, 20},
		{"fare breaks time tie", []string{"dear", "twin_b"}, []string{"twin_b"}, 5},
		// local+link costs 2 and arrives with express+link and the twins.
		{"cheaper slower first leg makes the same connection", nil, []string{"local", "link"}, 2},
		{"fewer transfers on equal fare", []string{"mid", "link", "twin_b"}, []string{"twin_b"}, 5},
		{"transfer when cheaper", []string{"mid", "link", "dear"}, []string{"mid", "link"}, 5},
		{"content order breaks full tie", []string{"twin_b", "twin_a"}, []string{"twin_a"}, 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := n.Plan(model.TransitPlanPayload{From: "p", To: "r", Time: 360, Lines: tt.lines})
			if err != nil {
				t.Fatal(err)
			}
			var lines []string
			for _, l := range got.Legs {
				lines = append(lines, l.Line)
			}
			if !reflect.DeepEqual(lines, tt.want) || got.Fare != tt.fare {
				t.Errorf("plan = %v fare %d, want %v fare %d", lines, got.Fare, tt.want, tt.fare)
			}
		})
	}
}

func TestPlanDeterministic(t *testing.T) {
	p := model.TransitPlanPayload{From: "a", To: "e", Time: 377}
	first, err := testNetwork(t).Plan(p)
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		again, _ := testNetwork(t).Plan(p)
		if !reflect.DeepEqual(first, again) {
			t.Fatalf("plan differs: %+v vs %+v", first, again)
		}
	}
}
