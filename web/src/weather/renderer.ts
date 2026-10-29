import Phaser from 'phaser';
import type { WeatherParams } from '../core/types.gen';
import type { TimeSlot } from '../systems/state';
import { DEPTH } from '../world/ChunkRenderer';

const W = 320;
const H = 180;

/**
 * Draws the current (blended, eased) weather over the map in 16-bit style:
 * a cloud/evening tint, a dithered fog layer and slanted rain (SPEC.md §4.9).
 * Everything is fixed to the camera.
 */
export class WeatherRenderer {
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly fog: Phaser.GameObjects.TileSprite;
  private readonly rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private fogDrift = 0;
  private slant = 0;

  constructor(scene: Phaser.Scene, depth: number = DEPTH.overhead + 10) {
    makeTextures(scene);
    this.tint = scene.add.rectangle(0, 0, W, H, 0x101030, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    this.fog = scene.add.tileSprite(0, 0, W, H, 'weather-fog').setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 1).setAlpha(0);
    this.rain = scene.add
      .particles(0, 0, 'weather-drop', {
        x: { min: -40, max: W + 40 },
        y: -8,
        lifespan: 900,
        speedY: { min: 260, max: 320 },
        speedX: 0,
        frequency: -1,
        quantity: 1,
      })
      .setScrollFactor(0)
      .setDepth(depth + 2);
  }

  update(p: WeatherParams, slot: TimeSlot, dtMs: number): void {
    // Darker under heavy cloud and rain, and in the evening.
    const dusk = slot === 'evening' ? 0.28 : 0;
    this.tint.setFillStyle(slot === 'evening' ? 0x1b2050 : 0x202838, Math.min(0.55, p.cloud * 0.18 + p.precip * 0.18 + dusk));

    // Fog drifts with the wind.
    this.fogDrift += (Math.cos(p.windDir) * (0.2 + p.wind) * dtMs) / 120;
    this.fog.tilePositionX = Math.round(this.fogDrift);
    this.fog.setAlpha(Math.min(0.75, p.fog * 0.85));

    // Rain: more drops with more precipitation, slanted by the wind.
    const drops = p.precip < 0.12 ? 0 : Math.round((p.precip - 0.1) * 26);
    const slant = Math.round(Math.cos(p.windDir) * p.wind * 160);
    if (Math.abs(slant - this.slant) >= 8) {
      this.slant = slant;
      this.rain.updateConfig({ speedX: { min: slant - 10, max: slant + 10 } });
    }
    if (drops > 0) this.rain.emitParticle(Math.max(1, Math.round((drops * dtMs) / 16)));
  }

  destroy(): void {
    this.tint.destroy();
    this.fog.destroy();
    this.rain.destroy();
  }
}

/** Generates the small pixel textures once per game. */
function makeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('weather-drop')) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xc8e8f8, 0.9).fillRect(0, 0, 1, 3).fillStyle(0x8cc8f0, 0.7).fillRect(0, 3, 1, 2);
    g.generateTexture('weather-drop', 1, 5);
    g.destroy();
  }
  if (!scene.textures.exists('weather-fog')) {
    // A 16×16 ordered-dither tile of pale pixels: a classic 16-bit fog.
    const g = scene.make.graphics({}, false);
    const bayer = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // Soft blobs: density varies across the tile.
        const density = 6 + 5 * Math.sin((x / 16) * Math.PI * 2) * Math.cos((y / 16) * Math.PI * 2);
        if (bayer[y % 4][x % 4] < density) g.fillStyle(0xe8eef4, 1).fillRect(x, y, 1, 1);
      }
    }
    g.generateTexture('weather-fog', 16, 16);
    g.destroy();
  }
}
