// 판 기록 저장소.
// - claim: 판 번호를 "쓴 것"으로 찜한다. 이미 있으면 false (같은 판을 두 번 올리지 못하게. 서버가 재시작돼도 DB 에 남는다)
// - complete: 검증 결과와 입력 기록(압축)을 남긴다. 나중에 규칙이 바뀌어도 기록으로 다시 검증할 수 있게 한다
// DATABASE_URL 이 있으면 PostgreSQL, 없으면 메모리(서버가 재시작되면 사라짐).
import pg from 'pg';
import { gzipSync } from 'node:zlib';
import type { RunResult, ReplayLog } from '../src/shared/replay.ts';

export interface RunStart { rid: string; seed: number; startedAt: number; version: string; replayVersion: number }
export interface RunStore {
  readonly kind: 'memory' | 'postgres';
  /** 판 번호를 찜한다. 새로 찜했으면 true, 이미 있으면 false. DB 에 닿지 못하면 reject */
  claim(run: RunStart): Promise<boolean>;
  /** 검증 결과 저장. DB 에 닿지 못하면 reject */
  complete(rid: string, result: RunResult, log: ReplayLog): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStore implements RunStore {
  readonly kind = 'memory';
  private runs = new Map<string, { start: RunStart; result?: RunResult }>();
  async claim(run: RunStart) {
    if (this.runs.has(run.rid)) return false;
    this.runs.set(run.rid, { start: run });
    return true;
  }
  async complete(rid: string, result: RunResult) { const r = this.runs.get(rid); if (r) r.result = result; }
  async close() {}
  /** 시험용 */
  get(rid: string) { return this.runs.get(rid); }
}

/*
 * PostgreSQL (Neon). Friday Deploy 의 store-postgres.ts 와 같은 원칙:
 * - 만들 때 접속하지 않는다. 테이블은 첫 사용 때 만들고, 실패하면 다음 사용 때 다시 시도한다
 *   (무료 DB 는 한동안 안 쓰면 잠들었다가 느리게 깨어난다. 그동안에도 게임 서버는 떠 있어야 한다).
 * - Neon 의 풀링 주소(PgBouncer)는 접속 매개변수 statement_timeout 을 거부하므로, 모든 작업을 트랜잭션으로 감싸
 *   그 안에서 SET LOCAL 로 시간 제한을 건다. 세션 단위 기능은 쓰지 않는다.
 * - 쿼리는 전부 매개변수로 보낸다.
 * - TLS: 주소의 sslmode=require 를 그대로 두면 pg 가 인증서 검증을 켠 채로 접속한다.
 */
const CREATE = `CREATE TABLE IF NOT EXISTS runs (
  rid            text        PRIMARY KEY,
  seed           integer     NOT NULL,
  version        text        NOT NULL,
  replay_version integer     NOT NULL,
  started_at     timestamptz NOT NULL,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  score          integer,
  won            boolean,
  room           integer,
  kills          integer,
  deaths         integer,
  time_s         integer,
  ticks          integer,
  log_gz         bytea
)`;

export class PostgresStore implements RunStore {
  readonly kind = 'postgres';
  private pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000, query_timeout: 15_000 });
    // 쉬고 있는 연결이 끊겨도(Neon 이 잠듦) 서버가 죽지 않게
    this.pool.on('error', err => console.error('[db] 쉬던 연결 오류', err.message));
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout = '10s'");
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  private ensure(): Promise<void> {
    this.ready ??= this.tx(async c => { await c.query(CREATE); }).catch(e => { this.ready = null; throw e; });
    return this.ready;
  }

  async claim(run: RunStart): Promise<boolean> {
    await this.ensure();
    return this.tx(async c => {
      const r = await c.query(
        'INSERT INTO runs (rid, seed, version, replay_version, started_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) ON CONFLICT (rid) DO NOTHING',
        [run.rid, run.seed, run.version, run.replayVersion, run.startedAt]);
      return r.rowCount === 1;
    });
  }

  async complete(rid: string, res: RunResult, log: ReplayLog): Promise<void> {
    await this.ensure();
    const gz = gzipSync(Buffer.from(JSON.stringify(log)));
    await this.tx(async c => {
      await c.query(
        'UPDATE runs SET finished_at = now(), score = $2, won = $3, room = $4, kills = $5, deaths = $6, time_s = $7, ticks = $8, log_gz = $9 WHERE rid = $1',
        [rid, res.score, res.won, res.room, res.kills, res.deaths, res.time, res.ticks, gz]);
    });
  }

  async close() { await this.pool.end(); }
}

export function openStore(url = process.env.DATABASE_URL?.trim()): RunStore {
  if (!url) { console.warn('[db] DATABASE_URL 이 없어 판 기록을 메모리에만 둡니다 (서버가 재시작되면 사라짐)'); return new MemoryStore(); }
  return new PostgresStore(url);
}
