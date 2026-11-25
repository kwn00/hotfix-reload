import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { RELEASES, APP_VERSION } from './releases.ts';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

test('버전이 package.json · package-lock.json · 새 소식에서 모두 같다', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, pkg.version, 'releases.ts 맨 위 항목을 package.json 버전에 맞추세요');
  assert.equal(lock.version, pkg.version, 'npm install 로 package-lock.json 을 맞추세요');
});

test('새 소식은 규칙(5줄 이하, 한 줄 70자 이하, 최신이 위, 버전 중복 없음)을 지킨다', () => {
  const seen = new Set<string>();
  for (const r of RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!seen.has(r.version), `중복 버전 ${r.version}`); seen.add(r.version);
    assert.ok(r.title.length > 0 && r.title.length <= 40, `${r.version} 제목 길이`);
    assert.ok(r.items.length >= 1 && r.items.length <= 5, `${r.version} 항목 수 ${r.items.length}`);
    for (const it of r.items) assert.ok([...it].length <= 70, `${r.version} 70자 초과: ${it}`);
  }
  const v = RELEASES.map(r => r.version.split('.').map(Number));
  for (let i = 1; i < v.length; i++) {
    const [a, b] = [v[i - 1], v[i]];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))), '최신 버전이 맨 위에 와야 합니다');
  }
});

test('현재 버전의 GitHub 릴리즈 본문이 있고 첫 줄이 버전 제목이다', () => {
  const file = new URL(`docs/releases/${APP_VERSION}.md`, root);
  assert.ok(existsSync(file), `docs/releases/${APP_VERSION}.md 를 만드세요`);
  assert.equal(readFileSync(file, 'utf8').split('\n')[0], `# v${APP_VERSION}`);
});

test('릴리즈노트와 새 소식에 "확인하지 못한 것"을 적지 않는다', () => {
  const body = readFileSync(new URL(`docs/releases/${APP_VERSION}.md`, root), 'utf8');
  const all = body + JSON.stringify(RELEASES);
  assert.doesNotMatch(all, /확인하지 못|확인 못|미확인/, '확인하지 못한 것은 PR 본문과 대화에만 적습니다');
});
