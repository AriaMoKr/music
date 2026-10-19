// Listening to the music books (SPEC §3.5 sound lists, §5.6 "Sounds"): a book's sound list, the
// queue and how sounds are named, the piano roll, who wrote a sound and when, the books that play
// on the shelves and by period, and practice (tempo, key, parts, loop) in the synthesizer and
// the player.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { soundRuns, soundsOf } from '../public/js/core/content/sounds.js';
import { QUEUE_MAX, SoundQueue, isGenericLabel, soundHeading, soundRows, soundTitle } from '../public/js/media/queue.js';
import { ROLL_SPAN, drawRoll, firstNoteAt, inWindow, rollLayout, windowFor } from '../public/js/media/roll.js';
import { PERIODS, attribute, attributeAll, bookPeriod, composerIn, composerPeriod } from '../public/js/media/composers.js';
import { MidiSynth, RATE_MAX, RATE_MIN } from '../public/js/media/synth.js';
import { SoundPlayer } from '../public/js/media/player.js';
import { PLAYING_PLACE, collectionsFor, groupPlaces, periodCollections, placeBookCount, playingBooks, playsSounds } from '../public/js/rooms.js';
import { placeFromSearch, placeHref } from '../public/js/place-url.js';
import { partGroups } from '../public/js/ui/music-stand.js';
import { booksThatPlay } from '../public/js/ui/listen-tab.js';
import { TUNE } from './helpers/midi-writer.js';

const link = (href) => ({ href });

describe('a book\'s sound list (core/content/sounds.js soundsOf)', () => {
  const chunks = [[
    { t: 'h', l: 1, r: [['SONGS', 0]] },
    { t: 'h', l: 2, r: [['No. 1 ROMISH LADY', 0]] },
    { t: 'img', src: '/zim/l/C/7_p1.png', w: 400, h: 100 },
    { t: 'p', r: [['[', 0], ['Listen', 0, link('C/music/p1.mid')], ['] [PNG] [MusicXML]', 0]] },
    { t: 'p', r: [['Some prose with no sound.', 0]] },
  ], [
    { t: 'h', l: 2, r: [['No. 2 BEGGAR', 0]] },
    // One link in two styles, then another sound in the same paragraph.
    { t: 'p', r: [['Fig. 2: ', 0], ['Good King ', 1, link('C/music/p2.mid')], ['Wenceslas', 3, link('C/music/p2.mid')], [' or ', 0], ['MP3', 0, link('C/music/p2.mp3')]] },
    { t: 'p', r: [['a ', 0], ['note', 0, link('C/notes.txt')]] },
  ]];

  it('lists each sound link once, where it is, with its kind, headings, paragraph and picture', () => {
    const list = soundsOf(chunks);
    assert.deepEqual(list, [
      { c: 0, b: 3, t: 'Listen', k: 'midi', href: 'C/music/p1.mid', h: 'No. 1 ROMISH LADY', p: 'SONGS', pic: '/zim/l/C/7_p1.png' },
      { c: 1, b: 1, t: 'Good King Wenceslas', k: 'midi', href: 'C/music/p2.mid', h: 'No. 2 BEGGAR', p: 'SONGS', x: 'Fig. 2: or' },
      { c: 1, b: 1, i: 1, t: 'MP3', k: 'audio', href: 'C/music/p2.mp3', h: 'No. 2 BEGGAR', p: 'SONGS', x: 'Fig. 2: or' },
    ], 'the format words beside a sound ([PNG] [MusicXML]) are left out; a link to a file that is no sound is no sound');
  });

  it('finds the runs of a block\'s i-th sound link (the follow-along highlight)', () => {
    const blk = chunks[1][1];
    assert.deepEqual(soundRuns(blk, 0), [1, 3], 'the link\'s two runs');
    assert.deepEqual(soundRuns(blk, 1), [4, 5]);
    assert.equal(soundRuns(blk, 2), null);
    assert.equal(soundRuns(chunks[0][4], 0), null);
  });

  it('takes a static build\'s media for a link, and a table row\'s cells', () => {
    const media = { src: 'zim/l/C/7_a.mid', mime: 'audio/midi', name: 'a.mid' };
    const list = soundsOf([[{ t: 'tr', g: 0, c: [[['Air', 0]], [['play', 0, { media }]]] }]]);
    assert.deepEqual(list, [{ c: 0, b: 0, t: 'play', k: 'midi', media, x: 'Air' }]);
  });
});

