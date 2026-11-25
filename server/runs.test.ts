import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueRun, readToken, finishRun } from './runs.ts';
import { Runner, NO_INPUT } from '../src/shared/runner.ts';
import { Recorder } from '../src/shared/replay.ts';
import { score } from '../src/shared/game.ts';
import { MemoryStore, type RunStore } from './store.ts';

const mem = () => new MemoryStore();

function play(seed: number, n: number) {
  const r = new Runner(seed), rec = new Recorder();
  for (let t = 0; t < n; t++) { const i = { ...NO_INPUT, mx: 1, fire: t % 20 === 0, aim: 0.05 }; r.tick(i); rec.add(i); }
  return { live: r, log: rec.log() };
}

test('토큰의 시드로 다시 돌린 점수를 돌려준다', async () => {
  const t0 = 1_000_000;
  const { token, seed } = issueRun(t0);
  const { live, log } = play(seed, 300);
  const res = await finishRun(mem(), token, log, t0 + 20_000);
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.result.score, score(live.state));
});

test('토큰을 고치면 받지 않는다 (시드 바꿔치기)', () => {
  const { token } = issueRun();
  const [data, mac] = token.split('.');
  const body = JSON.parse(Buffer.from(data, 'base64url').toString());
  body.seed = 1;
  const forged = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${mac}`;
  assert.equal(readToken(forged), null);
  assert.equal(readToken('nope'), null);
});

test('같은 판은 한 번만, 실제 시간보다 긴 기록은 받지 않는다', async () => {
  const t0 = 5_000_000;
  const a = issueRun(t0);
  const { log } = play(a.seed, 300); // 10초
  const st = mem();
  assert.equal((await finishRun(st, a.token, log, t0 + 2_000)).ok, true, '15초 여유 안');
  const again = await finishRun(st, a.token, log, t0 + 3_000);
  assert.equal(again.ok, false);
  const b = issueRun(t0);
  const long = play(b.seed, 30 * 60); // 60초
  const r = await finishRun(mem(), b.token, long.log, t0 + 10_000);
  assert.equal(r.ok, false);
});

test('서버가 재시작돼(메모리 목록이 비어도) 저장소에 남은 판은 다시 올릴 수 없다', async () => {
  const t0 = 9_000_000;
  const a = issueRun(t0);
  const { log } = play(a.seed, 60);
  const st = mem();
  assert.equal((await finishRun(st, a.token, log, t0 + 5_000)).ok, true);
  // 재시작 흉내: 같은 저장소(DB)에 이미 찜한 판 번호가 있다
  const shared: RunStore = { kind: 'memory', claim: async () => false, complete: async () => {}, close: async () => {} };
  const b = issueRun(t0);
  const r = await finishRun(shared, b.token, play(b.seed, 60).log, t0 + 5_000);
  assert.equal(r.ok, false);
});

test('DB 에 닿지 못해도 점수는 검증하고, 저장하지 못했다고 알린다', async () => {
  const t0 = 9_100_000;
  const a = issueRun(t0);
  const down: RunStore = { kind: 'postgres', claim: async () => { throw new Error('down'); }, complete: async () => { throw new Error('down'); }, close: async () => {} };
  const r = await finishRun(down, a.token, play(a.seed, 60).log, t0 + 5_000);
  assert.ok(r.ok && r.saved === false);
});
