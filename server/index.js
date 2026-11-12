import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { createApi } from './api.js';
import { SITES } from './sites.js';

const PORT = process.env.PORT ?? 3001;
const app = express();

app.use('/api', createApi(db));
app.use('/sites', express.static(fileURLToPath(new URL('sites', import.meta.url))));
app.get('/sites/:site', (req, res) => {
  const site = Object.hasOwn(SITES, req.params.site) && SITES[req.params.site];
  if (!site) return res.status(404).end();
  const file = fileURLToPath(new URL(`sites/${site.file}`, import.meta.url));
  if (!existsSync(file)) {
    return res.status(503).send('snapshot がありません。`npm run snapshot` を実行してください。');
  }
  res.sendFile(file);
});

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(dist + 'index.html'));
}

app.listen(PORT, () => console.log(`API server: http://localhost:${PORT}`));