describe('the queue and the names of sounds (media/queue.js)', () => {
  const item = (n) => ({ libId: 'l', bookId: 'b', sound: { t: `s${n}` } });

  it('plays its items in turn, back and on, round again when repeating', () => {
    const q = new SoundQueue();
    assert.equal(q.current, null);
    assert.equal(q.next(), null);
    assert.equal(q.set([item(1), item(2), item(3)], { start: 1, source: 'gramophone' }).sound.t, 's2');
    assert.equal(q.source, 'gramophone');
    assert.equal(q.hasPrev, true);
    assert.equal(q.next().sound.t, 's3');
    assert.equal(q.hasNext, false);
    assert.equal(q.next(), null, 'the end: it stays');
    assert.equal(q.current.sound.t, 's3');
    q.repeat = true;
    assert.equal(q.hasNext, true);
    assert.equal(q.next().sound.t, 's1', 'round again');
    assert.equal(q.prev(), null);
    assert.equal(q.add([item(4)]), 1);
    assert.equal(q.length, 4);
    q.remove(0);
    assert.equal(q.current.sound.t, 's2', 'the one after takes the current\'s place');
    q.clear();
    assert.deepEqual([q.length, q.index, q.source], [0, -1, null]);
    q.set(Array.from({ length: QUEUE_MAX + 5 }, (_, i) => item(i)));
    assert.equal(q.length, QUEUE_MAX);
    assert.equal(q.add([item(0)]), 0, 'full');
  });

  it('names a sound by its link\'s words, else a short paragraph, else its heading, else its file', () => {
    assert.equal(isGenericLabel('[Listen]'), true);
    assert.equal(isGenericLabel('Listen (MP3)'), true);
    assert.equal(isGenericLabel('MIDI file'), true);
    assert.equal(isGenericLabel('117-4.mid'), true, 'a file\'s name');
    assert.equal(isGenericLabel('[Listen: Dorian]'), false);
    assert.equal(soundTitle({ t: '[Listen: Dorian]' }), 'Dorian');
    assert.equal(soundTitle({ t: 'Good King Wenceslas', h: 'Carols' }), 'Good King Wenceslas');
    assert.equal(soundTitle({ t: 'Listen', x: 'Fig. 23. Kyrie', h: 'Chant' }), 'Fig. 23. Kyrie');
    assert.equal(soundTitle({ t: 'Listen', x: 'A long paragraph '.repeat(10), h: 'Chant' }), 'Chant', 'prose names nothing');
    assert.equal(soundTitle({ t: 'play', h: 'II', p: 'CHAPTER III THE SONATA' }), 'CHAPTER III THE SONATA · II');
    assert.equal(soundHeading({ h: 'by Ludwig van Beethoven', p: 'Fifth Symphony' }), 'Fifth Symphony · by Ludwig van Beethoven');
    assert.equal(soundTitle({ t: 'Listen', media: { name: 'music_01.mid' } }), 'music 01');
  });

  it('lists sounds under their headings, a tune\'s one sound as one row', () => {
    const rows = soundRows([
      { t: 'Listen', h: 'No. 1 ROMISH LADY', k: 'midi' },
      { t: 'Listen', h: 'Symphony No. 1', k: 'midi' },
      { t: 'Listen', h: 'Symphony No. 1', k: 'audio', media: { name: 'one.mp3' } },
      { t: '[Listen: Dorian]', h: 'Modes', k: 'midi' },
    ]);
    assert.deepEqual(rows, [
      { i: 0, label: 'No. 1 ROMISH LADY', kind: 'MIDI' },
      { heading: 'Symphony No. 1' },
      { i: 1, label: '♪ 1', kind: 'MIDI', under: true },
      { i: 2, label: '♪ 2', kind: 'MP3', under: true },
      { heading: 'Modes' },
      { i: 3, label: 'Dorian', kind: 'MIDI', under: true },
    ], 'a sound named otherwise than its heading stays under it');
  });
});

