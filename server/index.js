/**
 * HTTP sunucusu: statik dosyalar + REST API.
 * Harici bagimlilik yoktur; `node server/index.js` ile calisir.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpError, matchRoute } from './api.js';
import { COOKIE_NAME, getSession, parseCookies } from './auth.js';
import { flush, load } from './store.js';
import { ensureSeed } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'İstek gövdesi çok büyük.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    // Tek sayfa uygulamasi: bilinmeyen yollar index.html'e duser.
    const index = join(PUBLIC_DIR, 'index.html');
    if (!existsSync(index)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bulunamadı');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(readFileSync(index));
    return;
  }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': safe === '/index.html' ? 'no-cache' : 'no-cache',
  });
  res.end(readFileSync(file));
}

async function handleApi(req, res, url) {
  const match = matchRoute(req.method, url.pathname);
  if (!match) throw new HttpError(404, 'Bilinmeyen istek.');

  const cookies = parseCookies(req.headers.cookie || '');
  const session = getSession(cookies[COOKIE_NAME]);
  const db = load();
  const user = session ? db.users[session.userId] : null;
  if (session && (!user || user.active === false)) throw new HttpError(401, 'Oturum geçersiz.');

  // Basit CSRF korumasi: durum degistiren istekler ayni kokenden gelmeli.
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) throw new HttpError(403, 'Geçersiz istek kaynağı.');
    }
  }

  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await readBody(req);
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'Geçersiz JSON gövdesi.');
      }
    }
  }

  const headers = {};
  const cookiesOut = [];
  const ctx = {
    req,
    user,
    body,
    params: match.params,
    query: url.searchParams,
    cookies,
    secure: req.headers['x-forwarded-proto'] === 'https',
    setHeader: (k, v) => {
      headers[k] = v;
    },
    setCookie: (v) => cookiesOut.push(v),
  };

  const result = await match.handler(ctx);
  await flush();

  if (cookiesOut.length) headers['Set-Cookie'] = cookiesOut;
  if (result && typeof result === 'object' && '__raw' in result) {
    res.writeHead(200, headers);
    res.end(result.__raw);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(result ?? { ok: true }));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[hata]', err);
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: err.message || 'Sunucu hatası' }));
  }
});

const seedInfo = ensureSeed();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  Nöbet Çizelgesi');
  console.log(`  http://${shown}:${PORT}`);
  if (seedInfo?.created) {
    console.log('');
    console.log('  İlk kurulum tamamlandı. Yönetici girişi:');
    console.log(`    kullanıcı : ${seedInfo.username}`);
    console.log(`    parola    : ${seedInfo.password}`);
    console.log('  İlk girişten sonra parolayı değiştirin.');
  }
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await flush();
    server.close(() => process.exit(0));
  });
}
