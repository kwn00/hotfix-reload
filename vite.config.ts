import { defineConfig } from 'vite';

// 개발할 때: vite(화면) + 게임 서버(8787). /ws 는 게임 서버로 넘긴다.
export default defineConfig({
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
