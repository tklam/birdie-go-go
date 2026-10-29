import Phaser from 'phaser';
import type { CoreClient } from '../core/client';
import type { ContentBundle, WorldIndex } from '../core/types.gen';
import { loadJSON } from '../systems/data';

const TEXT = { fontFamily: 'monospace', fontSize: '8px', color: '#c8d0e0' };

/**
 * Title screen. During M0 it also reports whether each part of the pipeline
 * (Go core, content bundle, world index) loaded, and records the result on
 * <body data-boot> for automated checks.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, 48, 'BIRDIE GO GO', { ...TEXT, fontSize: '16px', color: '#ffe680' })
      .setOrigin(0.5);

    const status = this.add.text(width / 2, 96, 'Starting…', TEXT).setOrigin(0.5, 0).setAlign('center');
    const prompt = this.add.text(width / 2, height - 28, 'Tap to start', TEXT).setOrigin(0.5).setVisible(false);
    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });

    void this.checkPipeline().then((lines) => {
      status.setText(lines.join('\n'));
      prompt.setVisible(true);
      this.input.once('pointerdown', () => prompt.setText('Tseung Kwan O is coming soon'));
    });
  }

  private async checkPipeline(): Promise<string[]> {
    const core = this.registry.get('core') as CoreClient;
    const checks: [string, Promise<string>][] = [
      ['Core', core.ping('chirp').then((r) => `v${r.coreVersion}`)],
      ['Content', loadJSON<ContentBundle>('content/base.json').then((b) => `v${b.game.contentVersion}`)],
      [
        'World',
        loadJSON<WorldIndex>('world/index.json').then(
          (w) => `${w.widthChunks}×${w.heightChunks} chunks, ${w.regions.length} regions`,
        ),
      ],
    ];
    const results = await Promise.allSettled(checks.map(([, p]) => p));
    const ok = results.every((r) => r.status === 'fulfilled');
    document.body.dataset.boot = ok ? 'ok' : 'error';
    return results.map((r, i) => {
      const name = checks[i][0];
      return r.status === 'fulfilled' ? `${name}: ${r.value}` : `${name}: FAILED (${String(r.reason)})`;
    });
  }
}
