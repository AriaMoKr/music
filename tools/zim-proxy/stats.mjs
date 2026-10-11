#!/usr/bin/env node
// Requests to the edge proxy (this folder's Cloudflare Worker) per day or hour, from Cloudflare's
// GraphQL Analytics API: how much of the site's reading of web ZIMs goes through it. Every read
// of a book or an article is a request (a book opens with dozens), so this measures activity,
// not visitors; the demo set never goes through the proxy.
//
// Needs an API token with "Account Analytics: Read" and the account's ID in the environment, under
// wrangler's names; type the token in hidden, not on the command line (shell history):
//   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=<id>
//   node tools/zim-proxy/stats.mjs [options]
//
//   --days <n>      how far back (default 7)
//   --hours         per hour instead of per day
//   --script <name> the Worker (default: the name in wrangler.toml)
//   --json          the table as JSON

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

/** The Worker's name from wrangler.toml (`name = "…"`). */
export function workerName(toml) {
  return /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
}

/**
 * The GraphQL query: requests, errors and subrequests of one Worker between two times, grouped by
 * `timeField` (a dimension: datetimeHour, or datetime where that is missing) and status.
 */
export function statsQuery({ account, script, start, end, timeField }) {
  const s = JSON.stringify;
  return `{
  viewer {
    accounts(filter: { accountTag: ${s(account)} }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { scriptName: ${s(script)}, datetime_geq: ${s(start)}, datetime_leq: ${s(end)} }
        orderBy: [${timeField}_ASC]
      ) {
        sum { requests errors subrequests }
        dimensions { ${timeField} status }
      }
    }
  }
}`;
}

/** The bucket a row's time falls in, in UTC: "2026-10-11" per day, "2026-10-11 05:00" per hour. */
export function bucketOf(time, hours) {
  const iso = new Date(time).toISOString();
  return hours ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00` : iso.slice(0, 10);
}

/** Every bucket from start to end (so quiet days show as 0). */
export function bucketsBetween(start, end, hours) {
  const step = hours ? 3600e3 : 86400e3;
  const first = new Date(start);
  if (hours) first.setUTCMinutes(0, 0, 0);
  else first.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let t = first.getTime(); t <= new Date(end).getTime(); t += step) out.push(bucketOf(t, hours));
  return out;
}

/**
 * Rows (one per time and status) summed per bucket, every bucket of the range present, plus the
 * totals and the requests per status (success, clientDisconnected, scriptThrewException, …).
 */
export function summarize(rows, { start, end, hours, timeField }) {
  const per = new Map(bucketsBetween(start, end, hours).map((b) => [b, { requests: 0, errors: 0, subrequests: 0 }]));
  const total = { requests: 0, errors: 0, subrequests: 0 };
  const statuses = {};
  for (const row of rows) {
    const b = bucketOf(row.dimensions[timeField], hours);
    const into = per.get(b) ?? per.set(b, { requests: 0, errors: 0, subrequests: 0 }).get(b);
    for (const k of ['requests', 'errors', 'subrequests']) {
      into[k] += row.sum[k] ?? 0;
      total[k] += row.sum[k] ?? 0;
    }
    const status = row.dimensions.status ?? 'unknown';
    statuses[status] = (statuses[status] ?? 0) + (row.sum.requests ?? 0);
  }
  return { buckets: [...per].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bucket, v]) => ({ bucket, ...v })), total, statuses };
}

/** A GraphQL error that means the field does not exist in this dataset (try the next one). */
const unknownField = (errors) => errors?.some((e) => /unknown field|cannot query field|unknown argument|not defined|enum/i.test(e.message));

/**
 * Asks Cloudflare, trying datetimeHour first and datetime where that dimension is missing.
 * @returns {Promise<{ rows: object[], timeField: string }>}
 */
export async function fetchRows({ token, account, script, start, end, fetchImpl = fetch }) {
  let lastErrors = null;
  for (const timeField of ['datetimeHour', 'datetime']) {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: statsQuery({ account, script, start, end, timeField }) }),
    });
    if (!res.ok) {
      // Cloudflare's own words, when the answer has them ({ errors: [{ code, message }] }).
      const said = await res.json().then((b) => (b?.errors ?? []).map((e) => `${e.message}${e.code ? ` (${e.code})` : ''}`).join('; '), () => '');
      const hint = res.status === 401 ? ' The token was not accepted: an API token (not the Global API Key), copied whole, without spaces or line ends.'
        : res.status === 403 ? ' The token needs "Account Analytics: Read" on this account, or the account ID is not one the token covers.' : '';
      throw new Error(`Cloudflare said ${res.status} ${res.statusText}${said ? `: ${said}` : ''}.${hint}`);
    }
    const body = await res.json();
    if (body.errors?.length) {
      lastErrors = body.errors;
      if (unknownField(body.errors)) continue;
      throw new Error(`Cloudflare: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    const accounts = body.data?.viewer?.accounts ?? [];
    if (!accounts.length) throw new Error('No such account for this token (check CLOUDFLARE_ACCOUNT_ID).');
    return { rows: accounts[0].workersInvocationsAdaptive ?? [], timeField };
  }
  throw new Error(`Cloudflare: ${lastErrors.map((e) => e.message).join('; ')}`);
}

