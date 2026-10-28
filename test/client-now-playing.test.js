// The "Now playing" bar (public/js/ui/now-playing.js, SPEC §5.6 "Sounds"): what it shows of the
// sound playing, its buttons' states, and when a sound counts as another (said once as it starts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barButton, MEDIA_KEYS, NowPlaying, nowPlayingOf, startedText, withBarStops } from '../public/js/ui/now-playing.js';
import { fakeDocument } from './helpers/fake-dom.js';

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
    // Shuffled, the same sound moves in the queue: the queue's moves say whether another started.
    const at = (items, index, moves) => {
      const o = ix({ items, index });
      o.queue.moves = moves;
      return nowPlayingOf(o).key;
    };
    assert.equal(at([air, tune], 1, 4), at([tune, air], 0, 4), 'shuffled: the same sound, said once');
    assert.notEqual(at([tune, air], 0, 5), at([tune, air], 0, 4), 'played again from its start');
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

describe("the bar while a queue goes on (a TV's TalkBack on it)", () => {
  const shanty = [1, 2, 3].map((n) => ({ c: 0, b: n, t: 'Listen', k: 'midi', h: `Shanty ${n}`, media: { src: `/zim/m/C/7_s${n}.mid`, name: `s${n}.mid`, mime: 'audio/midi' } }));
  globalThis.ResizeObserver ??= class { observe() {} };

  /**
   * The bar over a fake document, with an Interaction stand-in that plays `items` as the page does:
   * a sound's end stops the player (idle), and in the same task the queue's next starts (loading).
   */
  function page(items = shanty) {
    const doc = fakeDocument();
    const root = doc.createElement('div');
    const props = new Map();
    root.style = { setProperty: (k, v) => props.set(k, v), getPropertyValue: (k) => props.get(k) ?? '' };
    const view = doc.createElement('canvas'); // where a TV's focus goes when the bar goes: walking
    const said = [];
    const queue = {
      items: items.map((sound) => ({ libId: 'm', bookId: '7', sound })), index: -1, moves: 0, source: 'gramophone',
      get length() { return this.items.length; },
      get current() { return this.items[this.index] ?? null; },
      get hasNext() { return this.index < this.items.length - 1; },
    };
    const ix = {
      queue, sound: { state: 'idle', media: null, duration: 0, toggle() {} },
      bookOf: () => BOOK, world: { gramophone: {} },
      /** The player's state, as player.js's _set tells interaction.js (which updates the bar). */
      set(state, o = {}) {
        Object.assign(this.sound, { state }, o);
        bar.update();
      },
      /** The queue's next (or first), loading: its bytes have not come yet. */
      start() {
        queue.index++;
        queue.moves++;
        this.set('loading', { media: queue.current.sound.media, duration: 0 });
      },
      /** A sound played to its end: the player idle, then the queue's next at once, if any (_soundEnded). */
      ended() {
        this.set('idle', { media: null, duration: 0 });
        if (queue.hasNext) this.start();
        else this.stopSounds();
      },
      stopSounds() {
        queue.items = [];
        queue.index = -1;
        this.set('idle', { media: null, duration: 0 });
      },
      nextSound() {},
    };
    const bar = new NowPlaying({ root, interaction: ix, announce: (t) => said.push(t), returnFocus: () => view });
    return { doc, bar, ix, view, said };
  }

  /** Every node of the bar, elements and text, in order. */
  const nodes = (el) => [el, ...el.childNodes.flatMap((c) => (c.nodeType === 1 ? nodes(c) : [c]))];
  const text = (el) => el.childNodes.map((c) => c.textContent).join('');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('keeps the bar, every element and text node in it, and the focus on Pause through a slow next sound', async () => {
    const { doc, bar, ix, said } = page();
    ix.start();
    ix.set('playing', { duration: 7 });
    const pause = bar.stops()[0];
    pause.focus();
    const before = nodes(bar.el);
    assert.equal(text(bar.el.childNodes[0]), 'Shanty 1How Music Developed · Henderson — MIDI · 0:07 · on the gramophone · 1 of 3');

    ix.ended();
    // Its bytes take longer to come than the 250 ms the bar used to wait for a sound to start.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(bar.el.hidden, false, 'still shown while the next sound loads');
    assert.equal(ix.sound.state, 'loading');
    const loading = nodes(bar.el);
    assert.equal(loading.length, before.length);
    assert.ok(loading.every((n, i) => n === before[i]), 'no element or text node replaced');
    assert.equal(doc.activeElement, pause, 'the focus on Pause');
    assert.equal(pause.getAttribute('aria-label'), 'Pause', 'a sound loading is shown as playing');
    assert.equal(text(bar.el.childNodes[0].childNodes[0]), 'Shanty 2', 'the next sound named at once');

    ix.set('playing', { duration: 3 });
    const playing = nodes(bar.el);
    assert.ok(playing.length === before.length && playing.every((n, i) => n === before[i]));
    assert.equal(text(bar.el.childNodes[0].childNodes[1]), 'How Music Developed · Henderson — MIDI · 0:03 · on the gramophone · 2 of 3');
    assert.equal(doc.activeElement, pause);
    assert.deepEqual(said, ['Playing Shanty 1, from How Music Developed · Henderson.', 'Playing Shanty 2, from How Music Developed · Henderson.']);
  });

  it('goes after the last sound, the focus given back', async () => {
    const { doc, bar, ix, view } = page(shanty.slice(0, 2));
    ix.start();
    ix.set('playing', { duration: 7 });
    bar.stops()[2].focus(); // Next
    ix.ended();
    ix.set('playing', { duration: 3 });
    await tick();
    assert.equal(bar.el.hidden, false);
    assert.equal(bar.stops()[2].getAttribute('aria-disabled'), 'true', 'no next after the last');
    ix.ended();
    assert.equal(bar.el.hidden, false, 'not before the end of the task: a sound may start in it');
    await tick();
    assert.equal(bar.el.hidden, true);
    assert.equal(doc.activeElement, view);
    assert.deepEqual(bar.stops(), []);
  });

  it('goes on Stop, and when a sound cannot be played', async () => {
    const stopped = page();
    stopped.ix.start();
    stopped.ix.set('playing', { duration: 7 });
    stopped.bar.stops()[1].focus();
    stopped.bar.stops()[1].click(); // Stop
    await tick();
    assert.equal(stopped.bar.el.hidden, true);
    assert.equal(stopped.doc.activeElement, stopped.view);

    const failed = page();
    failed.ix.start();
    failed.bar.stops()[0].focus();
    failed.ix.set('idle', { media: null }); // player.js _fail: stopped, the queue left where it was
    await tick();
    assert.equal(failed.bar.el.hidden, true, 'nothing more plays');
    assert.equal(failed.doc.activeElement, failed.view);
  });

  it('stays when one sound replaces another in a task (play stops the one before first)', async () => {
    const { bar, ix } = page();
    ix.start();
    ix.set('playing', { duration: 7 });
    const before = nodes(bar.el);
    ix.set('idle', { media: null });
    ix.queue.index = 1;
    ix.queue.moves++;
    ix.set('loading', { media: shanty[1].media });
    await tick();
    assert.equal(bar.el.hidden, false);
    assert.ok(nodes(bar.el).every((n, i) => n === before[i]));
  });
});
