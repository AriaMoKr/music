// The browser's Back for a book that is out (SPEC §5.6, "Links"): taking a book off its shelf adds
// a history entry at the same address, and so does each link followed in it. So the browser's
// Back (its button, a phone's back gesture, a mouse's back button, Quest Browser's) returns to the
// page a link was on, one link at a time, as the toolbar's ↩ Back does (through the same entries),
// and then puts the book away. A book put away otherwise (Put back, Esc, B) takes its entries back
// out, so that Back then leaves as it would have. Entries left by an earlier load of the page
// (before a reload) are passed over. Pure: given the page's history.

/** Our fields in an entry's state, beside what was there (the address's). */
const FIELDS = ['vrlbryBook', 'vrlbryTrail', 'vrlbryLoad'];

export class BackHistory {
  /**
   * @param {object} o
   * @param {History} o.history the page's (pushState, replaceState, back, go, state)
   * @param {string|number} o.load this load of the page (performance.timeOrigin): its entries' mark
   * @param {(depth: number) => boolean|Promise<boolean>} o.onBack go back to where the trail was
   *   `depth` links deep (interaction.backTo); false when there is no such place
   * @param {() => void} o.onAway Back past the book's own entry: the book is put away
   *   (interaction.putAway)
   */
  constructor({ history, load, onBack, onAway }) {
    this.history = history;
    this.load = load;
    this.onBack = onBack;
    this.onAway = onAway;
    /** How deep in our entries the current one is: 0 the page, 1 a book out, 1 + n n links deep in it. */
    this.level = 0;
    this._rewinding = false;
    this._pendingBook = false; // a book came out while its entries were being taken out
    // Loaded again on an entry of ours (a reload while a book was out): it is the page itself now.
    const state = history.state;
    if (state && FIELDS.some((k) => k in state)) {
      const rest = { ...state };
      for (const k of FIELDS) delete rest[k];
      history.replaceState(Object.keys(rest).length ? rest : null, '');
    }
  }

  /** A book came off its shelf. Another book a link swaps in keeps the entries there are. */
  bookOut() {
    if (this._rewinding) this._pendingBook = true;
    else if (this.level === 0) this._push(0);
  }

  /** A link was followed: the trail is now `depth` long. */
  pushed(depth) {
    this._push(depth);
  }

  _push(depth) {
    this.history.pushState({ ...(this.history.state || {}), vrlbryBook: 1, vrlbryTrail: depth, vrlbryLoad: this.load }, '');
    this.level = 1 + depth;
  }

  /** The toolbar's Back: through the browser's history, when a link's entry of ours is there (false: not). */
  back() {
    if (this.level <= 1 || this._rewinding) return false;
    this.history.back();
    return true;
  }

  /** The book was put away, not by Back: its entries are taken back out. */
  cleared() {
    this._pendingBook = false;
    this._rewindTo(0);
  }

  _rewindTo(level) {
    if (this.level <= level) return;
    this._rewinding = true;
    this.history.go(level - this.level);
    this.level = level;
  }

  /** The window's popstate. */
  popstate(state) {
    const ours = !!state?.vrlbryBook;
    if (ours && state.vrlbryLoad !== this.load) {
      this.history.back(); // left by an earlier load of the page: on to the one before
      return;
    }
    const level = ours ? 1 + (state.vrlbryTrail | 0) : 0;
    if (this._rewinding) {
      this._rewinding = false;
      this.level = level;
      if (this._pendingBook) {
        this._pendingBook = false;
        this.bookOut();
      }
      return;
    }
    const back = level < this.level;
    this.level = level;
    if (!back) return; // Forward: neither the book nor the links come back
    if (level === 0) {
      this.onAway();
      return;
    }
    Promise.resolve(this.onBack(level - 1)).then((ok) => {
      // Nowhere to go back to (the trail is gone): out of the links' entries, to the book's own.
      if (!ok && this.level === level) this._rewindTo(1);
    });
  }
}
