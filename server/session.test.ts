import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from './session.ts';
import type { ServerMsg } from '../src/shared/protocol.ts';

const base = { mx: 0, aim: 0, jump: false, crouch: false, fire: false, melee: false, act: null, slowmo: false, check: false, interact: false } as const;

test('시작하면 방 정보를 보내고 틱마다 스냅샷을 보낸다', () => {
  const out: ServerMsg[] = [];
  const s = new Session(m => out.push(m));
  s.handle({ t: 'start' });
  s.tick(); s.tick();
  assert.deepEqual(out.map(m => m.t), ['room', 'snap', 'snap']);
});

test('쏘기 연타는 총의 동작 시간보다 빨라지지 않는다', () => {
  let fired = 0;
  const s = new Session(m => { if (m.t === 'snap') fired += m.events.filter(e => e === 'fire' || e === 'jam').length; });
  s.handle({ t: 'start' });
  s.state!.enemies = [];
  s.state!.rng = () => 0.99; // 걸리지 않게 (걸림은 따로 테스트한다)
  for (let i = 0; i < 30; i++) { s.handle({ t: 'in', ...base, aim: -1.5, fire: true }); s.tick(); }
  assert.ok(fired >= 4 && fired <= 8, `쏜 수 ${fired}`);
});

test('입력으로 체력이나 위치를 바꿀 수 없다', () => {
  const s = new Session(() => {});
  s.handle({ t: 'start' });
  const hp = s.state!.p.hp, x = s.state!.p.x;
  s.handle({ t: 'in', ...base, hp: 99, x: 500 } as never);
  s.tick();
  assert.equal(s.state!.p.hp, hp);
  assert.equal(s.state!.p.x, x);
});

test('시작 전 입력은 무시한다', () => {
  const s = new Session(() => { throw new Error('보내면 안 됨'); });
  s.handle({ t: 'in', ...base, fire: true });
  s.tick();
});

test('총이 동작 중일 때 누른 장전 동작은 순서대로 모두 처리된다', () => {
  const s = new Session(() => {});
  s.handle({ t: 'start' });
  s.state!.enemies = []; s.state!.rng = () => 0.99;
  s.handle({ t: 'in', ...base, fire: true }); s.tick();          // 쏘기 → 잠깐 바쁨
  s.handle({ t: 'in', ...base, act: 'eject' });
  s.handle({ t: 'in', ...base, act: 'grab1' });
  s.handle({ t: 'in', ...base, act: 'insert' });
  for (let i = 0; i < 60; i++) s.tick();
  assert.equal(s.state!.gun.mag, 8, '빼고 → 쥐고 → 꽂기가 모두 됨');
  assert.equal(s.state!.gun.slots[0], null);
});

test('새 판을 시작하면 이전 판에서 쌓인 입력은 버린다', () => {
  const s = new Session(() => {});
  s.handle({ t: 'start' });
  s.state!.gun.busy = 5;
  s.handle({ t: 'in', ...base, act: 'eject', fire: true });
  s.handle({ t: 'start' });
  s.state!.enemies = [];
  s.tick();
  assert.equal(s.state!.gun.mag, 8);
  assert.equal(s.state!.bullets.length, 0);
});
