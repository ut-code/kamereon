import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { createApi } from './api.js';
import { SITES } from './sites.js';

const PORT = process.env.PORT ?? 3001;
const app = express();

app.use('/api', createApi(db));
// サイトは書き出し済みの1枚画像（server/sites/rendered/<id>.webp）として配信する
app.use('/sites', express.static(fileURLToPath(new URL('sites/rendered', import.meta.url))));
app.get('/sites/:file.webp', (req, res) => {
  if (!Object.hasOwn(SITES, req.params.file.replace(/-thumb$/, ''))) return res.status(404).end();
  res.status(503).send('サイト画像がありません。`npm run render` を実行してください。');
});

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(dist + 'index.html'));
}

app.listen(PORT, () => console.log(`API server: http://localhost:${PORT}`));
