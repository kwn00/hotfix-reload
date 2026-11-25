// 접속 하나 = 판 하나. 서버가 시드를 정하고 고정 틱으로 시뮬레이션한다.
import { randomInt } from 'node:crypto';
import { newGame, step, State, Input, IDLE, TICK } from '../src/shared/game.ts';
import { ClientMsg, ServerMsg, roomMsg, snapshot } from '../src/shared/protocol.ts';

export class Session {
  state: State | null = null;
  private input: Input = { ...IDLE };
  private lastRoom = -1;
  /** 한 틱 사이에 들어온 일회성 동작. 총이 동작 중이면 끝날 때까지 기다렸다 처리한다 (연타로 빨라지지 않게) */
  private pending = { fire: false, melee: false, jump: false, interact: false, acts: [] as NonNullable<Input['act']>[] };
  /** 쌓아 둘 수 있는 장전 동작 수 (빠르게 R → 1 → F → Space 를 눌러도 순서대로 처리한다) */
  static readonly MAX_ACTS = 4;

  constructor(private send: (m: ServerMsg) => void) {}

  handle(m: ClientMsg): void {
    if (m.t === 'start') {
      this.state = newGame(randomInt(2 ** 31));
      this.lastRoom = -1;
      this.input = { ...IDLE };
      this.pending = { fire: false, melee: false, jump: false, interact: false, acts: [] };
      return;
    }
    this.input = { ...IDLE, mx: m.mx, aim: m.aim, crouch: m.crouch, slowmo: m.slowmo, check: m.check };
    if (m.fire) this.pending.fire = true;
    if (m.melee) this.pending.melee = true;
    if (m.jump) this.pending.jump = true;
    if (m.interact) this.pending.interact = true;
    if (m.act && this.pending.acts.length < Session.MAX_ACTS) this.pending.acts.push(m.act);
  }

  tick(): void {
    const s = this.state;
    if (!s) return;
    if (s.room !== this.lastRoom) { this.lastRoom = s.room; this.send(roomMsg(s)); }
    const p = this.pending, busy = s.gun.busy > 0 || s.p.melee > 0;
    const inp: Input = { ...this.input, jump: p.jump, interact: p.interact,
      fire: busy ? false : p.fire, melee: busy ? false : p.melee, act: busy ? null : (p.acts[0] ?? null) };
    p.jump = false; p.interact = false;
    if (!busy) { p.fire = false; p.melee = false; p.acts.shift(); }
    step(s, inp, TICK);
    if (s.room !== this.lastRoom) { this.lastRoom = s.room; this.send(roomMsg(s)); }
    this.send(snapshot(s));
  }
}
