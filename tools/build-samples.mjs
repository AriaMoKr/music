#!/usr/bin/env node
// Makes the site's sampled instruments for MIDI songs (SPEC §5.6 "Sounds", media/samples.js) from
// a General MIDI SoundFont: for each of the 128 programs and the standard drum kit, the region
// each key plays at one velocity, its sample cut to what is heard (to its loop's end, a short loop
// repeated until it lasts LOOP_MIN, or at most MAX_SECONDS), encoded as a small mono Ogg Opus
// file named by its content, and a manifest of the zones (keys, root, tuning, loop, loudness,
// volume envelope). Samples shared by programs are encoded once.
//
//   node tools/build-samples.mjs --sf2 GeneralUser-GS.sf2 [--license LICENSE.txt] [--out public/sounds/gm]
//     [--kbps 40] [--velocity 100]
//
// Needs ffmpeg with libopus on the PATH. The set in public/sounds/gm/ is GeneralUser GS v2.0.3
// (S. Christian Collins, https://www.schristiancollins.com; its LICENSE.txt beside it), whose
// license allows its use in software and repackaging it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSf2, presetRegions, regionFor, regionParams } from './sf2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A loop shorter than this (s) is repeated until it is not: a lossy codec's seam then comes round less often. */
export const LOOP_MIN = 0.3;
/** The longest sample kept (s) of one that does not loop: its volume envelope has faded by then. */
export const MAX_SECONDS = 4;
/** The fade (s) at the end of a sample cut short. */
const FADE = 0.08;
/** The drum keys of the standard kit kept (GS: 27–87; General MIDI's are 35–81). */
export const DRUM_KEYS = [27, 87];

