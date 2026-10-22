// Sampled instruments for MIDI songs (SPEC §5.6 "Sounds"): GeneralUser GS's General MIDI set,
// cut and encoded as small Opus files by tools/build-samples.mjs, in public/sounds/gm/ with a
// manifest of zones: for each of the 128 programs and the standard drum kit, which keys a file
// plays, its root key and tuning, loop, loudness and volume envelope. A song loads only the files
// its notes play (SongVoices); the synthesizer (synth.js) asks for a note's zone as it schedules
// it, and plays its oscillator timbre where no sample is loaded (yet, or at all). Nothing here is
// needed: without the manifest, or a browser that cannot decode Opus, every song still plays.
//
// Decoded buffers are kept for the page's life in an LRU of BUDGET bytes, decoded at DECODE_RATE
// (the font's samples are ~31 kHz: twice that is not heard, and 48 kHz would take half as much
// memory again). The files are named by their content, so the HTTP cache keeps them across
// visits; the manifest is asked for again (revalidated) once a page.

export const SAMPLES_URL = new URL('../../sounds/gm/', import.meta.url);
/** The rate buffers are decoded at (Hz). */
export const DECODE_RATE = 32000;
/** Decoded buffers kept at most (bytes). */
export const BUDGET = 64 << 20;
/** Files fetched and decoded at once. */
const CONCURRENCY = 6;
/** Keys either side of a song's own loaded too: a part played a little higher or lower (practice) finds its zone. */
const MARGIN = 2;

/**
 * The zones a program plays: its own, else (a set without it) the first program of its family
 * that has some, else none.
 * @returns {object[]|null} in key order
 */
export function programZones(manifest, program) {
  const programs = manifest?.programs;
  if (!programs) return null;
  const own = programs[program];
  if (own?.length) return own;
  const family = program & ~7;
  for (let p = family; p < family + 8; p++) if (programs[p]?.length) return programs[p];
  return null;
}

/** The zone of `zones` (in key order, not overlapping) a key plays: the one holding it, else the nearest. */
export function zoneAt(zones, key) {
  if (!zones?.length) return null;
  if (key <= zones[0].hi) return zones[0];
  for (let i = 1; i < zones.length; i++) {
    const z = zones[i];
    if (key < z.lo) return z.lo - key < key - zones[i - 1].hi ? z : zones[i - 1];
    if (key <= z.hi) return z;
  }
  return zones[zones.length - 1];
}

/** How fast a zone's sample plays to sound `key`, `cents` higher (a bend). */
export function rateOf(zone, key, cents = 0) {
  return 2 ** (((zone.scale ?? 1) * (key - zone.root) * 100 + (zone.cents ?? 0) + cents) / 1200);
}

/**
 * The files a song's notes play: for each note its program's zone at its key (and MARGIN keys
 * either side, `transpose` semitones off), a drum's zone on channel 10.
 * @param {{ notes: Array<{ ch: number, key: number, program: number }> }} song midi.js midiSong's
 * @returns {Set<string>}
 */
export function songFiles(manifest, song, { transpose = 0, programs = null } = {}) {
  const files = new Set();
  if (!manifest) return files;
  const keys = new Map(); // program → Set of keys
  for (const n of song.notes) {
    if (n.ch === 9) {
      const d = manifest.drums?.[n.key];
      if (d) files.add(d.file);
      continue;
    }
    const p = programs?.get(n.ch) ?? n.program;
    let set = keys.get(p);
    if (!set) keys.set(p, (set = new Set()));
    set.add(n.key);
  }
  for (const [p, set] of keys) {
    const zones = programZones(manifest, p);
    if (!zones) continue;
    for (const k of set) {
      for (let d = -MARGIN; d <= MARGIN; d++) files.add(zoneAt(zones, k + transpose + d).file);
    }
  }
  return files;
}

/** Decodes a file's bytes, at DECODE_RATE where the browser can (an OfflineAudioContext's), else at `ctx`'s. */
function defaultDecode(ctx, bytes) {
  const Offline = globalThis.OfflineAudioContext;
  if (Offline) {
    try {
      return new Offline(1, 1, DECODE_RATE).decodeAudioData(bytes);
    } catch { /* that rate refused: the page's own */ }
  }
  return ctx.decodeAudioData(bytes);
}

/** The page's sampled instruments: the manifest, the decoded buffers (an LRU), and each song's voices. */
export class SampleBank {
  /**
   * @param {object} [o]
   * @param {URL|string} [o.url] where the set is (its manifest.json and files)
   * @param {(url: string, init?: object) => Promise<Response>} [o.fetch]
   * @param {(ctx: BaseAudioContext, bytes: ArrayBuffer) => Promise<AudioBuffer>} [o.decode]
   * @param {number} [o.budget] decoded bytes kept at most
   */
  constructor({ url = SAMPLES_URL, fetch: f = (u, init) => fetch(u, init), decode = defaultDecode, budget = BUDGET } = {}) {
    this.url = new URL(url);
    this._fetch = f;
    this._decode = decode;
    this._budget = budget;
    this._manifest = null; // a Promise of it (null: not asked for; resolved null: none)
    /** The manifest once it has come (a song's voices start with it at once), else null. */
    this.manifestNow = null;
    this._buffers = new Map(); // file → AudioBuffer, least recently used first
    this._bytes = 0;
    this._loading = new Map(); // file → Promise<AudioBuffer|null>
    this._failed = new Set(); // files that could not be fetched or decoded (not asked for again)
    this._queue = [];
    this._running = 0;
  }

