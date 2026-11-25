// 서버 ↔ 클라이언트 통신 규격.
// 클라이언트는 "의도"만 보내고, 서버는 그 플레이어가 볼 수 있는 것만 보낸다.
// - 벽 너머의 적은 보내지 않는다 (los)
// - 탄 수는 git status 를 충분히 들고 있을 때만 보낸다
import { State, Input, Action, ENEMY, EnemyKind, los, CHECK_TIME, W, H } from './game.ts';
import { GunEvent } from './gun.ts';

export const PROTOCOL_VERSION = 1;
export const MAX_MSG_BYTES = 256;

export type ClientMsg =
  | { t: 'start' }
  | { t: 'next' }
  | ({ t: 'in' } & Input);

const ACTS: readonly Action[] = ['eject', 'insert', 'rack', 'fill'];
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;

/** 받은 메시지를 검사한다. 모양이 틀리면 null (서버는 위반으로 센다). */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MSG_BYTES) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (typeof m !== 'object' || m === null) return null;
  const o = m as Record<string, unknown>;
  if (o.t === 'start' || o.t === 'next') return { t: o.t };
  if (o.t !== 'in') return null;
  const mx = num(o.mx, -1, 1), my = num(o.my, -1, 1), aim = num(o.aim, -Math.PI * 2, Math.PI * 2);
  if (mx === null || my === null || aim === null) return null;
  const act = o.act === null || o.act === undefined ? null : ACTS.includes(o.act as Action) ? (o.act as Action) : undefined;
  if (act === undefined) return null;
  return { t: 'in', mx, my, aim, fire: o.fire === true, act, check: o.check === true };
}

export interface FloorMsg { t: 'floor'; floor: number; w: number; h: number; map: string; exit: { x: number; y: number } }
export interface AmmoView { chamber: number; mag: number | null; pockets: number[]; loose: number }
export interface SnapMsg {
  t: 'snap';
  px: number; py: number; aim: number; hp: number; hurt: boolean;
  floor: number; kills: number;
  enemies: { id: number; x: number; y: number; kind: EnemyKind }[];
  bullets: [number, number][];
  pickups: [number, number][];
  gun: { magIn: boolean; pockets: number; hasLoose: boolean; busy: number };
  ammo: AmmoView | null;       // git status 결과 (들고 있을 때만)
  checking: number;            // 0~1, 점검 진행도
  events: GunEvent[];
  log: string[];
  over: boolean; cleared: boolean; won: boolean; score: number;
}
export type ServerMsg = { t: 'hello'; v: number } | FloorMsg | SnapMsg | { t: 'error'; msg: string };

export const FLOORS = 5;
export function score(s: State) { return (s.floor - 1) * 1000 + s.kills * 50 + (s.cleared && s.floor === FLOORS ? 2000 : 0); }

export function floorMsg(s: State): FloorMsg {
  let map = ''; for (let i = 0; i < W * H; i++) map += s.map[i] ? '1' : '0';
  return { t: 'floor', floor: s.floor, w: W, h: H, map, exit: s.exit };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function snapshot(s: State): SnapMsg {
  const g = s.gun;
  const near = (x: number, y: number) => Math.hypot(x - s.px, y - s.py) < 700 && los(s, x, y);
  return {
    t: 'snap', px: r1(s.px), py: r1(s.py), aim: r1(s.aim * 100) / 100, hp: s.hp, hurt: s.hurt > 0,
    floor: s.floor, kills: s.kills,
    enemies: s.enemies.filter(e => ENEMY[e.kind] && near(e.x, e.y)).map(e => ({ id: e.id, x: r1(e.x), y: r1(e.y), kind: e.kind })),
    bullets: s.bullets.map(b => [r1(b.x), r1(b.y)] as [number, number]),
    pickups: s.pickups.filter(p => near(p.x, p.y)).map(p => [p.x, p.y] as [number, number]),
    gun: { magIn: g.mag !== null, pockets: g.pockets.length, hasLoose: g.looseRounds > 0, busy: r1(g.busy * 100) / 100 },
    ammo: s.checkHold >= CHECK_TIME ? { chamber: g.chamber ? 1 : 0, mag: g.mag, pockets: [...g.pockets], loose: g.looseRounds } : null,
    checking: Math.min(1, s.checkHold / CHECK_TIME),
    events: s.events, log: s.log.map(l => l.text),
    over: s.over, cleared: s.cleared, won: s.cleared && s.floor === FLOORS, score: score(s),
  };
}
