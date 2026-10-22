// Sampled instruments for MIDI songs (SPEC §5.6 "Sounds"): the SoundFont reader and the set's
// build (tools/sf2.mjs, tools/build-samples.mjs), the set shipped in public/sounds/gm/, the
// page's bank and a song's voices (media/samples.js), and the synthesizer and player using them.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEN, parseSf2, presetRegions, regionFor, regionParams } from '../tools/sf2.mjs';
import { LOOP_MIN, MAX_SECONDS, cutSample, presetZones } from '../tools/build-samples.mjs';
import { SampleBank, programZones, rateOf, songFiles, zoneAt } from '../public/js/media/samples.js';
import { MidiSynth } from '../public/js/media/synth.js';
import { SoundPlayer } from '../public/js/media/player.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET = path.join(ROOT, 'public', 'sounds', 'gm');
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''}: ${a} ≠ ${b}`);

/**
 * A SoundFont 2 file: samples { name, data: Int16Array, rate, pitch, correction?, loop?: [s, e] },
 * instruments and presets { name, (bank, program,) zones: [[oper, amount | { lo, hi }], …][] }.
 */
function writeSf2({ samples, instruments, presets }) {
  const chunk = (id, body) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'latin1');
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const list = (type, parts) => chunk('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...parts]));
  const name20 = (s) => { const b = Buffer.alloc(20); b.write(s.slice(0, 19), 0, 'latin1'); return b; };
  // Samples, each followed by 46 zero points (as the spec has it).
  const points = [];
  const shdr = [];
  let at = 0;
  for (const s of samples) {
    const h = Buffer.alloc(46);
    name20(s.name).copy(h, 0);
    h.writeUInt32LE(at, 20);
    h.writeUInt32LE(at + s.data.length, 24);
    h.writeUInt32LE(at + (s.loop?.[0] ?? 0), 28);
    h.writeUInt32LE(at + (s.loop?.[1] ?? 0), 32);
    h.writeUInt32LE(s.rate, 36);
    h[40] = s.pitch;
    h.writeInt8(s.correction ?? 0, 41);
    h.writeUInt16LE(1, 44); // mono
    shdr.push(h);
    points.push(...s.data, ...new Array(46).fill(0));
    at += s.data.length + 46;
  }
  shdr.push(Buffer.alloc(46)); // EOS
  const smpl = Buffer.alloc(points.length * 2);
  points.forEach((v, i) => smpl.writeInt16LE(v, 2 * i));
  // Headers, bags and generators (presets and instruments alike).
  const headers = (items, size, write) => {
    const hdr = [];
    const bags = [];
    const gens = [];
    for (const item of items) {
      const h = Buffer.alloc(size);
      write(h, item, bags.length);
      hdr.push(h);
      for (const zone of item.zones) {
        const bag = Buffer.alloc(4);
        bag.writeUInt16LE(gens.length, 0);
        bags.push(bag);
        for (const [oper, v] of zone) {
          const g = Buffer.alloc(4);
          g.writeUInt16LE(oper, 0);
          if (typeof v === 'object') { g[2] = v.lo; g[3] = v.hi; } else g.writeInt16LE(v, 2);
          gens.push(g);
        }
      }
    }
    const end = Buffer.alloc(size);
    write(end, { name: 'EO', bank: 0, program: 0 }, bags.length);
    hdr.push(end);
    const bagEnd = Buffer.alloc(4);
    bagEnd.writeUInt16LE(gens.length, 0);
    bags.push(bagEnd);
    gens.push(Buffer.alloc(4));
    return { hdr: Buffer.concat(hdr), bags: Buffer.concat(bags), gens: Buffer.concat(gens) };
  };
  const p = headers(presets, 38, (h, x, bag) => { name20(x.name).copy(h, 0); h.writeUInt16LE(x.program, 20); h.writeUInt16LE(x.bank, 22); h.writeUInt16LE(bag, 24); });
  const i = headers(instruments, 22, (h, x, bag) => { name20(x.name).copy(h, 0); h.writeUInt16LE(bag, 20); });
  const body = Buffer.concat([
    Buffer.from('sfbk', 'latin1'),
    list('INFO', [chunk('ifil', Buffer.from([2, 0, 4, 0])), chunk('INAM', Buffer.from('Test Font\0', 'latin1'))]),
    list('sdta', [chunk('smpl', smpl)]),
    list('pdta', [chunk('phdr', p.hdr), chunk('pbag', p.bags), chunk('pmod', Buffer.alloc(10)), chunk('pgen', p.gens),
      chunk('inst', i.hdr), chunk('ibag', i.bags), chunk('imod', Buffer.alloc(10)), chunk('igen', i.gens), chunk('shdr', Buffer.concat(shdr))]),
  ]);
  return chunk('RIFF', body);
}

const ramp = (n) => Int16Array.from({ length: n }, (_, k) => (k % 200) * 100 - 10000);

describe('the SoundFont reader (tools/sf2.mjs)', () => {
  const font = () => parseSf2(writeSf2({
    samples: [
      { name: 'low', data: ramp(4000), rate: 32000, pitch: 48, correction: -5, loop: [1000, 1100] },
      { name: 'high', data: ramp(4000), rate: 32000, pitch: 72 },
      { name: 'strike', data: ramp(500), rate: 32000, pitch: 60 },
    ],
    instruments: [{
      name: 'Inst',
      zones: [
        [[GEN.releaseVolEnv, 0], [GEN.initialAttenuation, 100]], // global: the defaults
        [[GEN.keyRange, { lo: 0, hi: 59 }], [GEN.sampleModes, 1], [GEN.sampleID, 0]],
        [[GEN.keyRange, { lo: 60, hi: 127 }], [GEN.initialAttenuation, 40], [GEN.sampleID, 1]],
        [[GEN.keyRange, { lo: 55, hi: 65 }], [GEN.initialAttenuation, 400], [GEN.sampleID, 2]], // a quieter layer
      ],
    }],
    presets: [{ name: 'Piano', bank: 0, program: 0, zones: [[[GEN.coarseTune, 1], [GEN.initialAttenuation, 20], [GEN.instrument, 0]]] }],
  }));

  it('reads the headers, the global zone as the defaults and the preset\'s generators added', () => {
    const sf = font();
    assert.equal(sf.name, 'Test Font');
    assert.deepEqual(sf.samples.map((s) => s.name), ['low', 'high', 'strike']);
    const regions = presetRegions(sf, 0, 0);
    assert.equal(regions.length, 3);
    const low = regionParams(regions[0]);
    assert.equal(low.looped, true);
    assert.equal(low.loopEnd - low.loopStart, 100);
    assert.equal(low.root, 48);
    assert.equal(low.cents, 100 - 5, 'the preset\'s coarse tune and the sample\'s correction');
    assert.equal(low.attenuation, 100 + 20, 'the global zone\'s, plus the preset\'s');
    near(low.env.release, 1, 'timecents 0 is a second');
    const high = regionParams(regions[1]);
    assert.equal(high.looped, false);
    assert.equal(high.attenuation, 40 + 20, 'its own, not the global zone\'s, plus the preset\'s');
    assert.deepEqual(presetRegions(sf, 0, 1), [], 'no such preset');
  });

  it('plays a key with the loudest layer that holds it', () => {
    const regions = presetRegions(font(), 0, 0);
    assert.equal(regionFor(regions, 30, 100).sample.name, 'low');
    assert.equal(regionFor(regions, 57, 100).sample.name, 'low', 'not the quieter strike over it');
    assert.equal(regionFor(regions, 62, 100).sample.name, 'high');
  });

  it('makes zones of the keys a region plays, cuts samples to what is heard', () => {
    const sf = font();
    const zones = presetZones(sf, 0, 0, [0, 127], 100);
    assert.deepEqual(zones.map((z) => [z.lo, z.hi]), [[0, 59], [60, 127]]);
    // A short loop repeated until it lasts LOOP_MIN, the head kept.
    const looped = cutSample(sf.data, zones[0].params);
    const body = 100;
    const times = Math.ceil((LOOP_MIN * 32000) / body);
    assert.deepEqual(looped.loop, [1000, 1000 + body * times]);
    assert.equal(looped.pcm.length, 1000 + body * times);
    assert.deepEqual([...looped.pcm.subarray(1000 + body, 1000 + 2 * body)], [...sf.data.subarray(1000, 1100)]);
    // One that does not loop: whole, or at most MAX_SECONDS, faded at the end.
    const once = cutSample(sf.data, zones[1].params);
    assert.equal(once.loop, null);
    assert.equal(once.pcm.length, 4000);
    const long = cutSample(new Int16Array(400000).fill(1000), { ...zones[1].params, start: 0, end: 400000, rate: 32000 });
    assert.equal(long.pcm.length, MAX_SECONDS * 32000);
    assert.equal(long.cut, true);
    assert.equal(long.pcm.at(-1), 0, 'faded out');
  });
});

describe('the sample set shipped (public/sounds/gm)', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SET, 'manifest.json'), 'utf8'));
  const files = new Set(fs.readdirSync(SET));

  it('has every General MIDI program, every key of each, and the standard kit\'s drums', () => {
    for (let p = 0; p < 128; p++) {
      const zones = manifest.programs[p];
      assert.ok(zones?.length, `program ${p}`);
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        assert.ok(z.lo <= z.hi, `program ${p} zone ${i}`);
        if (i) assert.equal(z.lo, zones[i - 1].hi + 1, `program ${p}: zones in key order, without gaps`);
        assert.equal(z.env.length, 5);
        assert.ok(z.len > 0);
        if (z.loop) assert.ok(z.loop[0] >= 0 && z.loop[1] > z.loop[0] && z.loop[1] <= z.len + 1e-3, `program ${p} zone ${i}'s loop`);
      }
    }
    for (let k = 35; k <= 81; k++) assert.ok(manifest.drums[k], `drum ${k}`);
  });

  it('names files that are there, small, with the font\'s license beside them', () => {
    const named = new Set([...Object.values(manifest.programs).flat(), ...Object.values(manifest.drums)].map((z) => z.file));
    let bytes = 0;
    for (const f of named) {
      assert.ok(files.has(f), f);
      bytes += fs.statSync(path.join(SET, f)).size;
    }
    const opus = [...files].filter((f) => f.endsWith('.opus'));
    assert.equal(opus.length, named.size, 'no file left over from an earlier set');
    assert.ok(bytes < 8 << 20, `${(bytes / 1048576).toFixed(1)} MB`);
    assert.ok(files.has('LICENSE.txt'));
    assert.match(fs.readFileSync(path.join(SET, 'LICENSE.txt'), 'utf8'), /GeneralUser GS/);
  });
});

