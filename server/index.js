import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { SITES } from './sites.js';

const PORT = process.env.PORT ?? 3001;
const TIME_LIMIT_SEC = 180;
const MAX_IMAGE_BYTES = 400_000;
const MAX_DECOYS = 3;

const app = express();
app.use(express.json({ limit: '2mb' }));

const toChameleon = (row, { withImage = true, withDecoys = false } = {}) => ({
  id: row.id,
  site: row.site,
  name: row.name,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  ...(withImage && { image: row.image }),
  ...(withDecoys && { decoys: JSON.parse(row.decoys) }),
  searched: row.searched,
  found: row.found,
  createdAt: row.created_at,
});

app.use('/sites', express.static(fileURLToPath(new URL('sites', import.meta.url))));

// 舞台となるページ（同一オリジンで配信して、iframe の高さを測れるようにする）
app.get('/sites/:site', (req, res) => {
  const site = SITES[req.params.site];
  if (!site) return res.status(404).end();
  const file = fileURLToPath(new URL(`sites/${site.file}`, import.meta.url));
  if (!existsSync(file)) {
    return res.status(503).send('snapshot がありません。`npm run snapshot` を実行してください。');
  }
  res.sendFile(file);
});

app.get('/api/chameleons', (req, res) => {
  const { site, ids } = req.query;
  let rows;
  if (ids) {
    const list = String(ids).split(',').filter(Boolean).slice(0, 100);
    if (list.length === 0) return res.json([]);
    rows = db
      .prepare(`SELECT * FROM chameleons WHERE id IN (${list.map(() => '?').join(',')}) ORDER BY created_at DESC`)
      .all(...list);
  } else if (site) {
    rows = db.prepare('SELECT * FROM chameleons WHERE site = ? ORDER BY created_at DESC LIMIT 200').all(site);
  } else {
    rows = db.prepare('SELECT * FROM chameleons ORDER BY created_at DESC LIMIT 200').all();
  }
  res.json(rows.map((r) => toChameleon(r)));
});

app.get('/api/chameleons/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM chameleons WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(toChameleon(row));
});

const validFigure = ({ x, y, w, h, image } = {}) =>
  [x, y, w, h].every(Number.isFinite) &&
  typeof image === 'string' &&
  image.startsWith('data:image/png;base64,') &&
  image.length <= MAX_IMAGE_BYTES;

