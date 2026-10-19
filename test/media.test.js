// The sounds books play (SPEC §3.5 `media`): the MIDI reader, the synthesizer (on a fake
// AudioContext, with Node's mocked timers) and the player.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { EV, MAX_NOTES, MAX_STACK, MidiError, midiSong, parseMidi } from '../public/js/media/midi.js';
import { MAX_VOICES, MidiSynth, timbreOf } from '../public/js/media/synth.js';
import { SoundPlayer, clock, isMidi } from '../public/js/media/player.js';
import { TUNE, name, smf, tempo, vlq } from './helpers/midi-writer.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≉ ${b}`);
const song = (bytes) => midiSong(parseMidi(bytes));

describe('MIDI files (media/midi.js)', () => {
  it('reads variable-length numbers as the writer writes them', () => {
    for (const n of [0, 1, 127, 128, 8191, 16384, 0x0fffffff]) {
      const bytes = smf({ tracks: [[[n, 0x90, 60, 1], [0, 0x80, 60, 0]]] });
      assert.equal(parseMidi(bytes).tracks[0][0].tick, n, `delta ${n} (${vlq(n).length} bytes)`);
    }
  });

  it('turns ticks into seconds along the tempo map, across tracks', () => {
    // Track 0: 120 bpm, then 240 bpm at the second beat; track 1: two notes of a beat each.
    const s = song(smf({
      tracks: [
        [tempo(0, 500000), tempo(960, 250000)],
        [[0, 0xc0, 40], [0, 0x90, 60, 127], [480, 0x80, 60, 0], [480, 0x90, 64, 127], [480, 0x80, 64, 0]],
      ],
    }));
    assert.equal(s.notes.length, 2);
    const [a, b] = s.notes;
    near(a.t, 0);
    near(a.d, 0.5, 'a beat at 120 bpm');
    near(b.t, 1, 'two beats at 120');
    near(b.d, 0.25, 'a beat at 240');
    near(s.duration, 1.25);
    assert.equal(a.program, 40, 'the program change at the same tick comes first');
    assert.equal(a.key, 60);
    assert.equal(a.ch, 0);
  });

  it('follows running status and takes a note-on of velocity 0 as a note-off', () => {
    // 0x90 once, then data bytes only: on 60, on 62, "on" 60 vel 0 (off), on 62 vel 0.
    const s = song(smf({ format: 0, tracks: [[[0, 0x90, 60, 90], [0, 62, 90], [240, 60, 0], [240, 62, 0]]] }));
    assert.deepEqual(s.notes.map((n) => [n.key, n.t, n.d]), [[60, 0, 0.25], [62, 0, 0.5]]);
  });

  it('bakes each channel\'s volume, expression, pan and pitch bend into its notes', () => {
    const s = song(smf({
      tracks: [[
        [0, 0xb0, 7, 64], [0, 0xb0, 11, 127], [0, 0xb0, 10, 0], [0, 0xe0, 0x7f, 0x7f], [0, 0x90, 60, 127],
        // RPN 0 (pitch bend range) set to 12 semitones on channel 2: the same bend is an octave.
        [0, 0xb2, 101, 0], [0, 0xb2, 100, 0], [0, 0xb2, 6, 12], [0, 0xe2, 0x7f, 0x7f], [0, 0x92, 67, 64],
        [480, 0x80, 60, 0], [0, 0x82, 67, 0],
      ]],
    }));
    const [a, b] = s.notes;
    near(a.gain, (64 / 127) ** 2, 'volume squared, as General MIDI\'s curve');
    assert.equal(a.pan, -1);
    assert.equal(a.bend, 200, '+2 semitones, the default range');
    assert.equal(b.bend, 1200);
    near(b.gain, (64 / 127) * (100 / 127) ** 2, 'a channel\'s volume is 100 until set');
    assert.equal(b.pan, 0);
  });

  it('holds notes with the sustain pedal, until it is up or the key is struck again', () => {
    const s = song(smf({
      tracks: [[
        [0, 0xb0, 64, 127], [0, 0x90, 60, 100], [240, 0x80, 60, 0], [480, 0xb0, 64, 0], // pedal up at 1.5 beats
        [0, 0xb0, 64, 127], [0, 0x90, 62, 100], [240, 0x80, 62, 0], [240, 0x90, 62, 100], [240, 0x80, 62, 0], [240, 0xb0, 64, 0],
      ]],
    }));
    assert.deepEqual(s.notes.map((n) => [n.key, n.t, n.d]), [[60, 0, 0.75], [62, 0.75, 0.5], [62, 1.25, 0.5]]);
  });

  it('ends the earliest note of a key: unison parts on one channel, a note struck again before its note-off', () => {
    // Two tracks (1st and 2nd Oboe) on channel 0, in unison for a beat, then the second holds on.
    const unison = song(smf({ tracks: [
      [[0, 0x90, 69, 100], [480, 0x80, 69, 0]],
      [[0, 0x90, 69, 80], [960, 0x80, 69, 0]],
    ] }));
    assert.deepEqual(unison.notes.map((n) => [n.t, n.d]), [[0, 0.5], [0, 1]], 'two notes, each its own length');
    // Some writers strike C again before the note-off of the C before, in one tick.
    const again = song(smf({ tracks: [[[0, 0x90, 60, 100], [480, 0x90, 60, 100], [0, 0x80, 60, 0], [480, 0x80, 60, 0]]] }));
    assert.deepEqual(again.notes.map((n) => [n.t, n.d]), [[0, 0.5], [0.5, 0.5]]);
    // Without note-offs at all, a key keeps at most MAX_STACK notes sounding.
    const struck = song(smf({ tracks: [Array.from({ length: 10 }, (_, i) => [i ? 480 : 0, 0x90, 60, 100])] }));
    const sounding = (t) => struck.notes.filter((n) => n.t <= t && n.t + n.d > t).length;
    assert.ok(struck.notes.every((n, i) => sounding(n.t) <= MAX_STACK), `${struck.notes.map((n) => n.d)}`);
    assert.equal(sounding(4.4), MAX_STACK);
  });

  it('keeps the drum channel, gives a note of no length a little, and reads all notes off', () => {
    const s = song(smf({ tracks: [[[0, 0x99, 36, 100], [0, 0x89, 36, 0], [0, 0x90, 70, 100], [480, 0xb0, 123, 0], [480, 0x90, 72, 1]]] }));
    assert.equal(s.notes[0].ch, 9);
    assert.equal(s.notes[0].d, 0.05, 'the shortest a note lasts');
    near(s.notes[1].d, 0.5, 'all notes off (controller 123)');
    near(s.notes[2].d, 0.05, 'still on at the end: until then');
  });

  it('counts time in SMPTE frames when the file says so', () => {
    // -25 frames a second, 40 ticks a frame: 1000 ticks a second.
    const s = song(smf({ division: ((256 - 25) << 8) | 40, tracks: [[[500, 0x90, 60, 100], [250, 0x80, 60, 0]]] }));
    near(s.notes[0].t, 0.5);
    near(s.notes[0].d, 0.25);
  });

  it('reads an RMID file, a track name, and skips system exclusive and unknown meta events', () => {
    const inner = smf({ tracks: [[name(0, 'Air'), [0, 0xf0, 3, 1, 2, 0xf7], [0, 0xff, 0x7f, 2, 9, 9], [0, 0x90, 60, 100], [480, 0x80, 60, 0]]] });
    const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
    const riff = Uint8Array.from([...Buffer.from('RIFF'), ...u32le(inner.length + 12), ...Buffer.from('RMIDdata'), ...u32le(inner.length), ...inner]);
    const s = song(riff);
    assert.equal(s.title, 'Air');
    assert.equal(s.notes.length, 1);
    assert.equal(parseMidi(riff).tracks[0].filter((e) => e.type === EV.NAME).length, 1);
  });

  it('reads what is there of a damaged file, and refuses what is no MIDI file', () => {
    const cut = TUNE.slice(0, TUNE.length - 9); // the second note's off and the end are gone
    const s = song(cut);
    assert.equal(s.notes.length, 2, 'both notes, the second until the end');
    assert.throws(() => parseMidi(new TextEncoder().encode('ID3 an MP3 file, not MIDI at all')), MidiError);
    assert.throws(() => parseMidi(new Uint8Array(0)), MidiError);
    assert.throws(() => parseMidi(Uint8Array.from([...Buffer.from('MThd'), 0, 0, 0, 6, 0, 1, 0, 0, 1, 0xe0])), /no tracks/);
    assert.equal(song(TUNE).notes.length, 2);
    assert.ok(MAX_NOTES >= 100000);
  });
});

