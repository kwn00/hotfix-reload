import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from './session.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';

const base = { mx: 0, my: 0, aim: 0, fire: false, act: null, check: false } as const;

test('시작하면 층 정보를 보내고 틱마다 스냅샷을 보낸다', () => {
  const out: ServerMsg[] = [];
  const s = new Session(m => out.push(m));
  s.handle({ t: 'start' });
  s.tick();
  assert.deepEqual(out.map(m => m.t), ['floor', 'snap']);
});

test('깨지 않은 층은 next 로 넘길 수 없다', () => {
  const s = new Session(() => {});
  s.handle({ t: 'start' });
  s.handle({ t: 'next' });
  assert.equal(s.state!.floor, 1);
});

test('쏘기 연타는 총의 동작 시간보다 빨라지지 않는다', () => {
  let fired = 0;
  const s = new Session(m => { if (m.t === 'snap') fired += m.events.filter(e => e === 'fire').length; });
  s.handle({ t: 'start' });
  s.state!.enemies = [];
  for (let i = 0; i < 30; i++) { s.handle({ t: 'in', ...base, fire: true }); s.tick(); } // 1초 동안 매 틱 쏘기
  // 한 발에 0.12초 → 1초에 많아야 9발
  assert.ok(fired >= 5 && fired <= 9, `쏜 수 ${fired}`);
});

test('입력으로 체력이나 위치를 바꿀 수 없다 (모르는 필드는 무시)', () => {
  const s = new Session(() => {});
  s.handle({ t: 'start' });
  const before = { ...s.state! };
  s.handle({ t: 'in', ...base, hp: 99, px: 500 } as never);
  s.tick();
  assert.equal(s.state!.hp, before.hp);
  assert.equal(s.state!.px, before.px);
});
