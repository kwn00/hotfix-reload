// 한 층(floor)의 시뮬레이션. 화면 코드 없이 상태만 바꾼다.
import { Gun, GunEvent, newGun, tick as gunTick, fire, eject, insert, rack, fillOne } from './gun.ts';

export const TILE = 32;
export const W = 30, H = 20; // 타일 단위 맵 크기

export type EnemyKind = 'bug' | 'npe' | 'conflict' | 'mini';
export interface Enemy { id: number; x: number; y: number; hp: number; kind: EnemyKind; cd: number; }
export interface Bullet { x: number; y: number; vx: number; vy: number; life: number; }
export interface Pickup { x: number; y: number; rounds: number; }

export interface State {
  floor: number;
  map: Uint8Array;            // 0 바닥, 1 벽
  exit: { x: number; y: number };
  px: number; py: number; hp: number; hurt: number;
  aim: number;
  gun: Gun;
  enemies: Enemy[]; bullets: Bullet[]; pickups: Pickup[];
  kills: number; time: number;
  over: boolean; cleared: boolean;
  log: { text: string; t: number }[];
  events: GunEvent[];        // 이번 틱에 일어난 총 소리 (화면의 효과음용)
  checkHold: number;         // git status 를 들고 있던 시간
  nextId: number;
  rng: () => number;
}

export const ENEMY = {
  bug:      { hp: 2, speed: 55,  dmg: 1, r: 10, label: '버그' },
  npe:      { hp: 1, speed: 120, dmg: 1, r: 8,  label: 'NullPointerException' },
  conflict: { hp: 4, speed: 40,  dmg: 2, r: 13, label: 'Merge Conflict' },
  mini:     { hp: 1, speed: 80,  dmg: 1, r: 7,  label: '<<<<<<< HEAD' },
} as const;

export function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const wall = (s: State, tx: number, ty: number) =>
  tx < 0 || ty < 0 || tx >= W || ty >= H || s.map[ty * W + tx] === 1;

export function solidAt(s: State, x: number, y: number) { return wall(s, Math.floor(x / TILE), Math.floor(y / TILE)); }

function genMap(rng: () => number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) m[y * W + x] = 1;
  // 칸막이(파티션) 벽: 문 하나씩 뚫린 세로벽 + 책상 덩어리
  for (let wx = 7; wx < W - 3; wx += 7) {
    const door = 2 + Math.floor(rng() * (H - 5));
    for (let y = 1; y < H - 1; y++) if (y < door || y > door + 2) m[y * W + wx] = 1;
  }
  for (let i = 0; i < 10; i++) {
    const x = 2 + Math.floor(rng() * (W - 5)), y = 2 + Math.floor(rng() * (H - 5));
    if (x % 7 === 0 || x % 7 === 6 || x % 7 === 1) continue;
    m[y * W + x] = 1; m[y * W + x + 1] = 1;
  }
  return m;
}

export function newFloor(floor: number, seed: number, carry?: { gun: Gun; hp: number; kills: number; time: number }): State {
  const rng = mulberry32(seed + floor * 7919);
  const s: State = {
    floor, map: genMap(rng), exit: { x: (W - 2) * TILE + 16, y: (H - 2) * TILE + 16 },
    px: TILE * 1.5, py: TILE * 1.5, hp: carry?.hp ?? 5, hurt: 0, aim: 0,
    gun: carry?.gun ?? newGun(), enemies: [], bullets: [], pickups: [],
    kills: carry?.kills ?? 0, time: carry?.time ?? 0, over: false, cleared: false, log: [], rng,
    events: [], checkHold: 0, nextId: 1,
  };
  s.map[(H - 2) * W + (W - 2)] = 0; s.map[W + 1] = 0;
  const n = 5 + floor * 3;
  for (let i = 0; i < n; i++) {
    const kind: EnemyKind = floor >= 2 && rng() < 0.2 ? 'conflict' : rng() < 0.15 + floor * 0.05 ? 'npe' : 'bug';
    const p = freeSpot(s, 8);
    s.enemies.push({ id: s.nextId++, ...p, hp: ENEMY[kind].hp, kind, cd: 0 });
  }
  for (let i = 0; i < 2 + (floor % 2); i++) s.pickups.push({ ...freeSpot(s, 4), rounds: 4 + Math.floor(rng() * 5) });
  say(s, `${floor}층: 출구(🚪 롤백 터미널)까지 가세요`);
  return s;
}

function freeSpot(s: State, minTiles: number) {
  for (;;) {
    const tx = 1 + Math.floor(s.rng() * (W - 2)), ty = 1 + Math.floor(s.rng() * (H - 2));
    if (!wall(s, tx, ty) && tx + ty > minTiles) return { x: tx * TILE + 16, y: ty * TILE + 16 };
  }
}

export function say(s: State, text: string) { s.log.push({ text, t: 3 }); if (s.log.length > 4) s.log.shift(); }

const PLAYER_R = 10, PLAYER_SPEED = 130;

function move(s: State, o: { x: number; y: number }, dx: number, dy: number, r: number) {
  const nx = o.x + dx;
  if (!solidAt(s, nx + Math.sign(dx) * r, o.y - r + 1) && !solidAt(s, nx + Math.sign(dx) * r, o.y + r - 1)) o.x = nx;
  const ny = o.y + dy;
  if (!solidAt(s, o.x - r + 1, ny + Math.sign(dy) * r) && !solidAt(s, o.x + r - 1, ny + Math.sign(dy) * r)) o.y = ny;
}

