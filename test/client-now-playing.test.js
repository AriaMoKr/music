// The "Now playing" bar (public/js/ui/now-playing.js, SPEC §5.6 "Sounds"): what it shows of the
// sound playing, its buttons' states, and when a sound counts as another (said once as it starts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barButton, MEDIA_KEYS, nowPlayingOf, startedText, withBarStops } from '../public/js/ui/now-playing.js';

const BOOK = { libId: 'm', id: '7', title: 'How Music Developed', author: 'Henderson' };
const tune = { c: 2, b: 14, t: 'Listen', k: 'midi', h: 'The G scale', media: { src: '/zim/m/C/7_g.mid', name: 'g.mid', mime: 'audio/midi' } };
const air = { c: 2, b: 20, i: 1, t: 'Air', k: 'audio', media: { src: '/zim/m/C/air.mp3', name: 'air.mp3', mime: 'audio/mpeg' } };

/** An Interaction stand-in: its player, its queue and the books. */
function ix({ state = 'playing', items = [tune], index = 0, source = 'book', duration = 75, gramophone = false } = {}) {
  const queued = items.map((sound) => ({ libId: 'm', bookId: '7', sound }));
  return {
    sound: { state, duration, media: queued[index]?.sound.media ?? { name: 'loose_tune.mid', mime: 'audio/midi' } },
    queue: {
      source, index, length: queued.length,
      get current() { return queued[index] ?? null; },
      get hasNext() { return index < queued.length - 1; },
    },
    _playing: queued[index] ?? null,
    book: BOOK,
    bookOf: (libId, id) => (libId === 'm' && id === '7' ? BOOK : null),
    world: { gramophone: gramophone ? {} : null },
  };
}

describe('the Now playing bar', () => {
  it('shows nothing while no sound is loaded', () => {
    assert.equal(nowPlayingOf(ix({ state: 'idle' })), null);
    assert.equal(nowPlayingOf({ sound: null }), null);
  });

  it('names the sound and its book, and says what kind, how long and where', () => {
    const np = nowPlayingOf(ix());
    assert.equal(np.title, 'The G scale', 'a "Listen" is named by its heading, as on the Listen tab');
    assert.equal(np.book, 'How Music Developed · Henderson');
    assert.equal(np.line, 'MIDI · 1:15 · from the open book');
    assert.deepEqual([np.playing, np.loading, np.blocked, np.hasNext], [true, false, false, false]);
    const g = nowPlayingOf(ix({ items: [tune, air], index: 1, source: 'gramophone', duration: 0, gramophone: true }));
    assert.equal(g.title, 'Air');
    assert.equal(g.line, 'Recording · on the gramophone · 2 of 2', 'no length before it is known; its place in the queue');
  });

  it('gives the buttons their states: paused, loading, waiting for a tap, a next sound', () => {
    assert.equal(nowPlayingOf(ix({ state: 'paused' })).playing, false);
    const loading = nowPlayingOf(ix({ state: 'loading' }));
    assert.deepEqual([loading.playing, loading.loading], [true, true], 'shown as playing (Pause), not yet pressable');
    assert.equal(nowPlayingOf(ix({ state: 'blocked' })).blocked, true);
    assert.equal(nowPlayingOf(ix({ items: [tune, air] })).hasNext, true);
  });

  it('counts another sound as another, not the same one paused, resumed or timed', () => {
    const a = nowPlayingOf(ix({ items: [tune, air] }));
    assert.equal(nowPlayingOf(ix({ items: [tune, air], state: 'paused', duration: 0 })).key, a.key);
    assert.notEqual(nowPlayingOf(ix({ items: [tune, air], index: 1 })).key, a.key);
  });

  it('names a sound played without a list entry by its file, from the open book', () => {
    const loose = ix({ items: [] });
    const np = nowPlayingOf(loose);
    assert.equal(np.title, 'loose tune');
    assert.equal(np.book, 'How Music Developed · Henderson');
  });

  it('says a sound once as it starts, and asks for Play when the browser waits for a tap', () => {
    assert.equal(startedText(nowPlayingOf(ix())), 'Playing The G scale, from How Music Developed · Henderson.');
    assert.equal(startedText(nowPlayingOf(ix({ state: 'blocked' }))), 'The G scale, from How Music Developed · Henderson: press Play to hear it.');
  });
});

