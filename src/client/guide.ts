// 게임 중 키 설명 (위쪽 가운데, 반투명). '/' 키나 버튼으로 숨기고 펼 수 있고, 숨긴 상태를 기억한다.
// 아래 줄은 지금 할 만한 다음 키. 서버가 보낸 "보이는 상태"와 사건만 쓴다 (숨긴 탄 정보는 쓰지 않는다).
import type { SnapMsg } from '../shared/protocol.ts';

const KEY = 'hr-guide-hidden';
const DESKTOP: [string, string][] = [
  ['A D', '이동'], ['W', '점프'], ['S', '숙이기'], ['클릭', '쏘기'], ['V', '제압'], ['Shift', '슬로모션'],
  ['R', '탄창 빼기'], ['1~4', '탄창 쥐기'], ['F', '꽂기'], ['Space', '슬라이드'], ['G', '칸에 넣기'], ['Q 꾹', '남은 탄'], ['E', '줍기 / 문'],
];

export class Guide {
  private box = document.getElementById('guide')!;
  private keys = document.getElementById('guide-keys')!;
  private hint = document.getElementById('guide-hint')!;
  private toggleBtn = document.getElementById('guide-toggle') as HTMLButtonElement;
  private hidden = false;
  /** 사건으로 아는 "다음에 할 일" (꽂았으면 슬라이드, 걸렸으면 풀기, 헛방이면 탄창 확인) */
  private need: 'rack' | 'unjam' | 'dry' | null = null;

  constructor() {
    try { this.hidden = localStorage.getItem(KEY) === '1'; } catch { /* 무시 */ }
    for (const [k, v] of DESKTOP) {
      const item = document.createElement('span'); item.className = 'gk';
      const kb = document.createElement('kbd'); kb.textContent = k;
      item.append(kb);
      if (v) { const t = document.createElement('span'); t.textContent = v; item.append(t); }
      this.keys.append(item);
    }
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.apply();
  }

  private apply() {
    this.box.classList.toggle('collapsed', this.hidden);
    this.toggleBtn.textContent = this.hidden ? '조작법 보기 [/]' : '숨기기 [/]';
  }

  toggle() {
    this.hidden = !this.hidden;
    try { localStorage.setItem(KEY, this.hidden ? '1' : '0'); } catch { /* 무시 */ }
    this.apply();
  }

  reset() { this.need = null; }

  update(s: SnapMsg, events: readonly string[]) {
    for (const e of events) {
      if (e === 'insert') this.need = 'rack';
      else if (e === 'jam' || e === 'jammed') this.need = 'unjam';
      else if (e === 'dry') this.need = this.need ?? 'dry';
      else if (e === 'rack' || e === 'rack-waste' || e === 'unjam' || e === 'fire') this.need = null;
      else if (e === 'eject') this.need = null;
    }
    if (s.dead) this.need = null;
    let h = '';
    if (s.dead || s.won) h = '';
    else if (this.need === 'unjam') h = '총이 걸렸어요 → Space';
    else if (this.need === 'rack') h = '꽂았으면 → Space 로 슬라이드';
    else if (!s.gun.magIn && s.gun.grip) h = '쥔 탄창 꽂기 → F';
    else if (!s.gun.magIn && s.gun.slots.some(Boolean)) h = '탄창 쥐기 → 1~4';
    else if (!s.gun.magIn) h = '탄창이 없어요 → E 로 바닥 탄창 줍기';
    else if (this.need === 'dry') h = '헛방! 다 썼다면 → R 로 탄창 빼기';
    else if (s.enemies.some(e => e.aim !== null)) h = '조준선! → S 로 숙이기 · 책상 뒤로';
    this.hint.textContent = h;
    this.hint.classList.toggle('empty', !h);
  }
}
