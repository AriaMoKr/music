// What plays after the sound playing (SPEC §5.6 "Sounds"): a book's sounds one after another
// ("Play all" in its Sounds list), or what the gramophone was given (the catalogue stand's Listen
// tab). Pure, so the tests run it in Node; interaction.js plays its items.
//
// An item is { libId, bookId, sound }: `sound` an entry of a sound list (SPEC §3.5 sound lists:
// { c, b, i?, t, k, media, h?, p?, x?, pic? }).

/** Most items a queue holds (a book's 407 sounds fit; the whole Music ZIM's 5,215 do not). */
export const QUEUE_MAX = 2000;

/** Shuffles `a` in place (Fisher–Yates), `random` giving numbers in [0, 1). */
function shuffleInPlace(a, random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class SoundQueue {
  /** @param {{ random?: () => number }} [o] what a shuffle draws from (Math.random; a test's own) */
  constructor({ random = Math.random } = {}) {
    /** @type {Array<{ libId: string, bookId: string, sound: object }>} The items in the order they play. */
    this.items = [];
    /** The item playing (or to play), -1 when none. */
    this.index = -1;
    /**
     * Counts the moves to an item (set, go, next, prev): another sound for the Now playing bar,
     * where the index would change with a shuffle too.
     */
    this.moves = 0;
    /** Who filled it: 'book' (the reader: stops when the book is put back) or 'gramophone'. */
    this.source = null;
    /** Starts again at the first item after the last. */
    this.repeat = false;
    /**
     * Plays the items in a random order (setShuffle): the one playing first, the others dealt after
     * it, dealt again each time round when repeating; Play all (set's `start` null) from any.
     */
    this.shuffle = false;
    /** While shuffled, the items in their own order (turning the shuffle off puts them back), else null. */
    this._order = null;
    this.random = random;
    /**
     * Goes on to the next item when one ends (Play all, the gramophone); false plays one at a time,
     * the next only when asked for (⏭): a link's sound, or a row of the Sounds list, among its book's.
     */
    this.advance = true;
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

  /**
   * Replaces the queue with `items` (at most QUEUE_MAX), from item `start` (null: the first, or
   * any when shuffled; shuffled, the others follow it in a random order): the current item, or null.
   */
  set(items, { start = 0, source = 'book', advance = true } = {}) {
    this.items = items.slice(0, QUEUE_MAX);
    this._order = null;
    const n = this.items.length;
    this.index = n ? Math.max(0, Math.min(n - 1, start ?? 0)) : -1;
    this.source = n ? source : null;
    this.advance = advance;
    if (this.shuffle && n) this._deal(start == null ? null : this.current);
    this.moves++;
    return this.current;
  }

  /**
   * Shuffles the items (the one playing first, the others dealt after it in a random order), or
   * puts them back in their own order, from the one playing.
   */
  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    if (on) {
      if (this.items.length) this._deal(this.current);
    } else if (this._order) {
      const current = this.current;
      this.items = this._order;
      this._order = null;
      this.index = Math.max(0, this.items.indexOf(current));
    }
  }

  /** Deals the items in a random order, `first` (an item, or null: any) first, keeping their own in _order. */
  _deal(first) {
    if (!this._order) this._order = this.items;
    const rest = this._order.slice();
    const at = first ? rest.indexOf(first) : -1;
    if (at >= 0) rest.splice(at, 1);
    shuffleInPlace(rest, this.random);
    this.items = at >= 0 ? [first, ...rest] : rest;
    this.index = this.items.length ? 0 : -1;
  }

  /** The item that follows when the current one ends: the next, or null (one at a time: none). */
  ended() {
    return this.advance ? this.next() : null;
  }

  /**
   * Adds items at the end (the current one stays; shuffled, in among those still to come at
   * random); returns how many were added.
   */
  add(items, { source = 'gramophone' } = {}) {
    const added = items.slice(0, Math.max(0, QUEUE_MAX - this.items.length));
    if (!added.length) return 0;
    const empty = !this.items.length;
    if (this._order) {
      this._order.push(...added);
      for (const it of added) this.items.splice(this.index + 1 + Math.floor(this.random() * (this.items.length - this.index)), 0, it);
    } else {
      this.items.push(...added);
    }
    if (this.index < 0) this.index = this.items.length - added.length;
    if (empty && this.shuffle) this._deal(null);
    this.source = source;
    return added.length;
  }

  /** Goes to item i: it, or null when there is none. */
  go(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    this.index = i;
    this.moves++;
    return this.current;
  }

  /**
   * The next item (the first again when repeating, the items dealt again when shuffled), or null
   * at the end (the queue stays).
   */
  next() {
    if (this.index < 0) return null;
    if (this.index + 1 < this.items.length) return this.go(this.index + 1);
    if (!this.repeat || !this.items.length) return null;
    if (!this.shuffle || this.items.length < 2) return this.go(0);
    const last = this.current;
    this._deal(null);
    if (this.items[0] === last) { // not the one just played again at once
      const j = 1 + Math.floor(this.random() * (this.items.length - 1));
      [this.items[0], this.items[j]] = [this.items[j], this.items[0]];
    }
    this.moves++;
    return this.current;
  }

  prev() {
    return this.index > 0 ? this.go(this.index - 1) : null;
  }

  /** Takes item i out (the one after takes the place of a current one taken out). */
  remove(i) {
    if (i < 0 || i >= this.items.length) return;
    const [it] = this.items.splice(i, 1);
    const j = this._order ? this._order.indexOf(it) : -1;
    if (j >= 0) this._order.splice(j, 1);
    if (i < this.index) this.index--;
    if (this.index >= this.items.length) this.index = this.items.length - 1;
    if (!this.items.length) this.clear();
  }

  /** Empties the queue (repeat and shuffle stay as they are). */
  clear() {
    this.items = [];
    this._order = null;
    this.index = -1;
    this.source = null;
    this.advance = true;
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