describe('the piano roll (media/roll.js)', () => {
  const n = (t, key, d = 0.5, ch = 0, program = 0) => ({ t, d, ch, key, gain: 1, program, pan: 0, bend: 0 });
  const song = { notes: [n(0, 60), n(0.5, 64, 4, 1, 40), n(1, 36, 0.1, 9), n(9, 72), n(20, 67)], duration: 20.5 };

  it('knows a song\'s pitch range (drums aside), longest note and parts', () => {
    const L = rollLayout(song);
    assert.deepEqual([L.lo, L.hi, L.maxDur], [58, 82, 4], 'two octaves at least, a little room above and below');
    assert.deepEqual(L.parts.map((p) => [p.ch, p.program, p.notes, p.drums]), [[0, 0, 3, false], [1, 40, 1, false], [9, 0, 1, true]]);
  });

  it('finds the notes a window shows, those still sounding included, and when to draw the next', () => {
    const L = rollLayout(song);
    assert.equal(firstNoteAt(song.notes, 4.4, L.maxDur), 1, 'the long note from 0.5 may still sound at 4.4 (and does)');
    assert.equal(windowFor(10), 10 - 0.12 * ROLL_SPAN);
    assert.equal(windowFor(0.2), 0);
    assert.equal(inWindow(5, 0), true);
    assert.equal(inWindow(7.5, 0), false, 'near its end: the next window');
    // Drawn on a stub: what is filled, and how many notes.
    const rects = [];
    const g = { fillRect: (x, y, w, h) => rects.push([x, y, w, h]), fillText() {}, set fillStyle(v) {}, set globalAlpha(v) {}, set font(v) {}, set textBaseline(v) {}, set textAlign(v) {} };
    assert.equal(drawRoll(g, song, L, { x: 0, y: 0, w: 800, h: 250 }, 0), 3, 'the window\'s three notes (0, 0.5 and the drum)');
    assert.equal(drawRoll(g, song, L, { x: 0, y: 0, w: 800, h: 250 }, 8), 1, 'from 8 s: the note at 9');
    assert.ok(rects.every(([x, , w]) => x >= 0 && x + w <= 800 + 2), 'inside the box');
  });
});

