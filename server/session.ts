// 접속 하나 = 판 하나. 서버가 시드를 정하고 고정 틱(30Hz)으로 시뮬레이션한다.
// 화면은 입력을 "틱마다 하나씩" 번호(seq)를 붙여 보내고, 서버는 틱마다 하나씩 꺼내 쓴다.
// 스냅샷에 처리한 번호(ack)를 실어 보내면, 화면은 그 뒤의 입력을 다시 적용해 즉시 반응을 예측한다.
import { randomInt } from 'node:crypto';
import { newGame, step, State, Input, IDLE, TICK } from '../src/shared/game.ts';
import { ClientMsg, ServerMsg, roomMsg, snapshot } from '../src/shared/protocol.ts';

type InMsg = Extract<ClientMsg, { t: 'in' }>;

export class Session {
  state: State | null = null;
  /** 아직 쓰지 않은 입력 (틱마다 하나씩). 화면 시계가 조금 빨라도 쌓이지 않게 길이를 제한한다 */
  private queue: InMsg[] = [];
  static readonly MAX_QUEUE = 6;
  /** 틱마다 남겨 둘 입력 수 (네트워크 흔들림을 받아 주되 지연은 늘리지 않게) */
  static readonly BUFFER = 2;
  private last: Input = { ...IDLE };
  private ack = 0;
  private lastRoom = -1;
  /** 일회성 동작. 총이 동작 중이면 끝날 때까지 기다렸다 처리한다 (연타로 빨라지지 않게) */
  private pending = { fire: false, melee: false, jump: false, interact: false, acts: [] as NonNullable<Input['act']>[] };
  /** 쌓아 둘 수 있는 장전 동작 수 (빠르게 R → 1 → F → Space 를 눌러도 순서대로 처리한다) */
  static readonly MAX_ACTS = 4;

  constructor(private send: (m: ServerMsg) => void) {}

  handle(m: ClientMsg): void {
    if (m.t === 'start') {
      this.state = newGame(randomInt(2 ** 31));
      this.lastRoom = -1;
      this.queue = []; this.last = { ...IDLE }; this.ack = 0;
      this.pending = { fire: false, melee: false, jump: false, interact: false, acts: [] };
      return;
    }
    if (m.seq <= this.ack && this.ack > 0) return; // 이미 처리한 번호
    this.queue.push(m);
    // 넘치면 가장 오래된 것을 버리되, 그 안의 일회성 동작은 살린다
    while (this.queue.length > Session.MAX_QUEUE) this.takeOneShots(this.queue.shift()!);
  }

  private takeOneShots(m: InMsg) {
    const p = this.pending;
    if (m.fire) p.fire = true;
    if (m.melee) p.melee = true;
    if (m.jump) p.jump = true;
    if (m.interact) p.interact = true;
    if (m.act && p.acts.length < Session.MAX_ACTS) p.acts.push(m.act);
  }

  tick(): void {
    const s = this.state;
    if (!s) return;
    if (s.room !== this.lastRoom) { this.lastRoom = s.room; this.send(roomMsg(s)); }
    // 줄이 길면(서버 타이머가 조금 늦었음) 오래된 입력의 이동은 건너뛰고 일회성 동작만 살린다.
    // 줄이 쌓이면 그만큼 반응이 늦어지므로 2개 넘게 두지 않는다
    while (this.queue.length > Session.BUFFER) this.takeOneShots(this.queue.shift()!);
    // 이번 틱의 입력: 줄의 맨 앞. 없으면 마지막 입력을 그대로 (일회성 동작은 빼고)
    const m = this.queue.shift();
    if (m) {
      this.last = { ...IDLE, mx: m.mx, aim: m.aim, crouch: m.crouch, slowmo: m.slowmo, check: m.check };
      this.ack = m.seq;
      this.takeOneShots(m);
    }
    const p = this.pending, busy = s.gun.busy > 0 || s.p.melee > 0;
    const inp: Input = { ...this.last, jump: p.jump, interact: p.interact,
      fire: busy ? false : p.fire, melee: busy ? false : p.melee, act: busy ? null : (p.acts[0] ?? null) };
    p.jump = false; p.interact = false;
    if (!busy) { p.fire = false; p.melee = false; p.acts.shift(); }
    step(s, inp, TICK);
    if (s.room !== this.lastRoom) { this.lastRoom = s.room; this.send(roomMsg(s)); }
    this.send(snapshot(s, this.ack));
  }
}
