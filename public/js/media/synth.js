// Plays a song of midi.js through WebAudio: sampled instruments where the song's voices
// (samples.js) have a note's sample loaded, else a small General MIDI synthesizer of oscillators,
// envelopes and filtered noise, a timbre per instrument family and a few drums. Notes are
// scheduled a little ahead (LOOKAHEAD) from a timer, not from the frame loop:
// requestAnimationFrame does not run in VR or in a hidden page, and a song's thousands of notes
// are never all scheduled at once. At most MAX_VOICES sound together (a Quest's audio thread),
// the one ending soonest giving way.

import { rateOf } from './samples.js';

/** Notes scheduled this far ahead (s), from a timer every TICK_MS. */
const LOOKAHEAD = 1.0;
const TICK_MS = 200;
/** A note due longer ago than this (s: the timer was late, a hidden page's) is skipped, not crowded in. */
const LATE = 0.25;
/** Voices sounding at once. */
export const MAX_VOICES = 40;
/** How loud a note of full velocity starts, before the master volume. */
const PEAK = 0.32;
/** The same for a sample, before its zone's attenuation: as loud as the oscillators, measured (SPEC §5.6). */
export const SAMPLE_PEAK = 9.5;
/** SoundFont envelope times are for 100 dB: as time constants of an exponential, that divided by ln(10^5). */
const DB100 = 11.5;
const DB60 = 0.6; // of a release: the time it takes to fall 60 dB, when the voice is let go

/**
 * Timbres by General MIDI family (program >> 3): oscillator, attack and release (s), how far it
 * decays (sustain 0: dies away like a struck or plucked string, in `decay` s at middle C, longer
 * when lower) and a low-pass filter at `filter` times the pitch (0: none).
 */
const FAMILIES = [
  { wave: 'triangle', attack: 0.004, decay: 3.2, sustain: 0, release: 0.25, filter: 0 }, // piano
  { wave: 'sine', attack: 0.002, decay: 1.4, sustain: 0, release: 0.3, filter: 0 }, // chromatic percussion
  { wave: 'square', attack: 0.012, decay: 0, sustain: 1, release: 0.08, filter: 5 }, // organ
  { wave: 'sawtooth', attack: 0.003, decay: 1.8, sustain: 0, release: 0.15, filter: 4 }, // guitar
  { wave: 'triangle', attack: 0.006, decay: 1.6, sustain: 0.35, release: 0.1, filter: 0 }, // bass
  { wave: 'sawtooth', attack: 0.07, decay: 0, sustain: 1, release: 0.25, filter: 3 }, // strings
  { wave: 'sawtooth', attack: 0.14, decay: 0, sustain: 1, release: 0.4, filter: 2.5 }, // ensemble, choir
  { wave: 'sawtooth', attack: 0.04, decay: 0, sustain: 1, release: 0.12, filter: 5 }, // brass
  { wave: 'square', attack: 0.03, decay: 0, sustain: 1, release: 0.1, filter: 3.5 }, // reed
  { wave: 'sine', attack: 0.04, decay: 0, sustain: 1, release: 0.12, filter: 0 }, // pipe, flute
  { wave: 'square', attack: 0.01, decay: 0, sustain: 1, release: 0.1, filter: 8 }, // synth lead
  { wave: 'sawtooth', attack: 0.3, decay: 0, sustain: 1, release: 0.6, filter: 2 }, // synth pad
  { wave: 'triangle', attack: 0.1, decay: 0, sustain: 1, release: 0.5, filter: 0 }, // synth effects
  { wave: 'sawtooth', attack: 0.004, decay: 1.4, sustain: 0, release: 0.15, filter: 4 }, // ethnic (plucked)
  { wave: 'triangle', attack: 0.002, decay: 0.6, sustain: 0, release: 0.1, filter: 0 }, // percussive
  { wave: 'triangle', attack: 0.05, decay: 0.8, sustain: 0, release: 0.2, filter: 0 }, // sound effects
];
/** Programs whose family's timbre does not fit: pizzicato, harp and timpani are struck, not bowed. */
const PROGRAMS = {
  45: FAMILIES[3], 46: { ...FAMILIES[1], decay: 2.2 }, 47: { ...FAMILIES[14], decay: 1.2 },
  105: FAMILIES[13], 106: FAMILIES[13], 107: FAMILIES[13], 108: FAMILIES[1],
  109: { ...FAMILIES[8], filter: 6 }, 110: FAMILIES[5], 111: FAMILIES[8],
};

