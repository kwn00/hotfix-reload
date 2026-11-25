// 권총(hotfix.sh) 상태 머신. 화면과 무관한 순수 로직이라 테스트로 고정한다.
// 직접 장전: 탄창 빼기(바닥에 떨어짐) → 칸(1~4)에서 손으로 쥐기 → 꽂기 → 슬라이드 당기기. 가끔 총이 걸린다.
// 탄 수는 화면에 나오지 않는다. 직접 세거나 점검(git status)으로 확인한다.

export const MAG_SIZE = 8;
export const SLOTS = 4;

export interface Gun {
  chamber: boolean;              // 약실에 탄이 있는가
  jammed: boolean;               // 걸림: 슬라이드를 당겨야 풀린다
  mag: number | null;            // 꽂힌 탄창의 탄 수 (null = 탄창 없음)
  slots: (number | null)[];      // 탄창 칸 1~4 (null = 빈 칸)
  grip: number | null;           // 손에 쥔 탄창
  busy: number;                  // 동작 중 남은 시간(초)
  dropped: number | null;        // 방금 빼서 떨어뜨린 탄창 (시뮬레이션이 바닥에 놓고 지운다)
}

export type GunEvent =
  | 'fire' | 'dry' | 'jam' | 'jammed' | 'eject' | 'insert' | 'no-mag' | 'rack' | 'rack-waste' | 'unjam'
  | 'grab' | 'stow' | 'hand-full' | 'empty-slot' | 'no-slot'
  | 'busy' | 'pickup' | 'hit' | 'dead' | 'kill' | 'takedown' | 'enemy-fire' | 'door';

export const TIME = { eject: 0.2, grab: 0.3, stow: 0.3, insert: 0.45, rack: 0.3, unjam: 0.45, fire: 0.14 };
export const JAM_CHANCE = 0.04;

export function newGun(): Gun {
  return { chamber: true, jammed: false, mag: MAG_SIZE, slots: [MAG_SIZE, MAG_SIZE, null, null], grip: null, busy: 0, dropped: null };
}

export const cloneGun = (g: Gun): Gun => ({ ...g, slots: [...g.slots], dropped: null });

export function tick(g: Gun, dt: number): void { g.busy = Math.max(0, g.busy - dt); }

/** 쏘기. rand 는 0~1 난수 (서버의 비밀 난수) */
export function fire(g: Gun, rand: number): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.jammed) { g.busy = 0.1; return 'jammed'; }
  if (!g.chamber) { g.busy = 0.08; return 'dry'; }
  g.busy = TIME.fire;
  if (g.mag !== null && g.mag > 0) {
    g.mag--; g.chamber = true;
    if (rand < JAM_CHANCE) { g.jammed = true; return 'jam'; }
  } else g.chamber = false;
  return 'fire';
}

/** 탄창 빼기. 빠진 탄창은 바닥에 떨어진다 (남은 탄 그대로) */
export function eject(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.mag === null) return 'no-mag';
  g.dropped = g.mag; g.mag = null; g.busy = TIME.eject;
  return 'eject';
}

/** 칸 i(0~3)의 탄창을 손에 쥔다 */
export function grab(g: Gun, i: number): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.grip !== null) return 'hand-full';
  if (g.slots[i] === null || g.slots[i] === undefined) return 'empty-slot';
  g.grip = g.slots[i]; g.slots[i] = null; g.busy = TIME.grab;
  return 'grab';
}

/** 손의 탄창을 빈 칸에 다시 넣는다 */
export function stow(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.grip === null) return 'no-mag';
  const i = g.slots.indexOf(null);
  if (i < 0) return 'no-slot';
  g.slots[i] = g.grip; g.grip = null; g.busy = TIME.stow;
  return 'stow';
}

/** 손의 탄창을 총에 꽂는다. 약실은 채우지 않는다 (슬라이드를 당겨야 한다) */
export function insert(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.mag !== null || g.grip === null) return 'no-mag';
  g.mag = g.grip; g.grip = null; g.busy = TIME.insert;
  return 'insert';
}

/** 슬라이드 당기기. 약실의 탄(걸린 탄 포함)은 튕겨 나가 버려진다 */
export function rack(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  const wasJammed = g.jammed, wasted = g.chamber && !wasJammed;
  g.jammed = false; g.chamber = false;
  if (g.mag !== null && g.mag > 0) { g.mag--; g.chamber = true; }
  g.busy = wasJammed ? TIME.unjam : TIME.rack;
  return wasJammed ? 'unjam' : wasted ? 'rack-waste' : 'rack';
}

/** 주운 탄창: 빈 칸 → 없으면 빈 손. 둘 다 없으면 false */
export function pickupMag(g: Gun, rounds: number): boolean {
  const r = Math.max(0, Math.min(MAG_SIZE, rounds));
  const i = g.slots.indexOf(null);
  if (i >= 0) { g.slots[i] = r; return true; }
  if (g.grip === null) { g.grip = r; return true; }
  return false;
}

export function totalRounds(g: Gun): number {
  return (g.chamber ? 1 : 0) + (g.mag ?? 0) + (g.grip ?? 0) + g.slots.reduce<number>((a, b) => a + (b ?? 0), 0);
}
