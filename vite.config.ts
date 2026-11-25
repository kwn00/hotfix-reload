import { defineConfig } from 'vite';

// 개발할 때: vite(화면) + 게임 서버(8787). 판 시작 · 검증 API(/api)는 게임 서버로 넘긴다.
export default defineConfig({
  server: { proxy: { '/api': { target: 'http://localhost:8787' } } },
});
