// 서버 연결. 받은 메시지를 넘기고, 끊기면 알린다.
import type { ServerMsg, ClientMsg } from '../shared/protocol.ts';

export class Net {
  private ws: WebSocket | null = null;
  onMsg: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('연결 실패'));
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.onClose(); } };
      ws.onmessage = e => { try { this.onMsg(JSON.parse(e.data as string)); } catch { /* 무시 */ } };
    });
  }
  close() { const w = this.ws; this.ws = null; w?.close(); }
  get open() { return this.ws?.readyState === WebSocket.OPEN; }
  send(m: ClientMsg) { if (this.open) this.ws!.send(JSON.stringify(m)); }
}
