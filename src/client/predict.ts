// 즉시 반응: 내 캐릭터의 이동 · 점프 · 숙이기를 서버와 같은 코드(movePlayer)로 화면에서 먼저 돌린다.
// 서버가 처리한 입력 번호(ack)와 위치를 보내오면, 그 위치에서 아직 처리 안 된 입력을 다시 적용해 맞춘다.
// 판정(맞기 · 쏘기 · 탄)은 하지 않는다. 최종 위치는 언제나 서버 기준이다.
import { movePlayer, TICK, SLOWMO, type Body } from '../shared/game.ts';
import type { Parsed } from '../shared/level.ts';
import type { RoomMsg, SnapMsg } from '../shared/protocol.ts';

export interface MoveInput { seq: number; mx: number; jump: boolean; crouch: boolean; slowmo: boolean }

export class Predictor {
  private map: Parsed | null = null;
  private history: MoveInput[] = [];
  private body: Body | null = null;
  private prev: Body | null = null;
  /** 서버에 맞추느라 튄 만큼을 화면에서는 천천히 따라가게 (눈에 덜 튀게) */
  private offset = { x: 0, y: 0 };
  private meter = 1;
  /** 예측을 멈추는 때: 쓰러짐 · 제압 중 · 끝남 (서버 위치를 그대로 쓴다) */
  private frozen = true;

  setRoom(r: RoomMsg) {
    this.map = { w: r.w, h: r.h, tiles: Uint8Array.from(r.tiles, c => Number(c)), start: { x: 0, y: 0 }, enemies: [], mags: [], decor: [] };
    this.history = []; this.body = null; this.prev = null; this.offset = { x: 0, y: 0 };
  }

  reset() { this.map = null; this.history = []; this.body = null; this.prev = null; this.offset = { x: 0, y: 0 }; }

  private stepBody(b: Body, i: MoveInput) {
    const slow = i.slowmo && this.meter > 0;
    movePlayer(this.map!, b, i, TICK * (slow ? SLOWMO.player : 1));
  }

  /** 서버 스냅샷: 서버 위치에서 아직 처리 안 된 입력을 다시 적용 */
  onSnap(s: SnapMsg) {
    this.meter = s.meter;
    this.frozen = s.dead || s.p.melee || s.won;
    this.history = this.history.filter(i => i.seq > s.ack);
    if (!this.map) return;
    const b: Body = { x: s.p.x, y: s.p.y, vy: s.p.vy, onGround: s.p.ground, crouch: s.p.crouch };
    if (!this.frozen) for (const i of this.history) this.stepBody(b, i);
    if (this.body) {
      const dx = this.body.x - b.x, dy = this.body.y - b.y;
      // 크게 어긋났으면(문 · 다시 시작 등) 바로 맞춘다
      if (Math.hypot(dx, dy) > 64) this.offset = { x: 0, y: 0 };
      else { this.offset.x += dx; this.offset.y += dy; }
    }
    this.prev = this.body ? { ...b, x: b.x + (this.prev ? this.prev.x - this.body.x : 0), y: b.y + (this.prev ? this.prev.y - this.body.y : 0) } : { ...b };
    this.body = b;
  }

  /** 화면의 한 틱: 입력을 기록하고 바로 적용 */
  step(i: MoveInput) {
    this.history.push(i);
    if (this.history.length > 90) this.history.shift();
    if (!this.map || !this.body || this.frozen) return;
    this.prev = { ...this.body };
    this.stepBody(this.body, i);
  }

  /** 그릴 위치. alpha: 지난 화면 틱 이후 지난 비율 (0~1) */
  render(alpha: number, dt: number): { x: number; y: number; crouch: boolean } | null {
    if (!this.body) return null;
    const p = this.prev ?? this.body;
    const k = Math.pow(0.0001, dt); // 어긋난 만큼은 0.1초 안팎으로 사라진다
    this.offset.x *= k; this.offset.y *= k;
    return {
      x: p.x + (this.body.x - p.x) * alpha + this.offset.x,
      y: p.y + (this.body.y - p.y) * alpha + this.offset.y,
      crouch: this.body.crouch,
    };
  }
}
