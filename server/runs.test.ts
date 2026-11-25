import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueRun, readToken, finishRun } from './runs.ts';
import { Runner, NO_INPUT } from '../src/shared/runner.ts';
import { Recorder } from '../src/shared/replay.ts';
import { score } from '../src/shared/game.ts';

function play(seed: number, n: number) {
  const r = new Runner(seed), rec = new Recorder();
  for (let t = 0; t < n; t++) { const i = { ...NO_INPUT, mx: 1, fire: t % 20 === 0, aim: 0.05 }; r.tick(i); rec.add(i); }
  return { live: r, log: rec.log() };
}

test('토큰의 시드로 다시 돌린 점수를 돌려준다', async () => {
  const t0 = 1_000_000;
  const { token, seed } = issueRun(t0);
  const { live, log } = play(seed, 300);
  const res = await finishRun(token, log, t0 + 20_000);
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
  assert.equal((await finishRun(a.token, log, t0 + 2_000)).ok, true, '15초 여유 안');
  const again = await finishRun(a.token, log, t0 + 3_000);
  assert.equal(again.ok, false);
  const b = issueRun(t0);
  const long = play(b.seed, 30 * 60); // 60초
  const r = await finishRun(b.token, long.log, t0 + 10_000);
  assert.equal(r.ok, false);
});