app.post('/api/chameleons', (req, res) => {
  const { site, name, x, y, w, h, image, decoys = [] } = req.body ?? {};
  if (!SITES[site]) return res.status(400).json({ error: 'unknown site' });
  if (![x, y, w, h].every(Number.isFinite)) return res.status(400).json({ error: 'invalid position' });
  if (!validFigure({ x, y, w, h, image })) return res.status(400).json({ error: 'invalid image' });
  if (!Array.isArray(decoys) || decoys.length > MAX_DECOYS || !decoys.every(validFigure)) {
    return res.status(400).json({ error: 'invalid decoys' });
  }
  const cleanDecoys = decoys.map((d) => ({ x: d.x, y: d.y, w: Math.round(d.w), h: Math.round(d.h), image: d.image }));
  const cleanName = String(name ?? '').trim().slice(0, 20) || 'ななしのカメレオン';
  const id = randomUUID();
  db.prepare(
    `INSERT INTO chameleons (id, site, name, x, y, w, h, image, decoys, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, site, cleanName, x, y, Math.round(w), Math.round(h), image, JSON.stringify(cleanDecoys), new Date().toISOString());
  res.status(201).json({ id });
});

// ゲーム開始：ランダムに最大 count 人を選び、「探された」人数を加算する
app.post('/api/games', (req, res) => {
  const { site, count = 5, exclude = [] } = req.body ?? {};
  if (!SITES[site]) return res.status(400).json({ error: 'unknown site' });
  const n = Math.min(Math.max(Number(count) || 5, 1), 10);
  const ex = Array.isArray(exclude) ? exclude.filter((s) => typeof s === 'string').slice(0, 200) : [];
  const exSql = ex.length ? `AND id NOT IN (${ex.map(() => '?').join(',')})` : '';
  const rows = db
    .prepare(`SELECT * FROM chameleons WHERE site = ? ${exSql} ORDER BY RANDOM() LIMIT ?`)
    .all(site, ...ex, n);

  const gameId = randomUUID();
  const ids = rows.map((r) => r.id);
  db.prepare('INSERT INTO games (id, site, chameleon_ids, started_at) VALUES (?, ?, ?, ?)').run(
    gameId,
    site,
    JSON.stringify(ids),
    new Date().toISOString(),
  );
  const inc = db.prepare('UPDATE chameleons SET searched = searched + 1 WHERE id = ?');
  for (const id of ids) inc.run(id);

  res.status(201).json({
    gameId,
    timeLimit: TIME_LIMIT_SEC,
    chameleons: rows.map((r) => toChameleon(r, { withDecoys: true })),
  });
});

// 発見報告：1ゲームにつき1カメレオン1回だけ「見つけられた」人数を加算する
app.post('/api/games/:gameId/found', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'game not found' });
  const { chameleonId, score = 0, playerName } = req.body ?? {};
  const ids = JSON.parse(game.chameleon_ids);
  const found = JSON.parse(game.found_ids);
  if (!ids.includes(chameleonId)) return res.status(400).json({ error: 'not in this game' });

  const elapsed = (Date.now() - Date.parse(game.started_at)) / 1000;
  if (elapsed > TIME_LIMIT_SEC + 10) return res.status(409).json({ error: 'time over' });
  if (found.includes(chameleonId)) return res.json({ ok: true, alreadyFound: true });

  found.push(chameleonId);
  const newScore = Math.round((game.score || 0) + score);
  const cleanPlayerName = String(playerName ?? '').trim().slice(0, 20) || game.player_name || 'ななしのハンター';
  db.prepare('UPDATE games SET found_ids = ?, score = ?, player_name = ? WHERE id = ?').run(JSON.stringify(found), newScore,  cleanPlayerName, game.id);
  db.prepare('UPDATE chameleons SET found = found + 1 WHERE id = ?').run(chameleonId);
  res.json({ ok: true });
});

app.post('/api/games/:gameId/finish-hide-scores', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'game not found' });
  if (game.finished) return res.json({ ok: true });
  const { hideScores = {} } = req.body ?? {};
  const ids = JSON.parse(game.chameleon_ids);
  const entries = Object.entries(hideScores ?? {});
  if (entries.length !== ids.length || entries.some(([id, data]) => !ids.includes(id) || !data ||
    typeof data.wasVisible !== 'boolean' || !Number.isFinite(data.score) || data.score < 0)) {
    return res.status(400).json({ error: 'invalid hide scores' });
  }

  const updateStmt = db.prepare(`
    UPDATE chameleons 
    SET total_hide_score = total_hide_score + ?,
        view_count = view_count + 1 
    WHERE id = ?
  `);

  // 評価の加算と終了フラグを一括保存し、再送時の二重計上を防ぐ。
  db.exec('BEGIN');
  try {
    for (const [id, data] of entries) {
      if (data.wasVisible) updateStmt.run(Math.round(data.score), id);
    }
    db.prepare('UPDATE games SET finished = 1 WHERE id = ?').run(game.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json({ ok: true });
});

app.get('/api/rankings/finder', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, COALESCE(NULLIF(player_name, ''), 'ななしのハンター') AS player_name, CAST(score AS INTEGER) AS score, started_at 
    FROM games 
    WHERE CAST(score AS INTEGER) > 0 AND CAST(score AS INTEGER) > 0
    ORDER BY score DESC 
    LIMIT 10
  `).all();
  res.json(rows);
});

app.get('/api/rankings/hider', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, site, searched, found, total_hide_score, view_count,
           total_hide_score * 1.0 / view_count AS avg_score
    FROM chameleons 
    WHERE view_count >= 3
    ORDER BY avg_score DESC, view_count DESC 
    LIMIT 10
  `).all();
  res.json(rows);
});

app.get('/api/stats', (_req, res) => {
  const row = db
    .prepare('SELECT COUNT(*) AS chameleons, COALESCE(SUM(searched),0) AS searched, COALESCE(SUM(found),0) AS found FROM chameleons')
    .get();
  const games = db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
  res.json({ ...row, games });
});

// 本番用：ビルド済みのフロントエンドを配信
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(dist + 'index.html'));
}

app.listen(PORT, () => console.log(`API server: http://localhost:${PORT}`));