export function timbreOf(program) {
  return PROGRAMS[program] ?? FAMILIES[(program >> 3) & 15];
}

/** A General MIDI drum (channel 10) by key: noise through a filter, or a falling tone. */
function drumOf(key) {
  if (key === 35 || key === 36) return { tone: [150, 45], dur: 0.32 }; // bass drum
  if (key === 38 || key === 40) return { noise: ['bandpass', 1800, 0.8], dur: 0.18, tone: [190, 140], toneGain: 0.5 }; // snare
  if (key === 37 || key === 39) return { noise: ['bandpass', 2400, 1.2], dur: 0.1 }; // side stick, clap
  if (key === 42 || key === 44) return { noise: ['highpass', 7000, 0.7], dur: 0.05, gain: 0.5 }; // closed, pedal hi-hat
  if (key === 46) return { noise: ['highpass', 7000, 0.7], dur: 0.3, gain: 0.5 }; // open hi-hat
  if (key === 49 || key === 52 || key === 55 || key === 57) return { noise: ['highpass', 4500, 0.6], dur: 1.2, gain: 0.55 }; // cymbals
  if (key === 51 || key === 53 || key === 59) return { noise: ['bandpass', 5200, 1.5], dur: 0.6, gain: 0.45 }; // ride
  if (key >= 41 && key <= 50) { // toms, low to high
    const f = 80 + (key - 41) * 16;
    return { tone: [f, f * 0.75], dur: 0.36 };
  }
  return { noise: ['bandpass', 2600, 2], dur: 0.08, gain: 0.6 }; // anything else: a woodblock's tick
}

const freqOf = (key) => 440 * 2 ** ((key - 69) / 12);

/** Slowest and fastest a song is played (practice: its tempo, the pitch kept). */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;

/**
 * One song played on an AudioContext. play() starts or goes on, pause() keeps the place, stop()
 * goes back to the start; onEnd is called when it has played to its end. For practice it can be
 * slower or faster (rate), higher or lower (transpose), without some parts (muted channels), with
 * another instrument for a part (programs), and go round a passage (loop).
 */
