import type { AudioEngine } from '../audio/AudioEngine';
import Phaser from 'phaser';
import type { ContentBundle, WorldIndex } from '../core/types.gen';
import { audioSamples, queueManifest, type Manifest } from '../systems/assets';
import { loadPixelFont } from '../ui/text';
import { showSplash } from '../ui/splash';

/**
 * Loads the manifest, then every asset it lists, plus the content bundle and
 * world index. Shows the splash poster over the title screen, which starts
 * loading underneath.
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
    const manifest = this.cache.json.get('manifest') as Manifest;
    this.registry.set('manifest', manifest);
    const poster = manifest.splash_poster;
    if (poster?.file) void showSplash(`${import.meta.env.BASE_URL}assets/${poster.file}`, 'Angie, O Boy and Kei in Birdie Go Go');
    (this.registry.get('audio') as AudioEngine | undefined)?.registerSamples(audioSamples(manifest));
    this.registry.set('content', this.cache.json.get('content') as ContentBundle);
    this.registry.set('world', this.cache.json.get('world') as WorldIndex);
    void loadPixelFont().then(() => this.scene.start('Title'));
  }
}
