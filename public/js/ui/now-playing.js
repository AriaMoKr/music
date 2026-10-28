// The "Now playing" bar (SPEC §5.6 "Sounds"): on a screen, the Listen tab's first row in the page,
// for the keyboard and screen readers, whom the 3D panels leave out. What plays (the sound's title,
// its book, a line of kind, length and where it plays) and Play/Pause, Stop and Next, each named
// and reached with Tab. A sound that starts is said politely once, not as it plays on. The queue,
// the composers and periods, and the music stand's tempo, loop and parts stay in 3D. On a TV its
// buttons are in the remote's card (Menu), and the remote's media keys press them (ui/music-remote.js).
//
// nowPlayingOf, barButton and withBarStops are pure (the Interaction or a stand-in), for the tests;
// NowPlaying is the page's (tested over test/helpers/fake-dom.js).

import { isMidi } from '../core/content/sounds.js';
import { soundTitle } from '../media/queue.js';
import { clock } from '../media/player.js';

/**
 * What the bar shows, or null while nothing is loaded: `title`, `book` (title · author), `line`
 * (kind, length, where it plays, its place in the queue), the buttons' states (`playing`,
 * `loading`, `blocked`: the browser waits for a tap; `hasNext`), and `key`, which changes only when
 * another sound starts (a new item, or the same sound played again from its start in the queue:
 * its `moves`, not its index, which a shuffle changes too).
 * @param {object} ix interaction.js's Interaction: sound, queue, _playing, book, bookOf, world
 */
export function nowPlayingOf(ix) {
  const s = ix.sound;
  if (!s || s.state === 'idle') return null;
  const item = ix.queue?.current ?? ix._playing ?? null;
  const media = s.media ?? item?.sound?.media ?? null;
  const book = item ? ix.bookOf?.(item.libId, item.bookId) : ix.book ?? null;
  const title = item ? soundTitle(item.sound) : media?.name?.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') || 'A sound';
  const gramophone = ix.queue?.source === 'gramophone';
  const n = ix.queue?.length ?? 0;
  const d = s.duration;
  const line = [
    isMidi(media) ? 'MIDI' : 'Recording',
    ...(d ? [clock(d)] : []),
    gramophone ? (ix.world?.gramophone ? 'on the gramophone' : 'playing on') : 'from the open book',
    ...(n > 1 ? [`${ix.queue.index + 1} of ${n}`] : []),
  ].join(' · ');
  const where = item ? [item.libId, item.bookId, item.sound?.c, item.sound?.b, item.sound?.i ?? 0, ix.queue?.moves ?? ix.queue?.index ?? 0].join('\n') : '';
  return {
    key: `${where}\n${media?.src ?? media?.remote?.start ?? ''}\n${media?.name ?? ''}`,
    title,
    book: book ? `${book.title}${book.author ? ` · ${book.author}` : ''}` : '',
    line,
    playing: s.state === 'playing' || s.state === 'loading',
    loading: s.state === 'loading',
    blocked: s.state === 'blocked',
    hasNext: !!ix.queue?.hasNext,
  };
}

/** What is said as a sound starts (a polite status: overlay.announce). */
export function startedText(info) {
  const from = info.book ? `, from ${info.book}` : '';
  return info.blocked ? `${info.title}${from}: press Play to hear it.` : `Playing ${info.title}${from}.`;
}

/**
 * A TV remote's media keys (by common's keyOf) and what each does to the bar (SPEC §5.9, music).
 * A Bluetooth remote's Pause comes as `Pause` (Android's BREAK key), so it is MediaPause too.
 * Rewind and fast-forward are not among them: common reads them as ← and →, for TalkBack.
 */
export const MEDIA_KEYS = Object.freeze({
  MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', Pause: 'pause', MediaStop: 'stop', MediaTrackNext: 'next',
});

