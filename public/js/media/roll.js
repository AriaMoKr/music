// The piano roll on the music stand (SPEC §5.6 "Sounds"): a MIDI song's notes as bars, time
// across and pitch up, coloured by part, a window of it at a time. Drawn once per window onto
// the stand's canvas (a few hundred rectangles), while only a playhead mesh moves every frame:
// redrawing the canvas each frame would upload its texture each frame (a dropped frame on a
// Quest). Pure (any 2D context): the tests draw it on a stub.

/** Seconds of the song a window shows. */
export const ROLL_SPAN = 8;
/** Where in the window the playhead sits when it is drawn anew (the rest is what comes). */
export const ROLL_LEAD = 0.12;

/** A colour per MIDI channel (drums, channel 10, in grey). */
const PART_COLORS = [
  '#e0a83a', '#6fb3d9', '#d9776f', '#8fca6e', '#c792e0', '#e8d26a', '#6fd9c0', '#e08fb8',
  '#a3a3f0', '#9a9a9a', '#d9a36f', '#7fd98f', '#f0a3a3', '#a3d9f0', '#d9d96f', '#b8b8b8',
];
export const partColor = (ch) => PART_COLORS[ch & 15];

/** The General MIDI instrument families (program >> 3), as the parts list names them. */
export const FAMILY_NAMES = [
  'Piano', 'Bells', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass',
  'Reed', 'Flute', 'Synth lead', 'Synth pad', 'Effects', 'Ethnic', 'Percussion', 'Sounds',
];

/**
 * What the roll needs of a song, once: its pitch range (drums aside), its longest note (to find
 * the notes a window overlaps), and its parts (channel, instrument, notes), in channel order.
 * @param {{ notes: Array<{ t, d, ch, key, program }>, duration: number }} song midi.js midiSong's
 */
export function rollLayout(song) {
  let lo = 127;
  let hi = 0;
  let maxDur = 0;
  const parts = new Map();
  for (const n of song.notes) {
    if (n.d > maxDur) maxDur = n.d;
    let part = parts.get(n.ch);
    if (!part) parts.set(n.ch, part = { ch: n.ch, program: n.program, notes: 0, drums: n.ch === 9 });
    part.notes++;
    if (n.ch === 9) continue;
    if (n.key < lo) lo = n.key;
    if (n.key > hi) hi = n.key;
  }
  if (lo > hi) [lo, hi] = [60, 72];
  // A little room above and below, and at least two octaves shown.
  lo = Math.max(0, lo - 2);
  hi = Math.min(127, Math.max(hi + 2, lo + 24));
  return { lo, hi, maxDur, parts: [...parts.values()].sort((a, b) => a.ch - b.ch) };
}

/** The first note that may still sound at time `t` (notes are in starting order). */
export function firstNoteAt(notes, t, maxDur) {
  let lo = 0;
  let hi = notes.length;
  const from = t - maxDur;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].t < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Where a window starts that shows `pos` (the playhead ROLL_LEAD of the way in). */
export const windowFor = (pos, span = ROLL_SPAN) => Math.max(0, pos - ROLL_LEAD * span);

/** Whether the window starting at `from` still shows `pos` well (else draw the next). */
export const inWindow = (pos, from, span = ROLL_SPAN) => pos >= from && pos <= from + 0.9 * span;

/**
 * Draws the window [from, from + span) of a song into the box { x, y, w, h } of a 2D context:
 * a dark ground, a line at every C (with its name), the notes as bars in their part's colour
 * (muted parts faint), drums as ticks along the bottom.
 * @param {object} [opts] muted: Set of channels; transpose: semitones (shifts the bars)
 * @returns {number} the notes drawn
 */
export function drawRoll(g, song, layout, box, from, span = ROLL_SPAN, { muted = null, transpose = 0 } = {}) {
  const { x, y, w, h } = box;
  const { lo, hi, maxDur } = layout;
  const keys = hi - lo + 1;
  const drumH = layout.parts.some((p) => p.drums) ? Math.max(6, Math.round(h * 0.06)) : 0;
  const kh = (h - drumH) / keys;
  g.fillStyle = '#16120e';
  g.fillRect(x, y, w, h);
  // Octaves: a line at each C.
  g.font = `${Math.max(10, Math.min(14, kh * 6))}px sans-serif`;
  g.textBaseline = 'bottom';
  g.textAlign = 'left';
  for (let k = Math.ceil(lo / 12) * 12; k <= hi; k += 12) {
    const ky = y + h - drumH - (k - lo + 1) * kh;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, ky + kh, w, 1);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillText(`C${k / 12 - 1}`, x + 3, ky + kh);
  }
  // Seconds: a faint tick at each.
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let s = Math.ceil(from); s < from + span; s++) g.fillRect(x + ((s - from) / span) * w, y, 1, h);
  const notes = song.notes;
  const to = from + span;
  let drawn = 0;
  for (let i = firstNoteAt(notes, from, maxDur); i < notes.length && notes[i].t < to; i++) {
    const n = notes[i];
    if (n.t + n.d <= from) continue;
    const x0 = x + Math.max(0, ((n.t - from) / span) * w);
    const x1 = x + Math.min(w, ((n.t + n.d - from) / span) * w);
    g.globalAlpha = muted?.has(n.ch) ? 0.18 : 0.9;
    g.fillStyle = partColor(n.ch);
    if (n.ch === 9) {
      g.fillRect(x0, y + h - drumH, Math.max(2, Math.min(4, x1 - x0)), drumH - 1);
    } else {
      const key = Math.max(lo, Math.min(hi, n.key + transpose));
      g.fillRect(x0, y + h - drumH - (key - lo + 1) * kh, Math.max(2, x1 - x0 - 1), Math.max(2, kh - 0.5));
    }
    drawn++;
  }
  g.globalAlpha = 1;
  return drawn;
}
