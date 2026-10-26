// music's TV remote (SPEC §5.9, "Sounds on a TV"): the library's (ui/remote.js, shared with
// vrlbry), with the Now playing bar (ui/now-playing.js) in its card and the remote's media keys.
// The bar's Pause, Stop and Next are stops of the card: in the overlay's, before the foot row's
// buttons (the bar stands above them on a TV); in the text view's, after its toolbar's, before the
// text's links (the bar is outside the view's layer, across its foot). Play/Pause (and Play,
// Pause), Stop and Next press its buttons wherever the focus is; rewind and fast-forward are
// common's keyOf's arrows (for TalkBack), not the bar's.

import { keyOf } from '../../vendor/common/tv.js';
import { LibraryRemote } from './remote.js';
import { withBarStops } from './now-playing.js';

export class MusicRemote extends LibraryRemote {
  /**
   * @param {object} o as LibraryRemote's, and
   * @param {import('./now-playing.js').NowPlaying} o.nowPlaying the bar
   */
  constructor({ nowPlaying, ...o }) {
    super(o);
    this.nowPlaying = nowPlaying;
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

  /** Whether the card has the bar: not while a dialog or the text view's contents are the card. */
  _withBar() {
    return !this.overlay.dialog() && !this.textView.tocOpen;
  }
}