describe('a song\'s sampled voices (media/samples.js)', () => {
  const z = (lo, hi, file, extra = {}) => ({ lo, hi, file, root: Math.round((lo + hi) / 2), len: 1, env: [0, 0, 0, 0, 0.3], ...extra });
  const manifest = {
    programs: { 0: [z(0, 59, 'p-low'), z(60, 127, 'p-high')], 40: [z(0, 127, 'violin')], 48: [z(0, 127, 'strings')] },
    drums: { 36: z(36, 36, 'kick', { scale: 0 }), 42: z(42, 42, 'hat', { exclusive: 1 }), 46: z(46, 46, 'open-hat', { exclusive: 1 }) },
  };

  it('finds a program\'s zones (its family\'s where the set has none), a key\'s zone and its rate', () => {
    assert.equal(programZones(manifest, 0), manifest.programs[0]);
    assert.equal(programZones(manifest, 44), manifest.programs[40], 'tremolo strings: the first of its family that has zones');
    assert.equal(programZones(manifest, 120), null);
    assert.equal(zoneAt(manifest.programs[0], 30).file, 'p-low');
    assert.equal(zoneAt(manifest.programs[0], 60).file, 'p-high');
    const gappy = [z(10, 20, 'a'), z(40, 50, 'b')];
    assert.equal(zoneAt(gappy, 25).file, 'a');
    assert.equal(zoneAt(gappy, 35).file, 'b');
    assert.equal(zoneAt(gappy, 0).file, 'a');
    assert.equal(zoneAt(gappy, 99).file, 'b');
    near(rateOf({ root: 60 }, 60), 1);
    near(rateOf({ root: 60 }, 72), 2, 'an octave up');
    near(rateOf({ root: 60, cents: -100 }, 61), 1, 'its tuning');
    near(rateOf({ root: 60 }, 60, 1200), 2, 'a bend');
    near(rateOf({ root: 36, scale: 0 }, 50), 1, 'a drum: one pitch whatever the key');
  });

  it('lists only the files a song\'s notes play', () => {
    const song = { notes: [{ ch: 0, key: 30, program: 0 }, { ch: 1, key: 64, program: 40 }, { ch: 9, key: 36, program: 0 }] };
    assert.deepEqual([...songFiles(manifest, song)].sort(), ['kick', 'p-low', 'violin']);
    assert.ok(songFiles(manifest, song, { transpose: 30 }).has('p-high'), 'its key changed');
    assert.ok(songFiles(manifest, song, { programs: new Map([[1, 48]]) }).has('strings'), 'a part given another instrument');
    assert.equal(songFiles(null, song).size, 0);
  });

  /** A bank over the manifest above, its fetches counted, its buffers fake. */
  const bank = ({ fail = new Set(), budget } = {}) => {
    const fetched = [];
    const b = new SampleBank({
      url: 'https://site.test/sounds/gm/',
      budget,
      fetch: async (url) => {
        fetched.push(url.replace('https://site.test/sounds/gm/', ''));
        if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
        if (fail.has(url.split('/').pop())) return { ok: false };
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      },
      decode: async () => ({ length: 1000, numberOfChannels: 1 }),
    });
    return { b, fetched };
  };

  it('loads a song\'s files once, and plays a note from the nearest zone loaded', async () => {
    const { b, fetched } = bank();
    const song = { notes: [{ ch: 0, key: 30, program: 0 }, { ch: 0, key: 31, program: 0 }, { ch: 9, key: 36, program: 0 }] };
    const v = b.voices({}, song);
    await v.ready;
    assert.deepEqual(fetched.sort(), ['kick', 'manifest.json', 'p-low']);
    assert.equal(v.tone(0, 30).zone.file, 'p-low');
    assert.equal(v.tone(0, 90).zone.file, 'p-low', 'its zone not loaded: the nearest that is');
    assert.equal(v.drum(36).zone.file, 'kick');
    assert.equal(v.drum(42), null, 'not loaded: the oscillators');
    assert.equal(v.tone(40, 60), null, 'a program none of whose files is loaded');
    await v.prepare({ programs: new Map([[0, 40]]) });
    assert.ok(v.tone(40, 60), 'loaded once asked for');
    const again = b.voices({}, song);
    assert.equal(again.tone(0, 30)?.zone.file, 'p-low', 'another song plays what is kept at once, before it is ready');
    await again.ready;
    assert.equal(fetched.filter((f) => f === 'p-low').length, 1, 'not fetched again');
    assert.equal(fetched.filter((f) => f === 'manifest.json').length, 1);
  });

  it('keeps at most its budget, the least recently used let go; a file it cannot have plays the oscillators', async () => {
    const { b } = bank({ budget: 8000, fail: new Set(['violin']) }); // two buffers of 4,000 bytes
    await b.voices({}, { notes: [{ ch: 0, key: 30, program: 0 }, { ch: 0, key: 90, program: 0 }] }).ready;
    b.buffer('p-low'); // used: kept
    await b.voices({}, { notes: [{ ch: 9, key: 36, program: 0 }] }).ready;
    assert.ok(b.buffer('p-low') && b.buffer('kick'));
    assert.equal(b.buffer('p-high'), undefined, 'the least recently used');
    const v = b.voices({}, { notes: [{ ch: 1, key: 60, program: 40 }] });
    await v.ready;
    assert.equal(v.tone(40, 60), null);
  });

  it('plays every song with the oscillators when the site has no set', async () => {
    const b = new SampleBank({ url: 'https://site.test/x/', fetch: async () => ({ ok: false }) });
    const v = b.voices({}, { notes: [{ ch: 0, key: 60, program: 0 }] });
    await v.ready;
    assert.equal(v.tone(0, 60), null);
    assert.equal(v.drum(36), null);
  });
});

