// 결정적 수학: 사칙연산(+ - * /)과 Math.sqrt 만 쓴다.
// Math.sin · cos · atan2 · hypot 는 브라우저(엔진)마다 마지막 자리 결과가 다를 수 있어서,
// 브라우저에서 돈 판을 서버가 다시 돌려 검증할 때 결과가 어긋날 수 있다. 사칙연산과 sqrt 는 표준상 어디서나 같은 값이다.
// 정확도는 1e-9 안팎으로 게임에는 충분하다.

const PI = 3.141592653589793;
const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** -π ~ π 로 접는다 */
function wrap(x: number): number {
  x = x - TAU * Math.floor((x + PI) / TAU);
  return x;
}

/** |x| ≤ π/4 에서 sin (테일러 급수, 사칙연산만) */
function sinCore(x: number): number {
  const x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
/** |x| ≤ π/4 에서 cos */
function cosCore(x: number): number {
  const x2 = x * x;
  return 1 - x2 / 2 * (1 - x2 / 12 * (1 - x2 / 30 * (1 - x2 / 56 * (1 - x2 / 90 * (1 - x2 / 132 * (1 - x2 / 182))))));
}

export function dsin(x: number): number {
  x = wrap(x);
  // 사분면으로 나눠 |r| ≤ π/4 로 줄인다
  const q = Math.round(x / HALF_PI); // -2 ~ 2
  const r = x - q * HALF_PI;
  switch (q) {
    case 0: return sinCore(r);
    case 1: return cosCore(r);
    case -1: return -cosCore(r);
    default: return -sinCore(r); // ±2
  }
}

export function dcos(x: number): number {
  x = wrap(x);
  const q = Math.round(x / HALF_PI);
  const r = x - q * HALF_PI;
  switch (q) {
    case 0: return cosCore(r);
    case 1: return -sinCore(r);
    case -1: return sinCore(r);
    default: return -cosCore(r);
  }
}

/** 0 ≤ t ≤ 1 에서 atan (t > tan(π/12) 이면 한 번 더 줄인다) */
function atanUnit(t: number): number {
  const TAN_PI_12 = 0.2679491924311227, PI_6 = 0.5235987755982988, SQRT3 = 1.7320508075688772;
  let off = 0;
  if (t > TAN_PI_12) { t = (t * SQRT3 - 1) / (SQRT3 + t); off = PI_6; }
  const t2 = t * t;
  // |t| ≤ tan(π/12) ≈ 0.268 에서 급수 (항 11개면 1e-15 수준)
  let s = 0;
  for (let k = 21; k >= 1; k -= 2) s = 1 / k - t2 * s;
  return off + t * s;
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y;
  let a = ax >= ay ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
