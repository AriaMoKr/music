// music's TV remote (SPEC §5.9, "Sounds on a TV"): the library's (ui/remote.js, shared with
// vrlbry), with the Now playing bar (ui/now-playing.js) in its card and the remote's media keys.
// The bar's Pause, Stop and Next are stops of the card: in the overlay's, before the foot row's
// buttons (the bar stands above them on a TV); in the text view's, after its toolbar's, before the
// text's links on the screen (the bar is outside the view's layer, across its foot). Play/Pause
// (and Play, Pause), Stop and Next press its buttons wherever the focus is; rewind and
// fast-forward are common's keyOf's arrows (for TalkBack), not the bar's. With the dot on the
// gramophone, the walking hint (the overlay's, vrlbry's) says what OK does there.

import { keyOf } from '../../vendor/common/tv.js';
import { LibraryRemote } from './remote.js';
import { withBarStops } from './now-playing.js';

/** What OK does with a TV's dot on the gramophone (interaction.onDotGramophone), in the walking hint. */
const GRAMOPHONE_OK = Object.freeze({ play: 'OK plays the gramophone', pause: 'OK pauses the gramophone' });

/**
 * The walking hint with the dot on the gramophone: its OK clause (vrlbry's, "OK takes the book at
 * the dot") says what OK does there; the hint as it is when `what` is null.
 * @param {string} hint the overlay's
 * @param {'play' | 'pause' | null} what
 */
export function gramophoneHint(hint, what) {
  return what ? hint.replace(/\bOK\b[^·\n]*?(?= · |\n|$)/, GRAMOPHONE_OK[what]) : hint;
}

export class MusicRemote extends LibraryRemote {
  /**
   * @param {object} o as LibraryRemote's, and
   * @param {import('./now-playing.js').NowPlaying} o.nowPlaying the bar
   */
  constructor({ nowPlaying, ...o }) {
    super(o);
    this.nowPlaying = nowPlaying;
    // The overlay makes the hint (vrlbry's), and its OK clause is changed here while the dot is on
    // the gramophone: whenever the hint is made again too (the card, a book out), and only walking.
    const { overlay, interaction } = o;
    this._gramophone = null;
    const render = overlay._renderHint.bind(overlay);
    overlay._renderHint = () => {
      render();
      if (!overlay.tv || !this._gramophone || interaction.inCard || interaction.state !== 'browse') return;
      const el = overlay.$('.ov-hint');
      el.textContent = gramophoneHint(el.textContent, this._gramophone);
    };
    interaction.onDotGramophone = (what) => {
      this._gramophone = what;
      overlay._renderHint();
    };
    // After the Remote's own (the window's capture, which leaves these keys alone), before the site's.
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (nowPlaying.mediaKey(keyOf(e), e.repeat)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  /** The bar is the card's too, beside the text view's layer (not beside a dialog or the view's contents). */
  get inCard() {
    if (super.inCard) return true;
    const a = document.activeElement;
    return !!this.nowPlaying && !!a && this.nowPlaying.el.contains(a) && this._withBar();
  }

  _stops() {
    const stops = super._stops();
    if (!this.nowPlaying || !this._withBar()) return stops;
    const bar = this.nowPlaying.stops();
    if (this.textView.isOpen) {
      const top = this.textView.el.querySelector('.tv-bar');
      return withBarStops(stops, bar, { after: (e) => top.contains(e) });
    }
    const foot = this.overlay.root.querySelector('.ov-bottom');
    return withBarStops(stops, bar, { before: (e) => foot.contains(e) });
  }

  /**
   * ↑ ↓ in the text view with the bar between its toolbar and the text (the library's _textStep,
   * whose screen ends above the bar): down from the toolbar's last to the bar, from the bar's last
   * to the first stop on the screen; up from the text, the stop before off the screen, to the bar's
   * last. True when the key was taken.
   * @param {HTMLElement} a the focused control
   * @param {'ArrowUp' | 'ArrowDown'} key
   */
  _textStep(a, key) {
    const tv = this.textView;
    const bar = this.nowPlaying && tv?.isOpen && !tv.tocOpen && this._withBar() ? this.nowPlaying.stops() : [];
    if (!bar.length) return super._textStep(a, key);
    const stops = this._stops();
    const at = stops.indexOf(a);
    if (at < 0) return false;
    const inText = (s) => tv.el.contains(s) && !tv.inBar(s);
    if (key === 'ArrowDown') {
      if (a !== bar[bar.length - 1]) return bar.includes(a) || bar.includes(stops[at + 1]) ? false : super._textStep(a, key);
      stops.slice(at + 1).find((s) => inText(s) && tv.onScreen(s))?.focus({ preventScroll: true });
      return true;
    }
    if (!inText(a)) return false;
    const before = stops[at - 1];
    if (!before || tv.inBar(before) || (inText(before) && tv.onScreen(before))) return false;
    bar[bar.length - 1].focus({ preventScroll: true });
    return true;
  }

  /** Whether the card has the bar: not while a dialog or the text view's contents are the card. */
  _withBar() {
    return !this.overlay.dialog() && !this.textView.tocOpen;
  }
}
