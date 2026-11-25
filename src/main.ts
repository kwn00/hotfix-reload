import { newFloor, step, shoot, State, TILE, W, H, ENEMY, los, say } from './game.ts';
import { eject, insert, rack, fillOne, totalRounds, GunEvent } from './gun.ts';
import { sfx } from './sound.ts';

const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const title = document.getElementById('title')!;
const bestEl = document.getElementById('best')!;
const FLOORS = 5;

let s: State | null = null;
let seed = 0;
const keys = new Set<string>();
let mouse = { x: 0, y: 0, down: false };
let checkHold = 0;
let touchMove: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
let touchFire = false;

function best(): number { try { return Number(localStorage.getItem('hr-best') || 0); } catch { return 0; } }
function saveBest(v: number) { try { if (v > best()) localStorage.setItem('hr-best', String(v)); } catch { /* 무시 */ } }
function score(st: State) { return (st.floor - 1) * 1000 + st.kills * 50 + (st.cleared && st.floor === FLOORS ? 2000 : 0); }
function showBest() { const b = best(); bestEl.textContent = b ? `최고 점수 ${b}` : ''; }
showBest();

function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize); resize();

const MSG: Partial<Record<GunEvent, string>> = {
  dry: '찰칵. 약실이 비었어요', 'no-mag': '꽂을 탄창이 없어요', 'rack-waste': '한 발이 튕겨 나갔어요',
  'fill-none': '채울 탄이 없어요',
};
function act(ev: GunEvent) { if (!s) return; sfx(ev); const m = MSG[ev]; if (m) say(s, m); }

function action(k: string) {
  if (!s || s.over) return;
  const g = s.gun;
  if (k === 'r') act(eject(g));
  else if (k === 'f') act(insert(g));
  else if (k === ' ' || k === 'space') act(rack(g));
  else if (k === 'e') act(fillOne(g));
}

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'tab') e.preventDefault();
  if (!keys.has(k)) action(k);
  keys.add(k);
  if ((s?.over || s?.cleared) && k === 'enter') next();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', () => { mouse.down = true; if (s) act(shoot(s)); });
addEventListener('mouseup', () => mouse.down = false);

// 터치: 왼쪽 절반 드래그 = 이동, 조준은 가장 가까운 보이는 적
cv.addEventListener('touchstart', e => { for (const t of Array.from(e.changedTouches)) if (!touchMove) touchMove = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY }; });
cv.addEventListener('touchmove', e => { for (const t of Array.from(e.changedTouches)) if (touchMove?.id === t.identifier) { touchMove.x = t.clientX; touchMove.y = t.clientY; } });
cv.addEventListener('touchend', e => { for (const t of Array.from(e.changedTouches)) if (touchMove?.id === t.identifier) touchMove = null; if (s?.over || s?.cleared) next(); });
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#touch button'))) {
  const k = b.dataset.k!;
  b.addEventListener('touchstart', e => { e.preventDefault(); if (k === 'fire') { touchFire = true; if (s) act(shoot(s)); } else if (k === 'q') keys.add('q'); else action(k); });
  b.addEventListener('touchend', e => { e.preventDefault(); if (k === 'fire') touchFire = false; if (k === 'q') keys.delete('q'); if (s?.over || s?.cleared) next(); });
}

document.getElementById('start')!.addEventListener('click', () => {
  seed = (Math.random() * 1e9) | 0; s = newFloor(1, seed); title.classList.add('hidden');
});

function next() {
  if (!s) return;
  if (s.over || (s.cleared && s.floor === FLOORS)) { saveBest(score(s)); showBest(); s = null; title.classList.remove('hidden'); return; }
  s = newFloor(s.floor + 1, seed, { gun: s.gun, hp: Math.min(5, s.hp + 1), kills: s.kills, time: s.time });
}

