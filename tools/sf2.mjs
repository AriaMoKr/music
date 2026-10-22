// Reads a SoundFont 2 file (RIFF sfbk: its sample data and its preset, instrument and sample
// headers) and resolves a preset into regions: a sample, the keys and velocities it plays, its
// root key and tuning, loop and volume envelope, with the instrument's generators (its global
// zone the defaults) and the preset's added to them, as the SoundFont 2.04 spec has it. Modulators
// are not read (their defaults, velocity to loudness and the like, are the player's concern).
// Node only: tools/build-samples.mjs makes the site's sample set from it.

/** Generators read, by number (SoundFont 2.04, section 8.1.2). */
export const GEN = Object.freeze({
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4, initialFilterFc: 8, initialFilterQ: 9, endAddrsCoarseOffset: 12, pan: 17,
  delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38,
  keynumToVolEnvHold: 39, keynumToVolEnvDecay: 40, instrument: 41, keyRange: 43, velRange: 44,
  startloopAddrsCoarseOffset: 45, initialAttenuation: 48, endloopAddrsCoarseOffset: 50, coarseTune: 51,
  fineTune: 52, sampleID: 53, sampleModes: 54, scaleTuning: 56, exclusiveClass: 57, overridingRootKey: 58,
});

/** Generators whose value is a range (lo, hi bytes), not a signed amount. */
const RANGES = new Set([GEN.keyRange, GEN.velRange]);
/** Instrument-level only: a preset zone's value for these is ignored (2.04, 8.5). */
const INSTRUMENT_ONLY = new Set([
  GEN.startAddrsOffset, GEN.endAddrsOffset, GEN.startloopAddrsOffset, GEN.endloopAddrsOffset,
  GEN.startAddrsCoarseOffset, GEN.endAddrsCoarseOffset, GEN.startloopAddrsCoarseOffset,
  GEN.endloopAddrsCoarseOffset, GEN.sampleModes, GEN.exclusiveClass, GEN.overridingRootKey,
]);
/** The defaults of the generators read (2.04, 8.1.3). */
const DEFAULTS = Object.freeze({
  [GEN.initialFilterFc]: 13500, [GEN.delayVolEnv]: -12000, [GEN.attackVolEnv]: -12000,
  [GEN.holdVolEnv]: -12000, [GEN.decayVolEnv]: -12000, [GEN.releaseVolEnv]: -12000,
  [GEN.scaleTuning]: 100, [GEN.overridingRootKey]: -1,
});

/** sampleType bits (2.04, 7.10). */
export const SAMPLE_TYPE = Object.freeze({ mono: 1, right: 2, left: 4, linked: 8, rom: 0x8000 });

const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const name20 = (b, at) => {
  let s = '';
  for (let i = 0; i < 20 && b[at + i]; i++) s += String.fromCharCode(b[at + i]);
  return s.trim();
};

/**
 * The chunks of a RIFF list's body: { id → [bytes] } (lists by their type: 'LIST:pdta').
 * @param {Buffer} b
 */
function chunks(b, from, to) {
  const out = new Map();
  for (let at = from; at + 8 <= to;) {
    const id = fourcc(b, at);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    const key = id === 'LIST' ? `LIST:${fourcc(b, body)}` : id;
    out.set(key, { start: id === 'LIST' ? body + 4 : body, end: body + size });
    at = body + size + (size & 1);
  }
  return out;
}

/**
 * Reads a SoundFont 2 file.
 * @param {Buffer} b the whole file
 * @returns {{ name: string, presets: object[], instruments: object[], samples: object[], data: Int16Array }}
 */
