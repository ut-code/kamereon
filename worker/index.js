import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
// Express 4 の文字コード変換部品は package.json の overrides で Workers 対応版に固定。
import express from 'express';
import { createApi } from '../server/api.js';

const app = express();
app.use('/api', createApi(env.DB));
app.listen(3001);

export default httpServerHandler({ port: 3001 });
