import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Rebuilds the Go core, content bundle or world index when their sources
// change during `make dev`, then reloads the page. The most specific
// directory is listed first.
function goRebuild(): Plugin {
  const targets = [
    { dir: path.join(repoRoot, 'content', 'world'), make: 'world' },
    { dir: path.join(repoRoot, 'content', 'interiors'), make: 'world' },
    { dir: path.join(repoRoot, 'content'), make: 'content' },
    { dir: path.join(repoRoot, 'core'), make: 'core' },
  ];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    name: 'birdie-go-rebuild',
    apply: 'serve',
    configureServer(server) {
      for (const t of targets) server.watcher.add(t.dir);
      const onChange = (file: string) => {
        const t = targets.find((t) => file.startsWith(t.dir + path.sep));
        if (!t) return;
        clearTimeout(timers.get(t.make));
        timers.set(
          t.make,
          setTimeout(() => {
            execFile('make', ['-C', repoRoot, t.make], (err, _stdout, stderr) => {
              if (err) {
                server.config.logger.error(`make ${t.make} failed:\n${stderr || err.message}`);
                return;
              }
              server.config.logger.info(`make ${t.make}: rebuilt`, { timestamp: true });
              server.ws.send({ type: 'full-reload' });
            });
          }, 200),
        );
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
    },
  };
}

export default defineConfig({
  // Absolute base so the core worker can find core.wasm. Set BASE_PATH when
  // deploying under a sub-path (e.g. BASE_PATH=/birdie-go-go/ for GitHub Pages).
  base: process.env.BASE_PATH ?? '/',
  // Phaser alone is ~1.2 MB minified (~320 kB gzipped); it's cached by the service worker.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  plugins: [
    goRebuild(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Birdie Go Go',
        short_name: 'Birdie',
        description: 'A cozy 16-bit JRPG about birding and piano lessons.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#1b2a4a',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
        // core.wasm is ~3 MB with standard Go (smaller with TinyGo).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
