// Small 16×16 pictures for mini games, drawn at runtime from the master
// palette ("prop:<name>" icons; the names match core/content Props).
import type Phaser from 'phaser';

type Draw = (g: Phaser.GameObjects.Graphics) => void;

const PROPS: Record<string, Draw> = {
  bun: (g) => g.fillStyle(0xe8c070).fillEllipse(8, 9, 14, 11).fillStyle(0xf0d898).fillEllipse(8, 7, 10, 6).fillStyle(0xc83c3c).fillRect(7, 6, 2, 2),
  fish: (g) => g.fillStyle(0x8cc8f0).fillEllipse(7, 8, 12, 7).fillTriangle(12, 8, 15, 4, 15, 12).fillStyle(0x101018).fillRect(4, 7, 1, 1),
  shrimp: (g) => g.fillStyle(0xe88a6c).fillEllipse(8, 9, 12, 6).fillStyle(0xf0b090).fillRect(3, 6, 2, 2).fillRect(12, 10, 3, 1),
  crab: (g) => g.fillStyle(0xc83c3c).fillEllipse(8, 9, 12, 8).fillRect(1, 5, 3, 3).fillRect(12, 5, 3, 3).fillStyle(0x101018).fillRect(6, 7, 1, 1).fillRect(9, 7, 1, 1),
  shell: (g) => g.fillStyle(0xf0e0c8).fillTriangle(8, 2, 2, 13, 14, 13).fillStyle(0xd8b890).fillRect(5, 8, 1, 5).fillRect(8, 5, 1, 8).fillRect(11, 8, 1, 5),
  leaf: (g) => g.fillStyle(0x58a048).fillEllipse(8, 8, 8, 13).fillStyle(0x2f6f3f).fillRect(8, 3, 1, 11),
  flower: (g) => g.fillStyle(0xf0a0c0).fillCircle(5, 6, 3).fillCircle(11, 6, 3).fillCircle(5, 11, 3).fillCircle(11, 11, 3).fillStyle(0xf0d050).fillCircle(8, 8, 2),
  mooncake: (g) => g.fillStyle(0xb8742c).fillCircle(8, 8, 7).fillStyle(0xd89848).fillCircle(8, 8, 5).fillStyle(0xb8742c).fillRect(6, 6, 4, 4),
  can: (g) => g.fillStyle(0xc83c3c).fillRect(5, 3, 6, 11).fillStyle(0xe0e4f0).fillRect(5, 3, 6, 2).fillRect(5, 8, 6, 1),
  bottle: (g) => g.fillStyle(0x8cc8f0).fillRect(6, 5, 5, 10).fillRect(7, 2, 3, 3).fillStyle(0x3f7fdf).fillRect(6, 9, 5, 2),
  bag: (g) => g.fillStyle(0xe0e4f0).fillRect(3, 5, 10, 9).fillStyle(0x8a94c0).fillRect(5, 2, 1, 4).fillRect(10, 2, 1, 4),
  lantern: (g) => g.fillStyle(0xc83c3c).fillEllipse(8, 9, 10, 10).fillStyle(0xf0d050).fillRect(6, 3, 4, 2).fillRect(6, 14, 4, 1).fillRect(7, 6, 2, 6),
  tram: (g) => g.fillStyle(0x2f6f3f).fillRect(2, 3, 12, 11).fillStyle(0xf0e0c8).fillRect(2, 8, 12, 1).fillStyle(0x8cc8f0).fillRect(4, 5, 3, 2).fillRect(9, 5, 3, 2).fillRect(4, 10, 3, 2).fillRect(9, 10, 3, 2),
  junk: (g) => g.fillStyle(0x8a5a2c).fillRect(2, 11, 12, 3).fillStyle(0xc83c3c).fillTriangle(5, 2, 5, 10, 12, 10).fillStyle(0x101018).fillRect(5, 2, 1, 9),
};

/** Makes the texture for a prop once and returns its key ("prop_<name>"). */
export function ensureProp(scene: Phaser.Scene, name: string): string {
  const key = `prop_${name in PROPS ? name : 'leaf'}`;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({}, false);
    (PROPS[name] ?? PROPS.leaf)(g);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }
  return key;
}

/** The prop names (kept in step with core/content Props). */
export const PROP_NAMES = Object.keys(PROPS);
