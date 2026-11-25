// 키는 입력된 글자(e.key)가 아니라 눌린 자리(e.code)로 읽는다.
// e.key 는 한글 입력 상태에서 'ㄱ'(R) · 'ㅈ'(W) 처럼 바뀌어서, 한/영을 바꾸기 전에는 키가 먹지 않았다.
// e.code 는 입력기 · 자판 배열과 상관없이 'KeyR' 처럼 같은 값이다 (Friday Deploy 와 같은 방식).

/** 게임에서 쓰는 이름 → 이 이름으로 읽는 자리들 */
const CODES: Record<string, readonly string[]> = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['KeyW', 'ArrowUp'], crouch: ['KeyS', 'ArrowDown'],
  eject: ['KeyR'], insert: ['KeyF'], rack: ['Space'], stow: ['KeyG'],
  grab1: ['Digit1', 'Numpad1'], grab2: ['Digit2', 'Numpad2'], grab3: ['Digit3', 'Numpad3'], grab4: ['Digit4', 'Numpad4'],
  melee: ['KeyV'], interact: ['KeyE'], check: ['KeyQ'], slowmo: ['ShiftLeft', 'ShiftRight'], guide: ['Slash'],
};
const BY_CODE = new Map<string, string>();
for (const [name, codes] of Object.entries(CODES)) for (const c of codes) BY_CODE.set(c, name);

/** 눌린 자리(e.code)를 게임의 이름으로. 쓰지 않는 키는 null */
export function keyName(code: string): string | null {
  return BY_CODE.get(code) ?? null;
}

/** 브라우저 기본 동작(스크롤 · 빠른 찾기 등)을 막을 키 */
export const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Tab', 'ShiftLeft', 'ShiftRight']);
