import Phaser from 'phaser';
import type { ContentBundle, WorldIndex } from '../core/types.gen';
import { queueManifest, type Manifest } from '../systems/assets';
import { loadPixelFont } from '../ui/text';

/**
 * Loads the manifest, then every asset it lists, plus the content bundle and
 * world index. Continues to the title screen.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const base = import.meta.env.BASE_URL;
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 60, height / 2, 0, 4, 0xf0f0f0).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 122, 8).setStrokeStyle(1, 0xf0f0f0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => (bar.width = 120 * p));

    this.load.json('manifest', `${base}assets/manifest.json`);
    this.load.json('content', `${base}content/base.json`);
    this.load.json('world', `${base}world/index.json`);
    this.load.once('filecomplete-json-manifest', (_key: string, _type: string, manifest: Manifest) => {
      queueManifest(this.load, manifest);
    });
  }

  create(): void {
    this.registry.set('manifest', this.cache.json.get('manifest') as Manifest);
    this.registry.set('content', this.cache.json.get('content') as ContentBundle);
    this.registry.set('world', this.cache.json.get('world') as WorldIndex);
    void loadPixelFont().then(() => this.scene.start('Title'));
  }
}
