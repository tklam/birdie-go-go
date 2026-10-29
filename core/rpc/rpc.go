// Package rpc dispatches core worker requests to the core packages. It has no
// dependency on syscall/js, so the whole protocol can be tested natively.
package rpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"birdiegogo/core/lesson"
	"birdiegogo/core/model"
)

// MaxLessons is how many ungraded lessons a Server remembers; generating
// another forgets the oldest.
const MaxLessons = 16

// Server handles requests for one core worker. It keeps the answer keys of
// generated lessons until they are graded, so the client never sees them
// early (SPEC.md §6.3). A Server is not safe for concurrent use; the worker
// handles one request at a time.
type Server struct {
	nextLesson int
	// lessons maps lesson ID to answer key; order lists the IDs oldest
	// first.
	lessons map[string][]model.Mistake
	order   []string
}

// NewServer returns a Server with no lessons.
func NewServer() *Server {
	return &Server{lessons: make(map[string][]model.Mistake)}
}

// Handle decodes a JSON-encoded model.Request, runs it and returns the
// JSON-encoded model.Response. It never panics on bad input; errors are
// reported in the response.
func (s *Server) Handle(raw []byte) []byte {
	var req model.Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return encode(model.Response{ID: req.ID, Error: fmt.Sprintf("decode request: %v", err)})
	}
	result, err := s.dispatch(req)
	if err != nil {
		return encode(model.Response{ID: req.ID, Error: err.Error()})
	}
	return encode(model.Response{ID: req.ID, OK: true, Result: result})
}

func (s *Server) dispatch(req model.Request) (any, error) {
	switch req.Op {
	case "ping":
		var p model.PingPayload
		if err := decodePayload(req.Payload, &p); err != nil {
			return nil, err
		}
		return model.PingResult{Echo: p.Echo, CoreVersion: model.CoreVersion}, nil
	case "lesson.generate":
		var p model.LessonGeneratePayload
		if err := decodePayload(req.Payload, &p); err != nil {
			return nil, err
		}
		return s.generateLesson(p)
	case "lesson.grade":
		var p model.LessonGradePayload
		if err := decodePayload(req.Payload, &p); err != nil {
			return nil, err
		}
		return s.gradeLesson(p)
	default:
		return nil, fmt.Errorf("unknown op %q", req.Op)
	}
}

// generateLesson creates a performance and stores its answer key.
func (s *Server) generateLesson(p model.LessonGeneratePayload) (model.LessonGenerateResult, error) {
	perf, key, err := lesson.Generate(p)
	if err != nil {
		return model.LessonGenerateResult{}, fmt.Errorf("lesson.generate: %w", err)
	}
	s.nextLesson++
	id := "lesson-" + strconv.Itoa(s.nextLesson)
	if len(s.order) == MaxLessons {
		delete(s.lessons, s.order[0])
		s.order = s.order[1:]
	}
	s.lessons[id] = key
	s.order = append(s.order, id)
	return model.LessonGenerateResult{LessonID: id, Performance: perf}, nil
}

// errUnknownLesson is returned for lesson IDs that were never generated,
// were already graded or were forgotten.
var errUnknownLesson = errors.New("unknown lesson")

// gradeLesson grades the flags against a stored answer key and forgets the
// lesson.
func (s *Server) gradeLesson(p model.LessonGradePayload) (model.LessonGradeResult, error) {
	key, ok := s.lessons[p.LessonID]
	if !ok {
		return model.LessonGradeResult{}, fmt.Errorf("lesson.grade: %w %q", errUnknownLesson, p.LessonID)
	}
	delete(s.lessons, p.LessonID)
	for i, id := range s.order {
		if id == p.LessonID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	return lesson.Grade(key, p.FlagsMs, p.LatencyOffsetMs), nil
}

func decodePayload(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return nil
}

func encode(resp model.Response) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		// Only reachable if a result type can't be marshalled, which is a bug.
		out, _ = json.Marshal(model.Response{ID: resp.ID, Error: fmt.Sprintf("encode response: %v", err)})
	}
	return out
}
