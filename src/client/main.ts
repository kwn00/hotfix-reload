// 화면: 게임을 브라우저에서 직접 돌리고(지연 없음) three.js 로 그린다.
// 틱마다의 입력을 기록해 두었다가, 판이 끝나면 서버로 보낸다. 서버는 같은 시드로 처음부터 다시 돌려 점수를 검증한다.
import type { SnapMsg, RoomMsg } from '../shared/protocol.ts';
import { roomMsg, snapshot } from '../shared/protocol.ts';
import { TICK, type Action } from '../shared/game.ts';
import { Runner, type TickInput } from '../shared/runner.ts';
import { Recorder } from '../shared/replay.ts';
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
const letterbox = $('letterbox');
letterbox.style.visibility = 'hidden';
rigCv.style.visibility = 'hidden';

/** 지금 판: 진행기 · 입력 기록 · 서버가 준 판 토큰 (없으면 이번 판은 점수가 기록되지 않는다) */
let runner: Runner | null = null;
let recorder: Recorder | null = null;
let token: string | null = null;
let paused = false;
let room: RoomMsg | null = null;
let snap: SnapMsg | null = null, prev: SnapMsg | null = null;
let playing = false;
const guide = new Guide();

function best(): number { try { return Number(localStorage.getItem('hr-best') || 0); } catch { return 0; } }
function saveBest(v: number) { try { if (v > best()) localStorage.setItem('hr-best', String(v)); } catch { /* 무시 */ } }
function showBest() { const b = best(); bestEl.textContent = b ? `최고 점수 ${b}` : ''; }
showBest();

const slotBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('#slots button'));
function resize() {
  scene.resize(cv.clientWidth, cv.clientHeight);
  rig.resize(rigCv.clientWidth, rigCv.clientHeight, letterbox.clientHeight);
  slotBtns.forEach((b, i) => { const p = i < 4 ? rig.layout.slots[i] : rig.layout.grip; b.style.left = `${p.x}px`; });
}
addEventListener('resize', resize); resize();

function stop() {
  document.body.classList.remove('playing'); playing = false; runner = null; recorder = null; room = snap = prev = null;
  hud.classList.add('hidden'); rigCv.style.visibility = 'hidden'; letterbox.style.visibility = 'hidden'; title.classList.remove('hidden');
}

/** 판이 끝났다: 기록을 서버로 보내 검증받는다 */
let finishing = false;
let resultText = '';
async function finish(s: SnapMsg) {
  if (finishing || !recorder) return;
  finishing = true;
  const log = recorder.log();
  resultText = token ? '점수를 검증하는 중…' : '서버에 연결하지 못해 이번 판은 점수가 기록되지 않아요';
  let verified: number | null = null;
  if (token) {
    try {
      const r = await fetch('/api/run/finish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Run-Token': token }, body: JSON.stringify({ log }) });
      const j = await r.json() as { ok?: boolean; score?: number; error?: string };
      if (r.ok && j.ok && typeof j.score === 'number') { verified = j.score; resultText = `검증된 점수 ${j.score}`; }
      else resultText = `점수를 검증하지 못했어요 (${typeof j.error === 'string' ? j.error.slice(0, 60) : r.status})`;
    } catch { resultText = '서버에 연결하지 못해 점수를 검증하지 못했어요'; }
  }
  if (verified !== null) saveBest(verified);
  showBest();
  statusEl.textContent = `지난 판: ${verified !== null ? `검증된 점수 ${verified}` : `점수 ${s.score} (검증 안 됨)`}`;
  setTimeout(() => { finishing = false; resultText = ''; stop(); }, 5000);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true; statusEl.textContent = '판을 준비하는 중…';
  // 서버가 시드를 정하고 서명한 판 토큰을 준다. 실패해도 플레이는 할 수 있다 (점수만 기록되지 않음)
  let seed = Math.floor(Math.random() * 2 ** 31);
  token = null;
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 70_000);
    const r = await fetch('/api/run/start', { method: 'POST', signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) { const j = await r.json() as { token?: unknown; seed?: unknown }; if (typeof j.token === 'string' && Number.isInteger(j.seed)) { token = j.token; seed = j.seed as number; } }
  } catch { /* 오프라인으로 진행 */ }
  runner = new Runner(seed); recorder = new Recorder();
  room = null; snap = prev = null; acc = 0; paused = false; finishing = false; resultText = '';
  frameEvents = []; frameFlashes = []; frameImpacts = [];
  if (!token) runner.state.log.push({ text: '서버에 연결하지 못해 이번 판은 점수가 기록되지 않아요', t: 5 });
  playing = true; document.body.classList.add('playing'); rig.reset(); guide.reset();
  title.classList.add('hidden'); hud.classList.remove('hidden'); rigCv.style.visibility = 'visible'; letterbox.style.visibility = 'visible'; resize();
  statusEl.textContent = '';
  startBtn.disabled = false;
});