/**
 * Which of the bar's buttons an action presses ('toggle', 'stop', 'next'), or null when it does
 * nothing now: nothing loaded, Play while playing, Pause while not, Play/Pause while loading (its
 * button waits too), Next with none queued.
 * @param {ReturnType<typeof nowPlayingOf>} info
 * @param {'toggle'|'play'|'pause'|'stop'|'next'} action
 */
export function barButton(info, action) {
  if (!info) return null;
  if (action === 'stop') return 'stop';
  if (action === 'next') return info.hasNext ? 'next' : null;
  if (info.loading) return null;
  if (action === 'toggle' || (action === 'play') === !info.playing) return 'toggle';
  return null;
}

/**
 * A TV remote's card stops with the bar's among them (ui/music-remote.js): taken from where the
 * page has them and put `before` the first stop that is so (the overlay's foot row, which the bar
 * stands above on a TV), or `after` the last (the text view's toolbar); else at the end.
 * @template T
 * @param {T[]} stops
 * @param {T[]} bar the bar's buttons, none while it is hidden
 * @param {{ before?: (stop: T) => boolean, after?: (stop: T) => boolean }} where
 */
export function withBarStops(stops, bar, { before, after }) {
  const rest = stops.filter((s) => !bar.includes(s));
  let at = rest.length;
  if (before && rest.some(before)) at = rest.findIndex(before);
  else if (after && rest.some(after)) at = rest.findLastIndex(after) + 1;
  rest.splice(at, 0, ...bar);
  return rest;
}

/** An element of the bar's, of class `cls`, holding `children` (a string: its one text node). */
function part(doc, tag, cls, ...children) {
  const el = doc.createElement(tag);
  el.setAttribute('class', cls);
  for (const c of children) el.append(typeof c === 'string' ? doc.createTextNode(c) : c);
  return el;
}

/** A button of the bar's: its glyph, named (aria-label, title). */
function barPart(doc, cls, name, glyph) {
  const b = part(doc, 'button', cls, glyph);
  b.setAttribute('type', 'button');
  b.setAttribute('aria-label', name);
  b.setAttribute('title', name);
  return b;
}

/** An element's one text node changed in place, never replaced (a screen reader's focus on it stays). */
function setText(el, text) {
  const node = el.childNodes[0];
  if (node.data !== text) node.data = text;
}

/**
 * The bar, in the overlay after the text view (so Tab reaches it from the view's end), a region
 * named "Now playing". interaction.js calls update() whenever the sound or the queue changes.
 * Its elements and their text nodes are made once and kept, their text changed in place: TalkBack's
 * focus on one left the bar, for the page's own focus (the Controls help), whenever a queue's next
 * sound replaced them.
 */