/** The summary as text: a line per bucket, then the totals and the statuses. */
export function formatTable(summary, { script, start, end, hours }) {
  const n = (v) => v.toLocaleString('en-US');
  const w = hours ? 16 : 10;
  const lines = [
    `${script}: ${start.slice(0, 10)} to ${end.slice(0, 10)} (UTC), per ${hours ? 'hour' : 'day'}`,
    `${(hours ? 'hour' : 'day').padEnd(w)}  ${'requests'.padStart(10)}  ${'errors'.padStart(8)}  ${'subrequests'.padStart(11)}`,
  ];
  for (const b of summary.buckets) {
    if (hours && !b.requests) continue; // quiet hours would drown the busy ones
    lines.push(`${b.bucket.padEnd(w)}  ${n(b.requests).padStart(10)}  ${n(b.errors).padStart(8)}  ${n(b.subrequests).padStart(11)}`);
  }
  const t = summary.total;
  lines.push(`${'total'.padEnd(w)}  ${n(t.requests).padStart(10)}  ${n(t.errors).padStart(8)}  ${n(t.subrequests).padStart(11)}`);
  const statuses = Object.entries(summary.statuses).sort((a, b) => b[1] - a[1]);
  if (statuses.length) lines.push(`by status: ${statuses.map(([s, v]) => `${s} ${n(v)}`).join(', ')}`);
  return lines.join('\n');
}

async function main() {
  const { values: opts } = parseArgs({
    options: {
      days: { type: 'string', default: '7' }, hours: { type: 'boolean' }, script: { type: 'string' },
      json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (opts.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  // Trimmed: a pasted value can bring a space or a line end along, and the token is then refused.
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) {
    console.error('Set CLOUDFLARE_API_TOKEN (a token with "Account Analytics: Read") and CLOUDFLARE_ACCOUNT_ID in the environment first.');
    process.exitCode = 2;
    return;
  }
  const script = opts.script ?? workerName(fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8'));
  const days = Math.max(1, Number(opts.days) || 7);
  const end = new Date().toISOString();
  const start = new Date(Date.now() - days * 86400e3).toISOString();
  const hours = !!opts.hours;
  const { rows, timeField } = await fetchRows({ token, account, script, start, end });
  const summary = summarize(rows, { start, end, hours, timeField });
  console.log(opts.json ? JSON.stringify({ script, start, end, per: hours ? 'hour' : 'day', ...summary }, null, 2)
    : formatTable(summary, { script, start, end, hours }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