/** A fake AudioContext that records what is scheduled. */
function fakeContext() {
  const param = (value = 0) => ({ value, events: [], setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); return this; },
    cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; } });
  const ctx = {
    currentTime: 0, sampleRate: 8000, state: 'running', destination: { name: 'destination' }, made: [], connected: 0, disconnected: 0,
    resume() { this.state = 'running'; return Promise.resolve(); },
  };
  const node = (kind, fields = {}) => {
    const n = {
      kind, ...fields, starts: [], stops: [],
      connect(to) { ctx.connected++; return to; },
      disconnect() { ctx.disconnected++; },
      start(t) { this.starts.push(t); },
      stop(t) { this.stops.push(t); },
    };
    ctx.made.push(n);
    return n;
  };
  Object.assign(ctx, {
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0) }),
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createBufferSource: () => node('buffer', { buffer: null }),
    createBuffer: (channels, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    createStereoPanner: () => node('pan', { pan: param(0) }),
    createDynamicsCompressor: () => node('comp', { threshold: param(), knee: param(), ratio: param() }),
  });
  return ctx;
}
const oscs = (ctx) => ctx.made.filter((n) => n.kind === 'osc');
const note = (t, key = 60, d = 0.4, more = {}) => ({ t, d, ch: 0, key, gain: 1, program: 0, pan: 0, bend: 0, ...more });

