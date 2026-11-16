// server/sites/*.html をヘッドレス Chrome でページ全体ごと1枚の画像に書き出す（server/sites/rendered/<id>.webp）。
// ゲームではこの画像を表示するので、ブラウザや端末のフォント・レイアウト差でカメレオンの位置がずれない。
// 使い方: npm run render  （CHROME_PATH で Chrome の場所を変えられる）
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITES } from '../server/sites.js';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT_H = 800; // 100vh の基準（snapshot.js と合わせる）
const MAX_SCALE = 1.5; // 拡大しても粗くなりすぎないよう、少し高い解像度で書き出す
const WEBP_MAX = 16383; // WebP の1辺の上限 (px)
const QUALITY = 82;
// ホームのページ選択で使うサムネイル（<id>-thumb.webp）。ページ上端の THUMB_W × THUMB_H を縮小して書き出す。
// 縦横比 4:5（選択カード）と 16:10（確認画面）のどちらの枠も上端から埋められる範囲にしている。
const THUMB_W = 1280;
const THUMB_H = 1600;
const THUMB_PX = 480; // 書き出す幅 (px)。カードの表示幅 (最大250px程度) の約2倍
const THUMB_QUALITY = 80;

const sitesDir = new URL('../server/sites/', import.meta.url);
const outDir = new URL('rendered/', sitesDir);
const only = process.argv.slice(2);

const profile = await mkdtemp(join(tmpdir(), 'kamereon-render-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const browserUrl = await new Promise((resolve, reject) => {
  let log = '';
  chrome.stderr.on('data', (chunk) => {
    log += chunk;
    const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome が終了しました (${code})\n${log}`)));
});

// --- 最小限の CDP クライアント ---
const ws = new WebSocket(browserUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
const listeners = new Set();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    for (const fn of listeners) fn(msg);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const waitEvent = (method, sessionId) => new Promise((resolve) => {
  const fn = (msg) => {
    if (msg.method === method && msg.sessionId === sessionId) {
      listeners.delete(fn);
      resolve(msg.params);
    }
  };
  listeners.add(fn);
});

async function render(id, site) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) =>
    (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: site.width, height: VIEWPORT_H, deviceScaleFactor: 1, mobile: false,
  });
  const loaded = waitEvent('Page.loadEventFired', sessionId);
  await s('Page.navigate', { url: pathToFileURL(fileURLToPath(new URL(site.file, sitesDir))).href });
  await loaded;
  // 遅延読み込みの画像も含めて、画像とフォントが揃うまで待つ
  await evaluate(`(async () => {
    for (const img of document.images) img.loading = 'eager';
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.complete ? 0
      : new Promise((r) => { img.onload = img.onerror = r; })));
    await new Promise((r) => setTimeout(r, 500));
  })()`);

  const height = Math.ceil(await evaluate('document.documentElement.scrollHeight'));
  const scale = Math.min(MAX_SCALE, WEBP_MAX / site.width, WEBP_MAX / height);
  const { data } = await s('Page.captureScreenshot', {
    format: 'webp', quality: QUALITY, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: site.width, height, scale },
  });
  const thumb = await s('Page.captureScreenshot', {
    format: 'webp', quality: THUMB_QUALITY, captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: THUMB_W, height: Math.min(THUMB_H, height), scale: THUMB_PX / THUMB_W },
  });
  await send('Target.closeTarget', { targetId });

  const buf = Buffer.from(data, 'base64');
  const thumbBuf = Buffer.from(thumb.data, 'base64');
  await writeFile(new URL(`${id}.webp`, outDir), buf);
  await writeFile(new URL(`${id}-thumb.webp`, outDir), thumbBuf);
  console.log(`rendered ${id}: ${site.width}x${height} (x${scale.toFixed(2)}, ${(buf.length / 1024).toFixed(0)} KB)` +
    `, thumb ${(thumbBuf.length / 1024).toFixed(0)} KB`);
}

try {
  await mkdir(outDir, { recursive: true });
  for (const [id, site] of Object.entries(SITES)) {
    if (only.length && !only.includes(id)) continue;
    await render(id, site);
  }
} finally {
  ws.close();
  chrome.kill();
  await new Promise((r) => chrome.exitCode === null ? chrome.once("exit", r) : r());
  await rm(profile, { recursive: true, force: true });
}