export class MidiSynth {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{ notes: object[], duration: number }} song midiSong's
   * @param {{ destination?: AudioNode, volume?: number, samples?: import('./samples.js').SongVoices|null }} [opts]
   *   samples: the song's sampled voices (null: the oscillators alone)
   */
  constructor(ctx, song, { destination = ctx.destination, volume = 0.7, samples = null } = {}) {
    this.ctx = ctx;
    this.song = song;
    this._samples = samples;
    this.onEnd = null;
    this._out = ctx.createGain();
    this._out.gain.value = volume;
    // Many notes at once add up: a compressor keeps the sum from clipping.
    this._comp = ctx.createDynamicsCompressor?.() ?? null;
    if (this._comp) {
      this._comp.threshold.value = -14;
      this._comp.knee.value = 12;
      this._comp.ratio.value = 4;
      this._out.connect(this._comp).connect(destination);
    } else {
      this._out.connect(destination);
    }
    this._pans = new Map(); // pan (rounded) → StereoPannerNode into _out
    this._voices = [];
    this._noise = null;
    this._playing = false;
    this._t0 = 0; // the context's time at the song's start
    this._pos = 0; // where it is while paused (s)
    this._next = 0; // the next note to schedule
    this._timer = 0;
    this._tick = this._tick.bind(this);
    this._rate = 1; // song seconds a second
    this._transpose = 0; // semitones, drums aside
    this._muted = new Set(); // channels not played
    this._programs = new Map(); // channel -> the program it is played with instead of its own
    this._loop = null; // { a, b }: from b back to a (song seconds)
  }

  get duration() { return this.song.duration; }
  get playing() { return this._playing; }
  /** Where the song is (s, of the song: at another rate the clock goes otherwise). */
  get position() {
    return this._playing ? Math.max(0, Math.min(this.song.duration, (this.ctx.currentTime - this._t0) * this._rate)) : this._pos;
  }

  get rate() { return this._rate; }
  get transpose() { return this._transpose; }
  get loop() { return this._loop; }
  /** Whether a channel is muted. */
  muted(ch) { return this._muted.has(ch); }
  /** The muted channels (read only: setMuted changes them). */
  get mutedChannels() { return this._muted; }
  /** The program a channel is played with instead of its own, or undefined. */
  programOf(ch) { return this._programs.get(ch); }

  /** Plays slower or faster (RATE_MIN…RATE_MAX), from where it is. */
  setRate(rate) {
    this._again(() => { this._rate = Math.max(RATE_MIN, Math.min(RATE_MAX, rate)); });
  }

  /** Plays it `semitones` higher (or lower), drums aside. */
  setTranspose(semitones) {
    this._again(() => { this._transpose = Math.max(-24, Math.min(24, Math.round(semitones))); });
    this._prepare();
  }

  /** Mutes a channel (or plays it again). */
  setMuted(ch, on) {
    this._again(() => { if (on) this._muted.add(ch); else this._muted.delete(ch); });
  }

  /** Plays a channel with another program (General MIDI), or its own again (null). */
  setProgram(ch, program) {
    this._again(() => { if (program == null) this._programs.delete(ch); else this._programs.set(ch, program & 127); });
    this._prepare();
  }

  /** The sampled voices it plays with, or the oscillators alone (null); heard at once. */
  get samples() { return this._samples; }
  setSamples(samples) {
    this._again(() => { this._samples = samples; });
    this._prepare();
  }

  /** Loads the samples another key or instrument needs (until then the nearest, or the oscillators). */
  _prepare() {
    this._samples?.prepare({ transpose: this._transpose, programs: this._programs.size ? this._programs : null });
  }

  /** Goes round from b back to a (song seconds), or not (null). */
  setLoop(loop) {
    this._loop = loop && loop.b - loop.a >= 0.25 ? { a: Math.max(0, loop.a), b: Math.min(this.song.duration, loop.b) } : null;
    if (this._loop && this.position > this._loop.b) this._again(() => { this._pos = this._loop.a; }, true);
  }

  /** A change heard at once: the notes scheduled ahead are let go and scheduled again. */
  _again(change, seek = false) {
    const playing = this._playing;
    const pos = this.position;
    if (playing) this._halt();
    if (!seek) this._pos = pos;
    change();
    if (playing) this.play(this._pos);
  }

  /** Plays from `from` (s; default: where it was paused). */
  play(from = this._pos) {
    if (this._playing) return;
    this._playing = true;
    this._pos = Math.max(0, Math.min(this.song.duration, from));
    this._t0 = this.ctx.currentTime + 0.05 - this._pos / this._rate;
    // The first note at or after that place (binary search: notes are in starting order).
    const notes = this.song.notes;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (notes[mid].t < this._pos) lo = mid + 1;
      else hi = mid;
    }
    this._next = lo;
    this._tick();
  }

  /** Stops the sound and keeps the place. */
  pause() {
    if (!this._playing) return;
    this._pos = this.position;
    this._halt();
  }

  /** Stops the sound and goes back to the start. */
  stop() {
    this._halt();
    this._pos = 0;
  }

  /** Stops and lets go of the audio nodes. */
  dispose() {
    this.stop();
    this._out.disconnect();
    this._comp?.disconnect();
    for (const p of this._pans.values()) p.disconnect();
    this._pans.clear();
  }

  _halt() {
    this._playing = false;
    clearTimeout(this._timer);
    this._timer = 0;
    const now = this.ctx.currentTime;
    const voices = this._voices;
    this._voices = [];
    for (const v of voices) this._silence(v, now);
    // Let go of them once their short fade is over (cut at once, they click).
    setTimeout(() => {
      for (const v of voices) for (const node of v.nodes) node.disconnect();
    }, 150);
  }

  _tick() {
    if (!this._playing) return;
    const now = this.ctx.currentTime;
    const rate = this._rate;
    const loop = this._loop;
    // Round the loop: from its end back to its start.
    if (loop && (now - this._t0) * rate >= loop.b) {
      this._halt();
      this.play(loop.a);
      return;
    }
    const until = Math.min((now - this._t0 + LOOKAHEAD) * rate, loop ? loop.b : Infinity);
    const notes = this.song.notes;
    while (this._next < notes.length && notes[this._next].t < until) {
      const n = notes[this._next++];
      const when = this._t0 + n.t / rate;
      if (when < now - LATE || this._muted.has(n.ch)) continue;
      this._start(n, Math.max(when, now));
    }
    this._prune(now);
    if (loop) {
      this._timer = setTimeout(this._tick, TICK_MS);
      return;
    }
    if (this._next >= notes.length && (now - this._t0) * rate >= this.song.duration + 0.3) {
      this._playing = false;
      this._pos = 0;
      this._timer = 0;
      this.onEnd?.();
      return;
    }
    this._timer = setTimeout(this._tick, TICK_MS);
  }

  /** Lets go of the nodes of voices that have finished by `now`. */
  _prune(now) {
    const vs = this._voices;
    let w = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.end < now - 0.1) {
        for (const node of v.nodes) node.disconnect();
      } else {
        vs[w++] = v;
      }
    }
    vs.length = w;
  }

  /** A voice cut short at `when` (it gives way, or the song stops). */
  _silence(v, when) {
    if (v.end <= when) return;
    v.cut = true;
    v.gain.gain.cancelScheduledValues(when);
    v.gain.gain.setTargetAtTime(0, when, 0.01);
    for (const s of v.sources) s.stop(when + 0.06);
    v.end = when + 0.06;
  }

  /** Room for a voice starting at `when`: the voice ending soonest gives way when all are in use. */
  _room(when) {
    let sounding = 0;
    let first = null;
    for (const v of this._voices) {
      if (v.end <= when || v.cut) continue; // over, or already giving way
      sounding++;
      if (!first || v.end < first.end) first = v;
    }
    if (sounding >= MAX_VOICES && first) this._silence(first, when);
  }

  _pan(pan) {
    const key = Math.round(pan * 8) / 8;
    let node = this._pans.get(key);
    if (!node) {
      if (!this.ctx.createStereoPanner) return this._out;
      node = this.ctx.createStereoPanner();
      node.pan.value = key;
      node.connect(this._out);
      this._pans.set(key, node);
    }
    return node;
  }

  _start(n, when) {
    this._room(when);
    const s = this._samples;
    if (n.ch === 9) {
      const hit = s?.drum(n.key);
      if (hit) this._sampled(n, when, hit, true);
      else this._drum(n, when);
      return;
    }
    const key = Math.max(0, Math.min(127, n.key + this._transpose));
    const hit = s?.tone(this._programs.get(n.ch) ?? n.program, key);
    if (hit) this._sampled(n, when, hit, false);
    else this._tone(n, when);
  }

  /**
   * A note played by its sample (samples.js): the zone's root and tuning give its rate, its loop
   * holds it, and its volume envelope (SoundFont's: attack, hold, decay to the sustain level, and
   * the release once the note ends) shapes it. A drum plays its sample out, and one of an
   * exclusive class (the hi-hats) cuts the others of it short.
   */
  _sampled(n, when, hit, drum) {
    const ctx = this.ctx;
    const z = hit.zone;
    const key = drum ? n.key : Math.max(0, Math.min(127, n.key + this._transpose));
    const rate = rateOf(z, key, drum ? 0 : n.bend);
    const cls = drum ? z.exclusive ?? 0 : 0;
    if (cls) {
      for (const v of this._voices) if (v.cls === cls && v.end > when && !v.cut) this._silence(v, when);
    }
    const src = ctx.createBufferSource();
    src.buffer = hit.buffer;
    src.playbackRate.value = rate;
    if (z.loop) {
      src.loop = true;
      src.loopStart = z.loop[0];
      src.loopEnd = z.loop[1];
    }
    const g = ctx.createGain();
    src.connect(g).connect(this._pan(n.pan));
    const env = z.env; // [attack, hold, decay (s), sustain (cB down), release (s)]
    const attack = env[0], hold = env[1], decay = env[2], sustain = env[3], release = env[4];
    const byKey = (tc) => (tc ? 2 ** (((60 - key) * tc) / 1200) : 1);
    const peak = SAMPLE_PEAK * PEAK * n.gain * 10 ** (-(z.att ?? 0) / 200);
    const top = when + Math.max(0.002, attack);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, top);
    if (sustain > 0) g.gain.setTargetAtTime(peak * 10 ** (-sustain / 200), top + hold * byKey(z.keyToHold), Math.max(0.005, (decay * byKey(z.keyToDecay)) / DB100));
    const sampleEnd = z.loop ? Infinity : when + z.len / rate;
    const off = drum ? sampleEnd : Math.max(when + n.d / this._rate, top);
    const rel = Math.max(0.03, Math.min(3, release));
    let end = Math.min(sampleEnd, off + rel * DB60);
    if (off < sampleEnd) g.gain.setTargetAtTime(0, off, rel / DB100);
    end = Math.max(end, top) + 0.01;
    src.start(when);
    src.stop(end);
    this._voices.push({ nodes: [src, g], sources: [src], gain: g, end, cls });
  }

  _tone(n, when) {
    const ctx = this.ctx;
    const tim = timbreOf(this._programs.get(n.ch) ?? n.program);
    const f = freqOf(Math.max(0, Math.min(127, n.key + this._transpose)));
    const osc = ctx.createOscillator();
    osc.type = tim.wave;
    osc.frequency.value = f;
    if (n.bend) osc.detune.value = n.bend;
    const nodes = [osc];
    let last = osc;
    if (tim.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(16000, f * tim.filter);
      lp.Q.value = 0.5;
      last.connect(lp);
      nodes.push(lp);
      last = lp;
    }
    const g = ctx.createGain();
    nodes.push(g);
    last.connect(g).connect(this._pan(n.pan));
    const peak = PEAK * n.gain;
    const top = when + tim.attack;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, top);
    if (tim.sustain < 1) {
      // Lower strings ring longer: twice as long three octaves down, half as long three up.
      const decay = tim.decay * 2 ** ((60 - n.key) / 36);
      g.gain.setTargetAtTime(peak * tim.sustain, top, decay / 4);
    }
    const off = Math.max(when + n.d / this._rate, top);
    g.gain.setTargetAtTime(0, off, tim.release / 3);
    const end = off + tim.release * 1.6;
    osc.start(when);
    osc.stop(end);
    this._voices.push({ nodes, sources: [osc], gain: g, end });
  }

  _drum(n, when) {
    const ctx = this.ctx;
    const d = drumOf(n.key);
    const g = ctx.createGain();
    const nodes = [g];
    const sources = [];
    const peak = PEAK * 1.4 * n.gain * (d.gain ?? 1);
    g.gain.setValueAtTime(peak, when);
    g.gain.setTargetAtTime(0, when + 0.005, d.dur / 4);
    g.connect(this._pan(n.pan));
    if (d.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer();
      const f = ctx.createBiquadFilter();
      [f.type, f.frequency.value, f.Q.value] = d.noise;
      src.connect(f).connect(g);
      nodes.push(src, f);
      sources.push(src);
    }
    if (d.tone) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(d.tone[0], when);
      osc.frequency.exponentialRampToValueAtTime(d.tone[1], when + d.dur);
      let into = g;
      if (d.toneGain) {
        into = ctx.createGain();
        into.gain.value = d.toneGain;
        into.connect(g);
        nodes.push(into);
      }
      osc.connect(into);
      nodes.push(osc);
      sources.push(osc);
    }
    const end = when + d.dur * 1.5 + 0.02;
    for (const s of sources) {
      s.start(when);
      s.stop(end);
    }
    this._voices.push({ nodes, sources, gain: g, end });
  }

  _noiseBuffer() {
    if (!this._noise) {
      const len = Math.round(this.ctx.sampleRate * 1.5);
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noise.getChannelData(0);
      let x = 12345;
      for (let i = 0; i < len; i++) { // a fixed noise (no Math.random: the same each time)
        x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
        data[i] = x / 0x3fffffff - 1;
      }
    }
    return this._noise;
  }
}