describe('the synthesizer (media/synth.js)', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());
  /** Moves the fake clock and the timers on together. */
  const advance = (ctx, s) => {
    for (let ms = 0; ms < s * 1000; ms += 100) {
      ctx.currentTime += 0.1;
      mock.timers.tick(100);
    }
  };

  it('schedules notes a second ahead, from a timer, at the pitch and time they have', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0, 69), note(0.5, 81), note(2, 57), note(5, 60)], duration: 5.4 });
    synth.play();
    assert.deepEqual(oscs(ctx).map((o) => o.frequency.value), [440, 880], 'only what starts within the next second');
    near(oscs(ctx)[1].starts[0], 0.55, 'its time in the song, from a small lead');
    advance(ctx, 1.5);
    assert.equal(oscs(ctx).length, 3);
    near(synth.position, 1.45);
    assert.equal(synth.playing, true);
  });

  it('gives each family its timbre, and the struck and plucked programs theirs', () => {
    assert.equal(timbreOf(0).wave, 'triangle');
    assert.equal(timbreOf(0).sustain, 0, 'a piano dies away');
    assert.equal(timbreOf(40).sustain, 1, 'a violin is held');
    assert.equal(timbreOf(45).sustain, 0, 'pizzicato is plucked');
    assert.equal(timbreOf(127).wave, timbreOf(120).wave);
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0, 60, 0.4, { program: 40, bend: 150 })], duration: 1 });
    synth.play();
    const [osc] = oscs(ctx);
    assert.equal(osc.type, 'sawtooth');
    assert.equal(osc.detune.value, 150);
    assert.ok(ctx.made.some((n) => n.kind === 'filter'), 'a bowed string through a low-pass filter');
  });

  it('lets the voice ending soonest give way once MAX_VOICES sound', () => {
    const ctx = fakeContext();
    const notes = Array.from({ length: MAX_VOICES + 5 }, (_, i) => note(0, 40 + i, 3 + i * 0.01));
    const synth = new MidiSynth(ctx, { notes, duration: 4 });
    synth.play();
    const started = oscs(ctx);
    assert.equal(started.length, MAX_VOICES + 5);
    const cut = started.filter((o) => o.stops.length > 1);
    assert.equal(cut.length, 5, 'five voices cut short');
    assert.deepEqual(cut.map((o) => o.frequency.value), started.slice(0, 5).map((o) => o.frequency.value), 'the ones ending first');
  });

  it('pauses (silencing what sounds), plays on from there, and lets go of finished voices', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0), note(0.4, 62), note(1.2, 64), note(2.5, 65)], duration: 3 });
    synth.play();
    advance(ctx, 0.6);
    synth.pause();
    near(synth.position, 0.55);
    assert.equal(synth.playing, false);
    for (const o of oscs(ctx)) assert.ok(o.stops.at(-1) <= ctx.currentTime + 0.06 + 1e-9, 'every sounding voice stopped');
    const before = oscs(ctx).length;
    advance(ctx, 2); // paused: nothing more
    assert.equal(oscs(ctx).length, before);
    assert.ok(ctx.disconnected > 0, 'their nodes let go once their fade is over');
    synth.play();
    assert.equal(oscs(ctx).length, before + 1, 'from the next note after the place it was paused at (1.2)');
    near(oscs(ctx).at(-1).starts[0], ctx.currentTime + 0.05 + (1.2 - 0.55));
  });

  it('calls onEnd at the end and goes back to the start; drums are filtered noise or a falling tone', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0, 36, 0.1, { ch: 9 }), note(0.2, 42, 0.1, { ch: 9 })], duration: 0.3 });
    let ended = 0;
    synth.onEnd = () => ended++;
    synth.play();
    const kinds = ctx.made.map((n) => n.kind);
    assert.ok(kinds.includes('osc'), 'the bass drum: a falling tone');
    assert.ok(kinds.includes('buffer'), 'the hi-hat: noise');
    advance(ctx, 1.5);
    assert.equal(ended, 1);
    assert.equal(synth.playing, false);
    assert.equal(synth.position, 0);
    synth.dispose();
  });
});

