import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newFloor, step, shoot, solidAt } from './game.ts';

const idle = { mx: 0, my: 0, aim: 0, fire: false, act: null, check: false };

test('같은 시드면 같은 층이 나온다', () => {
  assert.deepEqual(newFloor(1, 42).map, newFloor(1, 42).map);
});

test('시작 칸과 출구는 벽이 아니다', () => {
  const s = newFloor(3, 7);
  assert.equal(solidAt(s, s.px, s.py), false);
  assert.equal(solidAt(s, s.exit.x, s.exit.y), false);
});

test('탄을 쏘면 총알이 생긴다', () => {
  const s = newFloor(1, 1); s.enemies = [];
  assert.equal(shoot(s), 'fire');
  assert.equal(s.bullets.length, 1);
});

test('출구에 닿으면 층을 깬다', () => {
  const s = newFloor(1, 1); s.enemies = [];
  s.px = s.exit.x; s.py = s.exit.y;
  step(s, idle, 0.016);
  assert.equal(s.cleared, true);
});

test('Merge Conflict 는 죽으면 둘로 갈라진다', () => {
  const s = newFloor(1, 1);
  s.enemies = [{ id: 99, x: s.px + 40, y: s.py, hp: 1, kind: 'conflict', cd: 0 }];
  s.bullets = [{ x: s.px + 30, y: s.py, vx: 500, vy: 0, life: 1 }];
  step(s, idle, 0.02);
  assert.equal(s.enemies.filter(e => e.kind === 'mini').length, 2);
});

test('입력의 장전 동작은 서버 시뮬레이션에서 처리된다', () => {
  const s = newFloor(1, 1); s.enemies = [];
  step(s, { ...idle, act: 'eject' }, 0.016);
  assert.equal(s.gun.mag, null);
  assert.deepEqual(s.events, ['eject']);
});
