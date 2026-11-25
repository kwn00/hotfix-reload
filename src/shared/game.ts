// 사이드뷰 시뮬레이션. 서버만 이것을 돌린다 (화면은 결과만 받는다).
// 좌표: x 오른쪽, y 아래. 사람의 (x, y) 는 발 가운데.
import { Gun, GunEvent, newGun, cloneGun, tick as gunTick, fire, eject, insert, rack, grab, stow, pickupMag } from './gun.ts';
import { ROOMS, TILE, parseRoom, Parsed, EnemyKind } from './level.ts';
// 브라우저에서 돈 판을 서버가 다시 돌려 똑같은 결과를 얻어야 하므로 Math.sin 등 대신 결정적 수학을 쓴다
import { dsin, dcos, datan2, dhypot } from './dmath.ts';

export { TILE };
export type { EnemyKind };
export const TICK = 1 / 30;

export const PLAYER = { w: 18, stand: 56, crouch: 30, speed: 150, crouchSpeed: 70, jump: 600, hp: 2, invuln: 0.8 };
export const GRAVITY = 1800;
export const SLOWMO = { world: 0.3, player: 0.6, drain: 0.3, regen: 0.06, killBonus: 0.15 };
export const AUTO_AIM = 0.12;      // 이 각도(라디안) 안의 보이는 적에게 탄이 붙는다
export const MELEE = { reach: 40, time: 0.4 };
export const CHECK_TIME = 0.6;
export const RESPAWN_TIME = 1.4;
export const PLAYER_BULLET = 2600, ENEMY_BULLET = 460;

export interface EnemyDef { label: string; hp: number; speed: number; w: number; h: number; telegraph: number; cd: number; shots: number; burstGap: number; pellets: number; spread: number; range: number }
export const ENEMY: Record<EnemyKind, EnemyDef> = {
  bug:      { label: '버그',                  hp: 1, speed: 45, w: 20, h: 50, telegraph: 0.8, cd: 1.6, shots: 1, burstGap: 0,    pellets: 1, spread: 0.04, range: 560 },
  npe:      { label: 'NullPointerException', hp: 1, speed: 90, w: 18, h: 46, telegraph: 0.6, cd: 2.0, shots: 3, burstGap: 0.12, pellets: 1, spread: 0.08, range: 560 },
  conflict: { label: 'Merge Conflict',       hp: 2, speed: 35, w: 24, h: 54, telegraph: 0.9, cd: 2.2, shots: 1, burstGap: 0,    pellets: 5, spread: 0.3,  range: 340 },
  debt:     { label: '기술 부채',              hp: 3, speed: 22, w: 28, h: 58, telegraph: 1.0, cd: 1.4, shots: 1, burstGap: 0,    pellets: 1, spread: 0.05, range: 600 },
};

export interface Enemy {
  id: number; kind: EnemyKind; x: number; y: number; vy: number; hp: number; dir: 1 | -1;
  alert: number;        // 플레이어를 보고 반응하기까지 남은 시간
  aimT: number;         // 조준 중 남은 시간 (0 보다 크면 조준선이 보인다)
  aimAng: number;
  cd: number; burst: number; burstT: number; sees: boolean;
  heard: number;        // 총소리를 들은 뒤 남은 경계 시간
}
export interface Bullet { id: number; x: number; y: number; vx: number; vy: number; life: number; enemy: boolean }
export interface Mag { id: number; x: number; y: number; rounds: number }

export interface Player { x: number; y: number; vy: number; onGround: boolean; crouch: boolean; face: 1 | -1; hp: number; invuln: number; melee: number; meleeTarget: number }

