// 서버: 화면 파일(dist) + /healthz + 판 시작 · 검증 API.
// 게임은 브라우저에서 돈다. 서버는 판이 끝날 때 입력 기록을 처음부터 다시 돌려 점수를 직접 계산한다 (runs.ts).
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/shared/releases.ts';
import { TokenBucket, clientIp, originAllowed } from './security.ts';
import { issueRun, finishRun, precheckToken } from './runs.ts';
import { openStore } from './store.ts';

const store = openStore();

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
/** 기록 크기 한도: 2시간 판도 넉넉히 들어가는 크기 (10분 판 ≈ 30~50KB) */
const MAX_BODY = 1024 * 1024;
/** 검증을 기다릴 수 있는 수. 넘치면 잠시 뒤에 다시 올려 달라고 한다 (기다리는 기록이 메모리를 쓰므로) */
const MAX_WAITING = 4;
let waiting = 0;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:",
};

/** 주소마다 API 요청 수 제한: 판 시작은 분당 20번, 검증은 분당 10번 남짓 */
const buckets = new Map<string, { start: TokenBucket; finish: TokenBucket; at: number }>();
function bucket(ip: string) {
  let b = buckets.get(ip);
  if (!b) { b = { start: new TokenBucket(10, 20 / 60), finish: new TokenBucket(5, 10 / 60), at: Date.now() }; buckets.set(ip, b); }
  b.at = Date.now();
  return b;
}
setInterval(() => { const cut = Date.now() - 10 * 60 * 1000; for (const [k, v] of buckets) if (v.at < cut) buckets.delete(k); }, 60_000).unref();

/** 검증(다시 돌리기)은 CPU 를 쓰므로 한 번에 하나씩 */
let verifying: Promise<unknown> = Promise.resolve();

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 만 받아요' });
  if (!originAllowed(req)) return json(res, 403, { error: '다른 사이트에서 온 요청이에요' });
  const ip = clientIp(req), b = bucket(ip);
  if (pathname === '/api/run/start') {
    if (!b.start.take()) return json(res, 429, { error: '잠시 뒤에 다시 시작해 주세요' });
    return json(res, 200, issueRun());
  }
  if (pathname === '/api/run/finish') {
    if (!b.finish.take()) return json(res, 429, { error: '잠시 뒤에 다시 올려 주세요' });
    // 토큰은 헤더로 받아 본문을 읽기 전에 확인한다
    const token = req.headers['x-run-token'];
    const pre = precheckToken(token);
    if (!pre.ok) { req.resume(); return json(res, pre.status, { ok: false, error: pre.error }); }
    if (waiting >= MAX_WAITING) { req.resume(); return json(res, 503, { ok: false, error: '검증할 기록이 많아요. 잠시 뒤에 다시 올려 주세요' }); }
    waiting++;
    try {
      let body: { log?: unknown };
      try { body = (await readBody(req)) as typeof body; } catch { return json(res, 400, { ok: false, error: '기록을 읽지 못했어요' }); }
      const job = verifying.then(() => finishRun(store, token, body?.log));
      verifying = job.catch(() => undefined);
      const r = await job;
      return r.ok ? json(res, 200, { ok: true, saved: r.saved, ...r.result }) : json(res, r.status, { ok: false, error: r.error });
    } catch { return json(res, 500, { ok: false, error: '검증 중 문제가 생겼어요' }); }
    finally { waiting--; }
  }
  return json(res, 404, { error: '없는 API 예요' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, version: APP_VERSION, store: store.kind })); return; }
  if (url.pathname.startsWith('/api/')) { void api(req, res, url.pathname); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  // dist 밖으로 나가는 경로는 막는다
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(DIST, rel);
  if (!file.startsWith(DIST + path.sep)) { res.writeHead(404); res.end(); return; }
  let ok = false;
  try { ok = statSync(file).isFile(); } catch { /* 없음 */ }
  if (!ok) { res.writeHead(404); res.end('not found'); return; }
  const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  if (req.method === 'HEAD') { res.end(); return; }
  const src = createReadStream(file);
  src.on('error', () => res.destroy());
  res.on('close', () => src.destroy());
  src.pipe(res);
});

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { server.close(() => { void store.close().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 3000).unref(); });
