import { describe, expect, it } from 'vitest';
import { shuffle } from './common';
import { answer, quizOver, startQuiz } from './quiz';

describe('quiz', () => {
  it('scores answers in order', () => {
    const qs = [
      { question: 'a?', answers: ['x', 'y'], correct: 1 },
      { question: 'b?', answers: ['x', 'y'], correct: 0 },
    ];
    const s = startQuiz();
    expect(answer(s, qs, 1)).toBe(true);
    expect(quizOver(s, qs)).toBe(false);
    expect(answer(s, qs, 1)).toBe(false);
    expect(quizOver(s, qs)).toBe(true);
    expect(s.right).toBe(1);
  });
});

describe('shuffle', () => {
  it('keeps every item', () => {
    let x = 1;
    const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    expect(shuffle([1, 2, 3, 4, 5], r).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
