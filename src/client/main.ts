// 화면: 입력을 서버로 보내고, 서버가 보낸 것을 three.js 로 그린다. 판정은 하지 않는다.
import type { SnapMsg, RoomMsg, ServerMsg, ClientMsg } from '../shared/protocol.ts';
import type { Action } from '../shared/game.ts';
import { Net } from './net.ts';
import { sfx } from './sound.ts';
import { initNews } from './news.ts';
import { Scene3D } from './scene.ts';
import { GunRig } from './rig.ts';

const $ = (id: string) => document.getElementById(id)!;
const cv = $('c') as HTMLCanvasElement;
const title = $('title'), hud = $('hud'), statusEl = $('status'), bestEl = $('best');
const startBtn = $('start') as HTMLButtonElement;
const touchUi = $('touch');
initNews();

const scene = new Scene3D(cv);
const rigCv = $('rig') as HTMLCanvasElement;
const rig = new GunRig(rigCv);
rigCv.style.visibility = "hidden";
const net = new Net();
let room: RoomMsg | null = null;
let snap: SnapMsg | null = null, prev: SnapMsg | null = null;
let snapAt = 0, playing = false;
const coarse = matchMedia('(pointer: coarse)');

function best(): number { try { return Number(localStorage.getItem('hr-best') || 0); } catch { return 0; } }
function saveBest(v: number) { try { if (v > best()) localStorage.setItem('hr-best', String(v)); } catch { /* 무시 */ } }
function showBest() { const b = best(); bestEl.textContent = b ? `최고 점수 ${b}` : ''; }
showBest();

const slotBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#slots button'));
function resize() {
  scene.resize(innerWidth, innerHeight);
  rig.resize(rigCv.clientWidth, rigCv.clientHeight);
  slotBtns.forEach((b, i) => { const p = i < 4 ? rig.layout.slots[i] : rig.layout.grip; b.style.left = `${p.x}px`; });
}
addEventListener('resize', resize); resize();

net.onMsg = (m: ServerMsg) => {
  if (m.t === 'room') { room = m; prev = snap = null; scene.setRoom(m); rig.reset(); }
  else if (m.t === 'snap') {
    prev = snap; snap = m; snapAt = performance.now();
    for (const e of m.events) sfx(e);
    if (m.won) finish();
  }
};
net.onClose = () => { if (playing) stop(); statusEl.textContent = '서버와 연결이 끊겼어요. 다시 시작해 주세요.'; };

function stop() { playing = false; room = snap = prev = null; hud.classList.add('hidden'); rigCv.style.visibility = 'hidden'; touchUi.classList.add('hidden'); title.classList.remove('hidden'); }
let finishing = false;
function finish() {
  if (finishing || !snap) return;
  finishing = true; saveBest(snap.score); showBest();
  setTimeout(() => { finishing = false; stop(); net.close(); }, 4000);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true; statusEl.textContent = '서버에 연결하는 중… (잠든 서버는 깨는 데 1분쯤 걸려요)';
  try {
    if (!net.open) await net.connect();
    net.send({ t: 'start' }); playing = true; rig.reset();
    title.classList.add('hidden'); hud.classList.remove('hidden'); rigCv.style.visibility = 'visible'; resize();
    if (coarse.matches) touchUi.classList.remove('hidden');
    statusEl.textContent = '';
  } catch { statusEl.textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
  startBtn.disabled = false;
});

// ---------- 입력 ----------
const held = new Set<string>();
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
const once = { fire: false, melee: false, jump: false, interact: false, act: null as Action | null };
const KEY_ACT: Record<string, Action> = { r: 'eject', f: 'insert', ' ': 'rack', space: 'rack', g: 'stow', '1': 'grab1', '2': 'grab2', '3': 'grab3', '4': 'grab4' };

