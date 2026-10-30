// Streaming benchmark (SPEC.md §4.10, developer_guide.md §7).
//
// Serves dist/ with `vite preview`, opens the game in headless Chromium with
// CPU throttling, starts a new game, then walks and teleports Angie across
// the world so chunks stream in and out, recording every frame time.
//
//   node tools/bench/bench.mjs            (make bench builds dist/ first)
//
// Env: CHROME (browser binary, default "chromium"), BENCH_CPU (throttle
// rate, default 2), BENCH_P95_MS (default 33), BENCH_MAX_SLOW (fraction of
// frames over 50 ms allowed, default 0.01), BENCH_HEAP_MB (default 300).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const chromeBin = process.env.CHROME ?? 'chromium';
const cpu = Number(process.env.BENCH_CPU ?? 2);
const p95Budget = Number(process.env.BENCH_P95_MS ?? 33);
const maxSlow = Number(process.env.BENCH_MAX_SLOW ?? 0.01);
const heapBudget = Number(process.env.BENCH_HEAP_MB ?? 300);
const port = 4180;
const debugPort = 9335;

const server = spawn('npx', ['vite', 'preview', '--outDir', '../dist', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: fileURLToPath(new URL('../../web/', import.meta.url)),
  stdio: 'ignore',
});
const chrome = spawn(chromeBin, ['--headless', '--no-sandbox', `--remote-debugging-port=${debugPort}`, '--window-size=1280,720', 'about:blank'], {
  stdio: 'ignore',
});
const cleanup = () => {
  chrome.kill();
  server.kill();
};
process.on('exit', cleanup);

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error('could not reach Chromium');
}

const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg.result ?? msg.error);
    waiting.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
};
const key = (type, code, keyCode) => send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: keyCode });
const hold = async (code, keyCode, ms) => {
  await key('keyDown', code, keyCode);
  await sleep(ms);
  await key('keyUp', code, keyCode);
};

await send('Runtime.enable');
await send('Emulation.setCPUThrottlingRate', { rate: cpu });
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    break;
  } catch {
    await sleep(200);
  }
}
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
for (let i = 0; i < 200 && !(await evaluate('document.body?.dataset.boot ?? null')); i++) await sleep(100);
if ((await evaluate('document.body?.dataset.boot ?? null')) !== 'ok') throw new Error(`the game did not boot (is dist/ built?) ${JSON.stringify({ errors, url: await evaluate('location.href'), title: await evaluate('document.title') })}`);
// Dismiss the splash poster: its first key only closes it.
for (let i = 0; i < 50 && (await evaluate('document.body.dataset.splash ?? null')) !== 'open'; i++) await sleep(100);
await key('keyDown', 'Escape', 27);
await key('keyUp', 'Escape', 27);
for (let i = 0; i < 50 && (await evaluate('document.body.dataset.splash ?? null')) === 'open'; i++) await sleep(100);
await key('keyDown', 'Enter', 13);
await key('keyUp', 'Enter', 13);
// Wait for the map, then skip the intro dialogue.
for (let i = 0; i < 150 && !(await evaluate('!!window.__game?.scene.getScene("Map")?.ready')); i++) await sleep(100);
if (!(await evaluate('!!window.__game?.scene.getScene("Map")?.ready'))) throw new Error('the map never became ready');
for (let i = 0; i < 40 && (await evaluate('document.querySelectorAll(".dialogue").length')); i++) {
  await key('keyDown', 'Space', 32);
  await key('keyUp', 'Space', 32);
  await sleep(120);
}

await evaluate(`(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`);

// Walk around…
await hold('ArrowLeft', 37, 2500);
await hold('ArrowDown', 40, 2500);
await hold('ArrowRight', 39, 3000);
await hold('ArrowUp', 38, 2000);
// …then teleport between distant points so whole chunk windows change at once.
const points = await evaluate(`(() => {
  const i = window.__game.registry.get('world');
  const w = Math.max(...i.regions.map((r) => r.x + r.width));
  const h = Math.max(...i.regions.map((r) => r.y + r.height));
  return [[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9], [0.5, 0.5], [0.05, 0.5], [0.95, 0.5]].map(([fx, fy]) => [Math.round(w * fx), Math.round(h * fy)]);
})()`);
for (const [x, y] of points) {
  await evaluate(`(() => { const s = window.__game.scene.getScene('Map'); s.pos = { x: ${x}, y: ${y} }; return true; })()`);
  await sleep(700);
}

const frames = (await evaluate('window.__frames')).slice(5);
const heapMb = Math.round(((await evaluate('performance.memory?.usedJSHeapSize ?? 0')) / 1024 / 1024) * 10) / 10;
frames.sort((a, b) => a - b);
const pct = (p) => frames[Math.min(frames.length - 1, Math.floor(frames.length * p))];
const slow = frames.filter((f) => f > 50).length / frames.length;
const report = {
  cpuThrottle: cpu,
  frames: frames.length,
  p50: Math.round(pct(0.5) * 10) / 10,
  p95: Math.round(pct(0.95) * 10) / 10,
  max: Math.round(frames[frames.length - 1] * 10) / 10,
  slowFraction: Math.round(slow * 1000) / 1000,
  heapMb,
  errors,
};
console.log(JSON.stringify(report, null, 2));
const failures = [];
if (report.p95 > p95Budget) failures.push(`p95 ${report.p95} ms > ${p95Budget} ms`);
if (slow > maxSlow) failures.push(`${(slow * 100).toFixed(1)}% of frames over 50 ms (budget ${maxSlow * 100}%)`);
if (heapMb > heapBudget) failures.push(`heap ${heapMb} MB > ${heapBudget} MB`);
if (errors.length) failures.push(`${errors.length} page error(s)`);
if (failures.length) {
  console.error('bench FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('bench passed');
process.exit(0);
