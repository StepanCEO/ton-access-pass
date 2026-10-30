// Записывает demo-сцену (app/demo.html) через Chrome DevTools Protocol и собирает mp4 + gif для README.
// Нужны: запущенный `npm run app:dev` (порт в DEMO_URL), Google Chrome и ffmpeg.
// Запуск: node scripts/record-demo.mjs en|ru
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lang = process.argv[2] ?? 'en';
const base = process.env.DEMO_URL ?? 'http://127.0.0.1:5199';
const out = join(import.meta.dirname, '..', 'docs', `demo-${lang}`);
const work = mkdtempSync(join(tmpdir(), 'demo-'));
const WIDTH = 960;
const HEIGHT = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
        '--headless=new',
        '--hide-scrollbars',
        '--no-first-run',
        '--force-dark-mode',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(work, 'profile')}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        'about:blank',
    ],
    { stdio: 'ignore' },
);
const watchdog = setTimeout(() => {
    chrome.kill('SIGKILL');
    process.exit(2);
}, 90_000);

let target;
for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
let id = 0;
const pending = new Map();
const frames = [];
const send = (method, params = {}) =>
    new Promise((resolve) => {
        const n = ++id;
        pending.set(n, resolve);
        ws.send(JSON.stringify({ id: n, method, params }));
    });
ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
    }
    if (msg.method === 'Page.screencastFrame') {
        frames.push({ data: msg.params.data, time: msg.params.metadata.timestamp });
        send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    }
});
const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.enable');
await send('Page.navigate', { url: `${base}/demo.html?lang=${lang}` });
await sleep(2500);

await send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: WIDTH * 2, maxHeight: HEIGHT * 2 });
await run('step(1)');
await sleep(2200);
await run('step(2)');
await sleep(700);
await run(`tap('#main-button')`);
await sleep(600);
await run('step(3)');
await sleep(1600); // mock-API «подтверждает» платёж через 1.8 с
await run('step(4)');
await sleep(3200);
await send('Page.stopScreencast');
const end = Date.now() / 1000;

// кадры приходят только при изменениях: длительность кадра = до следующего
const list = [];
frames.forEach((frame, i) => {
    const file = join(work, `f${String(i).padStart(4, '0')}.png`);
    writeFileSync(file, Buffer.from(frame.data, 'base64'));
    const duration = (frames[i + 1]?.time ?? end) - frame.time;
    list.push(`file '${file}'`, `duration ${Math.max(duration, 0.02).toFixed(3)}`);
});
list.push(`file '${join(work, `f${String(frames.length - 1).padStart(4, '0')}.png`)}'`);
writeFileSync(join(work, 'list.txt'), list.join('\n'));

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
ffmpeg('-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-vf', 'fps=30,scale=1920:-2:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', `${out}.mp4`);
ffmpeg('-i', `${out}.mp4`, '-vf', 'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', `${out}.gif`);

console.log(`${frames.length} кадров → ${out}.mp4, ${out}.gif`);
clearTimeout(watchdog);
ws.close();
const exited = new Promise((resolve) => chrome.once('exit', resolve));
chrome.kill('SIGKILL');
await exited;
rmSync(work, { recursive: true, force: true, maxRetries: 5 });
process.exit(0);