export interface State {
  room: number; map: Parsed;
  p: Player; aim: number;
  gun: Gun; checkpoint: Gun;
  enemies: Enemy[]; bullets: Bullet[]; mags: Mag[];
  slowmo: boolean; meter: number;
  kills: number; deaths: number; time: number; roomTime: number;
  roomKills: number;     // 방에 들어올 때의 처치 수 (다시 시작하면 되돌린다: 같은 적을 다시 쓰러뜨려 점수를 불리지 못하게)
  dead: number;          // 쓰러진 뒤 다시 시작하기까지 남은 시간 (0 = 살아 있음)
  won: boolean;
  alarm: Alarm;          // 경계 상태: 적이 나를 보고 있으면 alarmed, 소리를 들었으면 alert
  checkHold: number;
  events: GunEvent[]; log: { text: string; t: number }[];
  nextId: number; rng: () => number;
  /** 화면 연출용: 이번 틱의 총구 화염 / 맞은 자리 */
  flashes: { x: number; y: number; enemy: boolean }[];
  impacts: { x: number; y: number }[];
}

export type Action = 'eject' | 'insert' | 'rack' | 'stow' | 'grab1' | 'grab2' | 'grab3' | 'grab4';
export const ACTION_LIST: readonly Action[] = ['eject', 'insert', 'rack', 'stow', 'grab1', 'grab2', 'grab3', 'grab4'];
export type Alarm = 'calm' | 'alert' | 'alarmed';
/** 클라이언트가 보내는 "의도". 서버는 이것만 받는다. */
export interface Input {
  mx: number;            // -1 ~ 1 좌우
  jump: boolean; crouch: boolean;
  aim: number;           // 조준 각도 (라디안)
  fire: boolean; melee: boolean; act: Action | null;
  slowmo: boolean; check: boolean; interact: boolean;
}
export const IDLE: Input = { mx: 0, jump: false, crouch: false, aim: 0, fire: false, melee: false, act: null, slowmo: false, check: false, interact: false };

export function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- 지형 ----------
export const tileAt = (m: Parsed, tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h ? 1 : m.tiles[ty * m.w + tx]);
export const solid = (m: Parsed, x: number, y: number) => { const t = tileAt(m, Math.floor(x / TILE), Math.floor(y / TILE)); return t === 1 || t === 2; };