const round = (x, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * The frames a region's file holds and its loop in them: [start, …) of the font's data, the loop
 * (frames from the file's start) or null, and whether it was cut short.
 * @returns {{ pcm: Int16Array, loop: [number, number]|null, cut: boolean }}
 */
export function cutSample(data, p) {
  if (p.looped) {
    const head = data.subarray(p.start, p.loopStart);
    const body = data.subarray(p.loopStart, p.loopEnd);
    const times = Math.max(1, Math.ceil((LOOP_MIN * p.rate) / body.length));
    const pcm = new Int16Array(head.length + body.length * times);
    pcm.set(head, 0);
    for (let i = 0; i < times; i++) pcm.set(body, head.length + i * body.length);
    return { pcm, loop: [head.length, pcm.length], cut: false };
  }
  const max = Math.round(MAX_SECONDS * p.rate);
  const length = Math.min(p.end - p.start, max);
  const pcm = data.slice(p.start, p.start + length);
  const cut = p.end - p.start > max;
  if (cut) {
    const fade = Math.min(length, Math.round(FADE * p.rate));
    for (let i = 0; i < fade; i++) pcm[length - fade + i] = Math.round(pcm[length - fade + i] * (1 - (i + 1) / fade));
  }
  return { pcm, loop: null, cut };
}

/** Encodes mono 16-bit PCM as Ogg Opus at `kbps`, through ffmpeg. */
function encodeOpus(pcm, rate, kbps) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-ar', '48000', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio', '-f', 'ogg', 'pipe:1',
  ], { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`ffmpeg: ${r.error.message} (is ffmpeg with libopus on the PATH?)`);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

/**
 * The zones of a preset (bank, program) over `keys`: consecutive keys playing the same region
 * are one zone. Each zone: { lo, hi, params, sampleIndex }.
 */
export function presetZones(sf, bank, program, keys, velocity) {
  const regions = presetRegions(sf, bank, program);
  const zones = [];
  for (let k = keys[0]; k <= keys[1]; k++) {
    const r = regionFor(regions, k, velocity);
    if (!r) continue;
    const params = regionParams(r);
    const id = `${r.sampleIndex}:${params.start}:${params.end}:${params.looped ? `${params.loopStart}:${params.loopEnd}` : ''}`;
    const last = zones.at(-1);
    if (last && last.id === id && last.hi === k - 1 && sameZone(last.params, params)) last.hi = k;
    else zones.push({ lo: k, hi: k, id, params, sampleIndex: r.sampleIndex });
  }
  return zones;
}

/** Whether two regions of one sample play alike (the same tuning, loudness and envelope). */
function sameZone(a, b) {
  return a.root === b.root && a.cents === b.cents && a.scale === b.scale && a.attenuation === b.attenuation
    && a.exclusive === b.exclusive && JSON.stringify(a.env) === JSON.stringify(b.env);
}

/** A zone as the manifest keeps it (defaults left out). */
function zoneEntry(z, file) {
  const p = z.params;
  const e = p.env;
  const entry = { lo: z.lo, hi: z.hi, file: file.name, root: p.root };
  if (p.cents) entry.cents = p.cents;
  if (p.scale !== 1) entry.scale = p.scale;
  if (file.loop) entry.loop = file.loop;
  entry.len = file.len;
  if (p.attenuation) entry.att = p.attenuation;
  entry.env = [round(e.attack), round(e.hold), round(e.decay), e.sustain, round(e.release)];
  if (e.keyToHold) entry.keyToHold = e.keyToHold;
  if (e.keyToDecay) entry.keyToDecay = e.keyToDecay;
  if (p.exclusive) entry.exclusive = p.exclusive;
  return entry;
}

function main(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const sf2 = opt('sf2');
  if (!sf2) {
    console.error('usage: node tools/build-samples.mjs --sf2 <font.sf2> [--license <file>] [--out <dir>] [--kbps 40] [--velocity 100]');
    process.exit(2);
  }
  const out = path.resolve(opt('out', path.join(ROOT, 'public', 'sounds', 'gm')));
  const kbps = Number(opt('kbps', 40));
  const velocity = Number(opt('velocity', 100));
  const license = opt('license');
  const t0 = Date.now();
  const sf = parseSf2(fs.readFileSync(sf2));
  fs.mkdirSync(out, { recursive: true });
  const files = new Map(); // a sample's id → { name, loop, len, bytes }
  const fileFor = (z) => {
    let f = files.get(z.id);
    if (f) return f;
    const { pcm, loop } = cutSample(sf.data, z.params);
    const bytes = encodeOpus(pcm, z.params.rate, kbps);
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.opus`;
    fs.writeFileSync(path.join(out, name), bytes);
    const rate = z.params.rate;
    f = { name, loop: loop ? [round(loop[0] / rate), round(loop[1] / rate)] : null, len: round(pcm.length / rate, 3), bytes: bytes.length };
    files.set(z.id, f);
    return f;
  };
  const programs = {};
  for (let p = 0; p < 128; p++) {
    const zones = presetZones(sf, 0, p, [0, 127], velocity);
    if (zones.length) programs[p] = zones.map((z) => zoneEntry(z, fileFor(z)));
  }
  const drums = {};
  for (const z of presetZones(sf, 128, 0, DRUM_KEYS, velocity)) {
    for (let k = z.lo; k <= z.hi; k++) drums[k] = { ...zoneEntry(z, fileFor(z)), lo: k, hi: k };
  }
  const manifest = {
    version: 1,
    font: sf.name,
    source: 'GeneralUser GS by S. Christian Collins, https://www.schristiancollins.com (its samples cut and re-encoded as Opus: tools/build-samples.mjs)',
    license: license ? 'LICENSE.txt' : null,
    velocity, kbps,
    programs, drums,
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  if (license) fs.copyFileSync(license, path.join(out, 'LICENSE.txt'));
  // Files of an earlier set that this one does not use.
  const used = new Set([...files.values()].map((f) => f.name));
  for (const name of fs.readdirSync(out)) if (name.endsWith('.opus') && !used.has(name)) fs.rmSync(path.join(out, name));
  const bytes = [...files.values()].reduce((s, f) => s + f.bytes, 0);
  const zones = Object.values(programs).reduce((s, z) => s + z.length, 0);
  console.log(`${Object.keys(programs).length} programs (${zones} zones), ${Object.keys(drums).length} drum keys; ${files.size} files, ${(bytes / 1048576).toFixed(2)} MB; manifest ${(fs.statSync(path.join(out, 'manifest.json')).size / 1024).toFixed(0)} KB; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
