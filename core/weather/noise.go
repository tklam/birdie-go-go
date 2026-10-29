package weather

import (
	"math"
	"math/rand/v2"
)

// Stream constants keep the random processes independent. Each is mixed with
// the world seed into the PCG state, and the time index into the increment.
const (
	streamWet      = 0x77e7_0001
	streamTemp     = 0x7e3b_0002
	streamFog      = 0xf06_0003
	streamWind     = 0x3171_0004
	streamDir      = 0xd1e_0005
	streamLocal    = 0x10ca_0006
	streamLocalDir = 0x10cd_0007
	streamTyphoon  = 0x7f00_0008
	streamForecast = 0xf0ca_0009
)

// sampler draws reproducible random numbers indexed by (stream, n). It owns
// one PCG source that it re-seeds for every draw, so no draw depends on the
// order of the others, and it memoizes the smoothed processes for one Day
// call. It never touches global rand state.
type sampler struct {
	seed uint64
	pcg  *rand.PCG
	r    *rand.Rand
	memo map[procKey]float64
}

type procKey struct {
	stream uint64
	n      int64
}

func newSampler(seed uint32) *sampler {
	pcg := rand.NewPCG(0, 0)
	return &sampler{
		seed: mix(uint64(seed) + 0x9e3779b97f4a7c15),
		pcg:  pcg,
		r:    rand.New(pcg),
		memo: make(map[procKey]float64),
	}
}

// at re-seeds the source for (stream, n) and returns the generator, ready to
// produce that index's sequence of draws.
func (s *sampler) at(stream uint64, n int64) *rand.Rand {
	s.pcg.Seed(mix(s.seed^mix(stream)), mix(uint64(n)^(stream<<20)))
	return s.r
}

// normal is a standard normal draw for (stream, n).
func (s *sampler) normal(stream uint64, n int64) float64 {
	return s.at(stream, n).NormFloat64()
}

// process is a stationary AR(1)-like process with unit variance at integer
// time n: a truncated exponentially weighted sum of `taps` normal draws,
// Σ φ^k ε(n−k), normalized. Truncation makes every n computable on its own.
func (s *sampler) process(stream uint64, n int64, taps int, phi float64) float64 {
	k := procKey{stream, n}
	if v, ok := s.memo[k]; ok {
		return v
	}
	var sum, norm, w float64 = 0, 0, 1
	for i := range taps {
		sum += w * s.normal(stream, n-int64(i))
		norm += w * w
		w *= phi
	}
	v := sum / math.Sqrt(norm)
	s.memo[k] = v
	return v
}

// processAt samples a process at a real time by linear interpolation.
func (s *sampler) processAt(stream uint64, tau float64, taps int, phi float64) float64 {
	n0 := math.Floor(tau)
	f := tau - n0
	a := s.process(stream, int64(n0), taps, phi)
	if f == 0 {
		return a
	}
	b := s.process(stream, int64(n0)+1, taps, phi)
	return a*(1-f) + b*f
}

// mix is the SplitMix64 finalizer.
func mix(x uint64) uint64 {
	x ^= x >> 30
	x *= 0xbf58476d1ce4e5b9
	x ^= x >> 27
	x *= 0x94d049bb133111eb
	x ^= x >> 31
	return x
}

// hashString is 64-bit FNV-1a, used to give each area its own streams.
func hashString(s string) uint64 {
	h := uint64(14695981039346656037)
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}
