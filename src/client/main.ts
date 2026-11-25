// 화면: 입력을 서버로 보내고, 서버가 보낸 것을 three.js 로 그린다. 판정은 하지 않는다.
import type { SnapMsg, RoomMsg, ServerMsg, ClientMsg } from '../shared/protocol.ts';
import type { Action } from '../shared/game.ts';
import { Net } from './net.ts';
import { sfx } from './sound.ts';
import { initNews } from './news.ts';
import { Scene3D } from './scene.ts';
import { GunRig } from './rig.ts';
import { Guide } from './guide.ts';
import { keyName, PREVENT } from './keys.ts';

const $ = (id: string) => document.getElementById(id)!;
const cv = $('c') as HTMLCanvasElement;
const title = $('title'), hud = $('hud'), statusEl = $('status'), bestEl = $('best');
const startBtn = $('start') as HTMLButtonElement;
initNews();

const scene = new Scene3D(cv);
const rigCv = $('rig') as HTMLCanvasElement;
const rig = new GunRig(rigCv);
rigCv.style.visibility = "hidden";
const net = new Net();
let room: RoomMsg | null = null;
let snap: SnapMsg | null = null, prev: SnapMsg | null = null;
let snapAt = 0, playing = false;
const guide = new Guide();

function best(): number { try { return Number(localStorage.getItem('hr-best') || 0); } catch { return 0; } }
function saveBest(v: number) { try { if (v > best()) localStorage.setItem('hr-best', String(v)); } catch { /* 무시 */ } }
function showBest() { const b = best(); bestEl.textContent = b ? `최고 점수 ${b}` : ''; }
showBest();

const slotBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#slots button'));
function resize() {
  scene.resize(cv.clientWidth, cv.clientHeight);
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

function stop() { document.body.classList.remove('playing'); playing = false; room = snap = prev = null; hud.classList.add('hidden'); rigCv.style.visibility = 'hidden'; title.classList.remove('hidden'); }
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
    net.send({ t: 'start' }); playing = true; document.body.classList.add('playing'); rig.reset(); guide.reset();
    title.classList.add('hidden'); hud.classList.remove('hidden'); rigCv.style.visibility = 'visible'; resize();
    statusEl.textContent = '';
  } catch { statusEl.textContent = '서버에 연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
  startBtn.disabled = false;
});

// ---------- 입력 ----------
const held = new Set<string>();
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
const once = { fire: false, melee: false, jump: false, interact: false, act: null as Action | null };
const KEY_ACT: Record<string, Action> = { eject: 'eject', insert: 'insert', rack: 'rack', stow: 'stow', grab1: 'grab1', grab2: 'grab2', grab3: 'grab3', grab4: 'grab4' };

function press(k: string) {
  if (k === 'jump') once.jump = true;
  else if (k === 'interact') once.interact = true;
  else if (k === 'melee') once.melee = true;
  else if (k === 'guide') guide.toggle();
  else if (KEY_ACT[k]) once.act = KEY_ACT[k];
}
// held 에는 게임의 이름(left · crouch · slowmo …)을 담는다. 키는 눌린 자리(e.code)로 읽는다 (keys.ts)
addEventListener('keydown', e => {
  if (!playing) return;
  const k = keyName(e.code);
  if (PREVENT.has(e.code)) e.preventDefault();
  if (!k) return;
  if (!held.has(k) && !e.repeat) press(k);
  held.add(k);
});
addEventListener('keyup', e => { const k = keyName(e.code); if (k) held.delete(k); });
addEventListener('blur', () => held.clear());
const crossEl = $('crosshair');
addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  crossEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});
cv.addEventListener('mousedown', e => { if (!playing) return; if (e.button === 2) once.melee = true; else once.fire = true; });
cv.addEventListener('contextmenu', e => e.preventDefault());
// 칸 이름을 누르면 그 칸의 탄창을 쥔다. grip 을 누르면 쥔 탄창을 총에 꽂는다
for (const b of slotBtns) {
  const k = b.dataset.slot!;
  const go = (e: Event) => { e.preventDefault(); if (playing) once.act = k === 'grip' ? 'insert' : (`grab${k}` as Action); };
  b.addEventListener('mousedown', go);
}

function currentAim(): number {
  if (!snap) return 0;
  const gx = snap.p.x, gy = snap.p.y - (snap.p.crouch ? 18 : 36);
  const w = scene.screenToWorld(mouse.x, mouse.y, cv.clientWidth, cv.clientHeight);
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
    const right = held.has('right');
    const left = held.has('left');
    const aim = currentAim();
    if (now - lastSend >= 33 || once.fire || once.act || once.melee || once.jump || once.interact) {
      const msg: ClientMsg = {
        t: 'in', mx: (right ? 1 : 0) - (left ? 1 : 0), aim,
        jump: once.jump, crouch: held.has('crouch'),
        fire: once.fire, melee: once.melee, act: once.act, interact: once.interact,
        slowmo: held.has('slowmo'), check: held.has('check'),
      };
      net.send(msg);
      once.fire = once.melee = once.jump = once.interact = false; once.act = null; lastSend = now;
    }
    // 사건(쏘기 · 화염 · 불꽃)은 스냅샷 하나에 한 번만 (화면 주사율과 상관없이)
    const fresh = snap !== lastDrawn; lastDrawn = snap;
    scene.draw(prev, snap, Math.min(1, (now - snapAt) / 33), aim, dt, now, fresh);
    hudUpdate(snap);
    rig.update(snap, aim, dt, now, fresh);
    guide.update(snap, fresh);
    // 조준점: 쏘면 잠깐 벌어지고, 총이 바쁘면(장전 · 반동) 흐려진다
    if (fresh && snap.events.some(e => e === 'fire' || e === 'jam')) { crossEl.classList.add('fire'); setTimeout(() => crossEl.classList.remove('fire'), 90); }
    crossEl.classList.toggle('dim', snap.gun.busy > 0.15);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
