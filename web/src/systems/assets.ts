import type Phaser from 'phaser';

/** One entry of web/public/assets/manifest.json (tools/assetgen). */
export interface ManifestEntry {
  /** `illustration`: full-resolution art for the HTML overlay (the splash), exempt from the 16-bit rules. */
  type: 'image' | 'spritesheet' | 'background' | 'audio' | 'illustration';
  file?: string;
  frameWidth?: number;
  frameHeight?: number;
  frames?: string[];
  layers?: string[];
  perches?: [number, number][];
  ground?: [number, number];
  groundX?: [number, number];
  placeholder?: boolean;
}

export type Manifest = Record<string, ManifestEntry>;

/** Queues every image and spritesheet of the manifest on a Phaser loader. */
export function queueManifest(load: Phaser.Loader.LoaderPlugin, manifest: Manifest): void {
  const base = `${import.meta.env.BASE_URL}assets/`;
  for (const [id, e] of Object.entries(manifest)) {
    if (!e.file) continue;
    if (e.type === 'spritesheet') {
      load.spritesheet(id, base + e.file, { frameWidth: e.frameWidth ?? 16, frameHeight: e.frameHeight ?? 16 });
    } else if (e.type === 'image') {
      load.image(id, base + e.file);
    }
  }
}

/** Index of a named frame in a spritesheet entry (0 if unknown). */
export function frameIndex(entry: ManifestEntry | undefined, name: string): number {
  const i = entry?.frames?.indexOf(name) ?? -1;
  return i < 0 ? 0 : i;
}

/** URLs of the manifest's audio samples by id, for AudioEngine.registerSamples. */
export function audioSamples(manifest: Manifest): Record<string, string> {
  const base = `${import.meta.env.BASE_URL}assets/`;
  const out: Record<string, string> = {};
  for (const [id, e] of Object.entries(manifest)) if (e.type === 'audio' && e.file) out[id] = base + e.file;
  return out;
}

/**
 * A dialogue portrait for a speaker id: the front-facing idle frame of its
 * 16×24 character sheet (char_<id>), or null when there is none.
 */
export function portraitUrl(manifest: Manifest | undefined, speaker: string): string | null {
  const e = manifest?.[`char_${speaker}`];
  if (!e || e.frameWidth !== 16 || e.frameHeight !== 24) return null;
  return `${import.meta.env.BASE_URL}assets/${e.file}`;
}
