/**
 * 픽셀 스프라이트: 글자 격자 (글자 하나 = 픽셀 하나, 색은 PAL). '.' 은 투명.
 * Friday Deploy 와 같은 팔레트 · 같은 그림 방식 (후드티 + 헤드폰 개발자, 버그들).
 */
export const PAL: Record<string, string> = {
  k: '#11111b', w: '#eff1f5', s: '#f5c9a6', h: '#5c4033',
  b: '#89b4fa', B: '#5a7fd6', r: '#f38ba8', R: '#c9516f', g: '#a6e3a1', G: '#3b7a4a',
  y: '#f9e2af', Y: '#d9a441', o: '#fab387', O: '#d9773f', p: '#cba6f7', P: '#8f6fd1',
  c: '#94e2d5', l: '#bac2de', n: '#7f849c', m: '#585b70', d: '#45475a', e: '#e64553', E: '#8f1d33',
  t: '#d8c7a0', T: '#b3a07a', x: '#1c1220', X: '#3d2a44',
};

/** 후드티 + 헤드폰 개발자 (옆모습, 오른쪽을 본다). 팔과 총은 따로 그린다 */
export const DEV_STAND = [
  '....kkkkkk....',
  '...khhhhhhk...',
  '..kdhhhhhhdk..',
  '..kdhssssskk..',
  '..kdhsskssk...',
  '...khsssssk...',
  '..kkbbssbbk...',
  '.kbbbbbbbbbk..',
  '.kbbbbbbbbbk..',
  '.kbbbbbbbbbk..',
  '..kbbbbbbbk...',
  '...kBBkkBBk...',
  '...kBBk.kBBk..',
  '...kkk..kkk...',
];
export const DEV_WALK = [...DEV_STAND.slice(0, 11), '...kBBkBBk....', '..kBBk..kBBk..', '..kkk....kkk..'];
export const DEV_CROUCH = [
  '....kkkkkk....',
  '...khhhhhhk...',
  '..kdhhhhhhdk..',
  '..kdhsskssk...',
  '..kkbbssbbk...',
  '.kbbbbbbbbbk..',
  '.kBBBBBBBBBBk.',
  '.kkkkk..kkkkk.',
];
/** 팔 + 권총 (어깨가 왼쪽 끝, 조준 방향으로 돌린다) */
export const ARM = [
  '..........kkkk',
  'kkkkkkkkkkmmmk',
  'kbbbbbsskmmmmk',
  'kkkkkkkkkkdkkk',
  '..........kk..',
];

/** 버그: 빨간 딱정벌레가 서서 총을 든다 */
export const BUG = [
  '..k.....k.....',
  '...k...k......',
  '...kkkkk......',
  '..krrrrrk.....',
  '..krkrrkrk....',
  '..krrrrrrk....',
  '.kkRRRRRRkk...',
  'k.kRrRRrRk.k..',
  '..kRRrrRRk....',
  'k.kRrRRrRk.k..',
  '..kRRRRRRk....',
  '...kRRRRk.....',
  '..k.k..k.k....',
];
/** NullPointerException: 보라색, 가늘고 빠르다 (몸에 null 무늬) */
export const NPE = [
  '...kkkkk......',
  '..kpppppk.....',
  '..kpkppkpk....',
  '..kpppppk.....',
  '...kPPPk......',
  '..kPPPPPk.....',
  '.k.kPwPk.k....',
  '...kPwPk......',
  '..kPPPPPk.....',
  '...kPPPk......',
  '...k...k......',
  '..kk...kk.....',
];
/** Merge Conflict: 주황, 몸에 <<< >>> 무늬, 넓다 */
export const CONFLICT = [
  '...kkkkkkk.....',
  '..koooooook....',
  '..kokoooko k...',
  '..kooooooook...',
  '.kkOOOOOOOkk...',
  'k.kOwOOOwOk.k..',
  '..kOOwOwOOk....',
  '..kOOOOOOOk....',
  '..kOOwOwOOk....',
  'k.kOwOOOwOk.k..',
  '..kOOOOOOOk....',
  '..kOOOOOOOk....',
  '...kOOOOOk.....',
  '..k.k...k.k....',
];
/** 기술 부채: 오래된 베이지 PC 가 걸어 다닌다. 크고 느리다 */
export const DEBT = [
  '.kkkkkkkkkkk...',
  '.kttttttttttk..',
  '.ktkkkkkkkktk..',
  '.ktkggggggktk..',
  '.ktkgkggkgktk..',
  '.ktkggggggktk..',
  '.ktkkkkkkkktk..',
  '.kttttttttttk..',
  '.kTTTTTTTTTTk..',
  'kTTTTTTTTTTTTk.',
  'kTTkkTTTTkkTTk.',
  'kTTTTTTTTTTTTk.',
  '.kTTTTTTTTTTk..',
  '..kTTk..kTTk...',
  '..kkkk..kkkk...',
];
/** 적이 드는 총 (작다) */
export const ENEMY_GUN = ['kkkkkk', 'kmmmmk', 'kkkdkk', '...kk.'];

export const SPRITES = { DEV_STAND, DEV_WALK, DEV_CROUCH, ARM, BUG, NPE, CONFLICT, DEBT, ENEMY_GUN };

/** 격자를 캔버스로 굽는다 (scale = 픽셀 하나의 크기) */
export function bake(rows: readonly string[], scale = 1): HTMLCanvasElement {
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
  const ctx = cv.getContext('2d')!;
  rows.forEach((row, y) => Array.from(row).forEach((ch, x) => {
    const c = PAL[ch]; if (!c) return;
    ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  return cv;
}
