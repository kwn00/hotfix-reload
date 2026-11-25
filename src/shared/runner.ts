// 판 진행기: 틱마다 입력 하나를 받아 시뮬레이션을 한 틱 돌린다.
// 브라우저(실제 플레이)와 서버(기록 검증)가 같은 코드를 써서, 같은 시드 + 같은 입력이면 같은 결과가 나온다.
import { newGame, step, State, Input, IDLE, TICK, Action } from './game.ts';
import { dcos } from './dmath.ts';

/** 한 틱의 입력 (화면이 기록하고, 서버가 다시 돌린다) */
export interface TickInput {
  mx: number; aim: number;
  jump: boolean; crouch: boolean; fire: boolean; melee: boolean;
  act: Action | null; slowmo: boolean; check: boolean; interact: boolean;
}
export const NO_INPUT: TickInput = { mx: 0, aim: 0, jump: false, crouch: false, fire: false, melee: false, act: null, slowmo: false, check: false, interact: false };

/**
 * 입력을 결과에 영향을 주는 것만 남긴 모양으로 맞춘다.
 * 조준 각도는 쏠 때만 쓰이고, 그 밖에는 몸이 어느 쪽을 보는지만 쓰인다.
 * 그래서 쏘지 않는 틱은 오른쪽(0) · 왼쪽(π)으로 맞춘다: 기록이 작아지고, 기록과 실제 플레이가 정확히 같아진다.
 * 각도는 0.0001 라디안 단위로 자른다 (기록에 적히는 값 그대로 쓰도록).
 */
export function canonInput(i: TickInput): TickInput {
  const mx = i.mx > 0 ? 1 : i.mx < 0 ? -1 : 0;
  const aim = i.fire ? Math.round(Math.max(-7, Math.min(7, i.aim)) * 10000) / 10000 : dcos(i.aim) >= 0 ? 0 : 3.1416;
  return { ...i, mx, aim };
}

export class Runner {
  state: State;
  private last: Input = { ...IDLE };
  /** 일회성 동작. 총이 동작 중이면 끝날 때까지 기다렸다 처리한다 (연타로 빨라지지 않게) */
  private pending = { fire: false, fireAim: 0, melee: false, jump: false, interact: false, acts: [] as Action[] };
  static readonly MAX_ACTS = 4;
  ticks = 0;

  constructor(seed: number) { this.state = newGame(seed); }

  tick(raw: TickInput): void {
    const m = canonInput(raw);
    const s = this.state, p = this.pending;
    this.last = { ...IDLE, mx: m.mx, aim: m.aim, crouch: m.crouch, slowmo: m.slowmo, check: m.check };
    if (m.fire) { p.fire = true; p.fireAim = m.aim; } // 쏜 순간의 조준을 기억한다 (총이 바빠 나중에 나가도 그 방향으로)
    if (m.melee) p.melee = true;
    if (m.jump) p.jump = true;
    if (m.interact) p.interact = true;
    if (m.act && p.acts.length < Runner.MAX_ACTS) p.acts.push(m.act);
    const busy = s.gun.busy > 0 || s.p.melee > 0;
    const shootNow = !busy && p.fire;
    const inp: Input = { ...this.last, aim: shootNow ? p.fireAim : this.last.aim, jump: p.jump, interact: p.interact,
      fire: busy ? false : p.fire, melee: busy ? false : p.melee, act: busy ? null : (p.acts[0] ?? null) };
    p.jump = false; p.interact = false;
    if (!busy) { p.fire = false; p.melee = false; p.acts.shift(); }
    step(s, inp, TICK);
    this.ticks++;
  }
}
