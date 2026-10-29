import { describe, expect, it } from 'vitest';
import { portraitUrl, type Manifest } from './assets';

describe('portraitUrl', () => {
  const manifest = {
    char_mei: { type: 'spritesheet', file: 'chars/mei.png', frameWidth: 16, frameHeight: 24 },
    char_oboy: { type: 'spritesheet', file: 'chars/oboy.png', frameWidth: 8, frameHeight: 8 },
  } as unknown as Manifest;
  it('uses 16×24 character sheets only', () => {
    expect(portraitUrl(manifest, 'mei')).toMatch(/assets\/chars\/mei\.png$/);
    expect(portraitUrl(manifest, 'oboy')).toBeNull();
    expect(portraitUrl(manifest, 'magazine_editor')).toBeNull();
    expect(portraitUrl(undefined, 'mei')).toBeNull();
  });
});
