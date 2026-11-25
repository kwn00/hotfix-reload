// 권총(hotfix.sh) 상태 머신. 화면과 무관한 순수 로직이라 테스트로 고정한다.
// "직접 장전": 탄창 빼기 / 넣기 / 슬라이드 당기기를 따로 한다. 가끔 총이 걸린다(잼).
// 탄 수는 화면에 나오지 않는다. 직접 세거나 점검(git status)으로 확인한다.

export const MAG_SIZE = 8;
export const MAX_POCKETS = 4;

export interface Gun {
  chamber: boolean;          // 약실에 탄이 있는가
  jammed: boolean;           // 걸림: 슬라이드를 당겨야 풀린다
  mag: number | null;        // 꽂힌 탄창의 탄 수 (null = 탄창 없음)
  pockets: number[];         // 주머니 속 탄창들 (앞에서부터 꺼낸다)
  busy: number;              // 동작 중 남은 시간(초). 0 이 아니면 다른 동작 불가
}

export type GunEvent =
  | 'fire' | 'dry' | 'jam' | 'jammed' | 'eject' | 'insert' | 'no-mag' | 'rack' | 'rack-waste' | 'unjam'
  | 'busy' | 'pickup' | 'hit' | 'dead' | 'kill' | 'takedown' | 'enemy-fire' | 'door';

export const TIME = { eject: 0.25, insert: 0.55, rack: 0.3, unjam: 0.45, fire: 0.14 };
export const JAM_CHANCE = 0.04;

export function newGun(): Gun {
  return { chamber: true, jammed: false, mag: MAG_SIZE, pockets: [MAG_SIZE, MAG_SIZE], busy: 0 };
}

export const cloneGun = (g: Gun): Gun => ({ ...g, pockets: [...g.pockets] });

export function tick(g: Gun, dt: number): void {
  g.busy = Math.max(0, g.busy - dt);
}

/** 쏘기. rand 는 0~1 난수 (서버의 비밀 난수) */
export function fire(g: Gun, rand: number): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.jammed) { g.busy = 0.1; return 'jammed'; }
  if (!g.chamber) { g.busy = 0.08; return 'dry'; }
  g.busy = TIME.fire;
  // 반자동: 쏘고 나면 탄창에서 다음 탄이 올라온다. 이때 가끔 걸린다
  if (g.mag !== null && g.mag > 0) {
    g.mag--; g.chamber = true;
    if (rand < JAM_CHANCE) { g.jammed = true; return 'jam'; }
  } else g.chamber = false;
  return 'fire';
}

/** 탄창 빼기. 남은 탄이 있으면 주머니 맨 뒤로 들어간다 (빈 탄창은 버린다). */
export function eject(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.mag === null) return 'no-mag';
  if (g.mag > 0 && g.pockets.length < MAX_POCKETS) g.pockets.push(g.mag);
  g.mag = null;
  g.busy = TIME.eject;
  return 'eject';
}

/** 주머니 맨 앞 탄창 꽂기. 약실은 채우지 않는다 (슬라이드를 당겨야 한다). */
export function insert(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.mag !== null || g.pockets.length === 0) return 'no-mag';
  g.mag = g.pockets.shift()!;
  g.busy = TIME.insert;
  return 'insert';
}

/** 슬라이드 당기기. 약실의 탄(걸린 탄 포함)은 튕겨 나가 버려진다. */
export function rack(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  const wasJammed = g.jammed, wasted = g.chamber && !wasJammed;
  g.jammed = false;
  g.chamber = false;
  if (g.mag !== null && g.mag > 0) { g.mag--; g.chamber = true; }
  g.busy = wasJammed ? TIME.unjam : TIME.rack;
  return wasJammed ? 'unjam' : wasted ? 'rack-waste' : 'rack';
}

/** 주운 탄창을 주머니에. 자리가 없으면 false */
export function pickupMag(g: Gun, rounds: number): boolean {
  if (g.pockets.length >= MAX_POCKETS) return false;
  g.pockets.push(Math.max(0, Math.min(MAG_SIZE, rounds)));
  return true;
}

export function totalRounds(g: Gun): number {
  return (g.chamber ? 1 : 0) + (g.mag ?? 0) + g.pockets.reduce((a, b) => a + b, 0);
}
