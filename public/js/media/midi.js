// Standard MIDI Files (SMF formats 0, 1 and 2, also inside a RIFF "RMID" wrapper) read into a
// song: its notes in seconds, each with its channel's instrument, loudness, pan and pitch bend at
// the time it starts, for the synthesizer (synth.js). Pure, without browser APIs: the tests run it
// in Node. Gutenberg's music books link thousands of small MIDI files (SPEC §3.5 `media`).

/** Notes a song keeps; a file with more is cut there (a damaged or a huge file). */
export const MAX_NOTES = 200000;
/** Events read from one file at most. */
const MAX_EVENTS = 2000000;
/** A quarter note at 120 beats a minute, until a tempo event says otherwise (µs). */
const DEFAULT_TEMPO = 500000;
/** The shortest a note lasts (s): a note-off in the same tick as its note-on is still heard. */
const MIN_NOTE = 0.05;

export class MidiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MidiError';
  }
}

const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
const tagAt = (b, p, tag) => p + 4 <= b.length && b[p] === tag.charCodeAt(0) && b[p + 1] === tag.charCodeAt(1)
  && b[p + 2] === tag.charCodeAt(2) && b[p + 3] === tag.charCodeAt(3);

/** Kinds of events in parseMidi's tracks. */
export const EV = Object.freeze({ OFF: 0, ON: 1, CC: 2, PROGRAM: 3, BEND: 4, TEMPO: 5, NAME: 6 });

/**
 * Parses a Standard MIDI File.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{ format: number, division: number, smpte: number, tracks: Array<Array<{ tick: number,
 *   type: number, ch?: number, a?: number, b?: number, text?: string }>>, truncated: boolean }}
 *   division: ticks per quarter note, or 0 when the file counts time in SMPTE frames, then
 *   `smpte` ticks a second. a/b: key and velocity, controller and value, program, bend (0-16383),
 *   tempo (µs per quarter note).
 */
export function parseMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  // An RMID file is a RIFF chunk holding the SMF (its header 20 bytes in); a few other leading
  // bytes are skipped the same way.
  let p = 0;
  const scan = Math.min(b.length - 14, 1024);
  while (p <= scan && !tagAt(b, p, 'MThd')) p++;
  if (p > scan) throw new MidiError('not a MIDI file (no MThd header)');
  const headerLen = u32(b, p + 4);
  if (headerLen < 6) throw new MidiError('not a MIDI file (short MThd header)');
  const format = u16(b, p + 8);
  const div = u16(b, p + 12);
  let division = div;
  let smpte = 0;
  if (div & 0x8000) {
    // SMPTE: frames a second (two's complement: -24, -25, -29 for 29.97, -30) times ticks a frame.
    const fps = 256 - (div >> 8);
    division = 0;
    smpte = (fps === 29 ? 29.97 : fps) * (div & 0xff);
  }
  if (!division && !smpte) throw new MidiError('not a MIDI file (no time division)');
  p += 8 + headerLen;
  const tracks = [];
  const counted = { events: 0, truncated: false };
  while (p + 8 <= b.length && !counted.truncated) {
    const len = u32(b, p + 4);
    const start = p + 8;
    const end = Math.min(b.length, start + len);
    if (tagAt(b, p, 'MTrk')) tracks.push(readTrack(b, start, end, counted));
    if (start + len > b.length) break; // a damaged length: what was there is read
    p = start + len;
  }
  if (!tracks.length) throw new MidiError('not a MIDI file (no tracks)');
  return { format, division, smpte, tracks, truncated: counted.truncated };
}

function readTrack(b, p, end, counted) {
  const events = [];
  let tick = 0;
  let status = 0;
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4 && p < end; i++) {
      const c = b[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) break;
    }
    return v;
  };
  while (p < end) {
    if (++counted.events > MAX_EVENTS) {
      counted.truncated = true;
      break;
    }
    tick += vlq();
    if (p >= end) break;
    let s = b[p];
    if (s & 0x80) {
      p++;
    } else if (status) {
      s = status; // running status: the data bytes of another message of the same kind
    } else {
      p++; // a data byte with no status before it: skipped
      continue;
    }
    if (s === 0xff) {
      const type = b[p++];
      const len = vlq();
      const at = p;
      p += len;
      if (p > end) break;
      if (type === 0x51 && len >= 3) events.push({ tick, type: EV.TEMPO, a: (b[at] << 16) | (b[at + 1] << 8) | b[at + 2] });
      else if (type === 0x03 && len) events.push({ tick, type: EV.NAME, text: latin1(b, at, len) });
      else if (type === 0x2f) break; // end of track
      continue;
    }
    if (s === 0xf0 || s === 0xf7) { // system exclusive: skipped
      p += vlq();
      continue;
    }
    if (s >= 0xf0) { // other system messages (not allowed in a file, but seen): their data skipped
      p += s === 0xf2 ? 2 : s === 0xf1 || s === 0xf3 ? 1 : 0;
      continue;
    }
    status = s;
    const kind = s & 0xf0;
    const ch = s & 0x0f;
    const d1 = b[p++] & 0x7f;
    const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++] & 0x7f;
    if (p > end) break;
    if (kind === 0x90 && d2 > 0) events.push({ tick, type: EV.ON, ch, a: d1, b: d2 });
    else if (kind === 0x80 || kind === 0x90) events.push({ tick, type: EV.OFF, ch, a: d1 });
    else if (kind === 0xb0) events.push({ tick, type: EV.CC, ch, a: d1, b: d2 });
    else if (kind === 0xc0) events.push({ tick, type: EV.PROGRAM, ch, a: d1 });
    else if (kind === 0xe0) events.push({ tick, type: EV.BEND, ch, a: d1 | (d2 << 7) });
    // 0xa0 (key pressure) and 0xd0 (channel pressure): not played
  }
  return events;
}