describe('the sound player (media/player.js)', () => {
  const midi = { src: '/zim/lib/C/7_tune.mid', mime: 'audio/midi', name: 'tune.mid' };
  const mp3 = { src: '/zim/lib/C/air.mp3', mime: 'audio/mpeg', name: 'air.mp3' };
  /** A fake <audio>: play() resolves (or rejects with `refuse`'s error), ended() ends it. */
  function fakeAudio({ refuse = null } = {}) {
    const el = {
      paused: true, src: '', currentTime: 0, duration: 12, loads: 0,
      play() {
        if (refuse && refuse.n-- > 0) return Promise.reject(Object.assign(new Error('no'), { name: refuse.name }));
        this.paused = false;
        return Promise.resolve();
      },
      pause() { this.paused = true; },
      removeAttribute(k) { if (k === 'src') this.src = ''; },
      load() { this.loads++; },
      ended() { this.onended?.(); },
    };
    return el;
  }
  const make = ({ bytes = async () => TUNE, refuse, released = [] } = {}) => {
    const els = [];
    const ctx = fakeContext();
    const p = new SoundPlayer({
      context: () => ctx,
      bytes,
      url: async (m) => ({ url: `blob:${m.name}`, release: () => released.push(m.name) }),
      createAudio: () => {
        const el = fakeAudio({ refuse });
        els.push(el);
        return el;
      },
    });
    const states = [];
    p.onChange = (s) => states.push(s);
    return { p, ctx, els, states, released };
  };

  it('tells MIDI files from other sounds, and writes times as m:ss', () => {
    assert.equal(isMidi(midi), true);
    assert.equal(isMidi({ name: 'x.MIDI' }), true);
    assert.equal(isMidi({ mime: 'audio/x-midi' }), true);
    assert.equal(isMidi(mp3), false);
    assert.equal(clock(0), '0:00');
    assert.equal(clock(65.9), '1:05');
    assert.equal(clock(NaN), '0:00');
  });

  it('plays a MIDI file through the synthesizer, pauses, goes on and stops', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { p, ctx, states } = make();
      await p.play(midi);
      assert.deepEqual(states, ['loading', 'playing']);
      assert.equal(p.media, midi);
      near(p.duration, 1);
      assert.ok(oscs(ctx).length >= 1);
      p.toggle();
      assert.equal(p.state, 'paused');
      p.toggle();
      assert.equal(p.state, 'playing');
      p.stop();
      assert.equal(p.state, 'idle');
      assert.equal(p.media, null);
    } finally {
      mock.timers.reset();
    }
  });

  it('plays an MP3 through <audio>, lets go of its URL when it ends, and waits for ▶ when the browser refuses', async () => {
    const one = make();
    await one.p.play(mp3);
    assert.equal(one.p.state, 'playing');
    assert.equal(one.els[0].src, 'blob:air.mp3');
    assert.equal(one.p.duration, 12);
    one.els[0].ended();
    assert.equal(one.p.state, 'idle');
    assert.deepEqual(one.released, ['air.mp3']);
    assert.equal(one.els[0].loads, 1, 'its buffer let go');

    const two = make({ refuse: { name: 'NotAllowedError', n: 1 } });
    await two.p.play(mp3);
    assert.equal(two.p.state, 'blocked');
    two.p.toggle(); // the tap on ▶
    await new Promise((r) => setImmediate(r));
    assert.equal(two.p.state, 'playing');
  });

  it('says why a sound cannot be played, and drops a load that another sound replaced', async () => {
    const errors = [];
    const bad = make({ bytes: async () => new TextEncoder().encode('not midi') });
    bad.p.onError = (message) => errors.push(message);
    await bad.p.play(midi);
    assert.equal(bad.p.state, 'idle');
    assert.match(errors[0], /not a MIDI file/);

    let release;
    const slow = make({ bytes: () => new Promise((r) => { release = r; }) });
    const first = slow.p.play(midi);
    await slow.p.play(mp3); // while the MIDI file still loads
    release(TUNE);
    await first;
    assert.equal(slow.p.media, mp3, 'the later sound stays');
    assert.equal(slow.p.state, 'playing');
    assert.equal(oscs(slow.ctx).length, 0, 'the MIDI file was not played');

    const refused = make({ refuse: { name: 'NotSupportedError', n: 1 } });
    refused.p.onError = (message) => errors.push(message);
    await refused.p.play(mp3);
    assert.equal(refused.p.state, 'idle');
    assert.equal(errors.length, 2);
  });
});
