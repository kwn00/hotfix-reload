// 입력 기록: 화면이 틱마다의 입력을 적고, 판이 끝나면 서버로 보낸다. 서버는 같은 시드로 처음부터 다시 돌려 점수를 계산한다.
// 크기를 줄이려고 "바뀐 틱"만 적는다: [이전 기록 이후 지난 틱 수, 좌우, 각도, 키 묶음, 장전 동작 번호]
import { ACTION_LIST, score, type Action } from './game.ts';
import { Runner, canonInput, NO_INPUT, type TickInput } from './runner.ts';

export const REPLAY_VERSION = 1;
/** 한 판의 최대 길이 (2시간). 이보다 긴 기록은 받지 않는다 */
export const MAX_TICKS = 30 * 60 * 120;
export const MAX_ENTRIES = MAX_TICKS;

export type Entry = [dt: number, mx: number, aim: number, bits: number, act: number];
export interface ReplayLog { v: number; ticks: number; e: Entry[] }

const BITS = ['jump', 'crouch', 'fire', 'melee', 'slowmo', 'check', 'interact'] as const;
const ONE_SHOT = ['jump', 'fire', 'melee', 'interact'] as const;

function pack(i: TickInput): Entry {
  let bits = 0;
  BITS.forEach((k, n) => { if (i[k]) bits |= 1 << n; });
  return [0, i.mx, i.aim, bits, i.act ? ACTION_LIST.indexOf(i.act) + 1 : 0];
}
function unpack(e: Entry): TickInput {
  const i: TickInput = { ...NO_INPUT, mx: e[1], aim: e[2], act: e[4] ? ACTION_LIST[e[4] - 1] as Action : null };
  BITS.forEach((k, n) => { (i as unknown as Record<string, boolean>)[k] = (e[3] & (1 << n)) !== 0; });
  return i;
}
/** 다음 틱으로 이어질 때: 일회성 동작은 지운다 */
function carry(i: TickInput): TickInput {
  const c = { ...i, act: null };
  for (const k of ONE_SHOT) c[k] = false;
  return c;
}
const same = (a: TickInput, b: TickInput) =>
  a.mx === b.mx && a.aim === b.aim && a.act === b.act && BITS.every(k => a[k] === b[k]);

/** 화면 쪽: 틱마다 입력을 적는다 */
export class Recorder {
  private entries: Entry[] = [];
  private cur: TickInput = { ...NO_INPUT };
  private sinceLast = 0;
  private ticks = 0;

  add(raw: TickInput) {
    const i = canonInput(raw);
    this.ticks++;
    this.sinceLast++;
    if (this.entries.length === 0 || !same(i, this.cur)) {
      const e = pack(i); e[0] = this.sinceLast; this.entries.push(e); this.sinceLast = 0;
    }
    this.cur = carry(i);
  }

  log(): ReplayLog { return { v: REPLAY_VERSION, ticks: this.ticks, e: this.entries.map(e => [...e] as Entry) }; }
}

/** 기록의 모양을 검사한다 (서버가 받을 때). 틀리면 이유를 돌려준다 */
export function checkLog(x: unknown): string | null {
  if (typeof x !== 'object' || x === null) return '기록이 없어요';
  const l = x as Partial<ReplayLog>;
  if (l.v !== REPLAY_VERSION) return '기록 형식이 달라요';
  if (!Number.isInteger(l.ticks) || l.ticks! < 1 || l.ticks! > MAX_TICKS) return '판 길이가 이상해요';
  if (!Array.isArray(l.e) || l.e.length < 1 || l.e.length > MAX_ENTRIES) return '기록이 이상해요';
  let sum = 0;
  for (const e of l.e) {
    if (!Array.isArray(e) || e.length !== 5) return '기록 항목이 이상해요';
    const [dt, mx, aim, bits, act] = e;
    if (!Number.isInteger(dt) || dt < 0 || dt > MAX_TICKS) return '기록 항목이 이상해요';
    if (mx !== -1 && mx !== 0 && mx !== 1) return '기록 항목이 이상해요';
    if (typeof aim !== 'number' || !Number.isFinite(aim) || Math.abs(aim) > 7) return '기록 항목이 이상해요';
    if (!Number.isInteger(bits) || bits < 0 || bits >= 1 << BITS.length) return '기록 항목이 이상해요';
    if (!Number.isInteger(act) || act < 0 || act > ACTION_LIST.length) return '기록 항목이 이상해요';
    sum += dt;
  }
  // 첫 항목의 dt 는 1 (첫 틱), 그 뒤는 앞 항목 이후 지난 틱 수. 합이 전체 틱 수를 넘으면 안 된다
  if (sum > l.ticks!) return '기록 길이가 맞지 않아요';
  return null;
}

export interface RunResult { won: boolean; room: number; kills: number; deaths: number; time: number; score: number; ticks: number }

/** 서버 쪽: 시드와 기록으로 처음부터 다시 돌린다 (checkLog 를 통과한 기록만) */
export function replay(seed: number, log: ReplayLog): RunResult {
  const r = new Runner(seed);
  let k = 0, cur: TickInput = { ...NO_INPUT }, wait = log.e[0][0] - 1;
  for (let t = 0; t < log.ticks; t++) {
    let inp: TickInput;
    if (k < log.e.length && wait <= 0) { inp = unpack(log.e[k]); k++; wait = k < log.e.length ? log.e[k][0] - 1 : Infinity; }
    else { inp = cur; wait--; }
    r.tick(inp);
    cur = carry(inp);
    if (r.state.won) break;
  }
  const s = r.state;
  return { won: s.won, room: s.room, kills: s.kills, deaths: s.deaths, time: Math.floor(s.time), score: score(s), ticks: r.ticks };
}
