import { cp } from 'node:fs/promises';

await cp(new URL('../server/sites/', import.meta.url), new URL('../dist/sites/', import.meta.url), {
  recursive: true,
});