// 탭을 떠나거나 창이 가려지면 멈춘다 (혼자 하는 판이라 멈춰도 된다. 멈춘 시간은 기록에 들어가지 않는다)
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) paused = true; });
addEventListener('blur', () => { if (playing) paused = true; });

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
  if (e.code === 'Escape' || e.code === 'KeyP') { paused = !paused; held.clear(); return; }
  // 멈춤을 푸는 키는 게임 입력으로 쓰지 않는다 (Space 로 풀었는데 슬라이드까지 당겨지지 않게)
  if (paused) { paused = false; held.clear(); return; }
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
cv.addEventListener('mousedown', e => {
  if (!playing) return;
  if (paused) { paused = false; return; }
  if (e.button === 2) { once.melee = true; return; }
  once.fire = true;
  rig.trigger(); sfx('trigger');
  // 누르는 순간 조준점이 반응한다
  crossEl.classList.add('fire'); setTimeout(() => crossEl.classList.remove('fire'), 90);
});
cv.addEventListener('contextmenu', e => e.preventDefault());
// 칸 이름을 누르면 그 칸의 탄창을 쥔다. grip 을 누르면 쥔 탄창을 총에 꽂는다
for (const b of slotBtns) {
  const k = b.dataset.slot!;
  const go = (e: Event) => { e.preventDefault(); if (!playing) return; if (paused) { paused = false; return; } once.act = k === 'grip' ? 'insert' : (`grab${k}` as Action); };
  b.addEventListener('mousedown', go);
}

function currentAim(): number {
  if (!runner) return 0;
  const p = runner.state.p;
  const gx = p.x, gy = p.y - (p.crouch ? 18 : 36);
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
  centerEl.className = s.won ? 'good' : s.dead ? 'bad' : paused ? '' : '';
  centerEl.textContent = s.won ? `롤백 완료. 주말을 지켰어요!\n점수 ${s.score}\n${resultText}`
    : s.dead ? 'Segmentation fault (core dumped)' : paused ? '일시정지\n아무 키나 누르면 이어서 해요' : '';
  slowEl.classList.toggle('on', s.slowmo);
}

// ---------- 루프 ----------
let last = performance.now(), acc = 0;
/** 이번 프레임까지 쌓인 사건 · 화염 · 맞은 자리 (틱 여러 번에 걸친 것) */
let frameEvents: string[] = [], frameFlashes: SnapMsg['flashes'] = [], frameImpacts: SnapMsg['impacts'] = [];

/** 한 틱: 입력을 모아 진행기에 넣고, 같은 입력을 기록한다 */
function tickOnce() {
  const r = runner!, s = r.state;
  const inp: TickInput = {
    mx: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0), aim: currentAim(),
    jump: once.jump, crouch: held.has('crouch'), fire: once.fire, melee: once.melee, act: once.act,
    interact: once.interact, slowmo: held.has('slowmo'), check: held.has('check'),
  };
  once.fire = once.melee = once.jump = once.interact = false; once.act = null;
  r.tick(inp); recorder!.add(inp);
  for (const e of s.events) { frameEvents.push(e); sfx(e); }
  frameFlashes.push(...s.flashes); frameImpacts.push(...s.impacts);
  // 방이 바뀌면 이전 방 위치에서 이어 그리지 않는다
  const newRoom = !room || room.room !== s.room;
  if (newRoom) { room = roomMsg(s); scene.setRoom(room); rig.reset(); }
  prev = newRoom ? null : snap; snap = snapshot(s);
}

function frame(now: number) {
  const raw = (now - last) / 1000; last = now;
  const dt = Math.min(0.05, raw);
  if (playing && runner) {
    // 고정 30틱. 화면이 느려도 실제 흐른 시간만큼 돌린다 (최대 0.25초까지 따라잡음). 멈춤 · 끝난 뒤에는 돌리지 않는다
    if (!paused && !runner.state.won) {
      acc = Math.min(acc + Math.min(raw, 0.25), 0.25);
      while (acc >= TICK) { acc -= TICK; tickOnce(); if (runner.state.won) { void finish(snapshot(runner.state)); break; } }
    }
    if (!snap) tickOnce();
    const aim = currentAim();
    const view: SnapMsg = { ...snap!, events: frameEvents as SnapMsg['events'], flashes: frameFlashes, impacts: frameImpacts };
    if (import.meta.env.DEV) Object.assign(window, { __runner: runner, __recorder: recorder, __token: token, __view: view }); // 개발 모드에서만 (시험용)
    scene.draw(prev, view, paused ? 1 : acc / TICK, aim, dt, now, true);
    hudUpdate(view);
    rig.update(view, aim, dt, now, frameEvents);
    guide.update(view, frameEvents);
    crossEl.classList.toggle('dim', view.gun.busy > 0.15);
    frameEvents = []; frameFlashes = []; frameImpacts = [];
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
