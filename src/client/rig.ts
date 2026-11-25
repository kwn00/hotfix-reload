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
  '..kddddddddddddk.....k......kkkkkkkkk..',
  '..kdddddddddddk.....kk.....k...........',
  '..kddmdmdmddddk.....k.....k............',
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

function bulletCells(): Grid { return [{ x: 0, y: 0, c: 'O' }, { x: 1, y: 0, c: 'Y' }, { x: 2, y: 0, c: 'Y' }, { x: 3, y: 0, c: 'Y' }]; }

interface Fly { o: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; life: number }

export class GunRig {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -500, 500);
  private gun = new THREE.Group();
  private slide: THREE.Group;
  private mag: THREE.Group;
  private handMag: THREE.Group;
  private stovepipe: THREE.Group;
  private slotMags: THREE.Group[] = [];
  private slotRounds: THREE.Group[] = [];
  private muzzle: THREE.PointLight;
  private flashVox: THREE.Mesh;
  private flies: Fly[] = [];
  private gunY = 0;
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
    this.flashVox = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    this.flashVox.position.set(43, -3, 0); this.flashVox.visible = false;
    this.gun.add(frame, this.mag, this.slide, this.muzzle, this.flashVox);
    // 살짝 돌려서 입체감이 보이게
    this.gun.rotation.set(0.12, -0.42, 0);
    this.scene.add(this.gun, this.handMag);

    for (let i = 0; i < 4; i++) {
      const m = voxels(cellsOf(MAG), 3); m.rotation.set(0.1, -0.3, 0); this.scene.add(m); this.slotMags.push(m);
      const r = new THREE.Group(); this.scene.add(r); this.slotRounds.push(r);
    }
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.left = 0; this.camera.right = w; this.camera.top = h; this.camera.bottom = 0; this.camera.updateProjectionMatrix();
    // 총: 오른쪽 아래에 크게. 칸: 왼쪽 아래에 나란히
    const narrow = w < 700;
    const scale = Math.min(w * (narrow ? 0.5 : 0.38) / 44, (h - 8) / 29);
    this.gun.scale.setScalar(scale);
    this.gunY = 27 * scale + 4;
    this.gun.position.set(w - scale * (narrow ? 42 : 47), this.gunY, 0);
    const slotScale = Math.max(3, Math.min(scale * 0.7, (h - 30) / 12));
    const gap = narrow ? w * 0.11 : Math.min(110, w * 0.08);
    this.layout.slots = [];
    for (let i = 0; i < 4; i++) {
      const x = (narrow ? 16 : 36) + i * gap, y = slotScale * 11 + 24;
      this.slotMags[i].scale.setScalar(slotScale); this.slotMags[i].position.set(x, y, 0);
      this.slotRounds[i].scale.setScalar(slotScale * 0.8); this.slotRounds[i].position.set(x + slotScale * 9, y - slotScale * 2, 0);
      this.layout.slots.push({ x: x + slotScale * 4, y: 10 });
    }
    this.handMag.scale.setScalar(scale * 0.95);
    this.layout.grip = { x: this.gun.position.x - scale * 14, y: 10 };
  }

  private fly(cells: Grid, at: THREE.Vector3, v: THREE.Vector3, scale: number) {
    const o = voxels(cells, 2, { metalness: 0.8, roughness: 0.3 });
    o.scale.setScalar(scale); o.position.copy(at); this.scene.add(o);
    this.flies.push({ o, v, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 8 + Math.random() * 10), life: 1.2 });
  }

  /** 슬라이드 근처의 화면 좌표 (탄피가 튀어나오는 자리) */
  private portPos() { return new THREE.Vector3(22, 3, 0).applyMatrix4(this.gun.matrixWorld); }

  update(s: SnapMsg, aim: number, dt: number, now: number) {
    const sc = this.gun.scale.x;
    for (const e of s.events) {
      if (e === 'fire' || e === 'jam') {
        this.slideX = -9; this.slideTarget = 0; this.recoil = 1;
        this.muzzle.intensity = 400; this.flashVox.visible = true;
        if (e === 'fire') this.fly([{ x: 0, y: 0, c: 'Y' }, { x: 1, y: 0, c: 'Y' }, { x: 2, y: 0, c: 'Y' }], this.portPos(), new THREE.Vector3(120 + Math.random() * 80, 260 + Math.random() * 80, 0), sc * 0.9);
        if (e === 'jam') this.stovepipe.visible = true;
      } else if (e === 'rack' || e === 'rack-waste' || e === 'unjam') {
        this.slideTarget = -11; this.slideHold = 0.14;
        if (e === 'rack-waste') this.fly(bulletCells(), this.portPos(), new THREE.Vector3(140, 300, 0), sc * 0.9);
        if (e === 'unjam') { this.stovepipe.visible = false; this.fly(cellsOf(['YYY', 'YYY', 'YYY', 'OOO']), this.portPos(), new THREE.Vector3(160, 280, 0), sc * 0.9); }
      } else if (e === 'eject') {
        this.magGone = true;
        const at = new THREE.Vector3(MAG_OFFSET.x + 3, -7 - MAG_OFFSET.y - 5, 0).applyMatrix4(this.gun.matrixWorld);
        this.fly(cellsOf(MAG), at, new THREE.Vector3(-30, -60, 0), sc);
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
    if (this.muzzle.intensity < 40) this.flashVox.visible = false;

    // 반동 · 숨쉬기 · 조준 방향에 따라 살짝 기울기
    this.recoil *= Math.pow(0.002, dt);
    const tilt = Math.max(-0.35, Math.min(0.35, -Math.sin(aim) * 0.35)) * (Math.cos(aim) >= 0 ? 1 : -1);
    this.gun.rotation.z = tilt * 0.5 + this.recoil * 0.25 + Math.sin(now / 900) * 0.015;
    this.gun.position.y += (this.gunY + Math.sin(now / 700) * 2 - this.gun.position.y) * 0.2;

    // 손에 쥔 탄창: 총 아래 왼쪽에 떠 있다. 꽂으면 총 쪽으로 올라간다
    if (s.gun.grip && !this.lastGrip) this.handT = 0;
    this.lastGrip = s.gun.grip;
    this.handMag.visible = s.gun.grip;
    if (s.gun.grip) {
      this.handT = Math.min(1, this.handT + dt * 5);
      const base = new THREE.Vector3(MAG_OFFSET.x - 14, -7 - MAG_OFFSET.y + 2, 0).applyMatrix4(this.gun.matrixWorld);
      this.handMag.position.set(base.x - sc * 6 * (1 - this.handT), base.y - sc * 4 * (1 - this.handT) + Math.sin(now / 300) * 2, 20);
      this.handMag.rotation.set(0.1, -0.5, -0.25 + Math.sin(now / 500) * 0.05);
    }

    // 칸의 탄창. 점검 중이면 탄 수만큼 탄을 쌓아 보여 준다
    for (let i = 0; i < 4; i++) {
      this.slotMags[i].visible = s.gun.slots[i];
      const r = this.slotRounds[i];
      const n = s.ammo?.slots[i] ?? null;
      if (r.userData.n !== n) {
        r.clear(); r.userData.n = n;
        if (n !== null) for (let k = 0; k < n; k++) { const b = voxels(bulletCells(), 1); b.position.set(0, k * 1.3, 0); r.add(b); }
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
