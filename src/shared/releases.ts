/**
 * 버전과, 게임 안에서 보여주는 릴리즈노트 ("새 소식").
 *
 * - 맨 위 항목이 현재 버전이다. package.json 의 version 과 같아야 한다 (테스트가 확인한다).
 * - 여기에는 플레이어가 체감하는 것만, 쉬운 말로 짧게 적는다 (한 버전에 5줄 이하, 한 줄 70자 이하).
 *   보안·내부 구조·테스트·배포 설정 같은 변경은 적지 않는다.
 * - 전체 변경 내역은 docs/releases/<버전>.md 에 적는다. 그 파일이 GitHub 릴리즈의 본문이 된다.
 * - 버전을 올리는 절차는 .claude/skills/release/SKILL.md 참고.
 */
export interface ReleaseNote {
  /** x.y.z */
  version: string;
  /** 릴리즈를 준비한 날짜 (YYYY-MM-DD). PR 을 올린 날을 적는다 */
  date: string;
  /** 한 줄 제목 */
  title: string;
  /** 플레이어에게 보여줄 내용. 한 줄에 하나씩, 쉬운 말로 */
  items: string[];
}

/** 최신 버전이 맨 위 */
export const RELEASES: readonly ReleaseNote[] = [
  {
    version: '0.2.0',
    date: '2026-11-25',
    title: '핫픽스 리로드 첫 공개',
    items: [
      '권총 한 자루로 버그가 가득한 5개 층을 지나 롤백 터미널까지 가요.',
      '장전은 손으로 해요. 탄창 빼기, 꽂기, 슬라이드 당기기를 따로 해요.',
      '남은 탄은 화면에 안 나와요. Q 를 꾹 눌러 git status 로 확인해요.',
      '벽 너머의 적은 보이지 않아요.',
      '휴대폰에서는 화면 버튼으로 할 수 있어요.',
    ],
  },
];

export const APP_VERSION = RELEASES[0].version;
