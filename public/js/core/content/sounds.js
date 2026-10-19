// Sounds books link (SPEC §3.5 `media`): which links name one, which archive entries are one, and
// which are MIDI (played through the synthesizer: no browser plays MIDI itself). Shared by the
// core (conversion, resolveLink), the reader (media/player.js) and the static build.

/**
 * An archive path that names a sound: a link to one is kept as a book is converted and played when
 * followed. Gutenberg's books link MIDI and MP3 files ("Listen"), or embed an <audio> player.
 */
export const SOUND_PATH = /\.(?:mid|midi|kar|rmi|mp3|m4a|aac|oga|ogg|opus|wav|flac)$/i;

/** The MIME types of sounds (MIDI is audio/midi, or audio/x-midi, application/x-midi). */
export const SOUND_MIME = /^audio\/|midi/i;

/** True for a MIDI file (by its type, else its name). */
export const isMidi = (media) => /midi/i.test(media?.mime ?? '') || /\.(?:mid|midi|kar|rmi)$/i.test(media?.name ?? '');

/** Longest a sound list keeps a heading or a paragraph's text (characters). */
const TEXT_MAX = 140;

const clean = (s) => {
  const t = s.replace(/[\s\uFFFC]+/g, ' ').trim();
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1).trimEnd()}…` : t;
};
/**
 * What a paragraph says of the other files beside a sound ("[PNG] [XML] | View/Download PDF"):
 * Gutenberg's links to them are gone, their words are left out of the paragraph's text `x`.
 */
const FORMATS = /\[[^\]]{0,40}\]|\||\b(?:(?:view\/)?download|view|larger image|see larger version|pdf|png|xml|musicxml|finale|lilypond|abc|midi|mp3)\b/gi;
const runsOf = (blk) => blk.r ?? (blk.c ? blk.c.flat() : []);
const isPicture = (run) => run.length > 2 && run[2]?.src !== undefined && run[0] === '\uFFFC';

/** The sound a run's link names: its href (SOUND_PATH) or media, as a key and the link; else null. */
function soundOf(run) {
  const x = run.length > 2 ? run[2] : null;
  if (!x) return null;
  if (x.media) return { key: `m${x.media.src ?? x.media.remote?.start ?? ''}\n${x.media.name}`, x };
  if (typeof x.href === 'string' && SOUND_PATH.test(x.href.replace(/#.*$/, ''))) return { key: `h${x.href}`, x };
  return null;
}

/** A picture block's src near block `b` (a tune's score beside its "Listen"), or null. */
function pictureNear(blocks, b) {
  for (let i = b - 1; i >= Math.max(0, b - 4); i--) {
    const blk = blocks[i];
    if (blk.t === 'img') return blk.src;
    if (blk.t === 'h' || runsOf(blk).some((r) => soundOf(r))) break; // the tune before's
  }
  for (let i = b + 1; i <= Math.min(blocks.length - 1, b + 2); i++) {
    const blk = blocks[i];
    if (blk.t === 'img') return blk.src;
    if (blk.t === 'h' || runsOf(blk).some((r) => soundOf(r))) break;
  }
  return null;
}

/**
 * The sounds a book's links name, in reading order (SPEC §3.5 sound lists: a book's "Sounds" list,
 * the library's sound index): one per link (a link's runs together), with where it is (chunk c,
 * block b, and `i` its place among the block's sound links when not the first), its text `t`, its
 * kind `k` ('midi' or 'audio'), its `href` (or the static build's `media`), the nearest heading
 * `h` and the one above that `p`, the rest of its paragraph `x`, and `pic`, a picture next to it
 * (a tune's score). Pure: the core, the reader and the build use it.
 * @param {Array<object[]>} chunks each chunk's blocks
 * @returns {object[]}
 */
export function soundsOf(chunks) {
  const out = [];
  const heads = []; // heads[l]: the latest heading of level l (deeper ones dropped by a new one)
  chunks.forEach((blocks, c) => {
    blocks.forEach((blk, b) => {
      if (blk.t === 'h') {
        heads.length = blk.l + 1;
        heads[blk.l] = clean(runsOf(blk).filter((r) => !isPicture(r)).map((r) => r[0]).join(''));
        return;
      }
      const runs = runsOf(blk);
      let found = null;
      for (let i = 0; i < runs.length; i++) {
        const s = soundOf(runs[i]);
        if (!s) continue;
        const last = found?.at(-1);
        if (last && last.key === s.key && last.end === i) { // the same link, in another style
          last.text += runs[i][0];
          last.end = i + 1;
        } else {
          (found ??= []).push({ ...s, text: runs[i][0], start: i, end: i + 1 });
        }
      }
      if (!found) return;
      let rest = clean(runs.filter((r) => !soundOf(r) && !isPicture(r)).map((r) => r[0]).join('').replace(FORMATS, ' '));
      if (!/[\p{L}\p{N}]{2}/u.test(rest)) rest = ''; // only the brackets around a [Listen]
      let h = null;
      let p = null;
      for (let l = heads.length - 1; l >= 0; l--) {
        if (!heads[l]) continue;
        if (h === null) h = heads[l];
        else {
          p = heads[l];
          break;
        }
      }
      const pic = pictureNear(blocks, b);
      found.forEach((s, i) => {
        const media = s.x.media;
        const k = isMidi(media ?? { name: s.x.href.replace(/#.*$/, '') }) ? 'midi' : 'audio';
        out.push({
          c, b, ...(i ? { i } : {}), t: clean(s.text) || (k === 'midi' ? 'MIDI' : 'Listen'), k,
          ...(media ? { media } : { href: s.x.href }),
          ...(h ? { h } : {}), ...(p ? { p } : {}), ...(rest ? { x: rest } : {}), ...(pic ? { pic } : {}),
        });
      });
    });
  });
  return out;
}

/**
 * The runs of the `i`-th sound link of a block (a sound list entry's place: c, b, i), as soundsOf
 * counts them: their indexes [start, end) in the block's runs (a table row's cells flattened), or
 * null when the block has no such link.
 */
export function soundRuns(blk, i = 0) {
  const runs = runsOf(blk);
  let n = -1;
  let prev = null;
  for (let r = 0; r < runs.length; r++) {
    const s = soundOf(runs[r]);
    if (!s) {
      prev = null;
      continue;
    }
    if (!prev || prev.key !== s.key) n++;
    prev = s;
    if (n !== i) continue;
    let end = r + 1;
    while (end < runs.length && soundOf(runs[end])?.key === s.key) end++;
    return [r, end];
  }
  return null;
}
