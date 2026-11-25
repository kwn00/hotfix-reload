import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step, IDLE, enterRoom, TICK, solid, ENEMY, Enemy } from './game.ts';
import { ROOMS, parseRoom } from './level.ts';

const run = (s: ReturnType<typeof newGame>, inp = IDLE, n = 1) => { for (let i = 0; i < n; i++) step(s, inp, TICK); };
const enemy = (s: ReturnType<typeof newGame>, over: Partial<Enemy>): Enemy =>
  ({ id: 999, kind: 'bug', x: s.p.x + 200, y: s.p.y, vy: 0, hp: 1, dir: -1, alert: 0, aimT: 0, aimAng: Math.PI, cd: 99, burst: 0, burstT: 0, sees: false, heard: 0, ...over });

test('모든 방: 시작 자리는 바닥 위, 문이 있고, 적은 땅 위에 서 있다', () => {
  for (const r of ROOMS) {
    const m = parseRoom(r);
    assert.ok(solid(m, m.start.x, m.start.y + 4), `${r.name} 시작 자리 아래가 바닥이 아님`);
    assert.ok(m.tiles.includes(3), `${r.name} 문 없음`);
    for (const e of m.enemies) assert.ok(solid(m, e.x, e.y + 4), `${r.name} ${e.kind} 가 공중에 있음`);
    assert.ok(r.rows.every(row => row.length === r.rows[0].length), `${r.name} 줄 길이가 다름`);
  }
});

test('플레이어는 중력으로 땅에 서 있고 좌우로 움직인다', () => {
  const s = newGame(1); s.enemies = [];
  const y0 = s.p.y; run(s, IDLE, 10);
  assert.equal(s.p.y, y0);
  const x0 = s.p.x; run(s, { ...IDLE, mx: 1 }, 15);
  assert.ok(s.p.x > x0 + 50);
});

test('점프하면 떠올랐다가 다시 내려온다', () => {
  const s = newGame(1); s.enemies = [];
  const y0 = s.p.y;
  run(s, { ...IDLE, jump: true }); run(s, IDLE, 5);
  assert.ok(s.p.y < y0 - 40);
  run(s, IDLE, 60);
  assert.equal(s.p.y, y0);
});

test('적은 조준선을 보인 뒤에 쏜다 (바로 쏘지 않는다)', () => {
  const s = newGame(1);
  s.enemies = [enemy(s, { cd: 0 })];
  run(s, IDLE, 5);
  assert.equal(s.bullets.filter(b => b.enemy).length, 0, '반응 시간 동안은 쏘지 않음');
  assert.ok(s.enemies[0].aimT > 0 || s.enemies[0].alert > 0);
  run(s, IDLE, 40);
  assert.ok(s.events.length >= 0);
  assert.ok(s.deaths > 0 || s.p.hp < 2 || s.bullets.some(b => b.enemy), '결국 쏜다');
});

test('두 방 맞으면 쓰러지고, 잠시 뒤 방 처음으로 돌아간다 (탄은 방에 들어올 때 그대로)', () => {
  const s = newGame(1); s.enemies = [];
  s.gun.mag = 3; s.checkpoint.mag = 8;
  s.p.hp = 1;
  s.bullets.push({ id: 1, x: s.p.x - 10, y: s.p.y - 30, vx: 460, vy: 0, life: 1, enemy: true });
  run(s);
  assert.equal(s.deaths, 1);
  assert.ok(s.dead > 0);
  run(s, IDLE, 60);
  assert.equal(s.dead <= 0, true);
  assert.equal(s.p.hp, 2);
  assert.equal(s.gun.mag, 8);
});

test('숙이면 책상 높이 위로 날아오는 탄을 피한다', () => {
  const s = newGame(1); s.enemies = [];
  run(s, { ...IDLE, crouch: true });
  s.bullets.push({ id: 1, x: s.p.x - 10, y: s.p.y - 40, vx: 460, vy: 0, life: 1, enemy: true });
  run(s, { ...IDLE, crouch: true }, 3);
  assert.equal(s.p.hp, 2);
});

test('자동 조준: 조준이 조금 빗나가도 보이는 적에게 맞는다', () => {
  const s = newGame(1);
  s.enemies = [enemy(s, { x: s.p.x + 150 })];
  run(s, { ...IDLE, aim: 0.08, fire: true });
  run(s, IDLE, 10);
  assert.equal(s.kills, 1);
});

