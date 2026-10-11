// tools/zim-proxy/stats.mjs: the edge proxy's requests from Cloudflare's GraphQL Analytics API,
// against a fake API (the real one needs the account's token).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bucketOf, bucketsBetween, fetchRows, formatTable, statsQuery, summarize, workerName,
} from '../tools/zim-proxy/stats.mjs';

const start = '2026-10-09T05:30:00.000Z';
const end = '2026-10-11T05:30:00.000Z';
const row = (time, status, requests, errors = 0, subrequests = requests) => ({ sum: { requests, errors, subrequests }, dimensions: { datetimeHour: time, status } });

describe('proxy stats (tools/zim-proxy/stats.mjs)', () => {
  it('reads the Worker name from wrangler.toml', () => {
    assert.equal(workerName('# a comment\nname = "vrlbry-zim-proxy"\nmain = "worker.js"\n'), 'vrlbry-zim-proxy');
    assert.equal(workerName('main = "worker.js"'), null);
  });

  it('asks for one Worker between two times, by the given time field and status', () => {
    const q = statsQuery({ account: 'acc"1', script: 'vrlbry-zim-proxy', start, end, timeField: 'datetimeHour' });
    assert.match(q, /accountTag: "acc\\"1"/, 'values are quoted as JSON');
    assert.match(q, /scriptName: "vrlbry-zim-proxy", datetime_geq: "2026-10-09T05:30:00.000Z", datetime_leq: "2026-10-11T05:30:00.000Z"/);
    assert.match(q, /orderBy: \[datetimeHour_ASC\]/);
    assert.match(q, /dimensions \{ datetimeHour status \}/);
  });

  it('buckets by UTC day or hour, every one of the range present', () => {
    assert.equal(bucketOf('2026-10-10T23:59:00Z', false), '2026-10-10');
    assert.equal(bucketOf('2026-10-10T23:59:00Z', true), '2026-10-10 23:00');
    assert.deepEqual(bucketsBetween(start, end, false), ['2026-10-09', '2026-10-10', '2026-10-11']);
    assert.equal(bucketsBetween(start, end, true).length, 49);
  });

  it('sums rows per bucket and status, quiet days as 0', () => {
    const rows = [
      row('2026-10-09T06:00:00Z', 'success', 40),
      row('2026-10-09T06:00:00Z', 'clientDisconnected', 2, 0, 1),
      row('2026-10-11T01:00:00Z', 'success', 100, 3, 104),
    ];
    const s = summarize(rows, { start, end, hours: false, timeField: 'datetimeHour' });
    assert.deepEqual(s.buckets, [
      { bucket: '2026-10-09', requests: 42, errors: 0, subrequests: 41 },
      { bucket: '2026-10-10', requests: 0, errors: 0, subrequests: 0 },
      { bucket: '2026-10-11', requests: 100, errors: 3, subrequests: 104 },
    ]);
    assert.deepEqual(s.total, { requests: 142, errors: 3, subrequests: 145 });
    assert.deepEqual(s.statuses, { success: 140, clientDisconnected: 2 });
    const text = formatTable(s, { script: 'vrlbry-zim-proxy', start, end, hours: false });
    assert.match(text, /^vrlbry-zim-proxy: 2026-10-09 to 2026-10-11 \(UTC\), per day/);
    assert.match(text, /2026-10-10\s+0\s+0\s+0/);
    assert.match(text, /total\s+142\s+3\s+145/);
    assert.match(text, /by status: success 140, clientDisconnected 2/);
    // Per hour, only the hours with requests are listed.
    const hourly = formatTable(summarize(rows, { start, end, hours: true, timeField: 'datetimeHour' }), { script: 'x', start, end, hours: true });
    assert.equal(hourly.split('\n').filter((l) => /^2026-/.test(l)).length, 2);
  });

  it('falls back to datetime where datetimeHour is not a dimension, and says what a bad token means', async () => {
    const asked = [];
    const fake = async (url, init) => {
      const { query } = JSON.parse(init.body);
      asked.push(/orderBy: \[(\w+)_ASC\]/.exec(query)[1]);
      assert.equal(init.headers.authorization, 'Bearer tok');
      if (query.includes('datetimeHour')) return { ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: 'unknown field "datetimeHour"' }] }) };
      return {
        ok: true, status: 200,
        json: async () => ({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 5, errors: 0, subrequests: 5 }, dimensions: { datetime: '2026-10-10T12:34:56Z', status: 'success' } }] }] } }, errors: null }),
      };
    };
    const { rows, timeField } = await fetchRows({ token: 'tok', account: 'a', script: 's', start, end, fetchImpl: fake });
    assert.deepEqual(asked, ['datetimeHour', 'datetime']);
    assert.equal(timeField, 'datetime');
    assert.equal(summarize(rows, { start, end, hours: false, timeField }).buckets[1].requests, 5);

    // Cloudflare's own message is passed on, with what the status usually means.
    const denied = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ errors: [{ code: 10000, message: 'Authentication error' }] }) });
    await assert.rejects(fetchRows({ token: 'bad', account: 'a', script: 's', start, end, fetchImpl: denied }), /401 Unauthorized: Authentication error \(10000\)\. The token was not accepted/);
    const forbidden = async () => ({ ok: false, status: 403, statusText: 'Forbidden', json: async () => { throw new Error('not JSON'); } });
    await assert.rejects(fetchRows({ token: 't', account: 'a', script: 's', start, end, fetchImpl: forbidden }), /403 Forbidden\. The token needs "Account Analytics: Read"/);
    const other = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'quota exceeded' }] }) });
    await assert.rejects(fetchRows({ token: 't', account: 'a', script: 's', start, end, fetchImpl: other }), /quota exceeded/);
    const none = async () => ({ ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [] } } }) });
    await assert.rejects(fetchRows({ token: 't', account: 'a', script: 's', start, end, fetchImpl: none }), /CLOUDFLARE_ACCOUNT_ID/);
  });
});
