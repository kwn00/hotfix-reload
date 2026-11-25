import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, roomMsg } from './protocol.ts';
import { newGame, step, IDLE, TICK, CHECK_TIME, Enemy } from './game.ts';

const enemy = (over: Partial<Enemy>): Enemy =>
  ({ id: 1, kind: 'bug', x: 0, y: 0, vy: 0, hp: 1, dir: -1, alert: 9, aimT: 0, aimAng: Math.PI, cd: 99, burst: 0, burstT: 0, sees: false, heard: 0, ...over });

test('스냅샷에 탄 수는 점검할 때만 담긴다 (주운 탄창의 탄 수도 없다)', () => {
  const s = newGame(1);
  step(s, IDLE, TICK);
  const snap = snapshot(s);
  assert.equal(snap.ammo, null);
  for (const m of snap.mags) assert.equal('rounds' in m, false);
  const json = JSON.stringify(snap);
  assert.doesNotMatch(json, /rounds|chamber|jammed|"mag":\d/);
  for (let t = 0; t < CHECK_TIME + 0.1; t += TICK) step(s, { ...IDLE, check: true }, TICK);
  assert.deepEqual(snapshot(s).ammo, { chamber: 1, mag: 8, slots: [8, 8, null, null], grip: null });
});

test('벽 너머의 적과 그 탄은 스냅샷에 없다', () => {
  const s = newGame(1);
  const tx = Math.floor(s.p.x / 32) + 3;
  for (let y = 0; y < s.map.h; y++) s.map.tiles[y * s.map.w + tx] = 1;
  s.enemies = [enemy({ id: 1, x: (tx + 3) * 32, y: s.p.y }), enemy({ id: 2, x: s.p.x + 50, y: s.p.y })];
  s.bullets = [{ id: 7, x: (tx + 2) * 32, y: s.p.y - 30, vx: 0, vy: 0, life: 1, enemy: true }];
  const snap = snapshot(s);
  assert.deepEqual(snap.enemies.map(e => e.id), [2]);
  assert.equal(snap.bullets.length, 0);
});

test('방 정보에는 지형만 있고 적 배치는 없다', () => {
  const s = newGame(1);
  const json = JSON.stringify(roomMsg(s));
  assert.doesNotMatch(json, /enem|bug|npe|start/);
});
