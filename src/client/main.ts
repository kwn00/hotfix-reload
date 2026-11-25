// 화면: 입력을 서버로 보내고, 서버가 보낸 스냅샷을 그린다. 판정은 하지 않는다.
import type { SnapMsg, FloorMsg, ServerMsg } from '../shared/protocol.ts';
import { ENEMY, TILE, type Action } from '../shared/game.ts';
import { Net } from './net.ts';
import { sfx } from './sound.ts';
import { initNews } from './news.ts';

const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const title = document.getElementById('title')!;
const bestEl = document.getElementById('best')!;
const statusEl = document.getElementById('status')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
initNews();

const net = new Net();
let floor: FloorMsg | null = null;
let snap: SnapMsg | null = null;
let prev: SnapMsg | null = null;
let snapAt = 0;
let playing = false;
const keys = new Set<string>();
const mouse = { x: 0, y: 0 };
let pendingFire = false;
let pendingAct: Action | null = null;
let touchMove: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
const coarse = matchMedia('(pointer: coarse)');

function best(): number { try { return Number(localStorage.getItem('hr-best') || 0); } catch { return 0; } }
function saveBest(v: number) { try { if (v > best()) localStorage.setItem('hr-best', String(v)); } catch { /* 무시 */ } }
function showBest() { const b = best(); bestEl.textContent = b ? `최고 점수 ${b}` : ''; }
showBest();

function resize() { cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', resize); resize();

net.onMsg = (m: ServerMsg) => {
  if (m.t === 'floor') { floor = m; prev = snap = null; }
  else if (m.t === 'snap') {
    prev = snap; snap = m; snapAt = performance.now();
    for (const ev of m.events) sfx(ev);
  }
};
net.onClose = () => { if (playing) { playing = false; floor = snap = null; title.classList.remove('hidden'); } statusEl.textContent = '서버와 연결이 끊겼어요. 다시 시작해 주세요.'; };

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true; statusEl.textContent = '서버에 연결하는 중… (잠든 서버는 깨는 데 1분쯤 걸려요)';
  try {
    if (!net.open) await net.connect();
    net.send({ t: 'start' }); playing = true; title.classList.add('hidden'); statusEl.textContent = '';
  } catch { statusEl.textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
  startBtn.disabled = false;
});

const KEY_ACT: Record<string, Action> = { r: 'eject', f: 'insert', ' ': 'rack', e: 'fill' };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'tab') e.preventDefault();
  if (!keys.has(k) && KEY_ACT[k]) pendingAct = KEY_ACT[k];
  keys.add(k);
  if (k === 'enter') proceed();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', () => { pendingFire = true; proceed(); });

cv.addEventListener('touchstart', e => { for (const t of Array.from(e.changedTouches)) if (!touchMove) touchMove = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY }; });
cv.addEventListener('touchmove', e => { for (const t of Array.from(e.changedTouches)) if (touchMove?.id === t.identifier) { touchMove.x = t.clientX; touchMove.y = t.clientY; } });
cv.addEventListener('touchend', e => { for (const t of Array.from(e.changedTouches)) if (touchMove?.id === t.identifier) touchMove = null; proceed(); });
const TOUCH_ACT: Record<string, Action> = { r: 'eject', f: 'insert', space: 'rack', e: 'fill' };
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#touch button'))) {
  const k = b.dataset.k!;
  b.addEventListener('touchstart', e => { e.preventDefault(); if (k === 'fire') pendingFire = true; else if (k === 'q') keys.add('q'); else pendingAct = TOUCH_ACT[k]; });
  b.addEventListener('touchend', e => { e.preventDefault(); if (k === 'q') keys.delete('q'); proceed(); });
}

/** 층을 깼거나 끝났을 때 다음으로 */
function proceed() {
  if (!snap || !(snap.over || snap.cleared)) return;
  if (snap.over || snap.won) { saveBest(snap.score); showBest(); playing = false; floor = snap = null; title.classList.remove('hidden'); return; }
  net.send({ t: 'next' });
}

