// 장전 미리 움직이기: 장전 동작의 결과는 화면에 보이는 정보(탄창이 꽂혔는지 · 칸 · 손)만으로 정해진다.
// 그래서 키를 누르는 즉시 결과를 적용해 총 리그를 움직이고, 서버가 "실제로 처리했다"(actAck)고 하면 내려놓는다.
// 숨긴 정보(탄 수 · 약실 · 걸림)는 쓰지 않는다: 슬라이드를 당겨 무엇이 튀어나오는지는 서버 답을 기다린다.
import { TIME } from '../shared/gun.ts';
import type { Action } from '../shared/game.ts';
import type { SnapMsg } from '../shared/protocol.ts';

export interface GunView { magIn: boolean; slots: boolean[]; grip: boolean; busy: number }
/** 화면에서 바로 보여 줄 장전 사건 (총 리그 · 효과음) */
export type LocalEvent = 'eject' | 'grab' | 'stow' | 'insert' | 'rack';

/** 보이는 상태에 장전 동작 하나를 적용. 안 되는 동작이면 null (서버도 같은 규칙으로 거절한다) */
export function applyAct(v: GunView, act: Action): LocalEvent | null {
  if (act === 'eject') { if (!v.magIn) return null; v.magIn = false; v.busy = TIME.eject; return 'eject'; }
  if (act === 'insert') { if (v.magIn || !v.grip) return null; v.magIn = true; v.grip = false; v.busy = TIME.insert; return 'insert'; }
  if (act === 'stow') { const i = v.slots.indexOf(false); if (!v.grip || i < 0) return null; v.slots[i] = true; v.grip = false; v.busy = TIME.stow; return 'stow'; }
  if (act === 'rack') { v.busy = TIME.rack; return 'rack'; }
  const i = Number(act.slice(4)) - 1; // grab1~4
  if (v.grip || !v.slots[i]) return null;
  v.grip = true; v.slots[i] = false; v.busy = TIME.grab; return 'grab';
}

export class GunPredictor {
  private base: GunView | null = null;
  private view: GunView | null = null;
  private pending: { seq: number; act: Action; at: number }[] = [];

  reset() { this.base = null; this.view = null; this.pending = []; }

  /**
   * 장전 키를 눌렀을 때. 총이 바쁘지 않고 규칙상 되는 동작이면 바로 적용하고 보여 줄 사건을 돌려준다.
   * 바쁘면 미리 하지 않는다 (서버가 줄 세웠다가 처리하면 그때 서버 상태로 보인다)
   */
  press(seq: number, act: Action, now: number): LocalEvent | null {
    // 바쁜 시간은 소수 계산 오차로 0 이 아닌 아주 작은 값이 남을 수 있다 (서버도 0.01 단위로 보낸다)
    if (!this.view || this.view.busy > BUSY_EPS) return null;
    const v = cloneView(this.view);
    const ev = applyAct(v, act);
    if (!ev) return null;
    this.view = v;
    this.pending.push({ seq, act, at: now });
    return ev;
  }

  /** 서버 스냅샷: 서버의 보이는 상태에서, 아직 처리 안 된(미리 보여 준) 동작을 다시 적용 */
  onSnap(s: SnapMsg, now: number) {
    // 처리된 것과, 오래돼도 처리되지 않은 것(넘쳐서 버려짐 등)은 내려놓는다
    this.pending = this.pending.filter(p => p.seq > s.actAck && now - p.at < 1500);
    this.base = { magIn: s.gun.magIn, slots: [...s.gun.slots], grip: s.gun.grip, busy: s.gun.busy };
    const v = cloneView(this.base);
    for (const p of this.pending) { const busy = v.busy; applyAct(v, p.act); v.busy = Math.max(busy, v.busy); }
    // 바쁜 시간은 화면의 시계를 믿는다. 서버 값은 왕복만큼 늦어서, 쓰면 이미 끝난 동작이 다시 "바쁨"이 된다.
    // 서버가 실제로 바쁜 동안 누른 동작은 서버가 줄 세워 같은 순서로 처리하므로 결과는 같다
    if (this.view) v.busy = this.view.busy;
    this.view = v;
  }

  tick(dt: number) { if (this.view) { this.view.busy -= dt; if (this.view.busy < BUSY_EPS) this.view.busy = 0; } }

  get(): GunView | null { return this.view; }
}

const BUSY_EPS = 0.01;
const cloneView = (v: GunView): GunView => ({ ...v, slots: [...v.slots] });
