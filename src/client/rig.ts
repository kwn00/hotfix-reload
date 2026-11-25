// 화면 아래의 총 리그: 복셀(픽셀을 입체로 쌓은) 권총 + 탄창 칸 1~4 + 손에 쥔 탄창.
// 서버가 보낸 "보이는 상태"(꽂힘 · 칸 · 손)와 사건(쏘기 · 빼기 · 꽂기 · 당기기 · 걸림)만으로 움직인다.
// 탄 수는 점검(git status) 중일 때만 탄창 옆에 탄으로 쌓아 보여 준다.
import * as THREE from 'three';
import type { SnapMsg } from '../shared/protocol.ts';
import { PAL } from './art.ts';

const V = 1; // 복셀 하나 = 1 단위 (그룹 크기로 화면에 맞춘다)

type Grid = { x: number; y: number; c: string }[];

/** 픽셀 목록을 깊이 d 칸 복셀로 쌓는다 (색마다 InstancedMesh 하나) */
function voxels(cells: Grid, depth: number, opts: { roughness?: number; metalness?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const byColor = new Map<string, { x: number; y: number }[]>();
  for (const c of cells) { if (!byColor.has(c.c)) byColor.set(c.c, []); byColor.get(c.c)!.push(c); }
  const box = new THREE.BoxGeometry(V, V, V);
  const m = new THREE.Matrix4();
  for (const [col, list] of byColor) {
    const mat = new THREE.MeshStandardMaterial({ color: PAL[col] ?? col, roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0.35 });
    const inst = new THREE.InstancedMesh(box, mat, list.length * depth);
    let i = 0;
    for (const p of list) for (let z = 0; z < depth; z++) { m.makeTranslation(p.x, -p.y, z - (depth - 1) / 2); inst.setMatrixAt(i++, m); }
    g.add(inst);
  }
  return g;
}

/** 글자 격자 → 픽셀 목록 ('.' 은 빈칸) */
function cellsOf(rows: string[], ox = 0, oy = 0): Grid {
  const out: Grid = [];
  rows.forEach((r, y) => Array.from(r).forEach((c, x) => { if (c !== '.' && c !== ' ') out.push({ x: x + ox, y: y + oy, c }); }));
  return out;
}

// ---- 권총 그림 (오른쪽을 본다). 슬라이드 · 몸통 · 탄창을 따로 움직인다 ----
const SLIDE = [
  '.....m...............................m..',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'kmdmdmdmmmmmmmmmmmnnnnnnnmmmmmmmmmmmmmmk',
  'kmdmdmdmmmmmmmmmmmnkkkkknmmmmmmmmmmmmmmk',
  'kmdmdmdmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk',
  'kmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
];
const FRAME = [
  '....kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.',
  '...kddddddddddddddddddddddddddddddddddk.',
  '..kdddddddddddddkkkkkkkkkkkkkdddddddddk.',
  '..kddddddddddddk............kkkkkkkkk..',
  '..kdddddddddddk............k...........',
  '..kddmdmdmddddk...........k............',
  '..kdmdmdmdmdddk..........k.............',
  '...kddmdmdmddddkkkkkkkkkk..............',
  '...kdmdmdmdmddk........................',
  '...kddmdmdmdddk........................',
  '....kdmdmdmdmdk........................',
  '....kddmdmdmddk........................',
  '....kdmdmdmdmddk.......................',
  '.....kddmdmdmddk.......................',
  '.....kdmdmdmdmdk.......................',
  '.....kddmdmdmddk.......................',
  '......kkkkkkkkk........................',
];
/** 탄창 (손잡이 기울기와 같게 비스듬하다) */
const MAG = [
  '.kkkkkk..',
  '.kYYYYk..',
  '.kmmmmk..',
  '.kmmmmmk.',
  '..kmmmmk.',
  '..kmmmmk.',
  '..kmmmmmk',
  '...kmmmmk',
  '...kmmmmk',
  '...kmmmmk',
  '..kkkkkkk',
];
const MAG_OFFSET = { x: 5, y: 9 }; // 몸통 격자에서 탄창이 들어가는 자리
const GUN_C = { x: 22, y: -12 };    // 총 그림의 가운데 (돌리고 뒤집는 축)

function bulletCells(): Grid { return [{ x: 0, y: 0, c: 'O' }, { x: 1, y: 0, c: 'Y' }, { x: 2, y: 0, c: 'Y' }, { x: 3, y: 0, c: 'Y' }]; }

interface Fly { o: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; life: number }

export class GunRig {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -500, 500);
  private gun = new THREE.Group();
  /** 총의 가운데를 축으로 돌리고 뒤집는 바깥 그룹 (왼쪽을 겨누면 좌우로 뒤집는다) */
  private pivot = new THREE.Group();
  private face = 1;
  private slide: THREE.Group;
  private mag: THREE.Group;
  private handMag: THREE.Group;
  private stovepipe: THREE.Group;
  private slotMags: THREE.Group[] = [];
  private slotRounds: THREE.Group[] = [];
  private muzzle: THREE.PointLight;

  private flies: Fly[] = [];
  private gunY = 0;
  private trig: THREE.Group;
  private trigPull = 0;
  private gunX = 0;
  // 애니메이션 상태
  private slideX = 0; private slideTarget = 0; private slideHold = 0;
  private magY = 0; private magGone = false;
  private handT = 0;      // 손 탄창이 총으로 들어가는 진행도
  private recoil = 0;
  private lastGrip = false;
  layout = { slots: [] as { x: number; y: number }[], grip: { x: 0, y: 0 } };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.AmbientLight(0x9aa3c7, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-30, 60, 80); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x89b4fa, 1.6); rim.position.set(60, -10, -60); this.scene.add(rim);

    const frame = voxels(cellsOf(FRAME), 5, { roughness: 0.8, metalness: 0.1 });
    // 방아쇠는 따로 (누르는 순간 화면에서 바로 당긴다)
    this.trig = voxels([{ x: 21, y: 3, c: 'n' }, { x: 20, y: 4, c: 'n' }, { x: 21, y: 4, c: 'n' }, { x: 20, y: 5, c: 'n' }], 2, { roughness: 0.5, metalness: 0.5 });
    frame.add(this.trig); this.trig.position.y = 0;
    frame.position.y = -7;
    this.slide = voxels(cellsOf(SLIDE), 6, { roughness: 0.4, metalness: 0.6 });
    this.mag = voxels(cellsOf(MAG), 3);
    this.mag.position.set(MAG_OFFSET.x, -7 - MAG_OFFSET.y, 0);
    this.handMag = voxels(cellsOf(MAG), 3);
    this.stovepipe = voxels(cellsOf(['YYY', 'YYY', 'YYY', 'OOO']), 2, { metalness: 0.8, roughness: 0.3 });
    this.stovepipe.position.set(21, 4, 2); this.stovepipe.rotation.z = 0.3; this.stovepipe.visible = false;
    this.slide.add(this.stovepipe);
    this.muzzle = new THREE.PointLight(0xffc56b, 0, 80, 1);
    this.muzzle.position.set(44, -3, 6);
    // 총구 화염은 모양 없이 빛만: 쏘는 순간 총을 따뜻하게 비춘다
    this.gun.add(frame, this.mag, this.slide, this.muzzle);
    this.gun.position.set(-GUN_C.x, -GUN_C.y, 0);
    this.pivot.rotation.set(0.12, -0.42, 0); // 살짝 돌려 입체감 (가운데를 축으로)
    this.pivot.add(this.gun);
    this.scene.add(this.pivot, this.handMag);

    for (let i = 0; i < 4; i++) {
      const m = voxels(cellsOf(MAG), 3); m.rotation.set(0.1, -0.3, 0); this.scene.add(m); this.slotMags.push(m);
      const r = new THREE.Group(); this.scene.add(r); this.slotRounds.push(r);
    }
  }

  /** w · h: 그리는 영역 (띠보다 위로 넉넉하고 투명하다). band: 아래 레터박스 높이 (총 · 칸의 크기와 자리를 정한다) */
  resize(w: number, h: number, band = h) {
    this.renderer.setSize(w, h, false);
    this.camera.left = 0; this.camera.right = w; this.camera.top = h; this.camera.bottom = 0; this.camera.updateProjectionMatrix();
    // 총: 오른쪽 아래에 크게. 칸: 왼쪽 아래에 나란히
    const narrow = w < 700;
    const scale = Math.min(w * (narrow ? 0.5 : 0.38) / 44, (band - 6) / 31);
    this.pivot.scale.set(scale * this.face, scale, scale);
    // 총 그림의 세로 가운데(슬라이드 위 0 ~ 탄창 아래 -27)를 띠 가운데에
    this.gunY = band / 2 + (13.5 + GUN_C.y) * scale;
    // 총구 앞에 화염이 들어갈 자리를 남긴다 (오른쪽 끝에 붙이면 화염이 화면 밖으로 잘린다)
    this.gunX = w - scale * (narrow ? 52 : 58) + GUN_C.x * scale;
    this.pivot.position.set(this.gunX, this.gunY, 0);
    const slotScale = Math.max(3, Math.min(scale * 0.7, (band - 30) / 12));
    const gap = narrow ? w * 0.11 : Math.min(110, w * 0.08);
    this.layout.slots = [];
    for (let i = 0; i < 4; i++) {
      const x = (narrow ? 16 : 36) + i * gap, y = slotScale * 11 + 24;
      this.slotMags[i].scale.setScalar(slotScale); this.slotMags[i].position.set(x, y, 0);
      this.slotRounds[i].scale.setScalar(slotScale * 0.8); this.slotRounds[i].position.set(x + slotScale * 9, y - slotScale * 2, 0);
      this.layout.slots.push({ x: x + slotScale * 4, y: 10 });
    }
    this.handMag.scale.setScalar(scale * 0.95);
    // grip 글자는 칸 이름과 겹치지 않게 (좁은 화면)
    const lastSlot = this.layout.slots[3].x;
    this.layout.grip = { x: Math.max(this.gunX - scale * 36, lastSlot + 52), y: 10 };
  }

  /** 날아가는 것들의 원본 (복제는 도형 · 재질을 함께 쓰므로 새로 만들지 않는다) */
  private tpl = {
    casing: voxels([{ x: 0, y: 0, c: 'Y' }, { x: 1, y: 0, c: 'Y' }, { x: 2, y: 0, c: 'Y' }], 2, { metalness: 0.8, roughness: 0.3 }),
    round: voxels(bulletCells(), 2, { metalness: 0.8, roughness: 0.3 }),
    stove: voxels(cellsOf(['YYY', 'YYY', 'YYY', 'OOO']), 2, { metalness: 0.8, roughness: 0.3 }),
    mag: voxels(cellsOf(MAG), 3),
    bullet: voxels(bulletCells(), 1),
  };

  private fly(tpl: THREE.Group, at: THREE.Vector3, v: THREE.Vector3, scale: number) {
    if (this.flies.length > 40) return;
    const o = tpl.clone();
    o.scale.setScalar(scale); o.position.copy(at); this.scene.add(o);
    this.flies.push({ o, v, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 8 + Math.random() * 10), life: 1.2 });
  }

  /** 슬라이드 근처의 화면 좌표 (탄피가 튀어나오는 자리) */
  private portPos() { return new THREE.Vector3(22, 3, 0).applyMatrix4(this.gun.matrixWorld); }

  /** 새 판 · 새 방: 애니메이션 상태를 처음으로 */
  reset() {
    this.stovepipe.visible = false; this.slideX = 0; this.slideTarget = 0; this.slideHold = 0;
    this.magY = 0; this.magGone = false; this.handT = 0; this.recoil = 0; this.lastGrip = false;
    for (const f of this.flies) this.scene.remove(f.o);
    this.flies = [];
  }

  /** 방아쇠: 클릭하는 순간 (탄이 나갔는지는 서버 답을 기다린다) */
  trigger() { this.trigPull = 1; }

  /** events: 이번 프레임에 보여 줄 사건 (서버 사건 + 화면에서 미리 보여 주는 장전) */
  update(s: SnapMsg, aim: number, dt: number, now: number, events: readonly string[]) {
    const sc = this.pivot.scale.y;
    const fx = this.face; // 날아가는 방향도 총을 따라 뒤집는다
    for (const e of events) {
      if (e === 'fire' || e === 'jam') {
        this.slideX = -9; this.slideTarget = 0; this.recoil = 1;
        this.muzzle.intensity = 400;
        if (e === 'fire') this.fly(this.tpl.casing, this.portPos(), new THREE.Vector3(fx * (120 + Math.random() * 80), 260 + Math.random() * 80, 0), sc * 0.9);
        if (e === 'jam') this.stovepipe.visible = true;
      } else if (e === 'rack' || e === 'rack-waste' || e === 'unjam') {
        this.slideTarget = -11; this.slideHold = 0.14;
        if (e === 'rack-waste') this.fly(this.tpl.round, this.portPos(), new THREE.Vector3(fx * 140, 300, 0), sc * 0.9);
        if (e === 'unjam') { this.stovepipe.visible = false; this.fly(this.tpl.stove, this.portPos(), new THREE.Vector3(fx * 160, 280, 0), sc * 0.9); }
      } else if (e === 'rack-waste-fx') {
        // 슬라이드는 화면에서 이미 당겼다: 서버가 알려 준, 튀어나온 탄만
        this.fly(this.tpl.round, this.portPos(), new THREE.Vector3(fx * 140, 300, 0), sc * 0.9);
      } else if (e === 'unjam-fx') {
        this.stovepipe.visible = false; this.fly(this.tpl.stove, this.portPos(), new THREE.Vector3(fx * 160, 280, 0), sc * 0.9);
      } else if (e === 'eject') {
        this.magGone = true;
        const at = new THREE.Vector3(MAG_OFFSET.x + 3, -7 - MAG_OFFSET.y - 5, 0).applyMatrix4(this.gun.matrixWorld);
        this.fly(this.tpl.mag, at, new THREE.Vector3(-30 * fx, -60, 0), sc);
      } else if (e === 'insert') {
        this.magGone = false; this.magY = -14; this.handT = 0;
      } else if (e === 'dry' || e === 'jammed') {
        this.recoil = 0.15;
      }
    }
    if (!s.gun.magIn && !this.magGone) this.magGone = true;
    if (s.gun.magIn && this.magGone) { this.magGone = false; this.magY = 0; }

    // 슬라이드: 당긴 채 잠깐 멈췄다가 앞으로
    if (this.slideHold > 0) { this.slideHold -= dt; if (this.slideHold <= 0) this.slideTarget = 0; }
    this.slideX += (this.slideTarget - this.slideX) * Math.min(1, dt * (this.slideTarget < this.slideX ? 30 : 22));
    this.slide.position.x = this.slideX;
    // 탄창: 꽂히면 아래에서 밀려 올라온다
    this.mag.visible = !this.magGone;
    this.magY += (0 - this.magY) * Math.min(1, dt * 14);
    this.mag.position.y = -7 - MAG_OFFSET.y + this.magY;
    // 걸림 표시는 서버가 알려 준 사건으로만 켠다 (판 다시 시작 등으로 탄창이 바뀌면 끈다)
    if (s.dead) this.stovepipe.visible = false;

    // 총구 화염
    this.muzzle.intensity *= Math.pow(0.0005, dt);

    this.trigPull *= Math.pow(0.0005, dt);
    this.trig.position.x = -1.2 * Math.min(1, this.trigPull * 1.5);
    // 반동 · 숨쉬기 · 조준 방향에 따라 살짝 기울기
    this.recoil *= Math.pow(0.002, dt);
    // 왼쪽을 겨누면 좌우로 뒤집고, 위를 겨누면 어느 쪽이든 총구가 올라간다 (반동도 총구 쪽으로 튄다)
    const face = Math.cos(aim) >= 0 ? 1 : -1;
    if (face !== this.face) { this.face = face; this.pivot.scale.x = Math.abs(this.pivot.scale.x) * face; }
    const up = Math.max(-0.3, Math.min(0.3, -Math.sin(aim) * 0.3));
    this.pivot.rotation.z = face * (up * 0.5 + this.recoil * 0.25) + Math.sin(now / 900) * 0.015;
    this.pivot.position.y += (this.gunY + Math.sin(now / 700) * 2 - this.pivot.position.y) * 0.2;

    // 손에 쥔 탄창: 총 아래 왼쪽에 떠 있다. 꽂으면 총 쪽으로 올라간다
    if (s.gun.grip && !this.lastGrip) this.handT = 0;
    this.lastGrip = s.gun.grip;
    this.handMag.visible = s.gun.grip;
    if (s.gun.grip) {
      this.handT = Math.min(1, this.handT + dt * 5);
      const base = new THREE.Vector3(MAG_OFFSET.x - 14, -7 - MAG_OFFSET.y + 2, 0).applyMatrix4(this.gun.matrixWorld);
      this.handMag.position.set(base.x - fx * sc * 6 * (1 - this.handT), base.y - sc * 4 * (1 - this.handT) + Math.sin(now / 300) * 2, 20);
      this.handMag.rotation.set(0.1, -0.5 * fx, fx * (-0.25 + Math.sin(now / 500) * 0.05));
      this.handMag.scale.x = Math.abs(this.handMag.scale.x) * fx;
    }

    // 칸의 탄창. 점검 중이면 탄 수만큼 탄을 쌓아 보여 준다
    for (let i = 0; i < 4; i++) {
      this.slotMags[i].visible = s.gun.slots[i];
      const r = this.slotRounds[i];
      const n = s.ammo?.slots[i] ?? null;
      if (r.userData.n !== n) {
        r.clear(); r.userData.n = n;
        if (n !== null) for (let k = 0; k < n; k++) { const b = this.tpl.bullet.clone(); b.position.set(0, k * 1.3, 0); r.add(b); }
      }
    }

    for (const f of this.flies) {
      f.life -= dt; f.v.y -= 900 * dt;
      f.o.position.addScaledVector(f.v, dt);
      f.o.rotation.x += f.spin.x * dt; f.o.rotation.y += f.spin.y * dt; f.o.rotation.z += f.spin.z * dt;
    }
    for (const f of this.flies.filter(x => x.life <= 0 || x.o.position.y < -100)) this.scene.remove(f.o);
    this.flies = this.flies.filter(x => x.life > 0 && x.o.position.y >= -100);

    this.renderer.render(this.scene, this.camera);
  }
}
