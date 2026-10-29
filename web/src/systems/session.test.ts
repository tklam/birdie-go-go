import { describe, expect, it } from 'vitest';
import { speakerName } from './session';

describe('speakerName', () => {
  const content = { students: [{ id: 'mei', name: 'Mei', level: 1, home: '', repertoire: [], tendencies: {}, fee: 0 }] };
  it('uses fixed names, then students, then the id', () => {
    expect(speakerName('oboy', content)).toBe('O Boy');
    expect(speakerName('mei', content)).toBe('Mei');
    expect(speakerName('magazine_editor', content)).toBe('Magazine Editor');
  });
});
