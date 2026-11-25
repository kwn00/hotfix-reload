import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGun, fire, eject, insert, rack, fillOne, tick, MAG_SIZE, totalRounds } from './gun.ts';

const ready = (g: ReturnType<typeof newGun>) => tick(g, 10);

test('쏘면 탄창에서 다음 탄이 올라온다', () => {
  const g = newGun();
  assert.equal(fire(g), 'fire');
  assert.equal(g.chamber, true);
  assert.equal(g.mag, MAG_SIZE - 1);
});

test('9발 쏘면 탄이 떨어지고 그 뒤는 헛방', () => {
  const g = newGun();
  for (let i = 0; i < MAG_SIZE + 1; i++) { ready(g); assert.equal(fire(g), 'fire'); }
  ready(g);
  assert.equal(fire(g), 'dry');
  assert.equal(g.mag, 0);
});

test('탄창을 갈아 끼워도 슬라이드를 당기기 전엔 못 쏜다', () => {
  const g = newGun();
  for (let i = 0; i < MAG_SIZE + 1; i++) { ready(g); fire(g); }
  ready(g); assert.equal(eject(g), 'eject');
  assert.equal(g.pockets.length, 2, '빈 탄창은 버린다');
  ready(g); assert.equal(insert(g), 'insert');
  ready(g); assert.equal(fire(g), 'dry');
  ready(g); assert.equal(rack(g), 'rack');
  ready(g); assert.equal(fire(g), 'fire');
});

test('약실이 찬 채로 슬라이드를 당기면 한 발 버린다', () => {
  const g = newGun();
  const before = totalRounds(g);
  assert.equal(rack(g), 'rack-waste');
  assert.equal(totalRounds(g), before - 1);
});

test('남은 탄이 있는 탄창은 주머니 뒤로 간다', () => {
  const g = newGun();
  fire(g); ready(g); eject(g);
  assert.deepEqual(g.pockets, [MAG_SIZE, MAG_SIZE, MAG_SIZE - 1]);
});

test('동작 중에는 다른 동작을 못 한다', () => {
  const g = newGun();
  eject(g);
  assert.equal(insert(g), 'busy');
});

test('낱개 탄은 가장 덜 찬 탄창부터 채운다', () => {
  const g = newGun();
  g.pockets = [8, 3, 5]; g.looseRounds = 2;
  fillOne(g); ready(g); fillOne(g);
  assert.deepEqual(g.pockets, [8, 5, 5]);
  ready(g); assert.equal(fillOne(g), 'fill-none');
});