  /** The manifest (asked for once; null when the site has none, or it could not be read). */
  manifest() {
    if (!this._manifest) {
      this._manifest = this._fetch(new URL('manifest.json', this.url).href, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((m) => (m?.programs ? m : null))
        .catch(() => null);
      // Not found or unreadable: asked for again by the next song (a network that came back).
      this._manifest.then((m) => {
        if (m) this.manifestNow = m;
        else this._manifest = null;
      });
    }
    return this._manifest;
  }

  /** The decoded bytes kept. */
  get bytes() { return this._bytes; }

  /** A decoded file, if it is loaded (now the most recently used). */
  buffer(file) {
    const b = this._buffers.get(file);
    if (b) {
      this._buffers.delete(file);
      this._buffers.set(file, b);
    }
    return b;
  }

  /** Loads a file (once, however many ask); null when it cannot be. */
  load(ctx, file) {
    const have = this._buffers.get(file);
    if (have) return Promise.resolve(have);
    if (this._failed.has(file)) return Promise.resolve(null);
    let p = this._loading.get(file);
    if (!p) {
      p = new Promise((resolve) => {
        this._queue.push({ ctx, file, resolve });
        this._pump();
      });
      this._loading.set(file, p);
    }
    return p;
  }

  /** Voices for a song: its files loading (ready), its notes' zones and buffers as they come. */
  voices(ctx, song, opts) {
    return new SongVoices(this, ctx, song, opts);
  }

  _pump() {
    while (this._running < CONCURRENCY && this._queue.length) {
      const { ctx, file, resolve } = this._queue.shift();
      this._running++;
      this._fetchDecode(ctx, file).then((buf) => {
        this._running--;
        this._loading.delete(file);
        if (buf) this._keep(file, buf);
        else this._failed.add(file);
        resolve(buf);
        this._pump();
      });
    }
  }

  async _fetchDecode(ctx, file) {
    try {
      const res = await this._fetch(new URL(file, this.url).href);
      if (!res.ok) return null;
      return await this._decode(ctx, await res.arrayBuffer());
    } catch {
      return null; // a browser that cannot decode Opus, or the network: the oscillators
    }
  }

  _keep(file, buf) {
    this._buffers.set(file, buf);
    this._bytes += sizeOf(buf);
    for (const [f, b] of this._buffers) {
      if (this._bytes <= this._budget || f === file) break;
      this._buffers.delete(f);
      this._bytes -= sizeOf(b);
    }
  }
}

const sizeOf = (buf) => buf.length * (buf.numberOfChannels ?? 1) * 4;

/**
 * One song's voices: what the synthesizer asks for each note it schedules (tone, drum), from the
 * files the song's notes play, loaded as it starts (ready) or later (prepare: a part given another
 * instrument, the key changed).
 */
export class SongVoices {
  constructor(bank, ctx, song, { transpose = 0 } = {}) {
    this.bank = bank;
    this.ctx = ctx;
    this.song = song;
    this.manifest = bank.manifestNow; // at once when it has come: the buffers kept play before ready
    /** The playable sample last found (reused: read it before asking again). */
    this.hit = { zone: null, buffer: null };
    /** How many files the song's notes play, and whether they have all been loaded (or failed). */
    this.files = 0;
    this.loaded = false;
    this.ready = bank.manifest().then((m) => {
      this.manifest = m;
      const files = songFiles(m, song, { transpose });
      this.files = files.size;
      return this._loadAll(files);
    }).then(() => { this.loaded = true; });
  }

  /** Loads what playing `transpose` semitones off, or with `programs` (channel → program), needs. */
  prepare({ transpose = 0, programs = null } = {}) {
    return this.ready.then(() => this._loadAll(songFiles(this.manifest, this.song, { transpose, programs })));
  }

  _loadAll(files) {
    return Promise.all([...files].map((f) => this.bank.load(this.ctx, f))).then(() => {});
  }

  /**
   * The sample a program plays `key` with: its zone's, else (not loaded) the nearest zone of the
   * program that is; null for none (the synthesizer's oscillator then).
   */
  tone(program, key) {
    const zones = programZones(this.manifest, program);
    const z = zoneAt(zones, key);
    if (!z) return null;
    let buffer = this.bank.buffer(z.file);
    let zone = z;
    if (!buffer) {
      const i = zones.indexOf(z);
      for (let d = 1; d < zones.length && !buffer; d++) {
        for (const j of [i - d, i + d]) {
          const b = j >= 0 && j < zones.length ? this.bank.buffer(zones[j].file) : null;
          if (b) {
            buffer = b;
            zone = zones[j];
            break;
          }
        }
      }
      if (!buffer) return null;
    }
    this.hit.zone = zone;
    this.hit.buffer = buffer;
    return this.hit;
  }

  /** The sample of a drum (channel 10's key), or null. */
  drum(key) {
    const zone = this.manifest?.drums?.[key];
    const buffer = zone && this.bank.buffer(zone.file);
    if (!buffer) return null;
    this.hit.zone = zone;
    this.hit.buffer = buffer;
    return this.hit;
  }
}