test('근접 격투: 붙어 있는 적을 제압한다', () => {
  const s = newGame(1);
  s.enemies = [enemy(s, { x: s.p.x + 25 })];
  run(s, { ...IDLE, melee: true });
  assert.ok(s.p.melee > 0);
  run(s, IDLE, 20);
  assert.equal(s.kills, 1);
  assert.ok(s.events.includes('takedown') || s.kills === 1);
});

test('슬로모션은 세상을 느리게 하고 게이지를 쓴다', () => {
  const a = newGame(1), b = newGame(1);
  a.enemies = []; b.enemies = [];
  a.bullets.push({ id: 1, x: 300, y: 100, vx: 400, vy: 0, life: 9, enemy: true });
  b.bullets.push({ id: 1, x: 300, y: 100, vx: 400, vy: 0, life: 9, enemy: true });
  run(a, IDLE, 10); run(b, { ...IDLE, slowmo: true }, 10);
  assert.ok(b.bullets[0].x - 300 < (a.bullets[0].x - 300) * 0.5);
  assert.ok(b.meter < 1);
});

test('문에서 E 를 누르면 다음 방, 마지막 방이면 이긴다', () => {
  const s = newGame(1);
  const toDoor = () => { const m = s.map; for (let i = 0; i < m.w * m.h; i++) if (m.tiles[i] === 3) { s.p.x = (i % m.w) * 32 - 6; s.p.y = (Math.floor(i / m.w) + 1) * 32; return; } };
  s.enemies = []; toDoor(); run(s, { ...IDLE, interact: true });
  assert.equal(s.room, 1);
  enterRoom(s, ROOMS.length - 1); s.enemies = []; toDoor(); run(s, { ...IDLE, interact: true });
  assert.equal(s.won, true);
});

test('적 정의는 모두 있다', () => { for (const k of ['bug', 'npe', 'conflict', 'debt'] as const) assert.ok(ENEMY[k].hp > 0); });

test('빠진 탄창은 바닥에 떨어지고, E 로 다시 줍는다', () => {
  const s = newGame(1); s.enemies = []; s.mags = [];
  run(s, { ...IDLE, act: 'eject' });
  assert.equal(s.mags.length, 1);
  assert.equal(s.gun.mag, null);
  run(s, IDLE, 10);
  assert.equal(s.mags.length, 1, '걸어가기만 해서는 줍지 않는다');
  run(s, { ...IDLE, interact: true });
  assert.equal(s.mags.length, 0);
  assert.deepEqual(s.gun.slots, [8, 8, 8, null]);
});

test('경계 상태: 적이 나를 보면 장애(alarmed)', () => {
  const s = newGame(1);
  s.enemies = [enemy(s, { x: s.p.x + 150 })];
  run(s, IDLE, 2);
  assert.equal(s.alarm, 'alarmed');
  s.enemies = []; run(s, IDLE);
  assert.equal(s.alarm, 'calm');
});

test('다시 시작하면 그 방에서 올린 처치 수는 되돌린다 (점수 불리기 방지)', () => {
  const s = newGame(1);
  s.enemies = [enemy(s, { x: s.p.x + 150 })];
  run(s, { ...IDLE, aim: 0, fire: true }); run(s, IDLE, 10);
  assert.equal(s.kills, 1);
  s.p.hp = 1; s.p.invuln = 0;
  s.bullets.push({ id: 1, x: s.p.x - 10, y: s.p.y - 30, vx: 460, vy: 0, life: 1, enemy: true });
  run(s, IDLE, 60);
  assert.equal(s.kills, 0);
  assert.equal(s.slowmo, false);
});

test('빨라진 탄도 얇은 적(NullPointerException)을 건너뛰지 않는다 (거리마다)', () => {
  for (let d = 60; d <= 360; d += 7) { // 첫 방에서 책상(x 480~512) 앞까지
    const s = newGame(1); s.rng = () => 0.99;
    s.enemies = [enemy(s, { kind: 'npe', x: s.p.x + d })];
    run(s, { ...IDLE, aim: 0, fire: true }); run(s, IDLE, 12);
    assert.equal(s.kills, 1, `거리 ${d}px 에서 빗나감`);
  }
});
