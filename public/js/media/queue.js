// What plays after the sound playing (SPEC §5.6 "Sounds"): a book's sounds one after another
// ("Play all" in its Sounds list), or what the gramophone was given (the catalogue stand's Listen
// tab). Pure, so the tests run it in Node; interaction.js plays its items.
//
// An item is { libId, bookId, sound }: `sound` an entry of a sound list (SPEC §3.5 sound lists:
// { c, b, i?, t, k, media, h?, p?, x?, pic? }).

/** Most items a queue holds (a book's 407 sounds fit; the whole Music ZIM's 5,215 do not). */
export const QUEUE_MAX = 2000;

export class SoundQueue {
  constructor() {
    /** @type {Array<{ libId: string, bookId: string, sound: object }>} */
    this.items = [];
    /** The item playing (or to play), -1 when none. */
    this.index = -1;
    /** Who filled it: 'book' (the reader: stops when the book is put back) or 'gramophone'. */
    this.source = null;
    /** Starts again at the first item after the last. */
    this.repeat = false;
  }

  get current() {
    return this.items[this.index] ?? null;
  }

  get length() {
    return this.items.length;
  }

  /** Whether another item follows the current one. */
  get hasNext() {
    return this.index >= 0 && (this.index + 1 < this.items.length || (this.repeat && this.items.length > 1));
  }

  get hasPrev() {
    return this.index > 0;
  }

  /** Replaces the queue with `items` (at most QUEUE_MAX), from item `start`: the current item, or null. */
  set(items, { start = 0, source = 'book' } = {}) {
    this.items = items.slice(0, QUEUE_MAX);
    this.index = this.items.length ? Math.max(0, Math.min(this.items.length - 1, start)) : -1;
    this.source = this.items.length ? source : null;
    return this.current;
  }

  /** Adds items at the end (the current one stays); returns how many were added. */
  add(items, { source = 'gramophone' } = {}) {
    const room = Math.max(0, QUEUE_MAX - this.items.length);
    const added = items.slice(0, room);
    this.items.push(...added);
    if (added.length && this.index < 0) this.index = this.items.length - added.length;
    if (added.length) this.source = source;
    return added.length;
  }

  /** Goes to item i: it, or null when there is none. */
  go(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    this.index = i;
    return this.current;
  }

  /** The next item (the first again when repeating), or null at the end (the queue stays). */
  next() {
    if (this.index < 0) return null;
    if (this.index + 1 < this.items.length) return this.go(this.index + 1);
    return this.repeat && this.items.length ? this.go(0) : null;
  }

  prev() {
    return this.index > 0 ? this.go(this.index - 1) : null;
  }

  /** Takes item i out (the one after takes the place of a current one taken out). */
  remove(i) {
    if (i < 0 || i >= this.items.length) return;
    this.items.splice(i, 1);
    if (i < this.index) this.index--;
    if (this.index >= this.items.length) this.index = this.items.length - 1;
    if (!this.items.length) this.clear();
  }

  clear() {
    this.items = [];
    this.index = -1;
    this.source = null;
  }
}

/** A link's words that say only "play this" ("Listen", "[MIDI]", "here"): the sound is named otherwise. */
const GENERIC = /^[\s[(]*(?:listen(?: to)?|play(?: music)?|hear|here|click(?: here)?|audio|sound|music|midi|mp3|ogg|wav|file|recording)(?:[\s,.:;!-]*(?:\(?(?:midi|mp3|ogg|wav|file|audio|version|to (?:midi|mp3))\)?))*[\s\].)!.]*$/i;

/** A link text that is the file's name ("117-4.mid", "[music001.mp3]"). */
const FILE_NAME = /^[\s[(]*[\w.-]+\.(?:mid|midi|kar|rmi|mp3|m4a|ogg|oga|wav|flac)[\s\])]*$/i;

/** True for a link text that says only "play this", or is the file's name. */
export const isGenericLabel = (t) => !t || GENERIC.test(t) || FILE_NAME.test(t);

/** A paragraph's text short enough to name a sound ("Fig. 23. Kyrie"), not a page of prose. */
const NAMING_X = 70;

/** A link's words without "[Listen: …]" around what they name ("Dorian"). */
function ownWords(t) {
  const inner = t.replace(/^\s*\[\s*/, '').replace(/\s*\]\s*$/, '');
  const named = inner.replace(/^(?:listen|play|hear)(?: to)?\s*[:–-]?\s*/i, '');
  return named || inner;
}

/**
 * A sound's heading as lists show it: the heading, after the one above it when it is only a
 * number ("CHAPTER III … · II").
 */
export function soundHeading(sound) {
  if (!sound.h) return sound.p ?? '';
  // A number ("II"), or only who wrote it ("by Ludwig van Beethoven"): after what it is under.
  return (sound.h.length < 6 || /^by\s/i.test(sound.h)) && sound.p ? `${sound.p} · ${sound.h}` : sound.h;
}

/**
 * What a sound is called in lists: its link's words when they name it ("Dorian", "Good King
 * Wenceslas"), else a short paragraph around it ("Fig. 23. Kyrie"), else its heading, else its
 * file's name.
 * @param {object} sound a sound list entry
 */
export function soundTitle(sound) {
  if (!isGenericLabel(sound.t)) return ownWords(sound.t);
  if (sound.x && sound.x.length >= 3 && sound.x.length <= NAMING_X) return sound.x;
  if (sound.h || sound.p) return soundHeading(sound);
  return sound.media?.name?.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') || sound.t || 'Sound';
}

/**
 * A sound list as rows of a list (the reader's Sounds list, the gramophone's): a heading row
 * where the heading changes, then a row per sound, named by soundTitle, or by its number under
 * its heading when that is all its title says.
 * @param {object[]} sounds
 * @returns {Array<{ heading: string } | { i: number, label: string, kind: string, under?: true }>}
 *   i: the sound's index in `sounds`; under: below a heading row
 */
export function soundRows(sounds) {
  // Runs of sounds under one heading.
  const groups = [];
  sounds.forEach((s, i) => {
    const h = soundHeading(s);
    if (groups.at(-1)?.heading !== h) groups.push({ heading: h, items: [] });
    groups.at(-1).items.push(i);
  });
  const rows = [];
  for (const { heading, items } of groups) {
    const titles = items.map((i) => soundTitle(sounds[i]));
    // A tune's one sound, named by its heading: one row, named so.
    if (items.length === 1 && (!heading || titles[0] === heading)) {
      rows.push({ i: items[0], label: titles[0], kind: soundKind(sounds[items[0]]) });
      continue;
    }
    if (heading) rows.push({ heading });
    items.forEach((i, n) => rows.push({ i, label: heading && titles[n] === heading ? `♪ ${n + 1}` : titles[n], kind: soundKind(sounds[i]), ...(heading ? { under: true } : {}) }));
  }
  return rows;
}

/** "MIDI" or "MP3" (a recording of another kind by its file's ending). */
export function soundKind(sound) {
  if (sound.k === 'midi') return 'MIDI';
  const ext = /\.([a-z0-9]+)$/i.exec(sound.media?.name ?? '')?.[1];
  return ext ? ext.toUpperCase() : 'Recording';
}
