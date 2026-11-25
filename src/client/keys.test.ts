import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyName } from './keys.ts';

test('자리(e.code)로 읽어서 한글 입력 상태와 상관없이 같은 동작이 된다', () => {
  // 한글 입력 상태에서 R 을 누르면 e.key 는 'ㄱ' 이지만 e.code 는 그대로 'KeyR'
  assert.equal(keyName('KeyR'), 'eject');
  assert.equal(keyName('KeyW'), 'jump');
  assert.equal(keyName('Digit1'), 'grab1');
  assert.equal(keyName('Space'), 'rack');
  assert.equal(keyName('ShiftRight'), 'slowmo');
  assert.equal(keyName('Slash'), 'guide');
  assert.equal(keyName('KeyZ'), null);
});
