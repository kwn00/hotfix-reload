import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Predictor } from './predict.ts';
import { newGame, step, IDLE, TICK } from '../shared/game.ts';
import { roomMsg, snapshot } from '../shared/protocol.ts';

test('예측은 서버와 같은 결과를 낸다 (지연이 있어도 ack 뒤의 입력을 다시 적용해 맞춤)', () => {
  const s = newGame(3); s.enemies = [];
  const pr = new Predictor();
  pr.setRoom(roomMsg(s));
  pr.onSnap(snapshot(s, 0));
  const inputs = Array.from({ length: 40 }, (_, k) => ({ seq: k + 1, mx: k < 25 ? 1 : 0, jump: k === 10, crouch: k > 30, slowmo: false }));
  const LAG = 3; // 서버가 3틱 늦게 처리한다
  for (let k = 0; k < inputs.length; k++) {
    pr.step(inputs[k]);
    if (k >= LAG) {
      const i = inputs[k - LAG];
      step(s, { ...IDLE, mx: i.mx, jump: i.jump, crouch: i.crouch }, TICK);
      pr.onSnap(snapshot(s, i.seq));
    }
  }
  for (let k = inputs.length - LAG; k < inputs.length; k++) {
    const i = inputs[k];
    step(s, { ...IDLE, mx: i.mx, jump: i.jump, crouch: i.crouch }, TICK);
  }
  pr.onSnap(snapshot(s, inputs.length));
  const r = pr.render(1, 10)!;
  assert.ok(Math.abs(r.x - s.p.x) < 0.01 && Math.abs(r.y - s.p.y) < 0.01, `예측 ${r.x},${r.y} / 서버 ${s.p.x},${s.p.y}`);
});

test('입력을 넣는 즉시 예측 위치가 움직인다 (서버를 기다리지 않음)', () => {
  const s = newGame(3); s.enemies = [];
  const pr = new Predictor();
  pr.setRoom(roomMsg(s)); pr.onSnap(snapshot(s, 0));
  const x0 = pr.render(1, 0)!.x;
  pr.step({ seq: 1, mx: 1, jump: false, crouch: false, slowmo: false });
  assert.ok(pr.render(1, 0)!.x > x0);
});