export function parseSf2(b) {
  if (fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'sfbk') throw new Error('not a SoundFont 2 file (no RIFF sfbk)');
  const top = chunks(b, 12, Math.min(b.length, 8 + b.readUInt32LE(4)));
  const info = top.get('LIST:INFO');
  const sdta = top.get('LIST:sdta');
  const pdta = top.get('LIST:pdta');
  if (!sdta || !pdta) throw new Error('a SoundFont without its sample data or headers');
  let name = '';
  if (info) {
    const inam = chunks(b, info.start, info.end).get('INAM');
    if (inam) name = b.toString('latin1', inam.start, inam.end).replace(/\0.*$/s, '').trim();
  }
  const smpl = chunks(b, sdta.start, sdta.end).get('smpl');
  if (!smpl) throw new Error('a SoundFont without samples (no smpl chunk)');
  // 16-bit little-endian samples; copied, since the chunk need not be 2-byte aligned in the buffer.
  const data = new Int16Array((smpl.end - smpl.start) >> 1);
  for (let i = 0; i < data.length; i++) data[i] = b.readInt16LE(smpl.start + 2 * i);
  const p = chunks(b, pdta.start, pdta.end);
  const records = (id, size, read) => {
    const c = p.get(id);
    if (!c) throw new Error(`a SoundFont without its ${id} chunk`);
    const out = [];
    for (let at = c.start; at + size <= c.end; at += size) out.push(read(at));
    return out;
  };
  const phdr = records('phdr', 38, (at) => ({ name: name20(b, at), program: b.readUInt16LE(at + 20), bank: b.readUInt16LE(at + 22), bag: b.readUInt16LE(at + 24) }));
  const bag = (id) => records(id, 4, (at) => ({ gen: b.readUInt16LE(at) }));
  const gen = (id) => records(id, 4, (at) => {
    const oper = b.readUInt16LE(at);
    return RANGES.has(oper) ? { oper, lo: b[at + 2], hi: b[at + 3] } : { oper, amount: b.readInt16LE(at + 2) };
  });
  const pbag = bag('pbag');
  const pgen = gen('pgen');
  const inst = records('inst', 22, (at) => ({ name: name20(b, at), bag: b.readUInt16LE(at + 20) }));
  const ibag = bag('ibag');
  const igen = gen('igen');
  const samples = records('shdr', 46, (at) => ({
    name: name20(b, at), start: b.readUInt32LE(at + 20), end: b.readUInt32LE(at + 24),
    loopStart: b.readUInt32LE(at + 28), loopEnd: b.readUInt32LE(at + 32), rate: b.readUInt32LE(at + 36),
    pitch: b[at + 40], correction: b.readInt8(at + 41), link: b.readUInt16LE(at + 42), type: b.readUInt16LE(at + 44),
  })).slice(0, -1); // the last is the terminal EOS
  /** The zones of headers [i, i+1): each its generators as a Map (oper → amount or { lo, hi }). */
  const zonesOf = (headers, bags, gens, i) => {
    const zones = [];
    for (let z = headers[i].bag; z < headers[i + 1].bag; z++) {
      const m = new Map();
      for (let g = bags[z].gen; g < bags[z + 1].gen; g++) m.set(gens[g].oper, RANGES.has(gens[g].oper) ? { lo: gens[g].lo, hi: gens[g].hi } : gens[g].amount);
      zones.push(m);
    }
    return zones;
  };
  const instruments = inst.slice(0, -1).map((h, i) => ({ name: h.name, zones: zonesOf(inst, ibag, igen, i) }));
  const presets = phdr.slice(0, -1).map((h, i) => ({ name: h.name, bank: h.bank, program: h.program, zones: zonesOf(phdr, pbag, pgen, i) }));
  return { name, presets, instruments, samples, data };
}

/** A zone that is the global one: the first, without the generator that ends every other. */
const globalZone = (zones, last) => (zones.length && !zones[0].has(last) ? zones[0] : null);

const range = (v) => v ?? { lo: 0, hi: 127 };
const overlap = (a, b) => ({ lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi) });

/**
 * A preset's regions, resolved: each an instrument zone under a preset zone, its generators the
 * instrument's (its global zone's where the zone has none, else the defaults) plus the preset
 * zone's (its global zone's where it has none) for those that add up.
 * @returns {Array<{ keys: {lo, hi}, vels: {lo, hi}, sample: object, sampleIndex: number, gen: (oper: number) => number }>}
 */