export class NowPlaying {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root the overlay
   * @param {object} o.interaction interaction.js's Interaction
   * @param {(text: string) => void} o.announce a polite status (overlay.announce)
   * @param {() => HTMLElement|null} [o.returnFocus] where focus goes when the bar goes (Stop)
   */
  constructor({ root, interaction, announce, returnFocus }) {
    Object.assign(this, { I: interaction, announce, returnFocus });
    const doc = root.ownerDocument;
    this._title = part(doc, 'span', 'ov-np-title', '');
    this._sub = part(doc, 'span', 'ov-np-sub', '');
    this._toggle = barPart(doc, 'ov-np-toggle', 'Pause', '❚❚');
    this._buttons = { toggle: this._toggle, stop: barPart(doc, 'ov-np-stop', 'Stop', '■'), next: barPart(doc, 'ov-np-next', 'Next sound', '⏭') };
    const el = part(doc, 'section', 'ov-np', part(doc, 'span', 'ov-np-what', this._title, this._sub),
      part(doc, 'span', 'ov-np-buttons', ...Object.values(this._buttons)));
    el.hidden = true;
    el.setAttribute('aria-label', 'Now playing');
    root.append(el);
    this.el = el;
    this.root = root;
    this._said = null; // the sound last said
    this._info = null; // what the bar shows
    this._hiding = false; // a check at the end of the task that nothing plays (update)
    // Disabled buttons would drop the focus (Next on the last sound): aria-disabled, and ignored.
    const on = (b, fn) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      fn();
    });
    on(this._toggle, () => this.I.sound.toggle()); // on the tap: a blocked sound may start
    on(this._buttons.stop, () => this.I.stopSounds());
    on(this._buttons.next, () => this.I.nextSound());
    // The text view ends above the bar (style.css, --np-h), so the bar never covers its text.
    new ResizeObserver(() => this._fit()).observe(el);
  }

  /**
   * The bar's height for the text view to end above (--np-h), at once when the bar appears; the
   * view, shorter, keeps the focus in sight (the link just played, near its foot).
   */
  _fit(appearing = false) {
    if (this.el.hidden) return;
    const h = `${this.el.offsetHeight}px`;
    if (this.root.style.getPropertyValue('--np-h') === h && !appearing) return;
    this.root.style.setProperty('--np-h', h);
    const active = this.el.ownerDocument.activeElement;
    if (active?.closest?.('.tv-view')) active.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Shows what plays now, or hides the bar (its focus given back) when nothing more is to play:
   * Stop, the queue's end, a sound that cannot be played.
   */
  update() {
    const info = nowPlayingOf(this.I);
    if (!info) {
      // Between two sounds (Next, a queue going on) the player is idle for a moment, and the next
      // sound starts loading in the same task (interaction._playItem: player.js play is 'loading'
      // at once, however long its bytes take): the bar goes only if that task ends with nothing
      // loaded, so it stays, as it is, while a queue goes on.
      if (!this.el.hidden && !this._hiding) {
        this._hiding = true;
        queueMicrotask(() => {
          this._hiding = false;
          if (!nowPlayingOf(this.I)) this._hide();
        });
      }
      return;
    }
    const appearing = this.el.hidden;
    this.el.hidden = false;
    this._info = info;
    setText(this._title, info.title);
    setText(this._sub, info.book ? `${info.book} — ${info.line}` : info.line);
    const toggle = this._toggle;
    const name = info.playing ? 'Pause' : 'Play';
    if (toggle.getAttribute('aria-label') !== name) {
      toggle.setAttribute('aria-label', name);
      toggle.setAttribute('title', name);
      setText(toggle, info.playing ? '❚❚' : '▶');
    }
    if (toggle.getAttribute('aria-disabled') !== String(info.loading)) toggle.setAttribute('aria-disabled', String(info.loading));
    toggle.classList.toggle('ov-np-wait', info.blocked);
    const next = this._buttons.next;
    if (next.getAttribute('aria-disabled') !== String(!info.hasNext)) next.setAttribute('aria-disabled', String(!info.hasNext));
    if (appearing) this._fit(true);
    // Said once, when it starts playing (or waits for a tap), not as it loads or plays on.
    if (info.key !== this._said && ((info.playing && !info.loading) || info.blocked)) {
      this._said = info.key;
      this.announce?.(startedText(info));
    }
  }

  /**
   * A TV remote's media key (its name by common's keyOf): true when it is the bar's now (a sound is
   * loaded), its button pressed once, not again as the key repeats.
   */
  mediaKey(name, repeat = false) {
    const action = Object.hasOwn(MEDIA_KEYS, name) ? MEDIA_KEYS[name] : null;
    const info = action ? nowPlayingOf(this.I) : null;
    if (!info) return false;
    const button = repeat ? null : barButton(info, action);
    if (button) this._buttons[button].click();
    return true;
  }

  /** Its buttons, for a TV remote's card (ui/music-remote.js); none while it is hidden. */
  stops() {
    return this.el.hidden ? [] : Object.values(this._buttons);
  }

  _hide() {
    const had = this.el.contains(this.el.ownerDocument.activeElement);
    this.el.hidden = true;
    this._said = this._info = null;
    if (had) this.returnFocus?.()?.focus?.({ preventScroll: true });
  }
}
