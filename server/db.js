import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

const dataDir = new URL('../data/', import.meta.url);
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(new URL('kamereon.db', dataDir).pathname);

db.exec(`
  CREATE TABLE IF NOT EXISTS chameleons (
    id         TEXT PRIMARY KEY,
    site       TEXT NOT NULL,
    name       TEXT NOT NULL,
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    w          INTEGER NOT NULL,
    h          INTEGER NOT NULL,
    image      TEXT NOT NULL,
    searched   INTEGER NOT NULL DEFAULT 0,
    found      INTEGER NOT NULL DEFAULT 0,
    total_hide_score REAL NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id             TEXT PRIMARY KEY,
    site           TEXT NOT NULL,
    chameleon_ids  TEXT NOT NULL,
    found_ids      TEXT NOT NULL DEFAULT '[]',
    player_name    TEXT NOT NULL DEFAULT 'ななしのハンター',
    score          INTEGER NOT NULL DEFAULT 0,
    finished       INTEGER NOT NULL DEFAULT 0,
    started_at     TEXT NOT NULL
  );
`);

// 既存DBへの列追加：デコイ（[{x, y, w, h, image}] の JSON）
const columns = db.prepare('PRAGMA table_info(chameleons)').all().map((c) => c.name);
if (!columns.includes('decoys')) {
  db.exec(`ALTER TABLE chameleons ADD COLUMN decoys TEXT NOT NULL DEFAULT '[]'`);
}

if (!columns.includes('total_hide_score')) {
  db.exec(`ALTER TABLE chameleons ADD COLUMN total_hide_score REAL NOT NULL DEFAULT 0`);
}
if (!columns.includes('view_count')) {
  db.exec(`ALTER TABLE chameleons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
}

const gameCols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
if (!gameCols.includes('player_name')) {
  db.exec(`ALTER TABLE games ADD COLUMN player_name TEXT NOT NULL DEFAULT 'ななしのハンター'`);
}
if (!gameCols.includes('score')) {
  db.exec(`ALTER TABLE games ADD COLUMN score INTEGER NOT NULL DEFAULT 0`);
}
if (!gameCols.includes('finished')) {
  db.exec(`ALTER TABLE games ADD COLUMN finished INTEGER NOT NULL DEFAULT 0`);
}
