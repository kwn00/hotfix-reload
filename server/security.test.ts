import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, originAllowed } from './security.ts';
import type { IncomingMessage } from 'node:http';

test('토큰 버킷은 한도를 넘으면 막고 시간이 지나면 다시 채운다', () => {
  let now = 0;
  const b = new TokenBucket(3, 1, () => now);
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false]);
  now = 1000;
  assert.equal(b.take(), true);
});

test('다른 사이트의 Origin 은 거부한다', () => {
  const req = (origin: string | undefined, host: string) => ({ headers: { origin, host } }) as unknown as IncomingMessage;
  assert.equal(originAllowed(req('https://game.onrender.com', 'game.onrender.com')), true);
  assert.equal(originAllowed(req('https://evil.example', 'game.onrender.com')), false);
});