export function presetRegions(sf, bank, program) {
  const preset = sf.presets.find((p) => p.bank === bank && p.program === program);
  if (!preset) return [];
  const pGlobal = globalZone(preset.zones, GEN.instrument);
  const regions = [];
  for (const pz of preset.zones) {
    if (pz === pGlobal || !pz.has(GEN.instrument)) continue;
    const ins = sf.instruments[pz.get(GEN.instrument)];
    if (!ins) continue;
    const iGlobal = globalZone(ins.zones, GEN.sampleID);
    const pKeys = range(pz.get(GEN.keyRange) ?? pGlobal?.get(GEN.keyRange));
    const pVels = range(pz.get(GEN.velRange) ?? pGlobal?.get(GEN.velRange));
    for (const iz of ins.zones) {
      if (iz === iGlobal || !iz.has(GEN.sampleID)) continue;
      const keys = overlap(pKeys, range(iz.get(GEN.keyRange) ?? iGlobal?.get(GEN.keyRange)));
      const vels = overlap(pVels, range(iz.get(GEN.velRange) ?? iGlobal?.get(GEN.velRange)));
      if (keys.lo > keys.hi || vels.lo > vels.hi) continue;
      const sampleIndex = iz.get(GEN.sampleID);
      const sample = sf.samples[sampleIndex];
      if (!sample) continue;
      const gen = (oper) => {
        const own = iz.get(oper) ?? iGlobal?.get(oper) ?? DEFAULTS[oper] ?? 0;
        if (INSTRUMENT_ONLY.has(oper)) return own;
        return own + (pz.get(oper) ?? pGlobal?.get(oper) ?? 0);
      };
      regions.push({ keys, vels, sample, sampleIndex, gen });
    }
  }
  return regions;
}

/** Timecents to seconds. */
export const seconds = (tc) => 2 ** (tc / 1200);

/**
 * What a region plays, in the units the site's sample set keeps: its sample's frames (absolute,
 * in the file's data), its loop, root key and tuning, loudness, volume envelope and filter.
 */
export function regionParams(r) {
  const s = r.sample;
  const g = r.gen;
  const start = s.start + g(GEN.startAddrsOffset) + 32768 * g(GEN.startAddrsCoarseOffset);
  const end = s.end + g(GEN.endAddrsOffset) + 32768 * g(GEN.endAddrsCoarseOffset);
  const loopStart = s.loopStart + g(GEN.startloopAddrsOffset) + 32768 * g(GEN.startloopAddrsCoarseOffset);
  const loopEnd = s.loopEnd + g(GEN.endloopAddrsOffset) + 32768 * g(GEN.endloopAddrsCoarseOffset);
  const mode = g(GEN.sampleModes) & 3;
  const looped = (mode === 1 || mode === 3) && loopEnd > loopStart + 1 && loopStart >= start && loopEnd <= end;
  const rootKey = g(GEN.overridingRootKey) >= 0 ? g(GEN.overridingRootKey) : s.pitch <= 127 ? s.pitch : 60;
  return {
    start, end, loopStart, loopEnd, looped, rate: s.rate,
    root: rootKey, scale: g(GEN.scaleTuning) / 100,
    cents: g(GEN.coarseTune) * 100 + g(GEN.fineTune) + s.correction,
    attenuation: Math.max(0, g(GEN.initialAttenuation)), // cB
    filterFc: g(GEN.initialFilterFc), // absolute cents (8.176 Hz × 2^(fc/1200)); 13500 and up: none
    exclusive: g(GEN.exclusiveClass),
    env: {
      attack: seconds(g(GEN.attackVolEnv)), hold: seconds(g(GEN.holdVolEnv)), decay: seconds(g(GEN.decayVolEnv)),
      sustain: Math.max(0, Math.min(1440, g(GEN.sustainVolEnv))), release: seconds(g(GEN.releaseVolEnv)),
      keyToHold: g(GEN.keynumToVolEnvHold), keyToDecay: g(GEN.keynumToVolEnvDecay),
    },
  };
}

/**
 * The region a key and velocity play: one whose ranges hold both, a mono or left sample before a
 * right one (the site's samples are mono), else the one whose velocities are nearest. Of layers
 * that sound together (a violin's body and its bow's strike, a section's horns), the loudest:
 * the one with the least attenuation, which is the body of the sound.
 */
export function regionFor(regions, key, vel) {
  let best = null;
  let bestScore = Infinity;
  for (const r of regions) {
    if (key < r.keys.lo || key > r.keys.hi) continue;
    const velMiss = vel < r.vels.lo ? r.vels.lo - vel : vel > r.vels.hi ? vel - r.vels.hi : 0;
    const side = r.sample.type & SAMPLE_TYPE.right ? 1 : 0;
    const score = velMiss * 1e4 + side * 1e3 + Math.max(0, r.gen(GEN.initialAttenuation));
    if (score < bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}
