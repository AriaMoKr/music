// A TV's remote (SPEC §5.9): common's Remote, with the library's layers. The card the remote moves
// in is the page's open dialog (the help, Kiwix's library), else the text view's (its contents, or
// the whole view) while it is open, else the overlay; what holds the focus while walking is the
// text view while it is open, else the 3D view. OK while walking is the gamepad's A at the middle of
// the view (interaction.useMiddle); in the text view it goes to the links on the screen. Back is
// one step back (interaction.step), in the card a dialog or the contents closed first. Shared with
// music, so it gets what it uses from main.js.

import { keepsKey, Remote } from '../../vendor/common/tv.js';

export class LibraryRemote extends Remote {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas the 3D view
   * @param {import('./overlay.js').Overlay} o.overlay the page's card
   * @param {import('./text-view.js').TextView} o.textView
   * @param {object} o.interaction its step (Back) and useMiddle (OK)
   */
  constructor({ canvas, overlay, textView, interaction }) {
    // The Remote's own listeners on the whole page: the focus falling to nowhere from any layer.
    super({ root: document.body, view: canvas, use: () => this._use(), step: () => interaction.step() });
    this.overlay = overlay;
    this.textView = textView;
    this.I = interaction;
    this.onMode = (inCard) => {
      this._wasCard = inCard;
      interaction.inCard = inCard;
      if (!inCard) {
        // Walking again: what was open over the view closes.
        overlay.closeDialogs();
        if (textView.tocOpen) textView.closeToc();
      }
      overlay.setRemote({ card: inCard });
    };
    this._wasCard = false;
    // The focus moved by the page itself (the text view opening or closing, a dialog): the mode follows.
    document.addEventListener('focusin', () => {
      if (this.inCard !== this._wasCard) this.onMode(this.inCard);
    });
    // The open book's contents chosen in the card: walking, the dot on them (↑ ↓ scroll, OK picks).
    overlay.root.querySelector('.ov-b-toc')?.addEventListener('click', () => {
      if (interaction.tocPanel?.visible) this.walk();
    });
    interaction.onDotList = (on) => overlay.setRemote({ list: on });
  }

  /** The card the remote moves in now (the Remote reads it at each key). */
  get root() {
    if (!this.overlay) return this._base;
    return this.overlay.dialog() ?? (this.textView.isOpen ? this.textView.layer() : this.overlay.root);
  }

  set root(el) {
    this._base = el;
  }

  /** What holds the focus while walking: the text view while it is open (and no dialog is), else the 3D view. */
  get view() {
    return this.textView?.isOpen && !this.overlay.dialog() ? this.textView.el : this._canvas;
  }

  set view(el) {
    this._canvas = el;
  }

  /** Back in the card: a dialog or the text view's contents closed (back to what opened it), else as common's. */
  back() {
    if (this.inCard && !keepsKey(document.activeElement, 'Escape')) {
      const opener = this.overlay.closeDialog();
      if (opener !== null) {
        if (opener?.checkVisibility?.({ visibilityProperty: true })) opener.focus();
        else this.toCard();
        return true;
      }
      if (this.textView.tocOpen) {
        this.textView.closeToc(); // its button takes the focus
        return true;
      }
    }
    return super.back();
  }

  /** Menu: the text view's toolbar while it is open, else the card where it was left (a book's buttons while one is out). */
  toCard() {
    if (this.textView.isOpen && !this.overlay.dialog()) {
      const to = this.textView.cardStart();
      if (to) {
        to.focus({ preventScroll: true });
        this.onMode(true);
        return;
      }
    }
    // While a book is out its buttons come first, unless the card was left among them.
    const start = this.overlay.remoteStart();
    const book = (el) => !!el?.closest('.ov-book');
    if (!this._last || !this._stops().includes(this._last) || (book(start) && !book(this._last))) this._last = start;
    super.toCard();
  }

  /** OK while walking: in the text view its first link on the screen, else the middle of the 3D view. */
  _use() {
    if (!this.textView.isOpen) {
      this.I.useMiddle();
      return;
    }
    const link = this.textView.linkHere();
    if (!link) {
      this.toCard();
      return;
    }
    link.focus({ preventScroll: true });
    this.onMode(true);
  }
}
