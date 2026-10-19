// The browser's Back along the links followed in a book (SPEC §5.6, "Links"): each link followed
// adds a history entry at the same address, so the browser's Back (its button, a phone's back
// gesture, a mouse's back button, Quest Browser's) returns to the page the link was on, one link
// at a time, as the toolbar's ↩ Back does, which goes through the same entries. Closing the book
// takes them back out, so that Back then leaves as it would have. Entries left by an earlier load
// of the page (before a reload) are passed over. Pure: given the page's history.

export class BackHistory {
  /**
   * @param {object} o
   * @param {History} o.history the page's (pushState, back, go, state)
   * @param {string|number} o.load this load of the page (performance.timeOrigin): its entries' mark
   * @param {(depth: number) => boolean|Promise<boolean>} o.onBack go back to where the trail was
   *   `depth` links deep (interaction.backTo); false when there is no such place
   */
  constructor({ history, load, onBack }) {
    this.history = history;
    this.load = load;
    this.onBack = onBack;
    /** How many links deep the current entry is (0: the page itself). */
    this.depth = 0;
    this._rewinding = false;
  }

  /** A link was followed: the trail is now `depth` long. */
  pushed(depth) {
    this.history.pushState({ ...(this.history.state || {}), vrlbryTrail: depth, vrlbryLoad: this.load }, '');
    this.depth = depth;
  }

  /** The toolbar's Back: through the browser's history, when an entry of ours is there (false: not). */
  back() {
    if (this.depth <= 0 || this._rewinding) return false;
    this.history.back();
    return true;
  }

  /** The trail is gone (the book closed): its entries are taken back out. */
  cleared() {
    if (this.depth <= 0) return;
    this._rewinding = true;
    this.history.go(-this.depth);
    this.depth = 0;
  }

  /** The window's popstate. */
  popstate(state) {
    const deep = state?.vrlbryTrail > 0;
    if (deep && state.vrlbryLoad !== this.load) {
      this.history.back(); // left by an earlier load of the page: on to the one before
      return;
    }
    const depth = deep ? state.vrlbryTrail : 0;
    if (this._rewinding) {
      if (depth === 0) this._rewinding = false;
      this.depth = depth;
      return;
    }
    const back = depth < this.depth;
    this.depth = depth;
    if (!back) return; // Forward: the links are not followed again
    Promise.resolve(this.onBack(depth)).then((ok) => {
      // Nowhere to go back to (the trail is gone): out of these entries altogether.
      if (!ok && depth > 0 && this.depth === depth) this.cleared();
    });
  }
}
