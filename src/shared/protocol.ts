// 화면에 그릴 것: 시뮬레이션 상태에서 화면에 필요한 것을 골라 낸다.
// - 탄 수는 점검(git status)할 때만 담는다 (직접 세는 게임)
// - 벽 · 책상 너머의 적 · 탄 · 탄창도 담되, 주인공 시야선 밖이면 seen=false 로 표시한다 (화면은 살짝 흐리게 그린다)
// 판정과 점수 검증은 서버가 입력 기록을 다시 돌려서 한다 (replay.ts).
import { State, Alarm, EnemyKind, CHECK_TIME, visible, clear, pEye, score } from './game.ts';
import { ROOMS } from './level.ts';
import { GunEvent } from './gun.ts';

export interface RoomMsg {
  t: 'room'; room: number; rooms: number; name: string; w: number; h: number;
  tiles: string;   // 0 빈칸, 1 벽, 2 책상, 3 문
  decor: { kind: 'lamp' | 'rack' | 'window'; x: number; y: number }[];
}
export interface AmmoView { chamber: number; mag: number | null; slots: (number | null)[]; grip: number | null }
/** seen: 주인공 시야선 안에 있는가 (밖이면 화면이 살짝 흐리게 그린다) */
export interface EnemyView { id: number; kind: EnemyKind; x: number; y: number; dir: 1 | -1; aim: number | null; grabbed: boolean; seen: boolean }
export interface SnapMsg {
  t: 'snap';
  p: { x: number; y: number; vy: number; ground: boolean; crouch: boolean; face: 1 | -1; hp: number; hurt: boolean; melee: boolean };
  aim: number; dead: boolean; slowmo: boolean; meter: number;
  enemies: EnemyView[];
  /** 보이는 탄. vx · vy 는 날아가는 방향 · 속도 (화면이 방향대로 돌리고, 틱 사이를 이어 그린다) */
  bullets: { id: number; x: number; y: number; vx: number; vy: number; enemy: boolean; seen: boolean }[];
  mags: { id: number; x: number; y: number; seen: boolean }[];
  flashes: { x: number; y: number; enemy: boolean }[];
  impacts: { x: number; y: number }[];
  /** 총의 보이는 상태: 탄창이 꽂혔는지, 칸마다 탄창이 있는지, 손에 쥐었는지 (탄 수는 없다) */
  gun: { magIn: boolean; slots: boolean[]; grip: boolean; busy: number };
  alarm: Alarm;
  ammo: AmmoView | null;
  checking: number;
  events: GunEvent[]; log: string[];
  room: number; kills: number; deaths: number; time: number; won: boolean; score: number;
}

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
    p: { x: p.x, y: p.y, vy: p.vy, ground: p.onGround, crouch: p.crouch, face: p.face, hp: p.hp, hurt: p.invuln > 0, melee: p.melee > 0 },
    aim: r2(s.aim), dead: s.dead > 0, slowmo: s.slowmo, meter: r2(s.meter),
    enemies: s.enemies.filter(e => e.hp > 0).map(e => ({
      id: e.id, kind: e.kind, x: r1(e.x), y: r1(e.y), dir: e.dir,
      aim: e.aimT > 0 || e.burst > 0 ? r2(e.aimAng) : null, grabbed: p.melee > 0 && p.meleeTarget === e.id, seen: visible(s, e),
    })),
    bullets: s.bullets.map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), enemy: b.enemy, seen: sees(b.x, b.y) })),
    mags: s.mags.map(m => ({ id: m.id, x: m.x, y: m.y, seen: sees(m.x, m.y - 6) })),
    flashes: s.flashes.map(f => ({ x: r1(f.x), y: r1(f.y), enemy: f.enemy })),
    impacts: s.impacts.map(i => ({ x: r1(i.x), y: r1(i.y) })),
    gun: { magIn: g.mag !== null, slots: g.slots.map(v => v !== null), grip: g.grip !== null, busy: r2(g.busy) },
    alarm: s.alarm,
    ammo: s.checkHold >= CHECK_TIME ? { chamber: g.chamber ? 1 : 0, mag: g.mag, slots: [...g.slots], grip: g.grip } : null,
    checking: r2(Math.min(1, s.checkHold / CHECK_TIME)),
    // 적 총소리는 벽 너머에서도 들린다 (소리일 뿐 위치는 아니다)
    events: s.events, log: s.log.map(l => l.text),
    room: s.room, kills: s.kills, deaths: s.deaths, time: Math.floor(s.time), won: s.won, score: score(s),
  };
}
