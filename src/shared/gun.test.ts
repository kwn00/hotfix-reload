import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGun, fire, eject, insert, rack, grab, stow, tick, pickupMag, MAG_SIZE, totalRounds } from './gun.ts';

const ready = (g: ReturnType<typeof newGun>) => tick(g, 10);
const NOJAM = 0.99;

test('쏘면 탄창에서 다음 탄이 올라온다', () => {
  const g = newGun();
  assert.equal(fire(g, NOJAM), 'fire');
  assert.equal(g.chamber, true);
  assert.equal(g.mag, MAG_SIZE - 1);
});

test('9발 쏘면 탄이 떨어지고 그 뒤는 헛방', () => {
  const g = newGun();
  for (let i = 0; i < MAG_SIZE + 1; i++) { ready(g); assert.equal(fire(g, NOJAM), 'fire'); }
  ready(g); assert.equal(fire(g, NOJAM), 'dry');
});

test('장전 순서: 빼기(바닥) → 쥐기 → 꽂기 → 당기기', () => {
  const g = newGun();
  for (let i = 0; i < MAG_SIZE + 1; i++) { ready(g); fire(g, NOJAM); }
  ready(g); assert.equal(insert(g), 'no-mag', '손에 탄창이 없으면 못 꽂는다');
  ready(g); assert.equal(eject(g), 'eject');
  assert.equal(g.dropped, 0, '빈 탄창이 바닥에 떨어진다');
  ready(g); assert.equal(insert(g), 'no-mag');
  ready(g); assert.equal(grab(g, 0), 'grab');
  assert.equal(g.grip, MAG_SIZE); assert.equal(g.slots[0], null);
  ready(g); assert.equal(insert(g), 'insert');
  ready(g); assert.equal(fire(g, NOJAM), 'dry', '꽂기만 해서는 약실이 비어 있다');
  ready(g); assert.equal(rack(g), 'rack');
  ready(g); assert.equal(fire(g, NOJAM), 'fire');
});

test('빈 칸이나 손이 찬 상태로는 쥘 수 없다', () => {
  const g = newGun();
  assert.equal(grab(g, 3), 'empty-slot');
  grab(g, 0); ready(g);
  assert.equal(grab(g, 1), 'hand-full');
  ready(g); assert.equal(stow(g), 'stow');
  assert.deepEqual(g.slots, [MAG_SIZE, MAG_SIZE, null, null], '빈 첫 칸으로 돌아간다');
});

test('약실이 찬 채로 슬라이드를 당기면 한 발 버린다', () => {
  const g = newGun();
  const before = totalRounds(g);
  assert.equal(rack(g), 'rack-waste');
  assert.equal(totalRounds(g), before - 1);
});

test('걸리면 못 쏘고, 슬라이드를 당기면 걸린 탄을 버리고 풀린다', () => {
  const g = newGun();
  assert.equal(fire(g, 0), 'jam');
  ready(g); assert.equal(fire(g, NOJAM), 'jammed');
  const before = totalRounds(g);
  ready(g); assert.equal(rack(g), 'unjam');
  assert.equal(totalRounds(g), before - 1);
  ready(g); assert.equal(fire(g, NOJAM), 'fire');
});

test('동작 중에는 다른 동작을 못 한다', () => {
  const g = newGun();
  eject(g);
  assert.equal(grab(g, 0), 'busy');
});

test('주운 탄창은 빈 칸 → 빈 손 순서로 들어간다', () => {
  const g = newGun();
  assert.equal(pickupMag(g, 3), true);
  assert.equal(pickupMag(g, 5), true);
  assert.deepEqual(g.slots, [MAG_SIZE, MAG_SIZE, 3, 5]);
  assert.equal(pickupMag(g, 2), true);
  assert.equal(g.grip, 2);
  assert.equal(pickupMag(g, 1), false);
});
