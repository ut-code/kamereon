import express from 'express';
import { SITES } from './sites.js';

const TIME_LIMIT_SEC = 180;
const MAX_IMAGE_BYTES = 400_000;
const MAX_DECOYS = 3;

const route = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res)).catch(next);
};

const toChameleon = (row, { withDecoys = false } = {}) => ({
  id: row.id,
  site: row.site,
  name: row.name,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  image: row.image,
  ...(withDecoys && { decoys: JSON.parse(row.decoys ?? '[]') }),
  searched: row.searched,
  found: row.found,
  createdAt: row.created_at,
});

const validFigure = (figure) => {
  const { x, y, w, h, image } = figure ?? {};
  return [x, y, w, h].every(Number.isFinite) &&
    typeof image === 'string' &&
    image.startsWith('data:image/png;base64,') &&
    image.length <= MAX_IMAGE_BYTES;
};

const validScore = (score) =>
  Number.isFinite(score) && score >= 0 && Number.isSafeInteger(Math.round(score));

export function createApi(db) {
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));

  api.get('/chameleons', route(async (req, res) => {
    const { site, ids } = req.query;
    let statement;
    if (ids) {
      const list = String(ids).split(',').filter(Boolean).slice(0, 100);
      if (list.length === 0) return res.json([]);
      statement = db.prepare(`
        SELECT * FROM chameleons
        WHERE id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC
      `).bind(JSON.stringify(list));
    } else if (site) {
      statement = db.prepare('SELECT * FROM chameleons WHERE site = ? ORDER BY created_at DESC LIMIT 200')
        .bind(String(site));
    } else {
      statement = db.prepare('SELECT * FROM chameleons ORDER BY created_at DESC LIMIT 200');
    }
    const { results } = await statement.all();
    res.json(results.map((row) => toChameleon(row)));
  }));

  api.get('/chameleons/:id', route(async (req, res) => {
    const row = await db.prepare('SELECT * FROM chameleons WHERE id = ?').bind(req.params.id).first();
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(toChameleon(row));
  }));

  api.post('/chameleons', route(async (req, res) => {
    const { site, name, x, y, w, h, image, decoys = [] } = req.body ?? {};
    if (typeof site !== 'string' || !Object.hasOwn(SITES, site)) {
      return res.status(400).json({ error: 'unknown site' });
    }
    if (![x, y, w, h].every(Number.isFinite)) return res.status(400).json({ error: 'invalid position' });
    if (!validFigure({ x, y, w, h, image })) return res.status(400).json({ error: 'invalid image' });
    if (!Array.isArray(decoys) || decoys.length > MAX_DECOYS || !decoys.every(validFigure)) {
      return res.status(400).json({ error: 'invalid decoys' });
    }
    const cleanDecoys = decoys.map((decoy) => ({
      x: decoy.x,
      y: decoy.y,
      w: Math.round(decoy.w),
      h: Math.round(decoy.h),
      image: decoy.image,
    }));
    const cleanName = String(name ?? '').trim().slice(0, 20) || 'ななしのカメレオン';
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO chameleons (id, site, name, x, y, w, h, image, decoys, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, site, cleanName, x, y, Math.round(w), Math.round(h), image,
      JSON.stringify(cleanDecoys), new Date().toISOString()).run();
    res.status(201).json({ id });
  }));

  api.post('/games', route(async (req, res) => {
    const { site, count = 5, exclude = [] } = req.body ?? {};
    if (typeof site !== 'string' || !Object.hasOwn(SITES, site)) {
      return res.status(400).json({ error: 'unknown site' });
    }
    const limit = Math.min(Math.max(Math.trunc(Number(count)) || 5, 1), 10);
    const excludedIds = Array.isArray(exclude)
      ? exclude.filter((id) => typeof id === 'string').slice(0, 200)
      : [];
    // ID の配列は1つの値で渡し、D1 のバインド変数数の上限内に収める。
    const { results } = await db.prepare(`
      SELECT * FROM chameleons WHERE site = ?
      AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY RANDOM() LIMIT ?
    `).bind(site, JSON.stringify(excludedIds), limit).all();
    const gameId = crypto.randomUUID();
    const ids = JSON.stringify(results.map((row) => row.id));
    await db.batch([
      db.prepare('INSERT INTO games (id, site, chameleon_ids, started_at) VALUES (?, ?, ?, ?)')
        .bind(gameId, site, ids, new Date().toISOString()),
      db.prepare(`
        UPDATE chameleons SET searched = searched + 1
        WHERE id IN (SELECT value FROM json_each(?))
      `).bind(ids),
    ]);
    res.status(201).json({
      gameId,
      timeLimit: TIME_LIMIT_SEC,
      chameleons: results.map((row) => toChameleon(row, { withDecoys: true })),
    });
  }));

  api.post('/games/:gameId/found', route(async (req, res) => {
    const game = await db.prepare('SELECT * FROM games WHERE id = ?').bind(req.params.gameId).first();
    if (!game) return res.status(404).json({ error: 'game not found' });
    const { chameleonId, score = 0 } = req.body ?? {};
    if (!JSON.parse(game.chameleon_ids).includes(chameleonId)) {
      return res.status(400).json({ error: 'not in this game' });
    }
    if (!validScore(score)) return res.status(400).json({ error: 'invalid score' });
    const elapsed = (Date.now() - Date.parse(game.started_at)) / 1000;
    if (elapsed > TIME_LIMIT_SEC + 10) return res.status(409).json({ error: 'time over' });

    // 判定も更新と同じトランザクションで行い、同時報告と再送の二重計上を防ぐ。
    const results = await db.batch([
      db.prepare(`
        UPDATE chameleons SET found = found + 1 WHERE id = ? AND EXISTS (
          SELECT 1 FROM games WHERE id = ? AND NOT EXISTS (
            SELECT 1 FROM json_each(games.found_ids) WHERE value = ?
          )
        )
      `).bind(chameleonId, game.id, chameleonId),
      db.prepare(`
        UPDATE games SET found_ids = json_insert(found_ids, '$[#]', ?), score = score + ?
        WHERE id = ? AND NOT EXISTS (
          SELECT 1 FROM json_each(games.found_ids) WHERE value = ?
        )
      `).bind(chameleonId, Math.round(score), game.id, chameleonId),
    ]);
    if (results[1].meta.changes === 0) return res.json({ ok: true, alreadyFound: true });
    res.json({ ok: true });
  }));

  api.post('/games/:gameId/finish-hide-scores', route(async (req, res) => {
    const game = await db.prepare('SELECT * FROM games WHERE id = ?').bind(req.params.gameId).first();
    if (!game) return res.status(404).json({ error: 'game not found' });
    if (game.finished) return res.json({ ok: true });
    const { hideScores = {} } = req.body ?? {};
    const ids = JSON.parse(game.chameleon_ids);
    const entries = Object.entries(hideScores ?? {});
    if (entries.length !== ids.length || entries.some(([id, data]) =>
      !ids.includes(id) || !data || typeof data.wasVisible !== 'boolean' || !validScore(data.score))) {
      return res.status(400).json({ error: 'invalid hide scores' });
    }
    const statements = entries.filter(([, data]) => data.wasVisible).map(([id, data]) =>
      db.prepare(`
        UPDATE chameleons SET total_hide_score = total_hide_score + ?, view_count = view_count + 1
        WHERE id = ? AND EXISTS (SELECT 1 FROM games WHERE id = ? AND finished = 0)
      `).bind(Math.round(data.score), id, game.id));
    statements.push(db.prepare('UPDATE games SET finished = 1 WHERE id = ? AND finished = 0').bind(game.id));
    await db.batch(statements);
    res.json({ ok: true });
  }));

  api.get('/rankings/finder', route(async (req, res) => {
    const { results } = await db.prepare(`
      SELECT id, COALESCE(NULLIF(player_name, ''), 'ななしのハンター') AS player_name,
             CAST(score AS INTEGER) AS score, started_at
      FROM games WHERE CAST(score AS INTEGER) > 0 ORDER BY score DESC LIMIT 10
    `).all();
    res.json(results);
  }));

  api.get('/rankings/hider', route(async (req, res) => {
    const { results } = await db.prepare(`
      SELECT id, name, site, searched, found, total_hide_score, view_count,
             total_hide_score * 1.0 / view_count AS avg_score
      FROM chameleons WHERE view_count >= 3 ORDER BY avg_score DESC LIMIT 10
    `).all();
    res.json(results);
  }));

  api.get('/stats', route(async (req, res) => {
    const results = await db.batch([
      db.prepare(`
        SELECT COUNT(*) AS chameleons, COALESCE(SUM(searched), 0) AS searched,
               COALESCE(SUM(found), 0) AS found FROM chameleons
      `),
      db.prepare('SELECT COUNT(*) AS n FROM games'),
    ]);
    res.json({ ...results[0].results[0], games: results[1].results[0].n });
  }));

  api.use((req, res) => res.status(404).json({ error: 'not found' }));
  api.use((error, req, res, next) => {
    const status = error.status === 400 || error.status === 413 ? error.status : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'server error' : error.message });
  });
  return api;
}
