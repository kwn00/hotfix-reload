import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsin, dcos, datan2, dhypot } from './dmath.ts';

test('결정적 sin · cos · atan2 · hypot 는 Math 와 거의 같다', () => {
  let worst = 0;
  for (let i = -2000; i <= 2000; i++) {
    const x = i * 0.0137;
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
  }
  for (let i = 0; i < 2000; i++) {
    const a = i * 0.00314 - 3.14, r = 1 + i;
    const y = Math.sin(a) * r, x = Math.cos(a) * r;
    worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    worst = Math.max(worst, Math.abs(dhypot(x, y) - Math.hypot(x, y)) / r);
  }
  for (const [y, x] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [0, 0]]) {
    worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
  }
  assert.ok(worst < 1e-9, `최대 오차 ${worst}`);
});