function boxHits(m: Parsed, x: number, y: number, w: number, h: number) {
  const x0 = Math.floor((x - w / 2) / TILE), x1 = Math.floor((x + w / 2 - 0.01) / TILE);
  const y0 = Math.floor((y - h) / TILE), y1 = Math.floor((y - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const t = tileAt(m, tx, ty); if (t === 1 || t === 2) return true; }
  return false;
}

/** 이동 + 중력. 땅에 닿았으면 true */
function physics(m: Parsed, o: { x: number; y: number; vy: number }, dx: number, w: number, h: number, dt: number): boolean {
  if (dx !== 0 && !boxHits(m, o.x + dx, o.y, w, h)) o.x += dx;
  o.vy = Math.min(1200, o.vy + GRAVITY * dt);
  const dy = o.vy * dt;
  if (!boxHits(m, o.x, o.y + dy, w, h)) { o.y += dy; return false; }
  // 닿을 때까지 붙인다
  if (dy > 0) { o.y = Math.floor((o.y + dy) / TILE) * TILE; o.vy = 0; return true; }
  o.y = Math.ceil((o.y + dy - h) / TILE) * TILE + h; o.vy = 0; return false;
}

/** 두 점 사이에 벽이나 책상이 없는가 */
export function clear(m: Parsed, x0: number, y0: number, x1: number, y1: number) {
  const d = dhypot(x1 - x0, y1 - y0), n = Math.ceil(d / 6);
  for (let i = 1; i < n; i++) if (solid(m, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)) return false;
  return true;
}

/** 플레이어의 이동 · 점프 · 숙이기 한 틱. 서버의 판정과 화면의 예측(즉시 반응)이 같은 코드를 쓴다 */
export type Body = { x: number; y: number; vy: number; onGround: boolean; crouch: boolean };
export function movePlayer(m: Parsed, p: Body, inp: { mx: number; jump: boolean; crouch: boolean }, pdt: number) {
  // 숙이기: 일어설 자리가 없으면 숙인 채로
  const wantCrouch = inp.crouch && p.onGround;
  if (!wantCrouch && p.crouch && boxHits(m, p.x, p.y, PLAYER.w, PLAYER.stand)) p.crouch = true; else p.crouch = wantCrouch;
  const speed = p.crouch ? PLAYER.crouchSpeed : PLAYER.speed;
  if (inp.jump && p.onGround && !p.crouch) { p.vy = -PLAYER.jump; p.onGround = false; }
  p.onGround = physics(m, p, Math.max(-1, Math.min(1, inp.mx)) * speed * pdt, PLAYER.w, p.crouch ? PLAYER.crouch : PLAYER.stand, pdt);
}

// 몸의 기준점들
export const pHeight = (p: Player) => (p.crouch ? PLAYER.crouch : PLAYER.stand);
export const pEye = (p: Player) => ({ x: p.x, y: p.y - pHeight(p) + 8 });
export const pGun = (p: Player) => ({ x: p.x, y: p.y - (p.crouch ? 18 : 36) });
const pChest = (p: Player) => ({ x: p.x, y: p.y - (p.crouch ? 16 : 40) });
export const eChest = (e: Enemy) => ({ x: e.x, y: e.y - ENEMY[e.kind].h * 0.7 });

/** 플레이어 눈에 보이는 적인가 (가슴이나 머리 중 하나가 보이면) */
export function visible(s: State, e: Enemy) {
  const eye = pEye(s.p), d = ENEMY[e.kind];
  return clear(s.map, eye.x, eye.y, e.x, e.y - d.h + 6) || clear(s.map, eye.x, eye.y, e.x, e.y - d.h * 0.6);
}

// ---------- 방 ----------
export function enterRoom(s: State, room: number) {
  s.room = room; s.map = parseRoom(ROOMS[room]);
  s.checkpoint = cloneGun(s.gun);
  s.roomKills = s.kills;
  resetRoom(s);
  say(s, ROOMS[room].name);
}

function resetRoom(s: State) {
  const m = s.map;
  s.p = { x: m.start.x, y: m.start.y, vy: 0, onGround: true, crouch: false, face: 1, hp: PLAYER.hp, invuln: 0, melee: 0, meleeTarget: 0 };
  s.gun = cloneGun(s.checkpoint);
  s.enemies = m.enemies.map(e => ({ id: s.nextId++, kind: e.kind, x: e.x, y: e.y, vy: 0, hp: ENEMY[e.kind].hp, dir: -1 as const,
    alert: 0, aimT: 0, aimAng: Math.PI, cd: 0.5 + s.rng(), burst: 0, burstT: 0, sees: false, heard: 0 }));
  s.mags = m.mags.map(g => ({ id: s.nextId++, x: g.x, y: g.y, rounds: 2 + Math.floor(s.rng() * 6) }));
  s.bullets = []; s.dead = 0; s.alarm = 'calm'; s.kills = s.roomKills; s.roomTime = 0; s.slowmo = false; s.meter = Math.max(s.meter, 0.5);
}

export function newGame(seed: number): State {
  const s = {
    room: 0, map: parseRoom(ROOMS[0]), p: null as unknown as Player, aim: 0,
    gun: newGun(), checkpoint: newGun(), enemies: [], bullets: [], mags: [],
    slowmo: false, meter: 1, kills: 0, roomKills: 0, deaths: 0, time: 0, roomTime: 0, dead: 0, won: false, alarm: 'calm', checkHold: 0,
    events: [], log: [], nextId: 1, rng: mulberry32(seed), flashes: [], impacts: [],
  } as State;
  enterRoom(s, 0);
  return s;
}

export function say(s: State, text: string) { s.log.push({ text, t: 3 }); if (s.log.length > 4) s.log.shift(); }

const MSG: Partial<Record<GunEvent, string>> = {
  dry: '찰칵. 약실이 비었어요', jam: '총이 걸렸어요! 슬라이드를 당기세요 (Space)', jammed: '걸렸어요! Space',
  'no-mag': '탄창이 없어요', 'rack-waste': '한 발이 튕겨 나갔어요', 'hand-full': '손에 이미 탄창이 있어요 (G 로 넣기)',
  'empty-slot': '빈 칸이에요', 'no-slot': '넣을 칸이 없어요',
};
function ev(s: State, e: GunEvent) { if (e === 'busy') return; s.events.push(e); const m = MSG[e]; if (m) say(s, m); }

// ---------- 한 틱 ----------
const ACTIONS: Record<Action, (g: Gun) => GunEvent> = {
  eject, insert, rack, stow,
  grab1: g => grab(g, 0), grab2: g => grab(g, 1), grab3: g => grab(g, 2), grab4: g => grab(g, 3),
};

export function step(s: State, inp: Input, dt: number): void {
  s.events = []; s.flashes = []; s.impacts = [];
  if (s.won) return;
  for (const l of s.log) l.t -= dt;
  s.log = s.log.filter(l => l.t > 0);
  s.time += dt;

  if (s.dead > 0) {
    s.slowmo = false;
    s.dead -= dt;
    if (s.dead <= 0) { resetRoom(s); say(s, '다시 시도'); }
    return;
  }

  // 슬로모션: 게이지가 있을 때만
  s.slowmo = inp.slowmo && s.meter > 0;
  if (s.slowmo) s.meter = Math.max(0, s.meter - SLOWMO.drain * dt); else s.meter = Math.min(1, s.meter + SLOWMO.regen * dt);
  const wdt = dt * (s.slowmo ? SLOWMO.world : 1), pdt = dt * (s.slowmo ? SLOWMO.player : 1);
  s.roomTime += wdt;

  const p = s.p;
  s.aim = inp.aim;
  p.face = dcos(inp.aim) >= 0 ? 1 : -1;
  p.invuln = Math.max(0, p.invuln - wdt);
  gunTick(s.gun, pdt);
  s.checkHold = inp.check ? s.checkHold + dt : 0;

  // 근접 격투 중에는 움직이지 못한다
  if (p.melee > 0) {
    p.melee -= pdt;
    if (p.melee <= 0) {
      const t = s.enemies.find(e => e.id === p.meleeTarget && e.hp > 0);
      if (t) { t.hp = 0; kill(s, t, true); }
    }
  } else {
    movePlayer(s.map, p, inp, pdt);

    if (inp.act) ev(s, ACTIONS[inp.act](s.gun));
    // 빠진 탄창은 발밑에 떨어진다 (남은 탄 그대로. 다시 주울 수 있다)
    if (s.gun.dropped !== null) { s.mags.push({ id: s.nextId++, x: p.x + p.face * 6, y: p.y, rounds: s.gun.dropped }); s.gun.dropped = null; }
    if (inp.fire) shoot(s);
    if (inp.melee && s.gun.busy <= 0) tryMelee(s);

    // E: 바닥의 탄창 줍기 (가장 가까운 것), 없으면 문
    if (inp.interact && !touchingDoor(s)) {
      let best: Mag | null = null, bd = 30;
      for (const g of s.mags) { const d = Math.abs(g.x - p.x); if (d < bd && Math.abs(g.y - p.y) < 24) { bd = d; best = g; } }
      if (best) {
        if (pickupMag(s.gun, best.rounds)) { s.mags = s.mags.filter(g => g !== best); s.events.push('pickup'); say(s, '탄창을 주웠어요 (몇 발인지는 몰라요)'); }
        else ev(s, 'no-slot');
      }
    }
    // 문
    if (inp.interact && touchingDoor(s)) {
      s.events.push('door');
      if (s.room + 1 >= ROOMS.length) { s.won = true; s.slowmo = false; say(s, '롤백 완료. 주말을 지켰어요!'); return; }
      enterRoom(s, s.room + 1);
      return;
    }
  }


  // 탄
  for (const b of s.bullets) {
    // 빠른 탄이 얇은 적을 건너뛰지 않게 잘게 나눠 움직인다 (2600px/s ÷ 30틱 ÷ 8 ≈ 11px)
    const steps = 8, sx = b.vx * wdt / steps, sy = b.vy * wdt / steps;
    for (let i = 0; i < steps && b.life > 0; i++) {
      b.x += sx; b.y += sy;
      if (solid(s.map, b.x, b.y)) { b.life = 0; s.impacts.push({ x: b.x, y: b.y }); break; }
      if (b.enemy) {
        const h = pHeight(p);
        if (p.invuln <= 0 && Math.abs(b.x - p.x) < PLAYER.w / 2 + 2 && b.y > p.y - h && b.y < p.y) { b.life = 0; hurt(s); }
      } else {
        for (const e of s.enemies) {
          const d = ENEMY[e.kind];
          if (e.hp > 0 && Math.abs(b.x - e.x) < d.w / 2 + 2 && b.y > e.y - d.h && b.y < e.y) {
            b.life = 0; e.hp--; e.alert = 0; s.impacts.push({ x: b.x, y: b.y });
            if (e.hp <= 0) kill(s, e, false);
            break;
          }
        }
      }
    }
    b.life -= wdt;
  }
  s.bullets = s.bullets.filter(b => b.life > 0);

  for (const e of s.enemies) if (e.hp > 0) enemyThink(s, e, wdt);
  s.enemies = s.enemies.filter(e => e.hp > 0);
  s.alarm = s.enemies.some(e => e.sees) ? 'alarmed' : s.enemies.some(e => e.heard > 0) ? 'alert' : 'calm';
}

function touchingDoor(s: State) {
  const p = s.p, m = s.map;
  const tx0 = Math.floor((p.x - PLAYER.w / 2 - 4) / TILE), tx1 = Math.floor((p.x + PLAYER.w / 2 + 4) / TILE);
  const ty0 = Math.floor((p.y - pHeight(p)) / TILE), ty1 = Math.floor((p.y - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (tileAt(m, tx, ty) === 3) return true;
  return false;
}

export function shoot(s: State) {
  const e0 = fire(s.gun, s.rng());
  ev(s, e0);
  if (e0 !== 'fire' && e0 !== 'jam') return;
  const g = pGun(s.p);
  let ang = s.aim;
  // 자동 조준: 조준 방향 가까이에 있는 보이는 적에게 붙인다
  let best = AUTO_AIM;
  for (const e of s.enemies) {
    if (e.hp <= 0 || !visible(s, e)) continue;
    const c = eChest(e), a = datan2(c.y - g.y, c.x - g.x);
    const diff = Math.abs(datan2(dsin(a - s.aim), dcos(a - s.aim)));
    if (diff < best && clear(s.map, g.x, g.y, c.x, c.y)) { best = diff; ang = a; }
  }
  s.bullets.push({ id: s.nextId++, x: g.x + dcos(ang) * 14, y: g.y + dsin(ang) * 14, vx: dcos(ang) * PLAYER_BULLET, vy: dsin(ang) * PLAYER_BULLET, life: 1, enemy: false });
  s.flashes.push({ x: g.x + dcos(ang) * 16, y: g.y + dsin(ang) * 16, enemy: false });
  // 총소리를 들은 적은 바로 반응한다
  for (const e of s.enemies) if (Math.abs(e.x - s.p.x) < 400) { e.alert = Math.min(e.alert, 0.15); e.heard = 6; }
}

function tryMelee(s: State) {
  const p = s.p;
  let target: Enemy | null = null;
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const dx = e.x - p.x;
    if (Math.abs(dx) < MELEE.reach && Math.abs(e.y - p.y) < 24 && Math.sign(dx || p.face) === p.face) { target = e; break; }
  }
  if (!target) return;
  p.melee = MELEE.time; p.meleeTarget = target.id;
  target.aimT = 0; target.cd = MELEE.time + 0.2; target.burst = 0; // 붙잡힌 적은 쏘지 못한다
}

function hurt(s: State) {
  const p = s.p;
  p.hp--; p.invuln = PLAYER.invuln; s.events.push('hit');
  if (p.hp <= 0) { s.dead = RESPAWN_TIME; s.deaths++; s.events.push('dead'); say(s, 'Segmentation fault (core dumped)'); }
}

function kill(s: State, e: Enemy, melee: boolean) {
  s.kills++; s.events.push(melee ? 'takedown' : 'kill');
  s.meter = Math.min(1, s.meter + SLOWMO.killBonus);
  if (s.rng() < 0.5) s.mags.push({ id: s.nextId++, x: e.x, y: e.y, rounds: 1 + Math.floor(s.rng() * 6) });
}

function enemyThink(s: State, e: Enemy, dt: number) {
  const d = ENEMY[e.kind], p = s.p;
  e.cd = Math.max(0, e.cd - dt);
  e.heard = Math.max(0, e.heard - dt);
  const c = eChest(e), target = pChest(p);
  const dist = dhypot(target.x - c.x, target.y - c.y);
  const sees = s.dead <= 0 && dist < d.range && clear(s.map, c.x, c.y - 8, target.x, target.y);
  if (sees && !e.sees) e.alert = Math.max(e.alert, 0.35);
  e.sees = sees;

  // 연사 중
  if (e.burst > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) { enemyShot(s, e); e.burst--; e.burstT = d.burstGap; }
    return;
  }
  if (sees) {
    e.dir = target.x < e.x ? -1 : 1;
    if (e.alert > 0) { e.alert -= dt; return; }
    if (e.aimT > 0) {
      e.aimAng = datan2(target.y - c.y, target.x - c.x);
      e.aimT -= dt;
      if (e.aimT <= 0) { e.burst = d.shots; e.burstT = 0; e.cd = d.cd; }
      return;
    }
    if (e.cd <= 0) { e.aimT = d.telegraph; e.aimAng = datan2(target.y - c.y, target.x - c.x); return; }
    // 쏘기를 기다리는 동안 거리를 맞춘다
    const want = d.range * 0.5;
    const move = Math.abs(target.x - e.x) > want ? e.dir : 0;
    walk(s, e, move * d.speed * dt);
  } else {
    e.aimT = 0;
    // 순찰: 벽이나 낭떠러지에서 돈다
    const ahead = e.x + e.dir * (d.w / 2 + 4);
    if (boxHits(s.map, ahead, e.y, 4, d.h) || !solid(s.map, ahead, e.y + 4)) e.dir = (e.dir === 1 ? -1 : 1);
    walk(s, e, e.dir * d.speed * 0.5 * dt);
  }
}

function walk(s: State, e: Enemy, dx: number) {
  const d = ENEMY[e.kind];
  if (dx !== 0 && !solid(s.map, e.x + Math.sign(dx) * (d.w / 2 + 4), e.y + 4)) dx = 0; // 떨어지지 않는다
  physics(s.map, e, dx, d.w, d.h, TICK);
}

function enemyShot(s: State, e: Enemy) {
  const d = ENEMY[e.kind], c = eChest(e);
  const gx = c.x + e.dir * 12, gy = c.y;
  for (let i = 0; i < d.pellets; i++) {
    const a = e.aimAng + (s.rng() - 0.5) * d.spread * (d.pellets > 1 ? 1 : 2);
    s.bullets.push({ id: s.nextId++, x: gx, y: gy, vx: dcos(a) * ENEMY_BULLET, vy: dsin(a) * ENEMY_BULLET, life: d.range / ENEMY_BULLET * 1.4, enemy: true });
  }
  s.flashes.push({ x: gx, y: gy, enemy: true });
  s.events.push('enemy-fire');
}

export function score(s: State) {
  return Math.max(0, s.room * 1000 + s.kills * 100 + (s.won ? 3000 : 0) - s.deaths * 200 - Math.floor(s.time));
}
