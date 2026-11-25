// 게임 서버: 화면 파일(dist) + /healthz + WebSocket(/ws) 을 한 프로세스에서 서빙한다.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMsg, PROTOCOL_VERSION, MAX_MSG_BYTES, ServerMsg } from '../src/shared/protocol.ts';
import { TICK } from '../src/shared/game.ts';
import { Session } from './session.ts';
import { APP_VERSION } from '../src/shared/releases.ts';
import { TokenBucket, clientIp, originAllowed } from './security.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MAX_CONNS = 300, MAX_PER_IP = 4, MAX_VIOLATIONS = 5;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; img-src 'self' data:",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, version: APP_VERSION, sessions: sessions.size })); return; }
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

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
const perIp = new Map<string, number>();
const sessions = new Set<{ s: Session; ws: WebSocket }>();

server.on('upgrade', (req, socket, head) => {
  const ip = clientIp(req);
  const reject = (code: number) => { socket.write(`HTTP/1.1 ${code} x\r\n\r\n`); socket.destroy(); };
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return reject(404);
  if (!originAllowed(req)) return reject(403);
  if (sessions.size >= MAX_CONNS || (perIp.get(ip) ?? 0) >= MAX_PER_IP) return reject(429);
  wss.handleUpgrade(req, socket, head, ws => {
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const send = (m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(JSON.stringify(m)); };
    const entry = { s: new Session(send), ws };
    sessions.add(entry);
    // 정상 클라이언트는 틱(30Hz)마다 한 번 남짓 보낸다. 넉넉히 초당 60개, 순간 120개
    const bucket = new TokenBucket(120, 60);
    // 살아 있는지 확인: 30초마다 ping, 다음 확인 전까지 pong 이 오면 살아 있다.
    // (handleUpgrade 로 받은 연결에는 'connection' 이벤트가 오지 않으므로 여기서 직접 건다.
    //  전에는 그쪽에 걸어서 pong 을 받지 못해, 정상 연결도 30~60초 뒤에 끊겼다)
    const live = ws as WebSocket & { alive?: boolean };
    live.alive = true;
    ws.on('pong', () => { live.alive = true; });
    let violations = 0, lastViolation = 0;
    send({ t: 'hello', v: PROTOCOL_VERSION });
    ws.on('message', (data, isBinary) => {
      // 위반은 10초 동안 조용하면 지운다 (오래 하다 보면 가끔 생기는 것이 쌓여 끊기지 않게)
      if (violations > 0 && Date.now() - lastViolation > 10_000) violations = 0;
      if (!bucket.take()) { violations++; lastViolation = Date.now(); }
      else {
        const m = isBinary ? null : parseClientMsg(data.toString());
        if (m) entry.s.handle(m); else { violations++; lastViolation = Date.now(); }
      }
      if (violations >= MAX_VIOLATIONS) ws.close(1008, 'policy');
    });
    ws.on('close', () => {
      sessions.delete(entry);
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
    });
    ws.on('error', () => ws.terminate());
  });
});

setInterval(() => { for (const e of sessions) e.s.tick(); }, TICK * 1000);

// 응답 없는 연결 정리
setInterval(() => {
  for (const e of sessions) {
    const w = e.ws as WebSocket & { alive?: boolean };
    if (w.alive === false) { w.terminate(); continue; }
    w.alive = false; w.ping();
  }
}, Number(process.env.PING_MS ?? 30_000)).unref();

server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { wss.clients.forEach(c => c.close(1001)); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
