import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GunPredictor, applyAct, type GunView } from './gunpredict.ts';
import { newGame, step, IDLE, TICK, type Action } from '../shared/game.ts';
import { snapshot } from '../shared/protocol.ts';

test('보이는 상태 규칙은 서버의 총과 같은 결과를 낸다 (빼기 · 쥐기 · 꽂기 · 넣기 · 당기기)', () => {
  const acts: Action[] = ['insert', 'eject', 'grab3', 'grab1', 'grab2', 'stow', 'insert', 'grab1', 'stow', 'eject', 'insert', 'rack', 'grab2', 'insert'];
  const s = newGame(1); s.enemies = [];
  const v: GunView = { magIn: true, slots: [true, true, false, false], grip: false, busy: 0 };
  for (const a of acts) {
    applyAct(v, a); v.busy = 0;
    step(s, { ...IDLE, act: a }, TICK);
    s.gun.busy = 0;
    const g = snapshot(s).gun;
    assert.deepEqual({ magIn: v.magIn, slots: v.slots, grip: v.grip }, { magIn: g.magIn, slots: g.slots, grip: g.grip }, `동작 ${a} 뒤`);
  }
});

test('키를 누르면 바로 바뀌고, 서버가 처리하기 전 스냅샷이 와도 되돌아가지 않는다', () => {
  const s = newGame(1); s.enemies = [];
  const gp = new GunPredictor();
  gp.onSnap(snapshot(s, 0, 0), 0);
  assert.equal(gp.press(1, 'eject', 0), 'eject');
  assert.equal(gp.get()!.magIn, false, '즉시');
  gp.onSnap(snapshot(s, 1, 0), 50); // 서버는 아직 처리 전 (총이 바빴다)
  assert.equal(gp.get()!.magIn, false, '되돌아가지 않음');
  step(s, { ...IDLE, act: 'eject' }, TICK);
  gp.onSnap(snapshot(s, 1, 1), 100);
  assert.equal(gp.get()!.magIn, false);
});

test('총이 바쁜 동안 누른 동작은 미리 하지 않는다 (서버가 줄 세워 처리)', () => {
  const s = newGame(1); s.enemies = [];
  const gp = new GunPredictor();
  gp.onSnap(snapshot(s, 0, 0), 0);
  gp.press(1, 'eject', 0);
  assert.equal(gp.press(2, 'grab1', 10), null);
  gp.tick(1);
  assert.equal(gp.press(3, 'grab1', 20), 'grab');
});

test('서버가 끝내 처리하지 않은 동작은 1.5초 뒤 내려놓고 서버 상태를 따른다', () => {
  const s = newGame(1); s.enemies = [];
  const gp = new GunPredictor();
  gp.onSnap(snapshot(s, 0, 0), 0);
  gp.press(1, 'eject', 0);
  gp.onSnap(snapshot(s, 5, 0), 2000);
  assert.equal(gp.get()!.magIn, true);
});
