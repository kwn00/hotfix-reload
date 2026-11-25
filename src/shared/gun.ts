// 권총(hotfix.sh) 상태 머신. 화면과 무관한 순수 로직이라 테스트로 고정한다.
// Reloader 류의 "직접 장전": 탄창 빼기 / 넣기 / 슬라이드 당기기를 따로 한다.
// 탄 수는 화면에 나오지 않는다. 직접 세거나 `git status`(점검)로 확인한다.

export const MAG_SIZE = 8;

export interface Gun {
  chamber: boolean;          // 약실에 탄이 있는가
  mag: number | null;        // 꽂힌 탄창의 탄 수 (null = 탄창 없음)
  pockets: number[];         // 주머니 속 탄창들 (앞에서부터 꺼낸다)
  looseRounds: number;       // 낱개 탄 (탄창에 채워 넣어야 쓴다)
  busy: number;              // 동작 중 남은 시간(초). 0 이 아니면 다른 동작 불가
}

export type GunEvent =
  | 'fire' | 'dry' | 'eject' | 'insert' | 'no-mag' | 'rack' | 'rack-waste'
  | 'busy' | 'fill' | 'fill-none' | 'dead';

export const TIME = { eject: 0.25, insert: 0.55, rack: 0.3, fire: 0.12, fill: 0.35 };

export function newGun(): Gun {
  return { chamber: true, mag: MAG_SIZE, pockets: [MAG_SIZE, MAG_SIZE], looseRounds: 0, busy: 0 };
}

export function tick(g: Gun, dt: number): void {
  g.busy = Math.max(0, g.busy - dt);
}

export function fire(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (!g.chamber) { g.busy = 0.08; return 'dry'; }
  g.busy = TIME.fire;
  // 반자동: 쏘고 나면 탄창에서 다음 탄이 저절로 올라온다
  if (g.mag !== null && g.mag > 0) { g.mag--; g.chamber = true; } else g.chamber = false;
  return 'fire';
}

/** 탄창 빼기. 남은 탄이 있으면 주머니 맨 뒤로 들어간다 (빈 탄창은 버린다). */
export function eject(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.mag === null) return 'no-mag';
  if (g.mag > 0) g.pockets.push(g.mag);
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

/** 슬라이드 당기기. 약실에 탄이 있었으면 그 탄은 튕겨 나가 버려진다. */
export function rack(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  const wasted = g.chamber;
  g.chamber = false;
  if (g.mag !== null && g.mag > 0) { g.mag--; g.chamber = true; }
  g.busy = TIME.rack;
  return wasted ? 'rack-waste' : 'rack';
}

/** 낱개 탄을 주머니의 가장 덜 찬 탄창에 한 발 채운다. 탄창이 없으면 새 빈 탄창을 만든다. */
export function fillOne(g: Gun): GunEvent {
  if (g.busy > 0) return 'busy';
  if (g.looseRounds <= 0) return 'fill-none';
  let idx = -1;
  for (let i = 0; i < g.pockets.length; i++) {
    if (g.pockets[i] < MAG_SIZE && (idx < 0 || g.pockets[i] < g.pockets[idx])) idx = i;
  }
  if (idx < 0) { if (g.pockets.length >= 4) return 'fill-none'; g.pockets.push(0); idx = g.pockets.length - 1; }
  g.pockets[idx]++;
  g.looseRounds--;
  g.busy = TIME.fill;
  return 'fill';
}

/** 화면에 보여 줄 수 있는 총 탄 수 (점검할 때만 쓴다). */
export function totalRounds(g: Gun): number {
  return (g.chamber ? 1 : 0) + (g.mag ?? 0) + g.pockets.reduce((a, b) => a + b, 0) + g.looseRounds;
}