function latin1(b, at, len) {
  let s = '';
  for (let i = 0; i < len && i < 200; i++) s += String.fromCharCode(b[at + i]);
  return s.trim();
}

/**
 * The notes of a parsed file, in seconds and in the order they start. A note's `gain` is its
 * velocity times its channel's volume and expression (each squared, as General MIDI's curves),
 * `pan` -1…1, `bend` its pitch bend in cents, all as they were when it started. The sustain pedal
 * (controller 64) holds a note on past its note-off; a note struck again ends the one before.
 * Events of one tick keep the file's order (track by track): a note-on and its note-off in one
 * tick are a short note. A note-off ends the earliest sounding note of its key and channel: two
 * parts in unison on one channel (1st and 2nd Oboe, in Gutenberg's symphonies) are two notes, and
 * a note struck again before the note-off of the one before (in the same tick, by some writers)
 * does not end the new one. At most MAX_STACK notes of one key sound on a channel (a file without
 * note-offs piles none up): another one ends the earliest.
 * @returns {{ notes: Array<{ t: number, d: number, ch: number, key: number, gain: number,
 *   program: number, pan: number, bend: number }>, duration: number, title: string,
 *   truncated: boolean }} channel 9 is percussion (its key names the drum)
 */
export function midiSong(parsed) {
  const all = [];
  parsed.tracks.forEach((track, i) => {
    for (let j = 0; j < track.length; j++) all.push({ e: track[j], i, j });
  });
  // A stable sort: events of one tick keep their order (track by track, as listed).
  all.sort((x, y) => x.e.tick - y.e.tick);
  const chans = Array.from({ length: 16 }, () => ({
    program: 0, volume: 100, expression: 127, pan: 64, bend: 8192, bendRange: 2, sustain: false, rpn: 0x3fff,
    on: new Map(), // key → its sounding notes, earliest first
    held: [], // notes whose note-off came while the sustain pedal was down
  }));
  const notes = [];
  let truncated = !!parsed.truncated;
  let tempo = DEFAULT_TEMPO;
  let lastTick = 0;
  let secs = 0;
  let title = '';
  const timeOf = (tick) => {
    if (parsed.smpte) return tick / parsed.smpte;
    secs += ((tick - lastTick) * tempo) / (1e6 * parsed.division);
    lastTick = tick;
    return secs;
  };
  let t = 0;
  for (const { e } of all) {
    t = timeOf(e.tick);
    const c = e.ch === undefined ? null : chans[e.ch];
    switch (e.type) {
      case EV.TEMPO:
        if (e.a > 0) tempo = e.a;
        break;
      case EV.NAME:
        if (!title) title = e.text;
        break;
      case EV.PROGRAM:
        c.program = e.a;
        break;
      case EV.BEND:
        c.bend = e.a;
        break;
      case EV.CC:
        control(c, e.a, e.b, t);
        break;
      case EV.OFF: {
        const note = c.on.get(e.a)?.shift();
        if (!note) break;
        if (c.sustain) c.held.push(note);
        else finish(note, t);
        break;
      }
      case EV.ON: {
        // A key held by the pedal and struck again: the new note takes over.
        for (let k = c.held.length - 1; k >= 0; k--) {
          if (c.held[k].key === e.a) finish(c.held.splice(k, 1)[0], t);
        }
        let sounding = c.on.get(e.a);
        if (!sounding) c.on.set(e.a, (sounding = []));
        if (sounding.length >= MAX_STACK) finish(sounding.shift(), t);
        if (notes.length >= MAX_NOTES) {
          truncated = true;
          break;
        }
        const v = c.volume / 127;
        const x = c.expression / 127;
        const note = {
          t, d: 0, ch: e.ch, key: e.a, gain: (e.b / 127) * v * v * x * x, program: c.program,
          pan: Math.max(-1, Math.min(1, (c.pan - 64) / 63)), bend: Math.round(((c.bend - 8192) / 8192) * c.bendRange * 100),
        };
        notes.push(note);
        sounding.push(note);
        break;
      }
      default:
    }
  }
  // Notes still on at the end last until then.
  for (const c of chans) silence(c, t);
  let duration = t;
  for (const n of notes) duration = Math.max(duration, n.t + n.d);
  return { notes, duration, title, truncated };
}

/** Notes of one key that sound on a channel at once, at most (midiSong). */
export const MAX_STACK = 4;

function finish(note, t) {
  note.d = Math.max(MIN_NOTE, t - note.t);
}

/** Ends every note of a channel, sounding or held by the pedal. */
function silence(c, t) {
  for (const sounding of c.on.values()) {
    for (const note of sounding) finish(note, t);
    sounding.length = 0;
  }
  release(c, t);
}

/** Ends the notes the pedal held. */
function release(c, t) {
  for (const note of c.held) finish(note, t);
  c.held.length = 0;
}

function control(c, num, val, t) {
  switch (num) {
    case 7: c.volume = val; break;
    case 11: c.expression = val; break;
    case 10: c.pan = val; break;
    case 64:
      c.sustain = val >= 64;
      if (!c.sustain) release(c, t);
      break;
    case 101: c.rpn = (val << 7) | (c.rpn & 0x7f); break;
    case 100: c.rpn = (c.rpn & 0x3f80) | val; break;
    case 6: if (c.rpn === 0) c.bendRange = Math.max(0, Math.min(24, val)); break; // RPN 0: pitch bend range
    case 120: case 123: // all sound off, all notes off
      silence(c, t);
      break;
    case 121: // reset all controllers
      c.expression = 127;
      c.bend = 8192;
      c.sustain = false;
      release(c, t);
      break;
    default:
  }
}
