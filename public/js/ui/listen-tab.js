// The catalogue stand's Listen tab (SPEC §5.6 "Sounds"): what the gramophone plays. What plays
// now (its picture, book and buttons), then the books that play, a book's sounds, or the queue,
// all of them or only MIDI songs or only recordings (settings.listenKind). Tapping a sound plays
// its book from there on, on the gramophone, which goes on playing while the visitor walks and
// reads. Filled by interaction.js's _fillKiosk (`ix`: the Interaction).

import { UI } from './panel.js';
import { soundRows, soundTitle } from '../media/queue.js';
import { playingBooks, playsSounds } from '../rooms.js';
import { clock } from '../media/player.js';

/** The tab's views, beside each other under what plays (a list, and what one of it holds). */
const VIEWS = [['books', 'Books', 'book'], ['composers', 'Composers', 'composer'], ['periods', 'Periods', 'period'], ['queue', 'Queue']];

/** The kinds of sound the tab shows (settings.listenKind): all, MIDI songs, recordings (MP3s). */
export const LISTEN_KINDS = [['all', 'All'], ['midi', 'MIDI'], ['audio', 'MP3']];
const KIND_WORDS = { all: 'sounds', midi: 'MIDI songs', audio: 'recordings' };

/** Whether a sound (a sound list entry) is of a kind: 'all', 'midi', or 'audio' (a recording). */
export const isOfKind = (sound, kind) => kind === 'all' || !kind || (kind === 'midi' ? sound.k === 'midi' : sound.k !== 'midi');

/** Every book that plays, of every library: the most sounds first. */
export function booksThatPlay(libraries, booksByLib) {
  const out = [];
  for (const l of libraries) if (playsSounds(l)) out.push(...playingBooks(booksByLib[l.id] || []));
  return out.sort((a, b) => b.sounds - a.sounds);
}

/**
 * The books that play sounds of a kind, with how many: [{ book, count }], the most first. All
 * kinds from the books' own counts; one kind from the sound catalogue (Interaction.soundCatalog),
 * or null while it is read.
 */