let camX = 0, camY = 0;
let lastSend = 0;
function frame(now: number) {
  if (playing && snap && floor) {
    let mx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    let my = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (touchMove) { mx = Math.max(-1, Math.min(1, (touchMove.x - touchMove.ox) / 40)); my = Math.max(-1, Math.min(1, (touchMove.y - touchMove.oy) / 40)); }
    let aim = Math.atan2(mouse.y + camY - snap.py, mouse.x + camX - snap.px);
    if (coarse.matches) {
      // 터치: 보이는 적 중 가장 가까운 쪽 (서버가 보내 준 적만 알 수 있다)
      let bestD = 1e9, t = null as null | { x: number; y: number };
      for (const e of snap.enemies) { const d = Math.hypot(e.x - snap.px, e.y - snap.py); if (d < bestD) { bestD = d; t = e; } }
      aim = t ? Math.atan2(t.y - snap.py, t.x - snap.px) : (mx || my ? Math.atan2(my, mx) : snap.aim);
    }
    // 30Hz 로 보낸다. 쏘기·장전은 다음 전송에 실어 보낸다
    if (now - lastSend >= 33 || pendingFire || pendingAct) {
      net.send({ t: 'in', mx, my, aim, fire: pendingFire, act: pendingAct, check: keys.has('q') });
      pendingFire = false; pendingAct = null; lastSend = now;
    }
    draw(snap, floor, aim, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function draw(st: SnapMsg, fl: FloorMsg, aim: number, now: number) {
  const vw = cv.width, vh = cv.height, MW = fl.w * TILE, MH = fl.h * TILE;
  // 스냅샷 사이를 부드럽게 (한 틱 늦게 그린다)
  const t = Math.min(1, (now - snapAt) / 33);
  const pp = prev ?? st;
  const px = lerp(pp.px, st.px, t), py = lerp(pp.py, st.py, t);
  camX = MW < vw ? (MW - vw) / 2 : Math.max(0, Math.min(MW - vw, px - vw / 2));
  camY = MH < vh ? (MH - vh) / 2 : Math.max(0, Math.min(MH - vh, py - vh / 2));
  ctx.fillStyle = '#010409'; ctx.fillRect(0, 0, vw, vh);
  ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
  for (let y = 0; y < fl.h; y++) for (let x = 0; x < fl.w; x++) {
    const wl = fl.map[y * fl.w + x] === '1';
    ctx.fillStyle = wl ? '#30363d' : (x + y) % 2 ? '#161b22' : '#14191f';
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (wl) { ctx.fillStyle = '#484f58'; ctx.fillRect(x * TILE, y * TILE, TILE, 4); }
  }
  ctx.fillStyle = '#3fb950'; ctx.fillRect(fl.exit.x - 12, fl.exit.y - 14, 24, 28);
  ctx.fillStyle = '#0d1117'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText('$_', fl.exit.x, fl.exit.y + 4);
  for (const [x, y] of st.pickups) { ctx.fillStyle = '#d29922'; ctx.fillRect(x - 5, y - 4, 10, 8); }
  const prevE = new Map((prev?.enemies ?? []).map(e => [e.id, e]));
  for (const e of st.enemies) {
    const p0 = prevE.get(e.id) ?? e, ex = lerp(p0.x, e.x, t), ey = lerp(p0.y, e.y, t);
    const r = ENEMY[e.kind]?.r ?? 10;
    ctx.fillStyle = e.kind === 'npe' ? '#a371f7' : e.kind === 'conflict' ? '#db6d28' : e.kind === 'mini' ? '#f0883e' : '#f85149';
    ctx.fillRect(ex - r, ey - r, r * 2, r * 2);
    ctx.fillStyle = '#000'; ctx.fillRect(ex - r / 2, ey - r / 3, 3, 3); ctx.fillRect(ex + r / 2 - 3, ey - r / 3, 3, 3);
  }
  ctx.fillStyle = '#ffd33d'; for (const [x, y] of st.bullets) ctx.fillRect(x - 2, y - 2, 4, 4);
  ctx.fillStyle = st.hurt && Math.floor(now / 50) % 2 ? '#fff' : '#58a6ff';
  ctx.fillRect(px - 10, py - 10, 20, 20);
  ctx.strokeStyle = '#c9d1d9'; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(aim) * 18, py + Math.sin(aim) * 18); ctx.stroke();
  ctx.restore();

  ctx.textAlign = 'left'; ctx.font = '14px monospace';
  ctx.fillStyle = 'rgba(1,4,9,.65)'; ctx.fillRect(0, 0, Math.min(vw, 560), st.checking > 0 ? 100 : 78);
  ctx.fillStyle = '#f85149'; ctx.fillText('♥'.repeat(Math.max(0, st.hp)), 12, 22);
  ctx.fillStyle = '#8b949e'; ctx.fillText(`${st.floor}F · 처치 ${st.kills}`, 12, 42);
  const g = st.gun;
  ctx.fillStyle = '#c9d1d9';
  ctx.fillText(`탄창 ${g.magIn ? '꽂힘' : '없음'} · 주머니 탄창 ${g.pockets}개${g.hasLoose ? ' · 낱개 탄 있음' : ''}`, 12, 62);
  if (g.busy > 0) { ctx.fillStyle = '#d29922'; ctx.fillRect(12, 70, g.busy * 120, 4); }
  if (st.ammo) {
    const a = st.ammo, total = a.chamber + (a.mag ?? 0) + a.pockets.reduce((x, y) => x + y, 0) + a.loose;
    ctx.fillStyle = '#3fb950';
    ctx.fillText(`$ git status → 약실 ${a.chamber} · 탄창 ${a.mag ?? '-'} · 주머니 [${a.pockets.join(', ')}] · 낱개 ${a.loose} (합 ${total})`, 12, 92);
  } else if (st.checking > 0) { ctx.fillStyle = '#8b949e'; ctx.fillText('$ git status' + '.'.repeat(Math.ceil(st.checking * 4)), 12, 92); }
  st.log.forEach((l, i) => { ctx.fillStyle = '#e6edf3'; ctx.fillText(l, 12, vh - 20 - (st.log.length - 1 - i) * 20); });
  if (st.over || st.cleared) {
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, vw, vh);
    ctx.textAlign = 'center'; ctx.font = 'bold 22px monospace';
    ctx.fillStyle = st.over ? '#f85149' : '#3fb950';
    ctx.fillText(st.over ? 'Segmentation fault (core dumped)' : st.won ? '롤백 완료. 주말을 지켰어요!' : `${st.floor}층 통과`, vw / 2, vh / 2);
    ctx.font = '14px monospace'; ctx.fillStyle = '#8b949e';
    ctx.fillText(`점수 ${st.score} · Enter / 화면을 눌러 계속`, vw / 2, vh / 2 + 30);
  }
}