describe('who wrote a sound, and when (media/composers.js)', () => {
  it('finds composers by their names, the more particular first', () => {
    assert.equal(composerIn('by Ludwig van Beethoven').name, 'Ludwig van Beethoven');
    assert.equal(composerIn('Christoph Willibald Gluck (1714-1787)').name, 'Christoph Willibald Gluck');
    assert.equal(composerIn('RICHARD STRAUSS: Don Juan').name, 'Richard Strauss');
    assert.equal(composerIn('a Strauss waltz').name, 'Johann Strauss II');
    assert.equal(composerIn('ALESSANDRO SCARLATTI').name, 'Alessandro Scarlatti');
    assert.equal(composerIn('a sonata of Scarlatti').name, 'Domenico Scarlatti');
    assert.equal(composerIn('C. P. E. Bach and his father').name, 'Carl Philipp Emanuel Bach');
    assert.equal(composerIn('Bach\'s fugues').name, 'Johann Sebastian Bach');
    assert.equal(composerIn('Händel').name, 'George Frideric Handel');
    assert.equal(composerIn('the Bachelor'), null, 'a whole word only');
    assert.equal(composerIn(''), null);
  });

  it('dates them into periods, and guesses one from the words when no composer is named', () => {
    assert.equal(composerPeriod({ born: 1685, died: 1750 }), 'baroque');
    assert.equal(composerPeriod({ born: 1756, died: 1791 }), 'classical');
    assert.equal(composerPeriod({ born: 1810, died: 1849 }), 'romantic');
    assert.equal(composerPeriod({ born: 1862, died: 1918 }), 'romantic', 'by the year they were 35: Debussy in 1897');
    assert.equal(composerPeriod({ born: 1875, died: 1937 }), 'modern');
    assert.equal(attribute({ t: 'Listen', h: 'A Gregorian chant' }).period, 'medieval');
    assert.equal(attribute({ t: 'Listen', h: 'LESSON I. Music of the Chinese, Japanese and Hindoos.' }).period, 'ancient');
    assert.equal(attribute({ t: 'Listen', h: 'The Dying Cowboy' }, { title: 'Cowboy Songs, and Other Frontier Ballads' }).period, 'folk');
    assert.equal(attribute({ t: '[Listen: Dorian]', h: 'The modes' }).period, 'theory');
    assert.equal(attribute({ t: 'Listen', h: 'Overture' }).period, 'other');
    const own = attribute({ t: 'Listen', h: 'An example by Mozart' }, { title: 'Beethoven' });
    assert.equal(own.composer.name, 'Wolfgang Amadeus Mozart', 'its own words before its book\'s title');
    assert.equal(attribute({ t: 'Listen', h: 'Opus 21' }, { title: 'Beethoven' }).composer.name, 'Ludwig van Beethoven');
  });

  it('attributes every sound of the indexes, and gives a book the period most of its sounds are of', () => {
    const books = { a: { title: 'Beethoven' }, b: { title: 'Songs of the West' } };
    const cat = attributeAll([{ libId: 'l', books: [
      { id: 'a', sounds: [{ t: 'Listen', h: 'Opus 21' }, { t: 'Listen', h: 'A scale' }] },
      { id: 'b', sounds: [{ t: 'Listen', h: 'A ballad' }, { t: 'Listen', h: 'Mozart\'s air' }] },
    ] }], (libId, id) => books[id]);
    assert.equal(cat.items.length, 4);
    assert.deepEqual(cat.composers.map((c) => [c.name, c.count, c.books.size]), [['Wolfgang Amadeus Mozart', 1, 1], ['Ludwig van Beethoven', 2, 1]], 'by birth');
    assert.deepEqual(cat.periods.map((p) => [p.id, p.count]), [['classical', 3], ['folk', 1]], 'in time order, those with sounds');
    const of = (id) => bookPeriod(cat.items.filter((it) => it.bookId === id));
    assert.equal(of('a'), 'classical');
    assert.equal(of('b'), 'classical', 'a named composer weighs more than a ballad');
    assert.equal(bookPeriod([]), 'other');
    assert.equal(PERIODS[0].id, 'ancient');
  });
});