/** A fake audio context recording the nodes made (as test/media.test.js's). */
function fakeContext() {
  const param = (value = 0) => ({ value, events: [],
    setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); return this; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; } });
  const ctx = { currentTime: 0, sampleRate: 48000, state: 'running', destination: {}, made: [] };
  const node = (kind, fields = {}) => {
    const n = { kind, ...fields, starts: [], stops: [], connect: (to) => to, disconnect() {}, start(t) { this.starts.push(t); }, stop(t) { this.stops.push(t); } };
    ctx.made.push(n);
    return n;
  };
  Object.assign(ctx, {
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0) }),
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createBufferSource: () => node('buffer', { buffer: null, playbackRate: param(1), loop: false, loopStart: 0, loopEnd: 0 }),
    createBuffer: (channels, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    createStereoPanner: () => node('pan', { pan: param(0) }),
    createDynamicsCompressor: () => node('comp', { threshold: param(), knee: param(), ratio: param() }),
  });
  return ctx;
}

describe('the synthesizer with sampled voices (media/synth.js)', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());
  const note = (t, key = 60, d = 0.4, more = {}) => ({ t, d, ch: 0, key, gain: 1, program: 0, pan: 0, bend: 0, ...more });
  const buffer = { length: 32000, numberOfChannels: 1, duration: 1 };
  /** Voices that have a sample for program 0 and drums 42 and 46 (one exclusive class), and nothing else. */
  const voices = () => {
    const hit = { zone: null, buffer };
    const piano = { lo: 0, hi: 127, file: 'p', root: 60, loop: [0.5, 0.8], len: 1, att: 200, env: [0.01, 0, 2, 1000, 0.3] };
    const drums = { 42: { lo: 42, hi: 42, file: 'h', root: 42, scale: 0, len: 0.2, env: [0, 0, 0, 0, 0.1], exclusive: 1 }, 46: { lo: 46, hi: 46, file: 'o', root: 46, scale: 0, len: 1.5, env: [0, 0, 0, 0, 0.1], exclusive: 1 } };
    return {
      prepared: [],
      tone(program, key) { return program === 0 ? Object.assign(hit, { zone: piano }) : null; },
      drum(key) { return drums[key] ? Object.assign(hit, { zone: drums[key] }) : null; },
      prepare(o) { this.prepared.push(o); return Promise.resolve(); },
    };
  };
  const sources = (ctx) => ctx.made.filter((n) => n.kind === 'buffer');
  const oscs = (ctx) => ctx.made.filter((n) => n.kind === 'osc');

  it('plays a note by its sample, at the rate its key needs, held by its loop, the oscillators where it has none', () => {
    const ctx = fakeContext();
    const s = voices();
    const synth = new MidiSynth(ctx, { notes: [note(0, 72, 0.4, { bend: 100 }), note(0.1, 60, 0.4, { program: 40 })], duration: 1 }, { samples: s });
    synth.play();
    const [src] = sources(ctx);
    near(src.playbackRate.value, 2 ** (13 / 12), 'an octave and a semitone (the bend) up');
    assert.equal(src.loop, true);
    assert.deepEqual([src.loopStart, src.loopEnd], [0.5, 0.8]);
    near(src.stops[0], 0.05 + 0.4 + 0.3 * 0.6 + 0.01, 'let go when its release has fallen 60 dB');
    assert.equal(oscs(ctx).length, 1, 'the violin: no sample, the oscillator');
  });

  it('plays a drum out, an exclusive class cutting the others of it (the hi-hats)', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0, 46, 0.05, { ch: 9 }), note(0.2, 42, 0.05, { ch: 9 })], duration: 1 }, { samples: voices() });
    synth.play();
    const [open, closed] = sources(ctx);
    near(open.playbackRate.value, 1);
    assert.ok(open.stops.length === 2 && open.stops[1] < 0.05 + 0.2 + 0.07, 'the open hi-hat cut short by the closed one');
    near(closed.stops[0], 0.05 + 0.2 + 0.2 + 0.01, 'played out: not its note-off, its sample\'s end');
  });

  it('changes to the oscillators and back at once, and loads what another key or instrument needs', () => {
    const ctx = fakeContext();
    const s = voices();
    const synth = new MidiSynth(ctx, { notes: [note(0), note(2)], duration: 3 }, { samples: s });
    synth.play();
    assert.equal(sources(ctx).length, 1);
    synth.setSamples(null);
    assert.equal(synth.samples, null);
    synth.setTranspose(3);
    synth.setProgram(0, 48);
    synth.setSamples(s);
    assert.deepEqual(s.prepared.at(-1), { transpose: 3, programs: new Map([[0, 48]]) });
  });
});

describe('the player and the instruments chosen (media/player.js)', () => {
  const midi = Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0, 0x90, 60, 100, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
  ]);
  const media = { src: '/zim/x/C/a.mid', name: 'a.mid', mime: 'audio/midi' };

  it('plays a song with its sampled voices once they are ready, or with the oscillators', async () => {
    const ctx = fakeContext();
    const asked = [];
    const samples = { voices: (c, song) => { asked.push(song.notes.length); return { ready: Promise.resolve(), tone: () => null, drum: () => null, prepare: () => Promise.resolve() }; } };
    let kind = 'sampled';
    const player = new SoundPlayer({ context: () => ctx, bytes: async () => midi, url: async () => ({}), samples, instruments: () => kind });
    await player.play(media);
    assert.equal(player.state, 'playing');
    assert.deepEqual(asked, [1]);
    assert.ok(player.synth.samples, 'with its voices');
    player.setInstruments('synth');
    assert.equal(player.synth.samples, null, 'the oscillators, at once');
    player.setInstruments('sampled');
    assert.ok(player.synth.samples);
    player.stop();
    kind = 'synth';
    await player.play(media);
    assert.equal(player.synth.samples, null, 'a song started with the synth chosen');
    player.stop();
  });
});
