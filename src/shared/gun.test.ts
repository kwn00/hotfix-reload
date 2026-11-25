import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGun, fire, eject, insert, rack, tick, pickupMag, MAG_SIZE, MAX_POCKETS, totalRounds } from './gun.ts';

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
  ready(g);
  assert.equal(fire(g, NOJAM), 'dry');
});

test('탄창을 갈아 끼워도 슬라이드를 당기기 전엔 못 쏜다', () => {
  const g = newGun();
  for (let i = 0; i < MAG_SIZE + 1; i++) { ready(g); fire(g, NOJAM); }
  ready(g); assert.equal(eject(g), 'eject');
  assert.equal(g.pockets.length, 2, '빈 탄창은 버린다');
  ready(g); assert.equal(insert(g), 'insert');
  ready(g); assert.equal(fire(g, NOJAM), 'dry');
  ready(g); assert.equal(rack(g), 'rack');
  ready(g); assert.equal(fire(g, NOJAM), 'fire');
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
  assert.equal(g.jammed, true);
  ready(g); assert.equal(fire(g, NOJAM), 'jammed');
  const before = totalRounds(g);
  ready(g); assert.equal(rack(g), 'unjam');
  assert.equal(g.jammed, false);
  assert.equal(totalRounds(g), before - 1);
  ready(g); assert.equal(fire(g, NOJAM), 'fire');
});

test('동작 중에는 다른 동작을 못 한다', () => {
  const g = newGun();
  eject(g);
  assert.equal(insert(g), 'busy');
});

test('주머니는 4칸까지', () => {
  const g = newGun();
  assert.equal(pickupMag(g, 3), true);
  assert.equal(pickupMag(g, 3), true);
  assert.equal(pickupMag(g, 3), false);
  assert.equal(g.pockets.length, MAX_POCKETS);
});
