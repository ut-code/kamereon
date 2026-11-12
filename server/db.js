import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';

const dataDir = new URL('../data/', import.meta.url);
mkdirSync(dataDir, { recursive: true });

const sqlite = new DatabaseSync(new URL('kamereon.db', dataDir).pathname);
sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));

// 既存DBへの列追加：デコイ（[{x, y, w, h, image}] の JSON）
const columns = sqlite.prepare('PRAGMA table_info(chameleons)').all().map((c) => c.name);
if (!columns.includes('decoys')) {
  sqlite.exec(`ALTER TABLE chameleons ADD COLUMN decoys TEXT NOT NULL DEFAULT '[]'`);
}

if (!columns.includes('total_hide_score')) {
  sqlite.exec(`ALTER TABLE chameleons ADD COLUMN total_hide_score REAL NOT NULL DEFAULT 0`);
}
if (!columns.includes('view_count')) {
  sqlite.exec(`ALTER TABLE chameleons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
}

const gameCols = sqlite.prepare('PRAGMA table_info(games)').all().map((c) => c.name);
if (!gameCols.includes('player_name')) {
  sqlite.exec(`ALTER TABLE games ADD COLUMN player_name TEXT NOT NULL DEFAULT 'ななしのハンター'`);
}
if (!gameCols.includes('score')) {
  sqlite.exec(`ALTER TABLE games ADD COLUMN score INTEGER NOT NULL DEFAULT 0`);
}
if (!gameCols.includes('finished')) {
  sqlite.exec(`ALTER TABLE games ADD COLUMN finished INTEGER NOT NULL DEFAULT 0`);
}

// Node.js での開発にも D1 と同じ読み書きのインターフェースを提供する。
function prepare(sql, values = []) {
  const statement = sqlite.prepare(sql);
  return {
    bind: (...parameters) => prepare(sql, parameters),
    first: () => statement.get(...values) ?? null,
    all: () => ({ results: statement.all(...values) }),
    run() {
      const results = statement.all(...values);
      const { n } = sqlite.prepare('SELECT changes() AS n').get();
      return { results, meta: { changes: Number(n) } };
    },
  };
}

export const db = {
  prepare,
  batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
