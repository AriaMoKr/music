// The "Now playing" bar (SPEC §5.6 "Sounds"): on a screen, the Listen tab's first row in the page,
// for the keyboard and screen readers, whom the 3D panels leave out. What plays (the sound's title,
// its book, a line of kind, length and where it plays) and Play/Pause, Stop and Next, each named
// and reached with Tab. A sound that starts is said politely once, not as it plays on. The queue,
// the composers and periods, and the music stand's tempo, loop and parts stay in 3D. On a TV its
// buttons are in the remote's card (Menu), and the remote's media keys press them (ui/music-remote.js).
//
// nowPlayingOf, barButton and withBarStops are pure (the Interaction or a stand-in), for the tests;
// NowPlaying is the page's.

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

const STATIC = `
  <span class="ov-np-what">
    <span class="ov-np-title"></span>
    <span class="ov-np-sub"></span>
  </span>
  <span class="ov-np-buttons">
    <button type="button" class="ov-np-toggle" aria-label="Pause" title="Pause">❚❚</button>
    <button type="button" class="ov-np-stop" aria-label="Stop" title="Stop">■</button>
    <button type="button" class="ov-np-next" aria-label="Next sound" title="Next sound">⏭</button>
  </span>`;

/**
 * The bar, in the overlay after the text view (so Tab reaches it from the view's end), a region
 * named "Now playing". interaction.js calls update() whenever the sound or the queue changes.
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
    const el = doc.createElement('section');
    el.className = 'ov-np';
    el.hidden = true;
    el.setAttribute('aria-label', 'Now playing');
    el.innerHTML = STATIC; // the bar's own markup: what plays goes in as text
    root.append(el);
    this.el = el;
    this.root = root;
    this.$ = (sel) => el.querySelector(sel);
    this._said = null; // the sound last said
    this._info = null; // what the bar shows
    this._hideTimer = 0;
    // Disabled buttons would drop the focus (Next on the last sound): aria-disabled, and ignored.
    const on = (sel, fn) => this.$(sel).addEventListener('click', (e) => {
      if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
      fn();
    });
    on('.ov-np-toggle', () => this.I.sound.toggle()); // on the tap: a blocked sound may start
    on('.ov-np-stop', () => this.I.stopSounds());
    on('.ov-np-next', () => this.I.nextSound());
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

  /** Shows what plays now, or hides the bar (its focus given back) when nothing does. */
  update() {
    const info = nowPlayingOf(this.I);
    if (!info) {
      // Between two sounds (Next, the queue going on) the player is idle for a moment: the bar
      // goes only once nothing has started again, or the focus on its Next would be lost.
      if (!this.el.hidden && !this._hideTimer) {
        this._hideTimer = setTimeout(() => {
          this._hideTimer = 0;
          if (!nowPlayingOf(this.I)) this._hide();
        }, 250);
      }
      return;
    }
    clearTimeout(this._hideTimer);
    this._hideTimer = 0;
    const appearing = this.el.hidden;
    this.el.hidden = false;
    this._info = info;
    const sub = info.book ? `${info.book} — ${info.line}` : info.line;
    for (const [sel, text] of [['.ov-np-title', info.title], ['.ov-np-sub', sub]]) {
      const span = this.$(sel);
      if (span.textContent !== text) span.textContent = text;
    }
    const toggle = this.$('.ov-np-toggle');
    const name = info.playing ? 'Pause' : 'Play';
    if (toggle.getAttribute('aria-label') !== name) {
      toggle.setAttribute('aria-label', name);
      toggle.title = name;
      toggle.textContent = info.playing ? '❚❚' : '▶';
    }
    toggle.setAttribute('aria-disabled', String(info.loading));
    toggle.classList.toggle('ov-np-wait', info.blocked);
    this.$('.ov-np-next').setAttribute('aria-disabled', String(!info.hasNext));
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
    if (button) this.$(`.ov-np-${button}`).click();
    return true;
  }

  /** Its buttons, for a TV remote's card (ui/music-remote.js); none while it is hidden. */
  stops() {
    return this.el.hidden ? [] : [...this.el.querySelectorAll('button')];
  }

  _hide() {
    const had = this.el.contains(this.el.ownerDocument.activeElement);
    this.el.hidden = true;
    this._said = this._info = null;
    if (had) this.returnFocus?.()?.focus?.({ preventScroll: true });
  }
}