function press(k: string) {
  if (k === 'w' || k === 'arrowup' || k === 'up') once.jump = true;
  else if (k === 'e') once.interact = true;
  else if (k === 'v') once.melee = true;
  else if (k === 'fire') once.fire = true;
  else if (KEY_ACT[k]) once.act = KEY_ACT[k];
}
addEventListener('keydown', e => {
  if (!playing) return;
  const k = e.key.toLowerCase();
  if ([' ', 'tab', 'shift', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
  if (!held.has(k) && !e.repeat) press(k);
  held.add(k);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { if (!playing) return; if (e.button === 2) once.melee = true; else once.fire = true; });
cv.addEventListener('contextmenu', e => e.preventDefault());
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#touch button'))) {
  const k = b.dataset.k!;
  b.addEventListener('touchstart', e => { e.preventDefault(); held.add(k); press(k); }, { passive: false });
  b.addEventListener('touchend', e => { e.preventDefault(); held.delete(k); }, { passive: false });
  b.addEventListener('touchcancel', () => held.delete(k));
}
// 칸 이름을 누르면(터치 · 클릭) 그 칸의 탄창을 쥔다. grip 을 누르면 쥔 탄창을 총에 꽂는다
for (const b of slotBtns) {
  const k = b.dataset.slot!;
  const go = (e: Event) => { e.preventDefault(); if (playing) once.act = k === 'grip' ? 'insert' : (`grab${k}` as Action); };
  b.addEventListener('touchstart', go, { passive: false });
  b.addEventListener('mousedown', go);
}

function currentAim(): number {
  if (!snap) return 0;
  const gx = snap.p.x, gy = snap.p.y - (snap.p.crouch ? 18 : 36);
  if (coarse.matches) {
    // 터치: 보이는 적 중 가장 가까운 쪽, 없으면 바라보는 쪽 (서버의 자동 조준이 마무리한다)
    let bd = 1e9, ang = snap.p.face > 0 ? 0 : Math.PI;
    for (const e of snap.enemies) { const d = Math.abs(e.x - gx); if (d < bd) { bd = d; ang = Math.atan2(e.y - 36 - gy, e.x - gx); } }
    if (held.has('left')) ang = Math.PI; if (held.has('right')) ang = 0;
    return ang;
  }
  const w = scene.screenToWorld(mouse.x, mouse.y, innerWidth, innerHeight);
  return Math.atan2(w.y - gy, w.x - gx);
}

// ---------- HUD ----------
const upEl = $('uptime'), focusEl = $('focus'), alarmEl = $('alarm'), roomEl = $('roomname'), statsEl = $('stats'), checkEl = $('check');
const logEl = $('log'), centerEl = $('center'), slowEl = $('slowfx');
const ALARM = { calm: '정상', alert: '경고', alarmed: '장애' } as const;
let lastLog = '';
function hudUpdate(s: SnapMsg) {
  upEl.textContent = `${Math.round(Math.max(0, s.p.hp) / 2 * 100)}%`;
  focusEl.textContent = `${Math.round(s.meter * 100)}%`;
  alarmEl.textContent = ALARM[s.alarm]; alarmEl.className = `alarm ${s.alarm}`;
  roomEl.textContent = room ? `${room.name} (${room.room + 1}/${room.rooms})` : '';
  statsEl.textContent = `처치 ${s.kills} · 재시도 ${s.deaths}`;
  slotBtns.forEach((b, i) => b.classList.toggle('empty', i < 4 ? !s.gun.slots[i] : !s.gun.grip));
  if (s.ammo) {
    const a = s.ammo, f = (v: number | null) => (v === null ? '-' : String(v));
    checkEl.textContent = `$ git status\n약실 ${a.chamber} · 탄창 ${f(a.mag)} · 손 ${f(a.grip)}\n칸 [${a.slots.map(f).join(', ')}]`;
  } else checkEl.textContent = s.checking > 0 ? '$ git status' + '.'.repeat(Math.ceil(s.checking * 4)) : '';
  const lg = s.log.join('\n');
  if (lg !== lastLog) { lastLog = lg; logEl.replaceChildren(...s.log.map(t => { const d = document.createElement('div'); d.textContent = t; return d; })); }
  centerEl.className = s.won ? 'good' : s.dead ? 'bad' : '';
  centerEl.textContent = s.won ? `롤백 완료. 주말을 지켰어요!\n점수 ${s.score}` : s.dead ? 'Segmentation fault (core dumped)' : '';
  slowEl.classList.toggle('on', s.slowmo);
}

// ---------- 루프 ----------
let last = performance.now(), lastSend = 0;
let lastDrawn: SnapMsg | null = null;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing && snap && room) {
    const right = held.has('d') || held.has('arrowright') || held.has('right');
    const left = held.has('a') || held.has('arrowleft') || held.has('left');
    const aim = currentAim();
    if (now - lastSend >= 33 || once.fire || once.act || once.melee || once.jump || once.interact) {
      const msg: ClientMsg = {
        t: 'in', mx: (right ? 1 : 0) - (left ? 1 : 0), aim,
        jump: once.jump, crouch: held.has('s') || held.has('arrowdown') || held.has('down'),
        fire: once.fire, melee: once.melee, act: once.act, interact: once.interact,
        slowmo: held.has('shift'), check: held.has('q'),
      };
      net.send(msg);
      once.fire = once.melee = once.jump = once.interact = false; once.act = null; lastSend = now;
    }
    // 사건(쏘기 · 화염 · 불꽃)은 스냅샷 하나에 한 번만 (화면 주사율과 상관없이)
    const fresh = snap !== lastDrawn; lastDrawn = snap;
    scene.draw(prev, snap, Math.min(1, (now - snapAt) / 33), aim, dt, now, fresh);
    hudUpdate(snap);
    rig.update(snap, aim, dt, now, fresh);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
