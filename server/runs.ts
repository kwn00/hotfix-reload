// 판 토큰과 기록 검증.
// - 시작: 서버가 시드를 정하고, {판 번호, 시드, 시작 시각} 에 서명한 토큰을 준다 (화면이 시드를 바꿔 치지 못하게)
// - 끝: 화면이 토큰과 입력 기록을 보내면, 서버가 같은 시드로 처음부터 다시 돌려 점수를 직접 계산한다.
//   화면이 보낸 점수는 믿지 않는다. 기록을 조작하면 결과가 달라질 뿐이다.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { checkLog, ReplayCursor, REPLAY_VERSION, type ReplayLog, type RunResult } from '../src/shared/replay.ts';
import { APP_VERSION } from '../src/shared/releases.ts';
import type { RunStore } from './store.ts';
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

/**
 * 이 서버가 받은 판 번호 (빠른 거절용 · DB 에 닿지 못할 때의 대비). 같은 판 두 번 올리기를 실제로 막는 것은 DB 의 claim 이다
 * (서버가 재시작되면 이 목록은 지워지지만 DB 에는 남는다)
 */
const used = new Map<string, number>();
setInterval(() => { const cut = Date.now() - TOKEN_TTL_MS; for (const [k, t] of used) if (t < cut) used.delete(k); }, 10 * 60 * 1000).unref();

/** saved: DB 에 저장했는지 (DB 에 닿지 못했으면 false. 점수는 검증했지만 남지 않는다) */
export type FinishResult = { ok: true; result: RunResult; saved: boolean } | { ok: false; status: number; error: string };

/** 본문을 읽기 전에 토큰부터 확인한다 (가짜 토큰으로 큰 본문을 보내 메모리를 쓰게 하지 못하게) */
export function precheckToken(token: unknown, now = Date.now()): { ok: true } | { ok: false; status: number; error: string } {
  const t = readToken(token);
  if (!t) return { ok: false, status: 400, error: '판 토큰이 올바르지 않아요' };
  if (now - t.iat > TOKEN_TTL_MS) return { ok: false, status: 400, error: '너무 오래된 판이에요' };
  if (used.has(t.rid)) return { ok: false, status: 409, error: '이미 올린 판이에요' };
  return { ok: true };
}

/** 한 번에 돌리는 틱 수. 그 사이사이에 다른 요청(화면 파일 · healthz)을 받는다 (0.1 CPU 에서 약 0.1초 분량) */
const CHUNK = 3000;
const yieldNow = () => new Promise<void>(r => setImmediate(r));

export async function finishRun(store: RunStore, token: unknown, log: unknown, now = Date.now()): Promise<FinishResult> {
  const pre = precheckToken(token, now);
  if (!pre.ok) return pre;
  const t = readToken(token)!;
  const bad = checkLog(log);
  if (bad) return { ok: false, status: 400, error: bad };
  const l = log as ReplayLog;
  // 실제 시간보다 빨리 끝낼 수는 없다 (틱은 1/30초. 일시정지한 시간은 틱에 들어가지 않으므로 기록이 더 짧을 수만 있다)
  if (l.ticks * TICK * 1000 > now - t.iat + 15_000) return { ok: false, status: 400, error: '판 길이가 실제 시간보다 길어요' };
  used.set(t.rid, now); // 검증을 시작하는 순간 쓴 것으로 친다 (같은 판을 동시에 여러 번 올리지 못하게)
  // DB 에 판 번호를 찜한다. 이미 있으면(서버가 재시작된 뒤 다시 올림 등) 거절. DB 에 닿지 못하면 검증만 하고 저장하지 않는다
  let dbOk = true;
  try {
    if (!(await store.claim({ rid: t.rid, seed: t.seed, startedAt: t.iat, version: APP_VERSION, replayVersion: REPLAY_VERSION }))) {
      return { ok: false, status: 409, error: '이미 올린 판이에요' };
    }
  } catch (e) { dbOk = false; console.error('[db] 판 번호를 찜하지 못했어요', (e as Error).message); }
  const c = new ReplayCursor(t.seed, l);
  while (!c.run(CHUNK)) await yieldNow();
  const result = c.result();
  let saved = false;
  if (dbOk) {
    try { await store.complete(t.rid, result, l); saved = true; }
    catch (e) { console.error('[db] 결과를 저장하지 못했어요', (e as Error).message); }
  }
  return { ok: true, result, saved };
}