describe('the books that play, on the shelves (rooms.js)', () => {
  const lib = { id: 'gutenberg_en_lcc-m_2026-03', kind: 'gutenberg', title: 'Music', sounds: { books: 3, count: 12 } };
  const quiet = { id: 'other_2026-01', kind: 'gutenberg', title: 'Other' };
  const books = [
    { id: '1', title: 'A', sounds: 2, period: 'romantic' },
    { id: '2', title: 'B' },
    { id: '3', title: 'C', sounds: 7, period: 'baroque' },
    { id: '4', title: 'D', sounds: 3, period: 'baroque' },
  ];
  const booksByLib = { [lib.id]: books, [quiet.id]: [{ id: 'x', title: 'X' }] };

  it('is a place of its own when a library has sounds, its books the most sounds first', () => {
    assert.equal(playsSounds(lib), true);
    assert.equal(playsSounds(quiet), false);
    assert.ok(groupPlaces([lib, quiet]).includes(PLAYING_PLACE));
    assert.ok(!groupPlaces([quiet]).includes(PLAYING_PLACE));
    assert.deepEqual(playingBooks(books).map((b) => b.id), ['3', '4', '1']);
    const settings = { place: PLAYING_PLACE.id };
    const [c, ...more] = collectionsFor([lib, quiet], booksByLib, settings);
    assert.equal(more.length, 0, 'only the library that plays');
    assert.deepEqual(c.books.map((b) => b.id), ['3', '4', '1']);
    assert.equal(c.ordered, true);
    assert.equal(c.subtitle, '3 books that play · 12 sounds');
    assert.equal(placeBookCount(PLAYING_PLACE, [lib, quiet], booksByLib), 3);
    assert.deepEqual(booksThatPlay([lib, quiet], booksByLib).map((b) => b.id), ['3', '4', '1']);
  });

  it('is laid out by period when asked: a section per period, in time order', () => {
    const settings = { place: PLAYING_PLACE.id, playingOrder: 'period' };
    const cs = collectionsFor([lib], booksByLib, settings);
    assert.deepEqual(cs.map((c) => [c.title, c.books.map((b) => b.id)]), [['Baroque', ['3', '4']], ['Romantic', ['1']]]);
    assert.equal(cs[0].subtitle, '1600–1750 · 2 books · 10 sounds');
    assert.equal(periodCollections([{ library: lib, books: [{ id: '9', sounds: 1 }] }]), null, 'no periods known yet');
  });

  it('is named by the address (place-url.js)', () => {
    assert.match(placeHref('http://x/?a=1', PLAYING_PLACE.id), /place=playing/);
    assert.deepEqual(placeFromSearch('?place=playing', [lib]), { place: 'playing', room: null });
  });
});

describe('the music stand\'s parts (ui/music-stand.js)', () => {
  it('shows a part each, or by instrument family when there are more than eight', () => {
    const parts = (programs) => programs.map((program, ch) => ({ ch, program, drums: ch === 9 }));
    assert.equal(partGroups(parts([0, 40, 73])).length, 3);
    const groups = partGroups(parts([73, 74, 69, 72, 71, 71, 61, 57, 58, 58, 48, 41, 41, 42, 43, 44]));
    assert.deepEqual(groups.map((g) => g.parts.map((p) => p.ch)), [[0, 1, 3], [2, 4, 5], [6, 7, 8], [9], [10], [11, 12, 13, 14, 15]]);
  });
});

/** A fake AudioContext that records what is scheduled (as media.test.js's). */
function fakeContext() {
  const param = (value = 0) => ({ value, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } });
  const ctx = { currentTime: 0, sampleRate: 8000, state: 'running', destination: { name: 'destination' }, made: [], resume: () => Promise.resolve() };
  const node = (kind, fields = {}) => {
    const n = { kind, ...fields, starts: [], connect: (to) => to, disconnect() {}, start(t) { this.starts.push(t); }, stop() {} };
    ctx.made.push(n);
    return n;
  };
  Object.assign(ctx, {
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0) }),
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { frequency: param(350), Q: param(1) }),
    createBufferSource: () => node('buffer'),
    createBuffer: (c, length) => ({ length, getChannelData: () => new Float32Array(length) }),
    createStereoPanner: () => node('pan', { pan: param(0) }),
    createDynamicsCompressor: () => node('comp', { threshold: param(), knee: param(), ratio: param() }),
    createMediaElementSource: (el) => node('element', { el }),
  });
  return ctx;
}
const oscs = (ctx) => ctx.made.filter((n) => n.kind === 'osc');
const note = (t, key = 69, d = 0.4, more = {}) => ({ t, d, ch: 0, key, gain: 1, program: 0, pan: 0, bend: 0, ...more });

