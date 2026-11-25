// 서버 ↔ 클라이언트 통신 규격.
// 클라이언트는 "의도"만 보내고, 서버는 그 플레이어가 볼 수 있는 것만 보낸다.
// - 벽 · 책상 너머의 적과 그 탄은 보내지 않는다
// - 탄 수(약실 · 탄창 · 주머니, 주운 탄창의 탄 수)는 점검(git status)을 충분히 들고 있을 때만 보낸다
// - 방의 적 배치는 보내지 않는다 (지형만 보낸다)
import { State, Action, EnemyKind, CHECK_TIME, visible, clear, pEye, score } from './game.ts';
import { ROOMS } from './level.ts';
import { GunEvent } from './gun.ts';

export const PROTOCOL_VERSION = 2;
export const MAX_MSG_BYTES = 256;

export type ClientMsg =
  | { t: 'start' }
  | { t: 'in'; mx: number; aim: number; jump: boolean; crouch: boolean; fire: boolean; melee: boolean; act: Action | null; slowmo: boolean; check: boolean; interact: boolean };

const ACTS: readonly Action[] = ['eject', 'insert', 'rack'];
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;

/** 받은 메시지를 검사한다. 모양이 틀리면 null (서버는 위반으로 센다). 모르는 필드는 버린다. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MSG_BYTES) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.t === 'start') return { t: 'start' };
  if (o.t !== 'in') return null;
  const mx = num(o.mx, -1, 1), aim = num(o.aim, -Math.PI * 2, Math.PI * 2);
  if (mx === null || aim === null) return null;
  const act = o.act === null || o.act === undefined ? null : ACTS.includes(o.act as Action) ? (o.act as Action) : undefined;
  if (act === undefined) return null;
  const b = (k: string) => o[k] === true;
  return { t: 'in', mx, aim, jump: b('jump'), crouch: b('crouch'), fire: b('fire'), melee: b('melee'), act, slowmo: b('slowmo'), check: b('check'), interact: b('interact') };
}

export interface RoomMsg {
  t: 'room'; room: number; rooms: number; name: string; w: number; h: number;
  tiles: string;   // 0 빈칸, 1 벽, 2 책상, 3 문
  decor: { kind: 'lamp' | 'rack' | 'window'; x: number; y: number }[];
}
export interface AmmoView { chamber: number; mag: number | null; pockets: number[] }
export interface EnemyView { id: number; kind: EnemyKind; x: number; y: number; dir: 1 | -1; aim: number | null; grabbed: boolean }
export interface SnapMsg {
  t: 'snap';
  p: { x: number; y: number; crouch: boolean; face: 1 | -1; hp: number; hurt: boolean; melee: boolean };
  aim: number; dead: boolean; slowmo: boolean; meter: number;
  enemies: EnemyView[];
  bullets: { id: number; x: number; y: number; enemy: boolean }[];
  mags: { id: number; x: number; y: number }[];
  flashes: { x: number; y: number; enemy: boolean }[];
  impacts: { x: number; y: number }[];
  gun: { magIn: boolean; pockets: number; busy: number };
  ammo: AmmoView | null;
  checking: number;
  events: GunEvent[]; log: string[];
  room: number; kills: number; deaths: number; time: number; won: boolean; score: number;
}
export type ServerMsg = { t: 'hello'; v: number } | RoomMsg | SnapMsg;

export function roomMsg(s: State): RoomMsg {
  let tiles = ''; for (let i = 0; i < s.map.w * s.map.h; i++) tiles += s.map.tiles[i];
  return { t: 'room', room: s.room, rooms: ROOMS.length, name: ROOMS[s.room].name, w: s.map.w, h: s.map.h, tiles, decor: s.map.decor };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function snapshot(s: State): SnapMsg {
  const g = s.gun, p = s.p, eye = pEye(p);
  const sees = (x: number, y: number) => clear(s.map, eye.x, eye.y, x, y);
  return {
    t: 'snap',
    p: { x: r1(p.x), y: r1(p.y), crouch: p.crouch, face: p.face, hp: p.hp, hurt: p.invuln > 0, melee: p.melee > 0 },
    aim: r2(s.aim), dead: s.dead > 0, slowmo: s.slowmo, meter: r2(s.meter),
    enemies: s.enemies.filter(e => e.hp > 0 && visible(s, e)).map(e => ({
      id: e.id, kind: e.kind, x: r1(e.x), y: r1(e.y), dir: e.dir,
      aim: e.aimT > 0 || e.burst > 0 ? r2(e.aimAng) : null, grabbed: p.melee > 0 && p.meleeTarget === e.id,
    })),
    bullets: s.bullets.filter(b => !b.enemy || sees(b.x, b.y)).map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), enemy: b.enemy })),
    mags: s.mags.filter(m => sees(m.x, m.y - 6)).map(m => ({ id: m.id, x: m.x, y: m.y })),
    flashes: s.flashes.filter(f => !f.enemy || sees(f.x, f.y)).map(f => ({ x: r1(f.x), y: r1(f.y), enemy: f.enemy })),
    impacts: s.impacts.filter(i => sees(i.x, i.y)).map(i => ({ x: r1(i.x), y: r1(i.y) })),
    gun: { magIn: g.mag !== null, pockets: g.pockets.length, busy: r2(g.busy) },
    ammo: s.checkHold >= CHECK_TIME ? { chamber: g.chamber ? 1 : 0, mag: g.mag, pockets: [...g.pockets] } : null,
    checking: r2(Math.min(1, s.checkHold / CHECK_TIME)),
    // 적 총소리는 벽 너머에서도 들린다 (소리일 뿐 위치는 아니다)
    events: s.events, log: s.log.map(l => l.text),
    room: s.room, kills: s.kills, deaths: s.deaths, time: Math.floor(s.time), won: s.won, score: score(s),
  };
}
