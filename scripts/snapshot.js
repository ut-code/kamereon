// 対象サイトのHTMLを取得し、ゲーム用に加工して server/sites/ に保存する。
// - <script> を除去（静的なページとして表示し、遷移やアニメーションでレイアウトが変わらないようにする）
// - <base> を挿入（画像・CSSは元サイトから読み込む）
// - ビューポート高さに依存するスタイルを固定値(800px)に置き換える
//   → iframe をページ全体の高さで表示しても、誰が見ても同じレイアウトになる
import { writeFile, mkdir } from 'node:fs/promises';
import { SITES } from '../server/sites.js';

const VIEWPORT_H = 800;

const OVERRIDES = {
  utcode: `
    .min-h-\\[100vh\\] { min-height: ${VIEWPORT_H}px !important; }
    .mt-\\[100vh\\] { margin-top: ${VIEWPORT_H}px !important; }
    .bg-image { position: absolute !important; height: ${VIEWPORT_H}px !important; min-height: 0 !important; }
    .top-\\[40\\%\\] { top: ${VIEWPORT_H * 0.4}px !important; }
    header.sticky { position: relative !important; }
  `,
};

for (const [id, site] of Object.entries(SITES)) {
  if (site.local) continue;
  const res = await fetch(site.url);
  if (!res.ok) throw new Error(`${site.url}: ${res.status}`);
  let html = await res.text();

  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  html = html.replace(/loading="lazy"/g, 'loading="eager"');
  html = html.replace(/<head>/i, `<head><base href="${site.url}">`);
  const css = `
    html, body { overflow: hidden !important; }
    ${OVERRIDES[id] ?? ''}
  `;
  html = html.replace(/<\/head>/i, `<style id="kamereon-override">${css}</style></head>`);

  await mkdir(new URL('../server/sites/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../server/sites/${site.file}`, import.meta.url), html);
  console.log(`saved ${id} (${html.length} bytes)`);
}