describe('practice in the synthesizer (media/synth.js)', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());
  const advance = (ctx, s) => {
    for (let ms = 0; ms < s * 1000; ms += 100) {
      ctx.currentTime += 0.1;
      mock.timers.tick(100);
    }
  };

  it('plays slower or faster, its notes later or sooner, the pitch the same', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0), note(0.4), note(1.2)], duration: 2 });
    synth.setRate(0.5);
    synth.play();
    const starts = oscs(ctx).map((o) => o.starts[0]);
    assert.equal(starts.length, 2);
    assert.ok(Math.abs(starts[1] - 0.85) < 1e-9, `half as fast: 0.4 s of the song is 0.8 s (${starts})`);
    assert.equal(oscs(ctx)[1].frequency.value, 440);
    advance(ctx, 1);
    assert.ok(Math.abs(synth.position - 0.475) < 1e-9, `the song's time: ${synth.position}`);
    synth.setRate(9);
    assert.equal(synth.rate, RATE_MAX);
    synth.setRate(0);
    assert.equal(synth.rate, RATE_MIN);
  });

  it('plays higher or lower, drums aside, without muted parts, a part with another instrument', () => {
    const ctx = fakeContext();
    const synth = new MidiSynth(ctx, { notes: [note(0, 69), note(0.1, 69, 0.4, { ch: 1 }), note(0.2, 69, 0.4, { ch: 2 })], duration: 1 });
    synth.setTranspose(12);
    synth.setMuted(1, true);
    synth.setProgram(2, 40);
    synth.play();
    const [a, b] = oscs(ctx);
    assert.equal(oscs(ctx).length, 2, 'channel 1 muted');
    assert.equal(a.frequency.value, 880, 'an octave up');
    assert.equal(b.type, 'sawtooth', 'channel 2 as a violin');
    assert.deepEqual([synth.transpose, synth.muted(1), synth.programOf(2), [...synth.mutedChannels]], [12, true, 40, [1]]);
    synth.setProgram(2, null);
    assert.equal(synth.programOf(2), undefined);
  });

  it('goes round a loop, never on to its end', () => {
    const ctx = fakeContext();
    let ended = 0;
    const synth = new MidiSynth(ctx, { notes: [note(0), note(1), note(2), note(3)], duration: 3.4 });
    synth.onEnd = () => ended++;
    synth.setLoop({ a: 0.5, b: 2.5 });
    synth.play();
    advance(ctx, 8);
    assert.equal(ended, 0);
    assert.ok(synth.position >= 0.5 && synth.position <= 2.5, `in the loop: ${synth.position}`);
    synth.setLoop(null);
    assert.equal(synth.loop, null);
    synth.setLoop({ a: 1, b: 1.1 });
    assert.equal(synth.loop, null, 'too short to be a loop');
  });
});

describe('the player: what comes after a sound, where it goes, practice (media/player.js)', () => {
  it('says when a sound has played to its end, plays through a node it is given, and keeps its tempo', async () => {
    const ctx = fakeContext();
    const els = [];
    const p = new SoundPlayer({
      context: () => ctx,
      bytes: async () => TUNE,
      url: async (m) => ({ url: `blob:${m.name}`, release() {} }),
      createAudio: () => {
        const el = { paused: true, currentTime: 0, duration: 10, playbackRate: 1, play() { this.paused = false; return Promise.resolve(); }, pause() {}, removeAttribute() {}, load() {} };
        els.push(el);
        return el;
      },
    });
    const ended = [];
    p.onEnded = (m) => ended.push(m.name);
    const out = { name: 'panner' };
    p.setRate(0.8);
    await p.play({ src: 'x', mime: 'audio/mpeg', name: 'air.mp3' }, { destination: out });
    const el = els[0];
    assert.equal(el.playbackRate, 0.8, 'the tempo kept from before');
    assert.equal(el.preservesPitch, true);
    assert.ok(ctx.made.some((n) => n.kind === 'element' && n.el === el), 'through the given node');
    p.setLoop({ a: 2, b: 5 });
    el.currentTime = 5.2;
    p.checkLoop();
    assert.equal(el.currentTime, 2, 'round the loop');
    el.onended();
    assert.deepEqual(ended, ['air.mp3']);
    assert.equal(p.state, 'idle');
    assert.equal(p.loop, null, 'a loop is the sound\'s own');
    assert.equal(p.rate, 0.8);
  });
});
