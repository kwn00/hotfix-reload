import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runner, type TickInput, NO_INPUT } from './runner.ts';
import { Recorder, replay, checkLog } from './replay.ts';
import { mulberry32, ACTION_LIST, score } from './game.ts';

/** 사람처럼 무작위로 누르는 입력 */
function bot(seed: number, n: number): TickInput[] {
  const r = mulberry32(seed); const out: TickInput[] = [];
  let mx = 0, crouch = false, aim = 0.1;
  for (let t = 0; t < n; t++) {
    if (r() < 0.05) mx = [-1, 0, 1, 1][Math.floor(r() * 4)];
    if (r() < 0.03) crouch = !crouch;
    aim += (r() - 0.5) * 0.2;
    out.push({ ...NO_INPUT, mx, crouch, aim, jump: r() < 0.02, fire: r() < 0.08, melee: r() < 0.01, interact: r() < 0.02,
      slowmo: r() < 0.1, check: r() < 0.05, act: r() < 0.04 ? ACTION_LIST[Math.floor(r() * ACTION_LIST.length)] : null });
  }
  return out;
}

test('브라우저에서 돈 판과 서버가 기록으로 다시 돌린 판이 똑같다', () => {
  for (const seed of [1, 42, 777]) {
    const live = new Runner(seed), rec = new Recorder();
    for (const i of bot(seed, 4000)) { live.tick(i); rec.add(i); if (live.state.won) break; }
    const log = JSON.parse(JSON.stringify(rec.log())); // 네트워크를 지나는 것처럼
    assert.equal(checkLog(log), null);
    const res = replay(seed, log);
    assert.equal(res.score, score(live.state));
    assert.equal(res.kills, live.state.kills);
    assert.equal(res.deaths, live.state.deaths);
    assert.equal(res.room, live.state.room);
  }
});

test('조준을 계속 움직여도 쏘지 않으면 기록이 작다', () => {
  const rec = new Recorder();
  for (let t = 0; t < 3000; t++) rec.add({ ...NO_INPUT, aim: 0.3 + Math.sin(t / 10) * 0.5, mx: 1 });
  assert.ok(rec.log().e.length < 10, `항목 ${rec.log().e.length}개`);
});

test('이상한 기록은 받지 않는다', () => {
  for (const bad of [null, {}, { v: 1, ticks: 0, e: [] }, { v: 1, ticks: 10, e: [[1, 2, 0, 0, 0]] }, { v: 1, ticks: 10, e: [[1, 0, 99, 0, 0]] },
    { v: 1, ticks: 5, e: [[1, 0, 0, 0, 0], [9, 0, 0, 0, 0]] }, { v: 1, ticks: 10, e: [[1, 0, 0, 1024, 0]] }, { v: 1, ticks: 10, e: [[1, 0, 0, 0, 99]] }, { v: 2, ticks: 1, e: [[1, 0, 0, 0, 0]] }]) {
    assert.notEqual(checkLog(bad), null, JSON.stringify(bad));
  }
});

test('기록 속의 점수 조작은 통하지 않는다 (서버는 입력만 다시 돌린다)', () => {
  const live = new Runner(5), rec = new Recorder();
  for (const i of bot(5, 600)) { live.tick(i); rec.add(i); }
  const log = rec.log() as unknown as Record<string, unknown>;
  log.score = 999999; log.kills = 999;
  assert.equal(replay(5, log as never).score, score(live.state));
});

test('적을 쓰러뜨리고 · 쓰러지고 · 방을 넘는 4분 판도 서버에서 똑같이 나온다', () => {
  for (const seed of [1, 5]) {
    const r = new Runner(seed), rec = new Recorder();
    for (let t = 0; t < 30 * 240; t++) {
      const k = t % 300;
      const i: TickInput = { ...NO_INPUT, mx: k < 200 ? 1 : 0, aim: 0.05 + Math.sin(t / 13) * 0.1, fire: t % 9 === 0, crouch: k > 260,
        jump: t % 47 === 0, interact: t % 31 === 0,
        act: k === 210 ? 'eject' : k === 220 ? 'grab1' : k === 232 ? 'insert' : k === 250 ? 'rack' : k === 270 ? 'grab2' : null };
      r.tick(i); rec.add(i); if (r.state.won) break;
    }
    const res = replay(seed, JSON.parse(JSON.stringify(rec.log())));
    assert.ok(r.state.kills > 0 && r.state.deaths > 0 && r.state.room > 0, '시나리오가 충분히 진행됨');
    assert.deepEqual([res.room, res.kills, res.deaths, res.score], [r.state.room, r.state.kills, r.state.deaths, score(r.state)]);
  }
});

test('총이 바쁠 때 누른 쏘기는 나중에 나가도 누른 순간의 조준으로 나간다', () => {
  const r = new Runner(1); r.state.enemies = []; r.state.rng = () => 0.99;
  r.tick({ ...NO_INPUT, fire: true, aim: 0 });            // 첫 발 → 총이 잠깐 바쁨
  r.tick({ ...NO_INPUT, fire: true, aim: -0.8 });         // 바쁜 동안 위로 겨눠 클릭
  for (let i = 0; i < 6; i++) r.tick({ ...NO_INPUT, aim: -0.8 });
  const b = r.state.bullets.at(-1)!;
  assert.ok(b.vy < -1000, `위로 나가야 함 (vy ${b.vy})`);
});