/** 시야: 플레이어와 점 사이에 벽이 없는가 */
export function los(s: State, x: number, y: number) {
  const d = Math.hypot(x - s.px, y - s.py), steps = Math.ceil(d / 8);
  for (let i = 1; i < steps; i++) if (solidAt(s, s.px + (x - s.px) * i / steps, s.py + (y - s.py) * i / steps)) return false;
  return true;
}

export type Action = 'eject' | 'insert' | 'rack' | 'fill';
/** 클라이언트가 보내는 "의도". 서버는 이것만 받는다. */
export interface Input { mx: number; my: number; aim: number; fire: boolean; act: Action | null; check: boolean; }
export const CHECK_TIME = 0.6;
export const TICK = 1 / 30;

const ACTIONS: Record<Action, (g: Gun) => GunEvent> = { eject, insert, rack, fill: fillOne };
const MSG: Partial<Record<GunEvent, string>> = {
  dry: '찰칵. 약실이 비었어요', 'no-mag': '꽂을 탄창이 없어요', 'rack-waste': '한 발이 튕겨 나갔어요', 'fill-none': '채울 탄이 없어요',
};
function gunEvent(s: State, ev: GunEvent) { if (ev === 'busy') return; s.events.push(ev); const m = MSG[ev]; if (m) say(s, m); }

export function shoot(s: State): GunEvent {
  const ev = fire(s.gun);
  if (ev === 'fire') {
    const sp = 520, spread = (s.rng() - 0.5) * 0.06;
    s.bullets.push({ x: s.px, y: s.py, vx: Math.cos(s.aim + spread) * sp, vy: Math.sin(s.aim + spread) * sp, life: 1 });
  }
  return ev;
}

export function step(s: State, inp: Input, dt: number): void {
  s.events = [];
  if (s.over || s.cleared) return;
  s.time += dt; s.aim = inp.aim; s.hurt = Math.max(0, s.hurt - dt);
  gunTick(s.gun, dt);
  s.checkHold = inp.check ? s.checkHold + dt : 0;
  if (inp.act) gunEvent(s, ACTIONS[inp.act](s.gun));
  if (inp.fire) gunEvent(s, shoot(s));
  for (const l of s.log) l.t -= dt;
  s.log = s.log.filter(l => l.t > 0);

  const len = Math.hypot(inp.mx, inp.my) || 1;
  const slow = s.gun.busy > 0 ? 0.7 : 1;
  const p = { x: s.px, y: s.py };
  move(s, p, inp.mx / len * PLAYER_SPEED * slow * dt * Math.min(1, Math.hypot(inp.mx, inp.my)),
    inp.my / len * PLAYER_SPEED * slow * dt * Math.min(1, Math.hypot(inp.mx, inp.my)), PLAYER_R);
  s.px = p.x; s.py = p.y;

  for (const b of s.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (solidAt(s, b.x, b.y)) b.life = 0;
    for (const e of s.enemies) if (e.hp > 0 && b.life > 0 && Math.hypot(e.x - b.x, e.y - b.y) < ENEMY[e.kind].r + 3) {
      e.hp--; b.life = 0;
      e.x += b.vx * 0.02; e.y += b.vy * 0.02;
      if (e.hp <= 0) kill(s, e);
    }
  }
  s.bullets = s.bullets.filter(b => b.life > 0);

  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const st = ENEMY[e.kind], d = Math.hypot(s.px - e.x, s.py - e.y);
    e.cd = Math.max(0, e.cd - dt);
    if (d < 320 && los(s, e.x, e.y)) {
      move(s, e, (s.px - e.x) / d * st.speed * dt, (s.py - e.y) / d * st.speed * dt, st.r);
    }
    if (d < st.r + PLAYER_R && e.cd === 0 && s.hurt === 0) {
      s.hp -= st.dmg; s.hurt = 0.6; e.cd = 0.8;
      if (s.hp <= 0) { s.over = true; s.events.push('dead'); say(s, 'Segmentation fault (core dumped)'); }
    }
  }
  s.enemies = s.enemies.filter(e => e.hp > 0);

  for (const pk of s.pickups) if (pk.rounds > 0 && Math.hypot(pk.x - s.px, pk.y - s.py) < 18) {
    s.gun.looseRounds += pk.rounds; say(s, `낱개 탄 ${pk.rounds}발 주움 (E 로 탄창에 채우기)`); pk.rounds = 0;
  }
  s.pickups = s.pickups.filter(p => p.rounds > 0);

  if (Math.hypot(s.exit.x - s.px, s.exit.y - s.py) < 20) { s.cleared = true; say(s, '롤백 성공! 다음 층으로'); }
}

function kill(s: State, e: Enemy) {
  s.kills++;
  if (e.kind === 'conflict') {
    for (let i = 0; i < 2; i++) s.enemies.push({ id: s.nextId++, x: e.x + (i ? 8 : -8), y: e.y, hp: 1, kind: 'mini', cd: 0.5 });
    say(s, 'Merge Conflict 가 갈라졌어요!');
  }
  if (s.rng() < 0.25) s.pickups.push({ x: e.x, y: e.y, rounds: 2 + Math.floor(s.rng() * 3) });
}
