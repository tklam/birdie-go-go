import Phaser from 'phaser';
import type { WeatherParams } from '../core/types.gen';
import type { TimeSlot } from '../systems/state';
import { DEPTH } from '../world/ChunkRenderer';

const W = 320;
const H = 180;

/**
 * Draws the current (blended, eased) weather over the map in 16-bit style:
 * a cloud/evening tint, a smooth still haze for fog and slanted rain (SPEC.md §4.9).
 * Fog is deliberately plain: a moving dither pattern over the tiles was
 * uncomfortable to look at.
 * Everything is fixed to the camera.
 */
export class WeatherRenderer {
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly fog: Phaser.GameObjects.Rectangle;
  private readonly rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private slant = 0;
  private calm = false;
  private pending = 0;

  constructor(scene: Phaser.Scene, depth: number = DEPTH.overhead + 10) {
    makeTextures(scene);
    this.tint = scene.add.rectangle(0, 0, W, H, 0x101030, 0).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    this.fog = scene.add.rectangle(0, 0, W, H, 0xe8eef4, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(depth + 1).setAlpha(0);
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

  /**
   * `reduced` (Settings → Reduced motion) draws a third of the drops, falling
   * at half speed and straight down.
   */
  update(p: WeatherParams, slot: TimeSlot, dtMs: number, reduced = false): void {
    // Darker under heavy cloud and rain, and in the evening.
    const dusk = slot === 'evening' ? 0.28 : 0;
    this.tint.setFillStyle(slot === 'evening' ? 0x1b2050 : 0x202838, Math.min(0.55, p.cloud * 0.18 + p.precip * 0.18 + dusk));

    // Fog: a still, even haze, only once it's noticeable (fog > 0.3).
    this.fog.setAlpha(fogAlpha(p.fog));

    // Rain: more drops with more precipitation, slanted by the wind.
    const drops = p.precip < 0.12 ? 0 : ((p.precip - 0.1) * 26) / (reduced ? 3 : 1);
    const slant = reduced ? 0 : Math.round(Math.cos(p.windDir) * p.wind * 160);
    if (reduced !== this.calm) {
      this.calm = reduced;
      this.rain.updateConfig({ lifespan: reduced ? 1800 : 900, speedY: reduced ? { min: 130, max: 160 } : { min: 260, max: 320 } });
      this.slant = Number.NaN;
    }
    if (!(Math.abs(slant - this.slant) < 8)) {
      this.slant = slant;
      this.rain.updateConfig({ speedX: { min: slant - 10, max: slant + 10 } });
    }
    // Fractional drops carry over so light rain still shows at high frame rates.
    this.pending += (drops * dtMs) / 16;
    const n = Math.floor(this.pending);
    this.pending -= n;
    if (n > 0) this.rain.emitParticle(n);
  }

  destroy(): void {
    this.tint.destroy();
    this.fog.destroy();
    this.rain.destroy();
  }
}

/** How opaque the fog haze is for a fog level: none below 0.3, rising to 0.45. */
export function fogAlpha(fog: number): number {
  return Math.max(0, Math.min(0.45, (fog - 0.3) * 0.65));
}

/** Generates the small pixel textures once per game. */
function makeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('weather-drop')) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xc8e8f8, 0.9).fillRect(0, 0, 1, 3).fillStyle(0x8cc8f0, 0.7).fillRect(0, 3, 1, 2);
    g.generateTexture('weather-drop', 1, 5);
    g.destroy();
  }
}
