// 판 토큰과 기록 검증.
// - 시작: 서버가 시드를 정하고, {판 번호, 시드, 시작 시각} 에 서명한 토큰을 준다 (화면이 시드를 바꿔 치지 못하게)
// - 끝: 화면이 토큰과 입력 기록을 보내면, 서버가 같은 시드로 처음부터 다시 돌려 점수를 직접 계산한다.
//   화면이 보낸 점수는 믿지 않는다. 기록을 조작하면 결과가 달라질 뿐이다.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { checkLog, replay, type ReplayLog, type RunResult } from '../src/shared/replay.ts';
import { TICK } from '../src/shared/game.ts';

/** 서명 키. SESSION_SECRET 이 없으면 서버가 뜰 때마다 새로 만든다 (그러면 재시작 전에 시작한 판은 검증할 수 없다) */
const SECRET = process.env.SESSION_SECRET?.trim() || randomBytes(32).toString('hex');
/** 토큰 유효 시간: 판 최대 길이(2시간) + 여유 */
export const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

interface TokenBody { rid: string; seed: number; iat: number }

const sign = (data: string) => createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueRun(now = Date.now()): { token: string; seed: number } {
  const body: TokenBody = { rid: randomBytes(9).toString('base64url'), seed: randomInt(2 ** 31), iat: now };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  return { token: `${data}.${sign(data)}`, seed: body.seed };
}

export function readToken(token: unknown): TokenBody | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [data, mac] = token.split('.');
  if (!data || !mac) return null;
  const want = Buffer.from(sign(data)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const b = JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenBody;
    if (typeof b.rid !== 'string' || !Number.isInteger(b.seed) || !Number.isInteger(b.iat)) return null;
    return b;
  } catch { return null; }
}

/** 한 번 검증한 판 번호 (같은 판을 두 번 올리지 못하게). 지금은 메모리에만 (DB 를 붙이면 DB 로 옮긴다) */
const used = new Map<string, number>();
setInterval(() => { const cut = Date.now() - TOKEN_TTL_MS; for (const [k, t] of used) if (t < cut) used.delete(k); }, 10 * 60 * 1000).unref();

export type FinishResult = { ok: true; result: RunResult } | { ok: false; status: number; error: string };

export function finishRun(token: unknown, log: unknown, now = Date.now()): FinishResult {
  const t = readToken(token);
  if (!t) return { ok: false, status: 400, error: '판 토큰이 올바르지 않아요' };
  if (now - t.iat > TOKEN_TTL_MS) return { ok: false, status: 400, error: '너무 오래된 판이에요' };
  if (used.has(t.rid)) return { ok: false, status: 409, error: '이미 올린 판이에요' };
  const bad = checkLog(log);
  if (bad) return { ok: false, status: 400, error: bad };
  const l = log as ReplayLog;
  // 실제 시간보다 빨리 끝낼 수는 없다 (틱은 1/30초. 일시정지한 시간은 틱에 들어가지 않으므로 기록이 더 짧을 수만 있다)
  if (l.ticks * TICK * 1000 > now - t.iat + 15_000) return { ok: false, status: 400, error: '판 길이가 실제 시간보다 길어요' };
  used.set(t.rid, now);
  return { ok: true, result: replay(t.seed, l) };
}
