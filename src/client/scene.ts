// three.js 2.5D 화면. 판정은 하지 않고 서버가 보낸 것만 그린다.
// 시뮬레이션 좌표(px, y 아래) → 3D 좌표 (x 그대로, y 위로, z 는 깊이).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { RoomMsg, SnapMsg, EnemyView } from '../shared/protocol.ts';
import { ENEMY, TILE, TICK, SLOWMO } from '../shared/game.ts';
import { SPRITES, bake } from './art.ts';

const DEPTH = 150;            // 방의 깊이 (벽 블록의 z 길이)
const PX = 4;                 // 스프라이트 픽셀 하나 = 4px

function tex(rows: readonly string[]) {
  const t = new THREE.CanvasTexture(bake(rows, 1));
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function spriteMesh(rows: readonly string[], anchor: 'foot' | 'left' = 'foot') {
  const w = Math.max(...rows.map(r => r.length)) * PX, h = rows.length * PX;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(anchor === 'left' ? w / 2 : 0, anchor === 'foot' ? h / 2 : 0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex(rows), transparent: true, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

/** 벽 무늬: 사무실 벽지 + 걸레받이 (캔버스로 굽는다) */
function wallTexture(kind: 'office' | 'server' | 'roof') {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d')!;
  const base = kind === 'server' ? '#1e2030' : kind === 'roof' ? '#181825' : '#2a2b3d';
  c.fillStyle = base; c.fillRect(0, 0, 64, 64);
  c.fillStyle = 'rgba(255,255,255,0.03)';
  for (let x = 0; x < 64; x += 8) c.fillRect(x, 0, 1, 64);
  if (kind === 'server') { c.fillStyle = 'rgba(148,226,213,0.06)'; for (let y = 0; y < 64; y += 16) c.fillRect(0, y, 64, 1); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** fade: 보이는 정도 (0~1). 시야선 안이면 1, 밖이면 DIM 쪽으로 서서히 바뀐다. 사라지면(쓰러짐 · 주움) 0 까지 흐려진 뒤 지운다 */
interface Actor { group: THREE.Group; body: THREE.Mesh; gun: THREE.Mesh; laser: THREE.Line; shadow: THREE.Mesh; kind: string; lastX: number; fade: number }
/** 시야선 밖일 때 보이는 정도 (가려져 있어도 보이되 살짝 흐리게) */
const DIM = 0.35;
const FADE_TIME = 0.25;
/** 지금 값을 목표 쪽으로 FADE_TIME 동안 옮긴다 */
const toward = (v: number, target: number, dt: number) => (v < target ? Math.min(target, v + dt / FADE_TIME) : Math.max(target, v - dt / FADE_TIME));

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 10, 5000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private roomGroup = new THREE.Group();
  private dyn = new THREE.Group();
  private player: { group: THREE.Group; stand: THREE.Mesh; walk: THREE.Mesh; crouch: THREE.Mesh; arm: THREE.Mesh; shadow: THREE.Mesh };
  private actors = new Map<number, Actor>();
  private bullets = new Map<number, THREE.Mesh>();
  private mags = new Map<number, { m: THREE.Mesh; fade: number }>();
  private flashLights: THREE.PointLight[] = [];
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private room: RoomMsg | null = null;
  private tiles: Uint8Array | null = null;
  private camPos = new THREE.Vector3();
  private lastPx = 0;
  private camLook = new THREE.Vector3();
  private slow = 0;
  private shake = 0;
  private ambient = new THREE.AmbientLight(0x8890c0, 1.1);
  private blinkers: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene.background = new THREE.Color(0x0b0b12);
    this.scene.fog = new THREE.Fog(0x0b0b12, 700, 1800);
    this.scene.add(this.ambient, new THREE.HemisphereLight(0xb4befe, 0x313244, 0.9), this.roomGroup, this.dyn);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.75);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // 플레이어
    const stand = spriteMesh(SPRITES.DEV_STAND), walk = spriteMesh(SPRITES.DEV_WALK), crouch = spriteMesh(SPRITES.DEV_CROUCH);
    const arm = spriteMesh(SPRITES.ARM, 'left'); arm.scale.setScalar(0.75);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(16, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.5;
    const pg = new THREE.Group(); pg.add(stand, walk, crouch, arm, shadow);
    this.player = { group: pg, stand, walk, crouch, arm, shadow };
    this.dyn.add(pg);

    // 총구 화염용 조명 (돌려 쓴다)
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffd27a, 0, 320, 1); this.flashLights.push(l); this.dyn.add(l); }
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.fov = 38;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 방 ----------
  setRoom(r: RoomMsg) {
    this.room = r;
    this.tiles = Uint8Array.from(r.tiles, c => Number(c));
    for (const a of this.actors.values()) this.removeActor(a);
    this.actors.clear();
    for (const m of this.bullets.values()) this.dyn.remove(m); this.bullets.clear();
    for (const it of this.mags.values()) { this.dyn.remove(it.m); (it.m.material as THREE.Material).dispose(); } this.mags.clear();
    this.roomGroup.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const mm = o.material as THREE.Material | THREE.Material[]; (Array.isArray(mm) ? mm : [mm]).forEach(x => { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); }); } });
    this.roomGroup.clear(); this.blinkers = [];
    const kind = r.name.includes('서버') ? 'server' : r.name.includes('옥상') ? 'roof' : 'office';
    const W = r.w * TILE, H = r.h * TILE;

    // 뒷벽
    const wt = wallTexture(kind); wt.repeat.set(W / 64, H / 64);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: wt, roughness: 1 }));
    back.position.set(W / 2, -H / 2, -DEPTH / 2);
    this.roomGroup.add(back);
    if (kind === 'roof') {
      // 밤하늘과 도시 불빛
      back.visible = false;
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, H * 3), new THREE.MeshBasicMaterial({ color: 0x11111b }));
      sky.position.set(W / 2, -H / 2, -900); this.roomGroup.add(sky);
      const cityMat = new THREE.MeshBasicMaterial({ color: 0x1e1e2e });
      for (let i = 0; i < 40; i++) {
        const bw = 60 + ((i * 37) % 90), bh = 120 + ((i * 53) % 380);
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 60), cityMat);
        b.position.set(-W + i * (W * 3 / 40), -H + bh / 2 - 60, -600 - (i % 3) * 80); this.roomGroup.add(b);
        for (let k = 0; k < 4; k++) {
          const win = new THREE.Mesh(new THREE.PlaneGeometry(6, 8), new THREE.MeshBasicMaterial({ color: (i + k) % 3 ? 0xf9e2af : 0x89b4fa }));
          win.position.set(b.position.x - bw / 3 + (k % 2) * bw / 2, b.position.y + bh / 2 - 20 - Math.floor(k / 2) * 30, b.position.z + 31);
          this.roomGroup.add(win);
        }
      }
      const moon = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: 0xf5e0dc }));
      moon.position.set(W * 0.7, 150, -880); this.roomGroup.add(moon);
      const ml = new THREE.DirectionalLight(0xb4befe, 1.6); ml.position.set(W * 0.7, 400, 300); this.roomGroup.add(ml);
    }

    // 벽 · 바닥 블록 (InstancedMesh 한 번에)
    const solids: [number, number][] = [], desks: [number, number][] = [];
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const t = this.tiles[y * r.w + x];
      if (t === 1) {
        // 안쪽에서 보이지 않는 블록은 건너뛴다
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < r.w && yy < r.h && this.tiles![yy * r.w + xx] !== 1; });
        if (open) solids.push([x, y]);
      } else if (t === 2) desks.push([x, y]);
    }
    const blockMat = new THREE.MeshStandardMaterial({ color: kind === 'roof' ? 0x313244 : 0x45475a, roughness: 0.85, metalness: 0.05 });
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, TILE, DEPTH), blockMat, solids.length);
    const mtx = new THREE.Matrix4();
    solids.forEach(([x, y], i) => { mtx.makeTranslation(x * TILE + TILE / 2, -(y * TILE + TILE / 2), 0); blocks.setMatrixAt(i, mtx); });
    blocks.receiveShadow = true;
    this.roomGroup.add(blocks);
    // 바닥 윗면 줄 (밝은 테두리)
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x6c7086, roughness: 0.6 });
    for (const [x, y] of solids) if (y > 0 && this.tiles[(y - 1) * r.w + x] !== 1) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(TILE, 1.5, DEPTH), edgeMat);
      e.position.set(x * TILE + TILE / 2, -(y * TILE) + 0.75, 0); this.roomGroup.add(e);
    }

    // 책상 + 모니터 (모니터는 빛난다)
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x9a6a43, roughness: 0.7 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x313244 });
    const screenColors = [0x89b4fa, 0xa6e3a1, 0x94e2d5, 0xcba6f7];
    desks.forEach(([x, y], i) => {
      const cx = x * TILE + TILE / 2, top = -(y * TILE);
      const g = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(TILE + 2, 6, 70), deskMat); slab.position.set(0, -3, 0);
      const front = new THREE.Mesh(new THREE.BoxGeometry(TILE, TILE - 6, 4), legMat); front.position.set(0, -TILE / 2 - 3, 33);
      const mon = new THREE.Mesh(new THREE.BoxGeometry(22, 16, 2), new THREE.MeshStandardMaterial({ color: 0x11111b, emissive: screenColors[i % 4], emissiveIntensity: 1.4 }));
      mon.position.set(0, 12, -18);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 3), legMat); stand.position.set(0, 2, -18);
      g.add(slab, front, mon, stand); g.position.set(cx, top, -38); // 사람보다 뒤에 둔다 (가리지 않게)
      this.roomGroup.add(g);
      if (i % 2 === 0) { const l = new THREE.PointLight(screenColors[i % 4], 18, 140, 1); l.position.set(cx, top + 14, -6); this.roomGroup.add(l); }
    });

    // 장식: 형광등, 서버랙, 창문
    let lamps = 0;
    for (const d of r.decor) {
      if (d.kind === 'lamp') {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(48, 3, 20), new THREE.MeshBasicMaterial({ color: 0xf5f5ff }));
        bar.position.set(d.x, -d.y + 2, 10); this.roomGroup.add(bar);
        if (lamps++ < 6) { const l = new THREE.PointLight(0xdfe6ff, 90, 520, 1); l.position.set(d.x, -d.y - 10, 40); this.roomGroup.add(l); }
      } else if (d.kind === 'rack') {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(TILE, TILE, 40), new THREE.MeshStandardMaterial({ color: 0x181825, roughness: 0.5, metalness: 0.4 }));
        rack.position.set(d.x, -d.y - TILE / 2, -DEPTH / 2 + 22); this.roomGroup.add(rack);
        for (let k = 0; k < 3; k++) {
          const led = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 1), new THREE.MeshBasicMaterial({ color: k === 1 ? 0xa6e3a1 : 0x94e2d5 }));
          led.position.set(d.x - 8 + k * 6, -d.y - 8 - k * 7, -DEPTH / 2 + 43); this.roomGroup.add(led); this.blinkers.push(led);
        }
      } else if (d.kind === 'window') {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 1.6, TILE * 2.2), new THREE.MeshBasicMaterial({ color: 0x1e2a4a }));
        w.position.set(d.x, -d.y - TILE * 1.2, -DEPTH / 2 + 1); this.roomGroup.add(w);
        const frame = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 1.6, 2), new THREE.MeshBasicMaterial({ color: 0x6c7086 }));
        frame.position.set(d.x, -d.y - TILE * 1.2, -DEPTH / 2 + 1.5); this.roomGroup.add(frame);
      }
    }

    // 문: 롤백 터미널 ($_ 가 빛난다)
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (this.tiles[y * r.w + x] === 3 && (y === r.h - 1 || this.tiles[(y + 1) * r.w + x] !== 3)) {
      const term = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.8, TILE * 1.8, 30), new THREE.MeshStandardMaterial({ color: 0x1e1e2e, emissive: 0xa6e3a1, emissiveIntensity: 0.6 }));
      term.position.set(x * TILE + TILE / 2, -((y + 1) * TILE) + TILE * 0.9, -20); this.roomGroup.add(term);
      const l = new THREE.PointLight(0xa6e3a1, 50, 240, 1); l.position.set(x * TILE - 10, -((y + 1) * TILE) + 40, 30); this.roomGroup.add(l);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 0.7, TILE * 0.5), new THREE.MeshBasicMaterial({ map: this.textTex('$_', '#a6e3a1'), transparent: true }));
      label.position.set(x * TILE + TILE / 2, -((y + 1) * TILE) + TILE * 1.3, -4); this.roomGroup.add(label);
    }

    // 카메라를 바로 그 자리로
    this.camPos.set(0, 0, 0);
  }

  private textTex(text: string, color: string) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
    const c = cv.getContext('2d')!; c.fillStyle = color; c.font = 'bold 22px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 32, 17);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  /** 화면 좌표 → 시뮬레이션 좌표 (z=0 평면) */
  screenToWorld(sx: number, sy: number, w: number, h: number) {
    const v = new THREE.Vector3((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(this.camera);
    const dir = v.sub(this.camera.position).normalize();
    const t = -this.camera.position.z / dir.z;
    const p = this.camera.position.clone().add(dir.multiplyScalar(t));
    return { x: p.x, y: -p.y };
  }

  // ---------- 매 프레임 ----------
  /** me: 화면에서 예측한 내 위치 (있으면 서버 위치 대신 쓴다. 즉시 반응) */
  draw(prev: SnapMsg | null, s: SnapMsg, t: number, aim: number, dt: number, now: number, fresh: boolean, me: { x: number; y: number; crouch: boolean } | null = null) {
    if (!this.room) return;
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const pp = prev ?? s;
    const px = me ? me.x : lerp(pp.p.x, s.p.x), py = me ? me.y : lerp(pp.p.y, s.p.y);
    const crouch = me ? me.crouch : s.p.crouch;

    // 플레이어
    const P = this.player;
    P.group.position.set(px, -py, 0);
    P.group.visible = !s.dead || Math.floor(now / 80) % 2 === 0;
    const moving = Math.abs(px - this.lastPx) > 0.05; this.lastPx = px;
    const walkFrame = moving && Math.floor(now / 140) % 2 === 1;
    P.stand.visible = !crouch && !walkFrame; P.walk.visible = !crouch && walkFrame; P.crouch.visible = crouch;
    const face = Math.cos(aim) >= 0 ? 1 : -1;
    for (const m of [P.stand, P.walk, P.crouch]) {
      m.scale.x = face;
      (m.material as THREE.MeshStandardMaterial).emissive.setHex(s.p.hurt && Math.floor(now / 60) % 2 ? 0xf38ba8 : 0x000000);
    }
    P.arm.position.set(0, crouch ? 18 : 36, 2);
    P.arm.rotation.z = -aim;
    P.arm.scale.y = face * 0.75;
    P.arm.visible = !s.p.melee;

    // 적
    const seen = new Set<number>();
    const prevE = new Map((prev?.enemies ?? []).map(e => [e.id, e]));
    for (const e of s.enemies) {
      seen.add(e.id);
      let a = this.actors.get(e.id);
      if (!a) { a = this.makeActor(e); this.actors.set(e.id, a); }
      a.fade = toward(a.fade, e.seen ? 1 : DIM, dt);
      this.setFade(a);
      const p0 = prevE.get(e.id) ?? e;
      const ex = lerp(p0.x, e.x), ey = lerp(p0.y, e.y);
      a.group.position.set(ex, -ey, 0);
      a.group.visible = true;
      a.body.scale.x = -e.dir; // 그림은 왼쪽을 본다
      const bob = Math.abs(ex - a.lastX) > 0.2 ? Math.sin(now / 90) * 1.5 : 0;
      a.body.position.y = bob; a.lastX = ex;
      const d = ENEMY[e.kind];
      const ang = e.aim ?? (e.dir > 0 ? 0 : Math.PI);
      a.gun.position.set(0, d.h * 0.7, 3); a.gun.rotation.z = -ang; a.gun.scale.y = Math.cos(ang) >= 0 ? 1 : -1;
      // 조준선: 쏘기 전에 빨갛게 보인다
      a.laser.visible = e.aim !== null;
      if (e.aim !== null) {
        const len = this.rayLen(ex, ey - d.h * 0.7, e.aim);
        const pos = a.laser.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, 0, d.h * 0.7, 4); pos.setXYZ(1, Math.cos(e.aim) * len, d.h * 0.7 - Math.sin(e.aim) * len, 4); pos.needsUpdate = true;
        (a.laser.material as THREE.LineBasicMaterial).opacity = (0.5 + 0.4 * Math.sin(now / 40)) * a.fade;
      }
      (a.body.material as THREE.MeshStandardMaterial).emissive.setHex(e.grabbed ? 0x585b70 : 0x000000);
    }
    // 쓰러진 적: 그 자리에서 서서히 사라진다
    for (const [id, a] of this.actors) if (!seen.has(id)) {
      a.fade -= dt / FADE_TIME; a.laser.visible = false;
      if (a.fade <= 0) { this.removeActor(a); this.actors.delete(id); } else this.setFade(a);
    }

    // 탄
    const seenB = new Set<number>();
    // 탄은 서버가 보낸 방향(vx, vy)으로 돌리고, 다음 스냅샷까지는 그 방향으로 이어 그린다 (뚝뚝 끊기지 않게)
    const ahead = t * TICK * (s.slowmo ? SLOWMO.world : 1);
    for (const b of s.bullets) {
      seenB.add(b.id);
      let m = this.bullets.get(b.id);
      if (!m) { m = new THREE.Mesh(this.bulletGeo, this.bulletMat); this.bullets.set(b.id, m); this.dyn.add(m); }
      // 시야선 밖의 탄은 살짝 흐리게
      m.material = b.enemy ? (b.seen ? this.enemyBulletMat : this.enemyBulletDim) : (b.seen ? this.bulletMat : this.bulletDim);
      m.rotation.z = Math.atan2(-b.vy, b.vx);
      m.scale.set(b.enemy ? 0.7 : 0.55, b.enemy ? 2 : 0.6, b.enemy ? 2 : 0.6); // 내 탄: 아주 얇고 짧은 줄기(약 10px), 적 탄: 짧고 조금 굵게 (피할 수 있게 잘 보이도록)
      m.position.set(b.x + b.vx * ahead, -(b.y + b.vy * ahead), 4);
    }
    for (const [id, m] of this.bullets) if (!seenB.has(id)) { this.dyn.remove(m); this.bullets.delete(id); }

    // 바닥의 탄창
    const seenM = new Set<number>();
    for (const g of s.mags) {
      seenM.add(g.id);
      let it = this.mags.get(g.id);
      if (!it) {
        const mat = this.magMat.clone(); mat.transparent = true; mat.opacity = 0;
        it = { m: new THREE.Mesh(this.magGeo, mat), fade: 0 };
        this.mags.set(g.id, it); this.dyn.add(it.m);
      }
      it.fade = toward(it.fade, g.seen ? 1 : DIM, dt);
      (it.m.material as THREE.MeshStandardMaterial).opacity = it.fade;
      it.m.position.set(g.x, -g.y + 6 + Math.sin(now / 300 + g.id) * 2, 6); it.m.rotation.y = now / 600;
    }
    for (const [id, it] of this.mags) if (!seenM.has(id)) {
      it.fade -= dt / FADE_TIME;
      if (it.fade <= 0) { this.dyn.remove(it.m); (it.m.material as THREE.Material).dispose(); this.mags.delete(id); }
      else (it.m.material as THREE.MeshStandardMaterial).opacity = it.fade;
    }

    // 총구 화염 · 불꽃
    for (const f of fresh ? s.flashes : []) {
      const l = this.flashLights.find(x => x.intensity < 0.5) ?? this.flashLights[0];
      l.color.setHex(f.enemy ? 0xff8a5b : 0xffd27a); l.intensity = 260; l.position.set(f.x, -f.y, 30);
      if (!f.enemy) this.shake = Math.max(this.shake, 3);
      this.spark(f.x, f.y, f.enemy ? 0xff8a5b : 0xffe08a, 4);
    }
    if (fresh) for (const i of s.impacts) this.spark(i.x, i.y, 0xbac2de, 6);
    if (fresh && s.events.includes('hit')) this.shake = 10;
    for (const l of this.flashLights) l.intensity *= Math.pow(0.002, dt);
    for (const sp of this.sparks) { sp.life -= dt; sp.v.y -= 600 * dt; sp.m.position.addScaledVector(sp.v, dt); sp.m.scale.setScalar(Math.max(0.01, sp.life * 3)); }
    for (const sp of this.sparks.filter(x => x.life <= 0)) { this.dyn.remove(sp.m); }
    this.sparks = this.sparks.filter(x => x.life > 0);
    for (const b of this.blinkers) b.visible = Math.sin(now / 200 + b.position.x) > -0.6;

    // 슬로모션: 화면이 차가워지고 카메라가 다가간다
    this.slow += ((s.slowmo ? 1 : 0) - this.slow) * Math.min(1, dt * 6);
    this.ambient.color.setRGB(0.53 - 0.25 * this.slow, 0.56 - 0.05 * this.slow, 0.75 + 0.25 * this.slow);
    this.bloom.strength = 0.85 + 0.6 * this.slow;

    // 카메라: 살짝 위에서 내려다보며 따라간다 (조준 방향으로 조금 앞을 본다)
    const W = this.room.w * TILE;
    const narrow = this.camera.aspect < 1;
    // 방 높이(천장~바닥)가 화면에 꽉 차는 거리. 슬로모션에는 플레이어 쪽으로 다가간다
    const roomH = this.room.h * TILE;
    const fit = (roomH * 1.06) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    const dist = (narrow ? Math.max(fit, 900) : fit) - 120 * this.slow;
    // 방 바깥(빈 공간)이 보이지 않게 카메라를 방 안에 묶는다
    const halfW = dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 0.92;
    const lookX = W <= halfW * 2 ? W / 2 : Math.max(halfW, Math.min(W - halfW, px + Math.cos(aim) * 60));
    const lookY = (-roomH / 2 + 6) * (1 - this.slow) + (-py + 60) * this.slow;
    const target = new THREE.Vector3(lookX + 40 * this.slow, lookY + 40 - 20 * this.slow, dist);
    if (this.camPos.lengthSq() === 0) { this.camPos.copy(target); this.camLook.set(lookX, lookY, 0); }
    this.camPos.lerp(target, Math.min(1, dt * 5));
    this.camLook.lerp(new THREE.Vector3(lookX, lookY, 0), Math.min(1, dt * 6));
    this.shake *= Math.pow(0.001, dt);
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0));
    this.camera.lookAt(this.camLook);
    this.camera.rotation.z += -0.03 * this.slow;

    this.composer.render(dt);
  }

  // 돌려 쓰는 도형 · 재질 (탄 · 탄창은 계속 생겼다 사라지므로 새로 만들지 않는다)
  private bulletGeo = new THREE.BoxGeometry(18, 1.2, 1.2);
  private bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  private enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
  private bulletDim = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: DIM });
  private enemyBulletDim = new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: DIM });
  private magGeo = new THREE.BoxGeometry(8, 12, 5);
  private magMat = new THREE.MeshStandardMaterial({ color: 0x313244, emissive: 0xf9e2af, emissiveIntensity: 0.5 });
  /** 적 그림: 종류마다 텍스처와 판 하나를 만들어 두고, 재질만 적마다 따로 (맞을 때 색을 바꾸므로) */
  private actorParts = new Map<string, { body: THREE.Mesh; gun: THREE.Mesh }>();

  /** 적 하나의 보이는 정도를 그림에 반영 (몸은 투명도, 총 · 그림자는 시야선 안일 때만) */
  private setFade(a: Actor) {
    (a.body.material as THREE.MeshStandardMaterial).opacity = a.fade;
    a.gun.visible = a.fade > 0.6;
    a.shadow.visible = a.fade > 0.6;
  }

  private removeActor(a: Actor) {
    this.dyn.remove(a.group);
    (a.body.material as THREE.Material).dispose();
    a.laser.geometry.dispose(); (a.laser.material as THREE.Material).dispose();
  }

  private makeActor(e: EnemyView): Actor {
    const rows = e.kind === 'npe' ? SPRITES.NPE : e.kind === 'conflict' ? SPRITES.CONFLICT : e.kind === 'debt' ? SPRITES.DEBT : SPRITES.BUG;
    let parts = this.actorParts.get(e.kind);
    if (!parts) { parts = { body: spriteMesh(rows), gun: spriteMesh(SPRITES.ENEMY_GUN, 'left') }; this.actorParts.set(e.kind, parts); }
    const mat = (parts.body.material as THREE.MeshStandardMaterial).clone();
    // 서서히 나타나고 흐려지게: 투명도로 섞는다 (그림의 빈칸은 여전히 버린다)
    mat.alphaTest = 0.01; mat.opacity = 0;
    const body = new THREE.Mesh(parts.body.geometry, mat);
    const gun = new THREE.Mesh(parts.gun.geometry, parts.gun.material);
    const laserGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0xff4060, transparent: true, opacity: 0.8 }));
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.5;
    const group = new THREE.Group(); group.add(body, gun, laser, shadow);
    this.dyn.add(group);
    return { group, body, gun, laser, shadow, kind: e.kind, lastX: e.x, fade: 0 };
  }

  /** 조준선이 벽에 닿는 길이 (지형은 모두에게 보이는 정보) */
  private rayLen(x: number, y: number, ang: number) {
    const r = this.room!, t = this.tiles!;
    for (let d = 0; d < 900; d += 6) {
      const tx = Math.floor((x + Math.cos(ang) * d) / TILE), ty = Math.floor((y + Math.sin(ang) * d) / TILE);
      if (tx < 0 || ty < 0 || tx >= r.w || ty >= r.h) return d;
      const v = t[ty * r.w + tx]; if (v === 1 || v === 2) return d;
    }
    return 900;
  }

  private shadowGeo = new THREE.CircleGeometry(14, 16);
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
  private sparkGeo = new THREE.BoxGeometry(2, 2, 2);
  private sparkMats = new Map<number, THREE.MeshBasicMaterial>();
  private spark(x: number, y: number, color: number, n: number) {
    if (this.sparks.length > 120) return;
    let mat = this.sparkMats.get(color);
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color }); this.sparkMats.set(color, mat); }
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.set(x, -y, 6);
      this.dyn.add(m);
      this.sparks.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 300, Math.random() * 250, (Math.random() - 0.5) * 120), life: 0.25 + Math.random() * 0.2 });
    }
  }
}
