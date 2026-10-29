import Phaser from 'phaser';
import type { Session } from '../systems/session';
import { reducedMotion } from '../fx/motion';
import { TEXT } from '../ui/text';

const W = 320;
const H = 180;

export interface WeddingSceneData {
  /** The dialogue played over the scene. */
  dialogue: string;
  /** Called when the scene has finished (it stops itself). */
  done: () => void;
}

/**
 * The wedding (SPEC.md §8): the waterfront park at golden hour, friends and
 * students gathered, Angie and Kei in the middle with O Boy; the dialogue
 * plays over it, then petals and "Just married!".
 */
export class WeddingScene extends Phaser.Scene {
  constructor() {
    super('Wedding');
  }

  create(data: WeddingSceneData): void {
    const session = this.registry.get('session') as Session;
    const has = (k: string) => this.textures.exists(k);
    for (const layer of ['bg_waterfront_far', 'bg_waterfront_mid', 'bg_waterfront_near']) {
      if (has(layer)) this.add.image(0, 0, layer).setOrigin(0, 0);
    }
    // Golden-hour light.
    this.add.rectangle(0, 0, W, H, 0xf0b060, 0.18).setOrigin(0, 0);
    const guests = ['char_neighbour', 'char_mei', 'char_mrs_ho', 'char_fai', 'char_old_villager', 'char_birder'].filter(has);
    guests.forEach((key, i) => {
      const left = i % 2 === 0;
      const x = left ? 70 - Math.floor(i / 2) * 22 : 250 + Math.floor(i / 2) * 22;
      this.add.sprite(x, 150, key, 0).setOrigin(0.5, 1).setScale(2);
    });
    if (has('char_angie')) this.add.sprite(144, 152, 'char_angie', 0).setOrigin(0.5, 1).setScale(2);
    if (has('char_kei')) this.add.sprite(176, 152, 'char_kei', 0).setOrigin(0.5, 1).setScale(2);
    if (has('char_oboy') && session.state.joined.includes('oboy')) this.add.sprite(160, 92, 'char_oboy', 0).setScale(2);
    // An arch of flowers over the couple.
    const g = this.add.graphics();
    for (let a = 0; a <= 12; a++) {
      const t = (a / 12) * Math.PI;
      g.fillStyle(a % 2 ? 0xf0a0c0 : 0xffffff).fillCircle(160 - Math.cos(t) * 40, 112 - Math.sin(t) * 40, 4);
    }
    this.cameras.main.fadeIn(600, 0, 0, 0);

    void (async () => {
      await new Promise((r) => this.time.delayedCall(700, r));
      await session.dialogue(data.dialogue);
      if (!reducedMotion(this)) {
        const key = 'petal';
        if (!this.textures.exists(key)) {
          const p = this.make.graphics({}, false);
          p.fillStyle(0xf0a0c0).fillRect(0, 0, 2, 2);
          p.generateTexture(key, 2, 2);
          p.destroy();
        }
        this.add.particles(0, 0, key, {
          x: { min: 0, max: W },
          y: -4,
          speedY: { min: 20, max: 45 },
          speedX: { min: -15, max: 15 },
          lifespan: 6000,
          frequency: 40,
        });
      }
      this.add
        .text(W / 2, 30, 'Just married!', { ...TEXT, fontSize: '16px', color: '#ffe680' })
        .setOrigin(0.5)
        .setShadow(1, 1, '#101018', 0);
      await new Promise((r) => this.time.delayedCall(3500, r));
      this.cameras.main.fadeOut(600, 0, 0, 0);
      await new Promise((r) => this.time.delayedCall(700, r));
      data.done();
      this.scene.stop();
    })();
  }
}