let camX = 0, camY = 0;
function nearestVisible(st: State) {
  let bestE = null, bd = 1e9;
  for (const e of st.enemies) { const d = Math.hypot(e.x - st.px, e.y - st.py); if (d < bd && d < 320 && los(st, e.x, e.y)) { bd = d; bestE = e; } }
  return bestE;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (s) {
    let mx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let my = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    let aim = Math.atan2(mouse.y + camY - s.py, mouse.x + camX - s.px);
    if (touchMove) { mx = (touchMove.x - touchMove.ox) / 40; my = (touchMove.y - touchMove.oy) / 40; }
    if (matchMedia('(pointer: coarse)').matches) {
      const t = nearestVisible(s);
      aim = t ? Math.atan2(t.y - s.py, t.x - s.px) : (mx || my ? Math.atan2(my, mx) : s.aim);
    }
    checkHold = keys.has('q') ? checkHold + dt : 0;
    void touchFire;
    const wasOver = s.over;
    step(s, { mx, my, aim, shoot: false }, dt);
    if (!wasOver && s.over) sfx('dead');
    draw(s);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function draw(st: State) {
  const vw = cv.width, vh = cv.height;
  camX = Math.max(0, Math.min(W * TILE - vw, st.px - vw / 2)); camY = Math.max(0, Math.min(H * TILE - vh, st.py - vh / 2));
  if (W * TILE < vw) camX = (W * TILE - vw) / 2;
  if (H * TILE < vh) camY = (H * TILE - vh) / 2;
  ctx.fillStyle = '#010409'; ctx.fillRect(0, 0, vw, vh);
  ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wl = st.map[y * W + x] === 1;
    ctx.fillStyle = wl ? '#30363d' : (x + y) % 2 ? '#161b22' : '#14191f';
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (wl) { ctx.fillStyle = '#484f58'; ctx.fillRect(x * TILE, y * TILE, TILE, 4); }
  }
  // 출구
  ctx.fillStyle = '#3fb950'; ctx.fillRect(st.exit.x - 12, st.exit.y - 14, 24, 28);
  ctx.fillStyle = '#0d1117'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('$_', st.exit.x, st.exit.y + 4);
  for (const p of st.pickups) { ctx.fillStyle = '#d29922'; ctx.fillRect(p.x - 5, p.y - 4, 10, 8); }
  for (const e of st.enemies) {
    if (!los(st, e.x, e.y)) continue; // 벽 너머는 안 보인다
    const r = ENEMY[e.kind].r;
    ctx.fillStyle = e.kind === 'npe' ? '#a371f7' : e.kind === 'conflict' ? '#db6d28' : e.kind === 'mini' ? '#f0883e' : '#f85149';
    ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
    ctx.fillStyle = '#000'; ctx.fillRect(e.x - r / 2, e.y - r / 3, 3, 3); ctx.fillRect(e.x + r / 2 - 3, e.y - r / 3, 3, 3);
  }
  ctx.fillStyle = '#ffd33d'; for (const b of st.bullets) ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
  // 플레이어
  ctx.fillStyle = st.hurt > 0 && Math.floor(st.hurt * 20) % 2 ? '#fff' : '#58a6ff';
  ctx.fillRect(st.px - 10, st.py - 10, 20, 20);
  ctx.strokeStyle = '#c9d1d9'; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(st.px, st.py); ctx.lineTo(st.px + Math.cos(st.aim) * 18, st.py + Math.sin(st.aim) * 18); ctx.stroke();
  ctx.restore();

  // HUD: 체력, 총 상태(탄 수 없이 모양만), 로그
  ctx.textAlign = 'left'; ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(1,4,9,.65)'; ctx.fillRect(0, 0, Math.min(cv.width, 560), checkHold > 0 ? 100 : 78);
  ctx.fillStyle = '#f85149'; ctx.fillText('♥'.repeat(Math.max(0, st.hp)), 12, 22);
  ctx.fillStyle = '#8b949e'; ctx.fillText(`${st.floor}F · 처치 ${st.kills}`, 12, 42);
  const g = st.gun;
  ctx.fillStyle = '#c9d1d9';
  ctx.fillText(`탄창 ${g.mag === null ? '없음' : '꽂힘'} · 주머니 탄창 ${g.pockets.length}개${g.looseRounds ? ' · 낱개 탄 있음' : ''}`, 12, 62);
  if (g.busy > 0) { ctx.fillStyle = '#d29922'; ctx.fillRect(12, 70, g.busy * 120, 4); }
  if (checkHold > 0.6) {
    ctx.fillStyle = '#3fb950';
    ctx.fillText(`$ git status → 약실 ${g.chamber ? 1 : 0} · 탄창 ${g.mag ?? '-'} · 주머니 [${g.pockets.join(', ')}] · 낱개 ${g.looseRounds} (합 ${totalRounds(g)})`, 12, 92);
  } else if (checkHold > 0) { ctx.fillStyle = '#8b949e'; ctx.fillText('$ git status' + '.'.repeat(Math.floor(checkHold * 6)), 12, 92); }
  st.log.forEach((l, i) => { ctx.globalAlpha = Math.min(1, l.t); ctx.fillStyle = '#e6edf3'; ctx.fillText(l.text, 12, cv.height - 20 - (st.log.length - 1 - i) * 20); });
  ctx.globalAlpha = 1;
  if (st.over || st.cleared) {
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace';
    const win = st.cleared && st.floor === FLOORS;
    ctx.fillStyle = st.over ? '#f85149' : '#3fb950';
    ctx.fillText(st.over ? 'Segmentation fault (core dumped)' : win ? '롤백 완료. 주말을 지켰어요!' : `${st.floor}층 통과`, cv.width / 2, cv.height / 2);
    ctx.font = '14px monospace'; ctx.fillStyle = '#8b949e';
    ctx.fillText(`점수 ${score(st)} · Enter / 화면을 눌러 계속`, cv.width / 2, cv.height / 2 + 30);
  }
}
