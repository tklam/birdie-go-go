// The quiz mini game's rules (pure): questions in order, a running score.
import type { QuizQuestion } from '../core/types.gen';

export interface QuizState {
  index: number;
  right: number;
}

export function startQuiz(): QuizState {
  return { index: 0, right: 0 };
}

/** Answers the current question; returns whether it was right. Mutates state. */
export function answer(state: QuizState, questions: readonly QuizQuestion[], choice: number): boolean {
  const q = questions[state.index];
  const ok = !!q && choice === q.correct;
  if (ok) state.right++;
  state.index++;
  return ok;
}

export function quizOver(state: QuizState, questions: readonly QuizQuestion[]): boolean {
  return state.index >= questions.length;
}
