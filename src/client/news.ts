// 게임 안 새 소식. 그 버전을 처음 보는 사람에게 한 번 자동으로 띄운다.
import { RELEASES, APP_VERSION } from '../shared/releases.ts';

const SEEN_KEY = 'hr-news-seen';

export function initNews() {
  const verBtn = document.getElementById('version') as HTMLButtonElement;
  const dlg = document.getElementById('news')!;
  const list = document.getElementById('news-list')!;
  verBtn.textContent = `v${APP_VERSION}`;
  // textContent 만 쓴다 (innerHTML 금지)
  for (const r of RELEASES) {
    const sec = document.createElement('section');
    const h = document.createElement('h3'); h.textContent = `v${r.version} · ${r.title}`;
    const d = document.createElement('p'); d.className = 'date'; d.textContent = r.date;
    const ul = document.createElement('ul');
    for (const it of r.items) { const li = document.createElement('li'); li.textContent = it; ul.append(li); }
    sec.append(h, d, ul); list.append(sec);
  }
  const open = () => dlg.classList.remove('hidden');
  const close = () => { dlg.classList.add('hidden'); try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch { /* 무시 */ } };
  verBtn.addEventListener('click', open);
  document.getElementById('news-close')!.addEventListener('click', close);
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* 무시 */ }
  if (seen !== APP_VERSION) open();
}
