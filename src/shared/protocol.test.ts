import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMsg, snapshot } from './protocol.ts';
import { newFloor, step, CHECK_TIME } from './game.ts';

test('정상 입력은 통과하고 범위를 벗어난 값은 잘린다', () => {
  const m = parseClientMsg(JSON.stringify({ t: 'in', mx: 5, my: -0.5, aim: 1, fire: true, act: 'rack', check: false }));
  assert.deepEqual(m, { t: 'in', mx: 1, my: -0.5, aim: 1, fire: true, act: 'rack', check: false });
});

test('이상한 메시지는 거부한다', () => {
  for (const raw of ['nope', '{}', '{"t":"in","mx":"1","my":0,"aim":0}', '{"t":"in","mx":NaN}',
    JSON.stringify({ t: 'in', mx: 0, my: 0, aim: 0, act: 'cheat' }), JSON.stringify({ t: 'hp', hp: 99 }), 'x'.repeat(300)]) {
    assert.equal(parseClientMsg(raw), null, raw.slice(0, 40));
  }
});

test('스냅샷에 탄 수는 점검할 때만 담긴다', () => {
  const s = newFloor(1, 1); s.enemies = [];
  const idle = { mx: 0, my: 0, aim: 0, fire: false, act: null, check: false };
  step(s, idle, 0.03);
  const snap = snapshot(s);
  assert.equal(snap.ammo, null);
  assert.equal(JSON.stringify(snap).includes('looseRounds'), false);
  for (let t = 0; t < CHECK_TIME + 0.1; t += 0.05) step(s, { ...idle, check: true }, 0.05);
  assert.deepEqual(snapshot(s).ammo, { chamber: 1, mag: 8, pockets: [8, 8], loose: 0 });
});

test('벽 너머의 적은 스냅샷에 없다', () => {
  const s = newFloor(1, 1);
  // 플레이어와 적 사이에 벽을 세운다
  const tx = Math.floor(s.px / 32) + 2, ty = Math.floor(s.py / 32);
  for (let y = 0; y < 20; y++) s.map[y * 30 + tx] = 1;
  s.enemies = [{ id: 1, x: (tx + 2) * 32 + 16, y: ty * 32 + 16, hp: 2, kind: 'bug', cd: 0 },
    { id: 2, x: s.px + 30, y: s.py, hp: 2, kind: 'bug', cd: 0 }];
  assert.deepEqual(snapshot(s).enemies.map(e => e.id), [2]);
});