export function booksOfKind(libraries, booksByLib, catalog, kind) {
  const books = booksThatPlay(libraries, booksByLib);
  if (kind === 'all' || !kind) return books.map((book) => ({ book, count: book.sounds }));
  if (!catalog) return null;
  const counts = new Map();
  for (const it of catalog.items) {
    if (!isOfKind(it.sound, kind)) continue;
    const k = `${it.libId}\n${it.bookId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return books.map((book) => ({ book, count: counts.get(`${book.libId}\n${book.id}`) ?? 0 }))
    .filter((x) => x.count).sort((a, b) => b.count - a.count);
}

const kindCatalogs = new WeakMap(); // catalog -> Map(kind -> the catalog of that kind)

/**
 * The sound catalogue (media/composers.js attributeAll's) of one kind: its items of that kind, and
 * the composers and periods that have any, counted again. Kept per catalogue.
 */
export function catalogOfKind(catalog, kind) {
  if (kind === 'all' || !kind) return catalog;
  if (!kindCatalogs.has(catalog)) kindCatalogs.set(catalog, new Map());
  const kept = kindCatalogs.get(catalog);
  if (kept.has(kind)) return kept.get(kind);
  const items = catalog.items.filter((it) => isOfKind(it.sound, kind));
  const counted = new Map();
  for (const it of items) {
    if (!it.composer) continue;
    if (!counted.has(it.composer.name)) counted.set(it.composer.name, { count: 0, books: new Set() });
    const c = counted.get(it.composer.name);
    c.count++;
    c.books.add(`${it.libId}\n${it.bookId}`);
  }
  const periods = new Map();
  for (const it of items) periods.set(it.period, (periods.get(it.period) ?? 0) + 1);
  const out = {
    items,
    composers: catalog.composers.filter((c) => counted.has(c.name)).map((c) => ({ ...c, ...counted.get(c.name) })),
    periods: catalog.periods.map((pe) => ({ ...pe, count: periods.get(pe.id) ?? 0 })).filter((pe) => pe.count),
  };
  kept.set(kind, out);
  return out;
}

/**
 * Fills the tab from y0 down (the kiosk's tabs above it).
 * @param {import('../interaction.js').Interaction} ix
 * @param {import('./panel.js').Panel} p the kiosk
 */
export function fillListenTab(ix, p, y0, pad) {
  const L = ix._listen;
  let y = y0;
  y = nowPlaying(ix, p, y, pad);
  const tw = 160;
  // What each detail view shows, chosen in its list.
  const chosen = { book: 'book', composer: 'composer', period: 'period' };
  VIEWS.forEach(([id, label, detail], i) => {
    const text = id === 'queue' && ix.queue.length ? `${label} (${ix.queue.length})` : label;
    p.add({
      id: `lst-view-${id}`, type: 'button', x: pad + i * (tw + 12), y, w: tw, h: 50, label: text, size: 22,
      active: L.view === id || (detail && L.view === detail),
      onClick: () => {
        // From its own detail view, back to the list; from elsewhere, to what was chosen in it.
        if (detail && L.view === detail) {
          L.view = id;
          L[chosen[detail]] = null;
        } else {
          L.view = detail && L[chosen[detail]] ? detail : id;
        }
        ix._fillKiosk();
      },
    });
  });
  // Which sounds: all, MIDI songs only, recordings only (not the queue: it is what plays).
  if (L.view !== 'queue') {
    const kind = ix.settings.listenKind ?? 'all';
    const x0 = pad + VIEWS.length * (tw + 12) + 4;
    const kw = (p.w - pad - x0 - 2 * 6) / LISTEN_KINDS.length;
    LISTEN_KINDS.forEach(([id, label], i) => {
      p.add({
        id: `lst-kind-${id}`, type: 'button', x: x0 + i * (kw + 6), y, w: kw, h: 50, label, size: 19, active: kind === id,
        onClick: () => ix.setListenKind(id),
      });
    });
  }
  y += 64;
  const bottom = p.h - 56;
  if (L.view === 'queue') queueView(ix, p, y, pad, bottom);
  else if (L.view === 'book' && L.book) bookView(ix, p, y, pad, bottom);
  else if (L.view === 'composers' || L.view === 'composer' || L.view === 'periods' || L.view === 'period') attributedView(ix, p, y, pad, bottom);
  else booksView(ix, p, y, pad, bottom);
}

/**
 * Composers (by birth: a timeline) and periods (in time order), and a composer's or a period's
 * sounds (media/composers.js: guessed from the words around each sound).
 */
function attributedView(ix, p, y, pad, bottom) {
  const W = p.w;
  const L = ix._listen;
  const kind = ix.settings.listenKind ?? 'all';
  const all = ix.soundCatalog();
  if (!all) {
    p.add({ type: 'text', x: pad, y: y + 10, w: W - 2 * pad, h: 40, size: 24, color: UI.muted, text: ix._listenNote ?? 'Reading the sounds of every book…' });
    return;
  }
  const cat = catalogOfKind(all, kind);
  const back = (label, view, key) => {
    p.add({
      id: 'lst-back', type: 'button', x: pad, y, w: 190, h: 50, label, size: 22,
      onClick: () => {
        L.view = view;
        L[key] = null;
        ix._fillKiosk();
      },
    });
  };
  if (L.view === 'composers' || (L.view === 'composer' && !L.composer)) {
    L.view = 'composers';
    p.add({
      type: 'text', x: pad, y: y + 4, w: W - 2 * pad, h: 30, size: 21, color: UI.muted, maxLines: 1,
      text: `${cat.composers.length} composers named near their ${KIND_WORDS[kind]}, by birth (the names are guessed from the text around each sound)`,
    });
    p.add({
      id: 'lst-composers', type: 'list', x: pad, y: y + 42, w: W - 2 * pad, h: bottom - y - 42, rowH: 72, size: 25, serif: true,
      scroll: L.composersScroll ?? 0,
      items: cat.composers.map((c) => ({
        label: c.name, sub: `${c.born}–${c.died} · ${c.books.size} book${c.books.size === 1 ? '' : 's'}`, right: `${c.count} ♪`,
        active: ix._playing && cat.items.some((it) => it.sound === ix._playing.sound && it.composer?.name === c.name),
        onClick: () => {
          L.composersScroll = p.get('lst-composers')?.scroll ?? 0;
          L.view = 'composer';
          L.composer = c.name;
          ix._fillKiosk();
        },
      })),
    });
    return;
  }
  if (L.view === 'periods' || (L.view === 'period' && !L.period)) {
    L.view = 'periods';
    p.add({ type: 'text', x: pad, y: y + 4, w: W - 2 * pad, h: 30, size: 21, color: UI.muted, maxLines: 1, text: `The ${KIND_WORDS[kind]} by period, from their composers (or what their words say)` });
    p.add({
      id: 'lst-periods', type: 'list', x: pad, y: y + 42, w: W - 2 * pad, h: bottom - y - 42, rowH: 72, size: 25, serif: true,
      items: cat.periods.map((pe) => ({
        label: pe.name, sub: pe.years, right: `${pe.count} ♪`,
        onClick: () => {
          L.view = 'period';
          L.period = pe.id;
          ix._fillKiosk();
        },
      })),
    });
    return;
  }
  // One composer's sounds, or one period's (under their composers' names).
  const composer = L.view === 'composer' ? cat.composers.find((c) => c.name === L.composer) : null;
  const period = L.view === 'period' ? cat.periods.find((pe) => pe.id === L.period) : null;
  if (!composer && !period) { // none of this kind: back to the list
    L.view = L.view === 'composer' ? 'composers' : 'periods';
    L.composer = L.period = null;
    attributedView(ix, p, y, pad, bottom);
    return;
  }
  const items = cat.items.filter((it) => (composer ? it.composer?.name === composer.name : it.period === period?.id));
  if (period) {
    // A period's sounds by composer, in time order, the unnamed last.
    const born = (it) => it.composer?.born ?? Infinity;
    items.sort((a, b) => born(a) - born(b));
  }
  back(composer ? '← Composers' : '← Periods', composer ? 'composers' : 'periods', composer ? 'composer' : 'period');
  p.add({
    type: 'text', x: pad + 206, y: y + 8, w: W - 2 * pad - 206, h: 36, size: 26, weight: '600', serif: true, maxLines: 1,
    text: composer ? `${composer.name} (${composer.born}–${composer.died})` : `${period?.name ?? ''}${period?.years ? ` · ${period.years}` : ''}`,
  });
  y += 62;
  const queued = items.map(({ libId, bookId, sound }) => ({ libId, bookId, sound }));
  p.add({ id: 'lst-all', type: 'button', x: pad, y, w: 230, h: 52, label: '▶ Play all', size: 23, onClick: () => ix.playSounds(queued, null, 'gramophone') });
  p.add({
    id: 'lst-add', type: 'button', x: pad + 244, y, w: 250, h: 52, label: '+ Add to queue', size: 23,
    onClick: () => {
      const n = ix.queue.source === 'gramophone' ? ix.queue.add(queued) : 0;
      if (!n) ix.playSounds(queued, null, 'gramophone');
      else ix.notice('Added to the queue', `${n} sound${n === 1 ? '' : 's'}`, 2.5);
      ix._fillKiosk();
    },
  });
  p.add({ type: 'text', x: pad + 510, y: y + 14, w: W - 2 * pad - 510, h: 30, size: 21, color: UI.muted, align: 'right', maxLines: 1, text: `${items.length} ${KIND_WORDS[kind]}` });
  y += 66;
  const titles = new Map();
  const titleOf = (it) => {
    const k = `${it.libId}\n${it.bookId}`;
    if (!titles.has(k)) titles.set(k, ix.bookOf(it.libId, it.bookId)?.title ?? '');
    return titles.get(k);
  };
  const rows = [];
  let heading = null;
  items.forEach((it, i) => {
    if (period) {
      const h = it.composer?.name ?? 'Not named';
      if (h !== heading) rows.push({ heading: (heading = h) });
    }
    rows.push({ i, it });
  });
  const current = ix._playing ? rows.findIndex((r) => r.it?.sound === ix._playing.sound) : -1;
  p.add({
    id: 'lst-attributed', type: 'list', x: pad, y, w: W - 2 * pad, h: bottom - y, rowH: 72, size: 24, serif: true,
    scroll: Math.max(0, current - 3),
    items: rows.map((r, k) => (r.heading !== undefined
      ? { label: r.heading, disabled: true, weight: '600' }
      : {
        label: soundTitle(r.it.sound), sub: titleOf(r.it), right: r.it.sound.k === 'midi' ? 'MIDI' : 'MP3', indent: period ? 1 : 0, active: k === current,
        onClick: () => ix.playSounds(queued, r.i, 'gramophone'),
      })),
  });
}

/** What plays now: its picture (a tune's score), its name and book, and the buttons. */
function nowPlaying(ix, p, y, pad) {
  const W = p.w;
  const s = ix.sound;
  const item = s.state !== 'idle' ? ix.queue.current ?? ix._playing : null;
  const H = 176;
  p.add({ type: 'rect', x: pad, y, w: W - 2 * pad, h: H, radius: 16, color: 'rgba(255,255,255,0.06)' });
  if (!item) {
    p.add({
      type: 'text', x: pad + 24, y: y + 30, w: W - 2 * pad - 48, h: 120, size: 26, color: UI.muted, maxLines: 3,
      text: ix.world.gramophone
        ? 'The gramophone is silent. Choose a book below and tap one of its sounds, or tap the gramophone itself for a surprise.'
        : 'Nothing is playing. Choose a book below and tap one of its sounds: it plays on while you walk and read.',
    });
    return y + H + 16;
  }
  const book = ix.bookOf(item.libId, item.bookId);
  const picW = item.sound.pic ? 150 : 0;
  if (picW) {
    p.add({ id: 'lst-pic', type: 'image', x: pad + 14, y: y + 13, w: picW, h: H - 26, image: ix._listenPic?.src === item.sound.pic ? ix._listenPic.image : null });
    ix._loadListenPic(item.sound.pic);
  }
  const x = pad + 24 + (picW ? picW + 6 : 0);
  const tw = W - pad - 20 - x;
  p.add({ type: 'text', x, y: y + 14, w: tw, h: 40, size: 30, weight: '600', serif: true, color: UI.accent, maxLines: 1, text: `♪ ${soundTitle(item.sound)}` });
  const where = ix.queue.source === 'gramophone' ? (ix.world.gramophone ? 'on the gramophone' : 'playing on') : 'from the open book';
  const d = s.duration;
  p.add({
    type: 'text', x, y: y + 58, w: tw, h: 30, size: 22, color: UI.muted, maxLines: 1,
    text: `${book?.title ?? 'A book'}${book?.author ? ` · ${book.author}` : ''}`,
  });
  p.add({
    type: 'text', x, y: y + 86, w: tw, h: 28, size: 20, color: UI.muted, maxLines: 1,
    text: `${item.sound.k === 'midi' ? 'MIDI' : 'Recording'}${d ? ` · ${clock(d)}` : ''} · ${where}${ix.queue.length > 1 ? ` · ${ix.queue.index + 1} of ${ix.queue.length}` : ''}`,
  });
  const on = s.state === 'playing' || s.state === 'loading';
  const by = y + H - 62;
  const buttons = [
    ['lst-prev', '⏮', () => ix.prevSound(), !ix.queue.hasPrev],
    ['lst-toggle', on ? '❚❚' : '▶', () => ix.sound.toggle(), s.state === 'loading'],
    ['lst-next', '⏭', () => ix.nextSound(), !ix.queue.hasNext],
    ['lst-stop', '■', () => ix.stopSounds(), false],
  ];
  buttons.forEach(([id, label, fn, disabled], i) => {
    p.add({ id, type: 'button', x: x + i * 84, y: by, w: 74, h: 50, label, size: 24, disabled, active: id === 'lst-toggle' && s.state === 'blocked', onClick: fn });
  });
  // The queue's modes: round again after the last, and in a random order.
  p.add({
    id: 'lst-repeat', type: 'button', x: x + 4 * 84 + 10, y: by, w: 150, h: 50, label: '↻ Repeat', size: 21, active: ix.queue.repeat,
    onClick: () => ix.setQueueMode({ repeat: !ix.queue.repeat }),
  });
  p.add({
    id: 'lst-shuffle', type: 'button', x: x + 4 * 84 + 170, y: by, w: 150, h: 50, label: '⇄ Shuffle', size: 21, active: ix.queue.shuffle,
    onClick: () => ix.setQueueMode({ shuffle: !ix.queue.shuffle }),
  });
  return y + H + 16;
}

/** The books that play (sounds of the kind chosen), the most first. */
function booksView(ix, p, y, pad, bottom) {
  const W = p.w;
  const kind = ix.settings.listenKind ?? 'all';
  const books = booksOfKind(ix.libraries, ix.booksByLib, kind === 'all' ? null : ix.soundCatalog(), kind);
  if (!books) {
    p.add({ type: 'text', x: pad, y: y + 10, w: W - 2 * pad, h: 40, size: 24, color: UI.muted, text: ix._listenNote ?? 'Reading the sounds of every book…' });
    return;
  }
  const sounds = books.reduce((n, b) => n + b.count, 0);
  const none = kind === 'all' ? 'No book here plays yet (its library is still being searched for sounds).' : `No book here has ${KIND_WORDS[kind]}.`;
  p.add({
    type: 'text', x: pad, y: y + 4, w: W - 2 * pad, h: 30, size: 22, color: UI.muted, maxLines: 1,
    text: books.length ? `${books.length.toLocaleString()} books ${kind === 'all' ? 'that play' : 'with them'}, ${sounds.toLocaleString()} ${KIND_WORDS[kind]}: choose one` : none,
  });
  y += 42;
  const L = ix._listen;
  p.add({
    id: 'lst-books', type: 'list', x: pad, y, w: W - 2 * pad, h: bottom - y, rowH: 72, size: 25, serif: true,
    scroll: L.booksScroll ?? 0,
    items: books.map(({ book: b, count }) => ({
      label: b.title, sub: b.author || '', right: `${count} ♪`,
      active: ix._playing?.bookId === b.id && ix._playing?.libId === b.libId,
      onClick: () => {
        L.booksScroll = p.get('lst-books')?.scroll ?? 0;
        L.view = 'book';
        L.book = { libId: b.libId, id: b.id };
        L.bookScroll = null;
        ix._fillKiosk();
      },
    })),
  });
}

/** A book's sounds under their headings: Play all, Add to the queue, a sound to play from. */
function bookView(ix, p, y, pad, bottom) {
  const W = p.w;
  const L = ix._listen;
  const book = ix.bookOf(L.book.libId, L.book.id);
  p.add({
    id: 'lst-back', type: 'button', x: pad, y, w: 150, h: 50, label: '← Books', size: 22,
    onClick: () => {
      L.view = 'books';
      L.book = null;
      ix._fillKiosk();
    },
  });
  p.add({ type: 'text', x: pad + 166, y: y + 8, w: W - 2 * pad - 166, h: 36, size: 26, weight: '600', serif: true, maxLines: 1, text: book?.title ?? '' });
  y += 62;
  const every = ix.soundsOfBook(L.book.libId, L.book.id);
  if (!every) {
    p.add({ type: 'text', x: pad, y: y + 10, w: W - 2 * pad, h: 40, size: 24, color: UI.muted, text: ix._listenNote ?? 'Reading its sounds…' });
    return;
  }
  const kind = ix.settings.listenKind ?? 'all';
  const sounds = every.filter((s) => isOfKind(s, kind));
  if (!sounds.length) {
    const other = every.length - sounds.length;
    p.add({
      type: 'text', x: pad, y: y + 10, w: W - 2 * pad, h: 80, size: 24, color: UI.muted, maxLines: 2,
      text: `This book has no ${KIND_WORDS[kind]} (it has ${other} ${KIND_WORDS[kind === 'midi' ? 'audio' : 'midi']}): All shows them.`,
    });
    return;
  }
  const items = sounds.map((sound) => ({ libId: L.book.libId, bookId: L.book.id, sound }));
  p.add({ id: 'lst-all', type: 'button', x: pad, y, w: 230, h: 52, label: '▶ Play all', size: 23, onClick: () => ix.playSounds(items, null, 'gramophone') });
  p.add({
    id: 'lst-add', type: 'button', x: pad + 244, y, w: 250, h: 52, label: '+ Add to queue', size: 23,
    onClick: () => {
      const n = ix.queue.source === 'gramophone' ? ix.queue.add(items) : 0;
      if (!n) ix.playSounds(items, null, 'gramophone');
      else ix.notice('Added to the queue', `${n} sound${n === 1 ? '' : 's'} of ${book?.title ?? 'the book'}`, 2.5);
      ix._fillKiosk();
    },
  });
  p.add({ id: 'lst-read', type: 'button', x: pad + 508, y, w: 220, h: 52, label: 'Find the book', size: 23, onClick: () => book && ix.ensureShelved(book).then((ok) => ok && ix.showBook(book)) });
  y += 66;
  const rows = soundRows(sounds);
  const playing = ix._playing?.bookId === L.book.id && ix._playing?.libId === L.book.libId ? ix._playing.sound : null;
  const current = playing ? rows.findIndex((r) => r.i !== undefined && sounds[r.i] === playing) : -1;
  p.add({
    id: 'lst-sounds', type: 'list', x: pad, y, w: W - 2 * pad, h: bottom - y, rowH: 58, size: 24, serif: true,
    scroll: L.bookScroll ?? Math.max(0, current - 3),
    items: rows.map((r, k) => (r.i === undefined
      ? { label: r.heading, disabled: true, weight: '600' }
      : {
        label: r.label, right: r.kind, indent: r.under ? 1 : 0, active: k === current,
        onClick: () => {
          L.bookScroll = p.get('lst-sounds')?.scroll ?? null;
          ix.playSounds(items, r.i, 'gramophone');
        },
      })),
  });
}

/** What plays next: the queue, the sound playing marked; tap one to play it. */
function queueView(ix, p, y, pad, bottom) {
  const W = p.w;
  const q = ix.queue;
  if (!q.length) {
    p.add({ type: 'text', x: pad, y: y + 10, w: W - 2 * pad, h: 80, size: 24, color: UI.muted, maxLines: 2, text: 'The queue is empty: Play all or Add to queue a book\'s sounds.' });
    return;
  }
  p.add({ id: 'lst-clear', type: 'button', x: pad, y, w: 200, h: 50, label: '✕ Clear', size: 22, onClick: () => ix.stopSounds() });
  p.add({
    type: 'text', x: pad + 216, y: y + 12, w: W - 2 * pad - 216, h: 30, size: 21, color: UI.muted, maxLines: 1,
    text: q.source === 'gramophone' ? 'On the gramophone: it plays on while you walk and read.' : 'From the open book: it stops when the book goes back.',
  });
  y += 62;
  const titles = new Map();
  const titleOf = (it) => {
    const key = `${it.libId}\n${it.bookId}`;
    if (!titles.has(key)) titles.set(key, ix.bookOf(it.libId, it.bookId)?.title ?? '');
    return titles.get(key);
  };
  p.add({
    id: 'lst-queue', type: 'list', x: pad, y, w: W - 2 * pad, h: bottom - y, rowH: 72, size: 24, serif: true,
    scroll: Math.max(0, q.index - 3),
    items: q.items.map((it, i) => ({
      label: soundTitle(it.sound), sub: titleOf(it), right: it.sound.k === 'midi' ? 'MIDI' : 'MP3', active: i === q.index,
      onClick: () => ix.playQueued(i),
    })),
  });
}
