import type { IncomingMessage } from 'node:http';

export class TokenBucket {
  private tokens: number; private last = Date.now();
  constructor(private cap: number, private perSec: number, private now = () => Date.now()) { this.tokens = cap; this.last = now(); }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.cap, this.tokens + (t - this.last) / 1000 * this.perSec); this.last = t;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}

/**
 * 클라이언트 주소. Render 는 X-Forwarded-For 앞에 위조된 값이 올 수 있어서,
 * 앞단(Cloudflare)이 덮어쓰는 단일 값 헤더(CLIENT_IP_HEADER, 예: cf-connecting-ip)를 쓴다.
 */
export function clientIp(req: IncomingMessage): string {
  const h = process.env.CLIENT_IP_HEADER?.toLowerCase();
  const v = h ? req.headers[h] : undefined;
  if (typeof v === 'string' && v.length < 64) return v.trim();
  return req.socket.remoteAddress ?? '?';
}

/** 다른 사이트의 페이지가 이 서버에 WebSocket 을 여는 것을 막는다 (ALLOWED_ORIGINS 가 없으면 같은 호스트만). */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return process.env.NODE_ENV !== 'production';
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
