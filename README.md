# 핫픽스 리로드 (Hotfix Reload)

> 금요일 배포가 터졌다. 권총 한 자루와 탄창 몇 개로 옥상의 롤백 터미널까지.

[Friday Deploy](https://github.com/kwn00/friday-deploy) 세계관을 잇는 **직접 장전 사이드뷰 액션** 웹 게임.
데스크톱(키보드 · 마우스) 전용입니다. 남은 탄은 화면에 나오지 않고, 장전은 손으로 하고, 두 방 맞으면 쓰러집니다. 화면은 three.js 로 그린 2.5D 이고, 아래에 복셀 권총과 탄창 칸이 보입니다.

## 조작

| 키 | 동작 |
| --- | --- |
| A · D / W / S | 이동 / 점프 / 숙이기 (숙이면 책상 높이 아래로) |
| 마우스 · 클릭 | 조준 · 쏘기 (보이는 적 가까이면 조준을 조금 도와줌) |
| R | 탄창 빼기 (발밑에 떨어짐) |
| 1~4 / F / Space | 그 칸의 탄창 쥐기 / 쥔 탄창 꽂기 / 슬라이드 당기기 (걸린 총 풀기) |
| G | 쥔 탄창을 빈 칸에 다시 넣기 |
| Shift | 슬로모션 (게이지) |
| V · 오른쪽 클릭 | 바로 앞의 적 제압 |
| E | 바닥의 탄창 줍기 / 문 (롤백 터미널) |
| Q (꾹) | `git status`: 0.6초 들고 있으면 남은 탄이 보임 |
| Esc · P | 일시정지 (탭을 떠나도 멈춤) |

- 탄창을 꽂아도 약실은 비어 있습니다. 슬라이드를 당겨야 쏠 수 있고, 약실이 찬 채로 당기면 한 발을 버립니다.
- 가끔 총이 걸립니다. 슬라이드를 당겨 걸린 탄을 버리세요.
- 적은 빨간 조준선을 보인 뒤에 쏩니다. 숙이거나 책상 뒤로 피하세요.

## 적

버그(권총) · NullPointerException(빠른 연사) · Merge Conflict(산탄, 두 방) · 기술 부채(느림, 세 방).

## 구조와 보안

혼자 하는 게임이라, 게임은 브라우저에서 돕니다 (쏘기 · 장전 · 적 반응에 지연이 없습니다).
점수는 서버가 검증합니다: 판을 시작할 때 서버가 시드에 서명한 판 토큰을 주고, 판이 끝나면 화면이 틱마다의 입력 기록을 보냅니다.
서버는 같은 시드로 처음부터 다시 돌려 점수를 직접 계산합니다. 화면에서 상태를 조작해도 기록으로 다시 돌린 결과는 달라지지 않습니다.

```
src/shared   총 · 방 지도 · 시뮬레이션 · 결정적 수학 · 판 진행기 · 입력 기록 (서버/화면 공용)
server       Node. 정적 파일, 판 시작 · 검증 API (/api/run/start, /api/run/finish)
src/client   Vite + three.js. 판을 돌리고 그리기, 입력 기록
```

## 개발

```bash
npm install
npm run dev        # API 서버(8787) + 화면(vite). 화면 주소로 접속
npm test           # 단위 테스트
npm run build && npm start   # 운영과 같은 방식 (http://localhost:8787)
```

## 배포

### 판 기록 DB (Neon)

검증한 판의 결과와 입력 기록(압축)은 PostgreSQL 에 저장합니다. 판 번호를 DB 에 남겨 서버가 재시작돼도 같은 판을 두 번 올릴 수 없습니다.
Render 대시보드 → 서비스 → **Environment** 에 `DATABASE_URL`(Neon 의 연결 주소, `sslmode=require` 그대로)을 넣으면 됩니다. 비밀번호가 들어 있으니 저장소에 커밋하지 마세요.
테이블은 서버가 처음 쓸 때 만듭니다. DB 가 잠들어 있거나 잠깐 닿지 않아도 게임과 검증은 계속되고, 그동안의 판은 "저장하지 못함"으로 알립니다.
`DATABASE_URL` 이 없으면 메모리에만 둡니다 (서버가 재시작되면 사라짐). `/healthz` 의 `store` 가 `postgres` 면 DB 를 쓰는 중입니다.

```bash
TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/testdb npm test   # PostgreSQL 저장소 테스트까지
```

### Render

Render Blueprint(`render.yaml`)로 웹 서비스 하나에 배포합니다. `main` 에 푸시하면 자동 배포되고,
새 버전이면 GitHub 릴리즈가 만들어집니다 (`.github/workflows/release.yml`). 릴리즈 절차는 `.claude/skills/release/SKILL.md`.
