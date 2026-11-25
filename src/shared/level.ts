// 손으로 만든 방들. 건물 아래층에서 시작해 옥상의 롤백 터미널까지 간다.
// 한 글자 = 타일 하나 (32px). 높이는 12줄.
//   #  벽/바닥 (막힘)       =  책상 (막힘, 한 칸 높이: 숙이면 몸을 가린다)
//   P  시작 자리             D  다음 방으로 가는 문 (E)
//   b  버그 (권총)           n  NullPointerException (빠르게 연사)
//   m  Merge Conflict (산탄, 두 방)   t  기술 부채 (느리지만 세 방)
//   M  바닥에 떨어진 탄창     L  형광등 (그림만)   S  서버랙 (그림만)   W  창문 (그림만)
// 그림만인 것과 적 · 탄창 · 시작 자리는 바닥(빈칸)으로 친다.

export interface RoomDef { name: string; rows: string[] }

export const ROOMS: readonly RoomDef[] = [
  {
    name: 'B1 · 탕비실',
    rows: [
      '##################################',
      '#     L          L         L     #',
      '#                                #',
      '#                                #',
      '#                                #',
      '#                                #',
      '#                     ###        #',
      '#                                #',
      '#                                #',
      '#              =                 D',
      '# P    M       =       b       = D',
      '##################################',
    ],
  },
  {
    name: '1F · 오픈 오피스',
    rows: [
      '##############################################',
      '#    L        L         L          L         #',
      '#                                            #',
      '#                                            #',
      '#                  ######                    #',
      '#                                            #',
      '#                    n                       #',
      '#          ####    ######     ####           #',
      '#                                            #',
      '#                                            D',
      '# P   =   b   =      =    M   =  b =    =  b D',
      '##############################################',
    ],
  },
  {
    name: '2F · 회의실',
    rows: [
      '##########################################',
      '#  L    W  W  W   L   W  W  W    L       #',
      '#                                        #',
      '#                                        #',
      '#                     b                  #',
      '#        #####     #######     #####     #',
      '#                                        #',
      '#                                        #',
      '#                                        #',
      '#               ====                     D',
      '# P    =   m    ====    M    = n   b   t D',
      '##########################################',
    ],
  },
  {
    name: '3F · 서버실',
    rows: [
      '################################################',
      '#  L   SS   L   SS    L   SS   L    SS   L     #',
      '#      SS       SS        SS        SS         #',
      '#      SS       SS        SS        SS         #',
      '#      SS   n   SS        SS        SS         #',
      '#   ##########  ####  ##########  ######       #',
      '#                                              #',
      '#                                              #',
      '#                                              #',
      '#           =             =             =      D',
      '# P    M    =    b    t   =    bn   M   =   m  D',
      '################################################',
    ],
  },
  {
    name: '4F · 대표실',
    rows: [
      '########################################',
      '#   L    W   W   W   W   L    W   W    #',
      '#                                      #',
      '#                                      #',
      '#              n           n           #',
      '#         ###########  ##########      #',
      '#                                      #',
      '#                                      #',
      '#                                      #',
      '#       ==                  ==         D',
      '# P     ==    b    m    M   ==    b tt D',
      '########################################',
    ],
  },
  {
    name: 'RF · 옥상',
    rows: [
      '##################################',
      '#                                #',
      '#                                #',
      '#                                #',
      '#                                #',
      '#                                #',
      '#                                #',
      '#            ######              #',
      '#                                #',
      '#        =                       D',
      '# P      =     b    n m    =  tt D',
      '##################################',
    ],
  },
];

export const TILE = 32;
export const ROOM_H = 12;
export type EnemyKind = 'bug' | 'npe' | 'conflict' | 'debt';
export const ENEMY_CHARS: Record<string, EnemyKind> = { b: 'bug', n: 'npe', m: 'conflict', t: 'debt' };

/** 판정용 타일: 0 빈칸, 1 벽, 2 책상, 3 문 */
export interface Parsed {
  w: number; h: number; tiles: Uint8Array; start: { x: number; y: number };
  enemies: { kind: EnemyKind; x: number; y: number }[];
  mags: { x: number; y: number }[];
  /** 그림만: 화면용 (판정에 안 쓴다) */
  decor: { kind: 'lamp' | 'rack' | 'window'; x: number; y: number }[];
}

export function parseRoom(def: RoomDef): Parsed {
  const h = def.rows.length, w = Math.max(...def.rows.map(r => r.length));
  const tiles = new Uint8Array(w * h);
  const out: Parsed = { w, h, tiles, start: { x: 0, y: 0 }, enemies: [], mags: [], decor: [] };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = def.rows[y][x] ?? ' ';
    const cx = x * TILE + TILE / 2, foot = (y + 1) * TILE; // 발 높이 = 그 칸의 바닥
    if (c === '#') tiles[y * w + x] = 1;
    else if (c === '=') tiles[y * w + x] = 2;
    else if (c === 'D') tiles[y * w + x] = 3;
    else if (c === 'P') out.start = { x: cx, y: foot };
    else if (c === 'M') out.mags.push({ x: cx, y: foot });
    else if (ENEMY_CHARS[c]) out.enemies.push({ kind: ENEMY_CHARS[c], x: cx, y: foot });
    else if (c === 'L') out.decor.push({ kind: 'lamp', x: cx, y: y * TILE });
    else if (c === 'S') out.decor.push({ kind: 'rack', x: cx, y: y * TILE });
    else if (c === 'W') out.decor.push({ kind: 'window', x: cx, y: y * TILE });
  }
  return out;
}
