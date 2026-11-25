// 접속 하나 = 판 하나. 서버가 시드를 정하고 고정 틱으로 시뮬레이션한다.
import { randomInt } from 'node:crypto';
import { newFloor, step, State, Input, TICK } from '../src/shared/game.ts';
import { ClientMsg, ServerMsg, floorMsg, snapshot, FLOORS } from '../src/shared/protocol.ts';

const IDLE: Input = { mx: 0, my: 0, aim: 0, fire: false, act: null, check: false };

export class Session {
  state: State | null = null;
  private seed = 0;
  private input: Input = { ...IDLE };
  /** 한 틱 사이에 들어온 일회성 동작 (쏘기 / 장전). 틱마다 하나씩 처리해 연타로 빨라지지 않게 한다 */
  private pendingFire = false;
  private pendingAct: Input['act'] = null;

  constructor(private send: (m: ServerMsg) => void) {}

  handle(m: ClientMsg): void {
    if (m.t === 'start') {
      this.seed = randomInt(2 ** 31);
      this.state = newFloor(1, this.seed);
      this.send(floorMsg(this.state));
    } else if (m.t === 'next') {
      const s = this.state;
      if (!s || !s.cleared || s.floor >= FLOORS) return; // 깨지 않은 층은 넘길 수 없다
      this.state = newFloor(s.floor + 1, this.seed, { gun: s.gun, hp: Math.min(5, s.hp + 1), kills: s.kills, time: s.time });
      this.send(floorMsg(this.state));
    } else {
      this.input = { mx: m.mx, my: m.my, aim: m.aim, check: m.check, fire: false, act: null };
      if (m.fire) this.pendingFire = true;
      if (m.act) this.pendingAct = m.act;
    }
  }

  tick(): void {
    const s = this.state;
    if (!s) return;
    const inp: Input = { ...this.input, fire: this.pendingFire, act: this.pendingAct };
    // 동작 중(busy)이면 기다렸다가 처리한다 (누른 입력이 사라지지 않게)
    if (s.gun.busy <= 0) { this.pendingFire = false; this.pendingAct = null; }
    else inp.fire = false, inp.act = null;
    step(s, inp, TICK);
    this.send(snapshot(s));
  }
}
