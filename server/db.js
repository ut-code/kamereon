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
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id             TEXT PRIMARY KEY,
    site           TEXT NOT NULL,
    chameleon_ids  TEXT NOT NULL,
    found_ids      TEXT NOT NULL DEFAULT '[]',
    started_at     TEXT NOT NULL
  );
`);

// 既存DBへの列追加：デコイ（[{x, y, w, h, image}] の JSON）
const columns = db.prepare('PRAGMA table_info(chameleons)').all().map((c) => c.name);
if (!columns.includes('decoys')) {
  db.exec(`ALTER TABLE chameleons ADD COLUMN decoys TEXT NOT NULL DEFAULT '[]'`);
}
