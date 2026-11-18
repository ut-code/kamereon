import { cp } from 'node:fs/promises';

// 書き出し済みのサイト画像（npm run render）だけを配信用にコピーする
await cp(new URL('../server/sites/rendered/', import.meta.url), new URL('../dist/sites/', import.meta.url), {
  recursive: true,
});