describe("a TV remote's media keys on the bar", () => {
  const press = (key, o) => barButton(nowPlayingOf(ix(o)), MEDIA_KEYS[key]);

  it('reads play/pause, play, pause, stop and next, and leaves rewind and fast-forward to turning', () => {
    assert.deepEqual(Object.keys(MEDIA_KEYS), ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'Pause', 'MediaStop', 'MediaTrackNext']);
    assert.equal(MEDIA_KEYS.Pause, MEDIA_KEYS.MediaPause, "a Bluetooth remote's Pause (Android's BREAK key)");
    assert.equal(MEDIA_KEYS.MediaRewind, undefined, "common's keyOf reads it as ArrowLeft");
    assert.equal(MEDIA_KEYS.MediaFastForward, undefined);
  });

  it('presses the button each stands for', () => {
    assert.equal(press('MediaPlayPause'), 'toggle');
    assert.equal(press('MediaPlayPause', { state: 'paused' }), 'toggle');
    assert.equal(press('MediaPause'), 'toggle');
    assert.equal(press('Pause'), 'toggle');
    assert.equal(press('MediaPlay', { state: 'paused' }), 'toggle');
    assert.equal(press('MediaPlay', { state: 'blocked' }), 'toggle', 'a key press starts a sound the browser held for a tap');
    assert.equal(press('MediaStop'), 'stop');
    assert.equal(press('MediaTrackNext', { items: [tune, air] }), 'next');
  });

  it('does nothing where the button would not: nothing loaded, Play while playing, Pause while paused, loading, no next', () => {
    assert.equal(press('MediaPlayPause', { state: 'idle' }), null);
    assert.equal(press('MediaStop', { state: 'idle' }), null);
    assert.equal(press('MediaPlay'), null);
    assert.equal(press('MediaPause', { state: 'paused' }), null);
    assert.equal(press('Pause', { state: 'paused' }), null);
    assert.equal(press('MediaPlayPause', { state: 'loading' }), null, 'its button waits for the sound too');
    assert.equal(press('MediaStop', { state: 'loading' }), 'stop');
    assert.equal(press('MediaTrackNext'), null, "a book's last sound has no next");
  });
});

describe("the bar among a TV remote's card stops", () => {
  const bar = ['pause', 'stop', 'next'];

  it("comes before the overlay's foot row, which it stands above", () => {
    const stops = ['card', 'search', 'pause', 'stop', 'next', 'help', 'read'];
    assert.deepEqual(withBarStops(stops, bar, { before: (s) => s === 'help' || s === 'read' }),
      ['card', 'search', 'pause', 'stop', 'next', 'help', 'read']);
    const moved = ['card', 'help', 'read', 'textview', 'pause', 'stop', 'next']; // the page's order
    assert.deepEqual(withBarStops(moved, bar, { before: (s) => ['help', 'read', 'textview'].includes(s) }),
      ['card', 'pause', 'stop', 'next', 'help', 'read', 'textview']);
  });

  it("comes after the text view's toolbar, before its text's links", () => {
    const stops = ['close', 'contents', 'putback', 'link1', 'link2'];
    assert.deepEqual(withBarStops(stops, bar, { after: (s) => ['close', 'contents', 'putback'].includes(s) }),
      ['close', 'contents', 'putback', 'pause', 'stop', 'next', 'link1', 'link2']);
  });

  it('goes at the end without its neighbours, and adds nothing while hidden', () => {
    assert.deepEqual(withBarStops(['a', 'b'], bar, { before: () => false }), ['a', 'b', 'pause', 'stop', 'next']);
    assert.deepEqual(withBarStops(['a', 'b'], [], { after: (s) => s === 'a' }), ['a', 'b']);
  });
});
