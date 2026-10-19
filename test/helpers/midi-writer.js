// Writes Standard MIDI Files for tests: each track a list of events [delta ticks, ...bytes], an
// end-of-track meta event appended unless `end` is false.

export function vlq(n) {
  const out = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const chunk = (tag, body) => [...Buffer.from(tag, 'latin1'), ...u32(body.length), ...body];

/**
 * @param {{ format?: number, division?: number, tracks: Array<Array<number[]>>, end?: boolean }} o
 *   division: ticks per quarter note, or the raw 16-bit SMPTE value
 * @returns {Uint8Array}
 */
export function smf({ format = 1, division = 480, tracks, end = true }) {
  const body = tracks.map((events) => chunk('MTrk', [
    ...events.flatMap(([dt, ...bytes]) => [...vlq(dt), ...bytes]),
    ...(end ? [0, 0xff, 0x2f, 0] : []),
  ]));
  return Uint8Array.from([...chunk('MThd', [...u16(format), ...u16(tracks.length), ...u16(division)]), ...body.flat()]);
}

/** Meta events: a tempo (µs per quarter note) and a track name. */
export const tempo = (dt, us) => [dt, 0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
export const name = (dt, text) => [dt, 0xff, 0x03, ...vlq(text.length), ...Buffer.from(text, 'latin1')];

/** A short tune: middle C then E on a piano, a quarter note each at 120 beats a minute. */
export const TUNE = smf({
  tracks: [
    [name(0, 'Tune'), tempo(0, 500000)],
    [[0, 0xc0, 0], [0, 0x90, 60, 100], [480, 0x80, 60, 0], [0, 0x90, 64, 100], [480, 0x80, 64, 0]],
  ],
});
