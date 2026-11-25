// PostgreSQL 저장소 테스트. TEST_DATABASE_URL 이 있을 때만 돈다 (예: postgres://user@127.0.0.1:5432/testdb)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { PostgresStore } from './store.ts';

const URL = process.env.TEST_DATABASE_URL;

test('PostgreSQL: 판 번호는 한 번만 찜하고, 결과와 압축한 기록을 저장한다', { skip: !URL && 'TEST_DATABASE_URL 없음' }, async () => {
  const raw = new pg.Client({ connectionString: URL }); await raw.connect();
  await raw.query('DROP TABLE IF EXISTS runs');
  const st = new PostgresStore(URL!);
  try {
    const run = { rid: 'r1', seed: 42, startedAt: Date.now() - 5000, version: '0.4.1', replayVersion: 1 };
    assert.equal(await st.claim(run), true);
    assert.equal(await st.claim(run), false, '같은 판 번호는 두 번 찜할 수 없다');
    const log = { v: 1, ticks: 10, e: [[1, 0, 0, 0, 0]] as [number, number, number, number, number][] };
    await st.complete('r1', { won: false, room: 1, kills: 3, deaths: 2, time: 40, score: 1100, ticks: 10 }, log);
    const row = (await raw.query('SELECT * FROM runs WHERE rid = $1', ['r1'])).rows[0];
    assert.equal(row.score, 1100); assert.equal(row.kills, 3); assert.equal(row.seed, 42);
    assert.deepEqual(JSON.parse(gunzipSync(row.log_gz).toString()), log);
    // 새 저장소(서버 재시작)도 같은 판 번호를 거절한다
    const st2 = new PostgresStore(URL!);
    assert.equal(await st2.claim(run), false);
    await st2.close();
  } finally { await st.close(); await raw.end(); }
});

test('PostgreSQL: DB 에 닿지 못하면 reject 하고, 나중에 다시 시도할 수 있다', { skip: !URL && 'TEST_DATABASE_URL 없음' }, async () => {
  const st = new PostgresStore('postgres://nobody@127.0.0.1:1/none');
  await assert.rejects(st.claim({ rid: 'x', seed: 1, startedAt: Date.now(), version: '0', replayVersion: 1 }));
  await st.close();
});
