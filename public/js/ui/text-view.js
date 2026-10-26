// The text view (SPEC §5.8): on a screen, the open book's current part as a page of text over
// the 3D view, for screen readers, the keyboard, zoom and phones. It shows the chunk the open
// page is in (a chapter-sized part, or one Wikipedia article), built from its blocks (§3.5) as
// DOM nodes and text, never as HTML. The 3D book stays the reading position: opening the view
// scrolls it to the open page's first block, turning pages keeps it in step, and closing it
// leaves the book open at the block at the top of the view. Its header is the reader's toolbar:
// contents, text size, theme, where the reader is, Back, Put back. On a TV (SPEC §5.9) the view
// itself holds the remote's focus while reading: ↑ ↓ scroll it, ← → turn the 3D book's pages, and
// its toolbar and links are the card that Menu and OK go into (ui/remote.js).
//
// renderBlocks and topBlock are pure (a document passed in), for the tests; TextView is the page's.

import { SOUND_PATH, soundRuns } from '../core/content/sounds.js';

/** Style bits (§3.5) and the element each is shown with, outermost first. */
const STYLE_TAGS = [
  [256, 'span', 'tv-larger'],
  [128, 'small', null],
  [64, 'u', null],
  [32, 'span', 'tv-smallcaps'],
  [16, 'sub', null],
  [8, 'sup', null],
  [4, 'code', null],
  [2, 'strong', null],
  [1, 'em', null],
];

/** The image run's place-holding character (§3.5). */
const OBJ = '￼';

const isImageRun = (run) => !!run[2]?.src;
const linkOf = (run) => {
  const l = run[2];
  return l && (Array.isArray(l.at) || l.href || l.to || l.media) ? l : null;
};
/** Where a link leads (an image run in a link carries a copy of its fields: §3.5), or the sound it plays. */
const destination = (l) => JSON.stringify([l.at ?? null, l.href ?? null, l.to ?? null,
  l.media ? [l.media.src ?? l.media.remote?.start ?? null, l.media.name ?? null] : null]);

/** Whether a link plays a sound (§3.5 `media`, or the server's link to a sound file) rather than going anywhere. */
export const isSoundLink = (l) => !!l && (!!l.media || (typeof l.href === 'string' && SOUND_PATH.test(l.href.replace(/#.*$/, ''))));

/**
 * The links (run link objects) of a sound list entry's place in a part's blocks (its b and i-th
 * sound link: §3.5 sound lists), as the 3D reader marks them (reader.soundRects); empty when the
 * part has no such link. Pure.
 * @param {object[]} blocks
 * @param {{ b: number, i?: number }} at
 */
export function soundLinks(blocks, at) {
  const blk = blocks?.[at?.b];
  const span = blk && soundRuns(blk, at.i ?? 0);
  if (!span) return new Set();
  const runs = blk.r ?? blk.c.flat();
  const links = new Set();
  for (let k = span[0]; k < span[1]; k++) links.add(runs[k][2]);
  return links;
}

/** Text with its hard breaks ("\n") as <br>s. */
function appendText(doc, el, text) {
  const parts = String(text).split('\n');
  parts.forEach((t, i) => {
    if (i) el.append(doc.createElement('br'));
    if (t) el.append(doc.createTextNode(t));
  });
}

/** One run's content: its text (or picture) inside its style elements. */
function runNode(doc, run, o) {
  let node;
  if (isImageRun(run)) {
    const r = run[2];
    node = doc.createElement('img');
    node.setAttribute('alt', r.alt ?? '');
    node.setAttribute('class', r.inv ? 'tv-inline tv-inv' : 'tv-inline');
    if (r.w) node.setAttribute('width', String(Math.round(r.w)));
    if (r.h) node.setAttribute('height', String(Math.round(r.h)));
    o.image?.(node, r.src);
  } else {
    node = doc.createElement('span');
    appendText(doc, node, run[0].replaceAll(OBJ, ''));
  }
  const bits = run[1] | 0;
  for (let i = STYLE_TAGS.length - 1; i >= 0; i--) {
    const [bit, tag, cls] = STYLE_TAGS[i];
    if (!(bits & bit)) continue;
    const wrap = doc.createElement(tag);
    if (cls) wrap.setAttribute('class', cls);
    wrap.append(node);
    node = wrap;
  }
  return node;
}

/**
 * Runs into an element: each run in its style elements; consecutive runs leading to one place (a
 * link's words and its pictures) as one real link, which onLink(link, event) follows.
 */
function appendRuns(doc, el, runs, o) {
  let a = null;
  let aLink = null;
  for (const run of runs || []) {
    const link = linkOf(run);
    if (link) {
      if (!aLink || destination(link) !== destination(aLink)) {
        a = doc.createElement('a');
        a.setAttribute('href', Array.isArray(link.at) ? `#tv-${link.at[0]}-${link.at[1]}` : '#');
        a.setAttribute('class', 'tv-link');
        const target = link;
        a.addEventListener?.('click', (e) => {
          e.preventDefault?.();
          o.onLink?.(target, e);
        });
        o.linkEl?.(a, target);
        el.append(a);
        aLink = link;
      }
      a.append(runNode(doc, run, o));
    } else {
      a = null;
      aLink = null;
      el.append(runNode(doc, run, o));
    }
  }
}

/** The text of runs (a heading's, a contents entry's), pictures and breaks left out. */
export function runsText(runs) {
  return (runs || []).map((r) => (isImageRun(r) ? '' : r[0])).join('').replaceAll(OBJ, '').replace(/\s+/g, ' ').trim();
}

/**
 * A chunk's blocks (§3.5) as DOM nodes appended to `container`: `h` as headings below the view's
 * own (the part's highest level as h2, down to h6, never a level left out), `p` as paragraphs
 * (alignment, verse and indent kept), `li` as lists by depth with their markers, `tr` as tables
 * (rows grouped by `g`, header rows as `th`), `pre`, `img` (its alt, and the picture through
 * `image`), `hr`. Every block's element carries `data-b` (its index) and the id `tv-<c>-<b>`,
 * which links within the book point to. `skip`: a block left out (an article's title, which the
 * view's own title says).
 * @param {Document} doc
 * @param {Element} container
 * @param {object[]} blocks
 * `linkEl(a, link)` is told of each link made (the sounds' are marked while they play).
 * @param {{ c: number, skip?: number, onLink?: (link: object, e: Event) => void, linkEl?: (a: Element, link: object) => void, image?: (img: Element, src: string) => void }} o
 * @returns {number} how many blocks were shown
 */
export function renderBlocks(doc, container, blocks, o) {
  const c = o.c | 0;
  const skip = o.skip ?? -1;
  // Headings go in order under the view's h1 whatever level the part starts at (a chapter's l 2),
  // each at most one below the one before (a book's h3 then h5 would leave a level out).
  let top = 6;
  let above = 1;
  (blocks || []).forEach((block, b) => { if (block?.t === 'h' && b !== skip) top = Math.min(top, Math.max(1, block.l | 0)); });
  const mark = (el, b) => {
    el.setAttribute('data-b', String(b));
    el.setAttribute('id', `tv-${c}-${b}`);
    return el;
  };
  const indent = (el, q) => { if (q) el.setAttribute('style', `margin-inline-start: ${Math.min(q, 6) * 1.5}em`); };
  let lists = []; // the open lists, by depth
  let table = null; // the open table: { el, g, head, body }
  const endList = () => { lists = []; };
  const endTable = () => { table = null; };
  (blocks || []).forEach((block, b) => {
    if (b === skip) return;
    const t = block?.t;
    if (t !== 'li') endList();
    if (t !== 'tr') endTable();
    if (t === 'h') {
      const level = Math.min(6, above + 1, Math.max(2, (block.l | 0) - top + 2));
      above = level;
      const el = mark(doc.createElement(`h${level}`), b);
      if (block.a === 'c' || block.a === 'r') el.setAttribute('class', `tv-a${block.a}`);
      appendRuns(doc, el, block.r, o);
      container.append(el);
    } else if (t === 'p') {
      const el = mark(doc.createElement('p'), b);
      const cls = [block.v ? 'tv-verse' : '', block.a === 'c' || block.a === 'r' ? `tv-a${block.a}` : ''].filter(Boolean).join(' ');
      if (cls) el.setAttribute('class', cls);
      indent(el, block.q);
      appendRuns(doc, el, block.r, o);
      container.append(el);
    } else if (t === 'li') {
      const d = Math.max(1, block.d | 0);
      while (lists.length > d) lists.pop();
      while (lists.length < d) {
        const ul = doc.createElement('ul');
        ul.setAttribute('class', 'tv-list');
        const parent = lists.length ? lists[lists.length - 1].last ?? lists[lists.length - 1].el : container;
        parent.append(ul);
        lists.push({ el: ul, last: null });
      }
      const li = mark(doc.createElement('li'), b);
      if (block.m) {
        const m = doc.createElement('span');
        m.setAttribute('class', 'tv-marker');
        m.append(doc.createTextNode(`${block.m} `));
        li.append(m);
      }
      appendRuns(doc, li, block.r, o);
      lists[lists.length - 1].el.append(li);
      lists[lists.length - 1].last = li;
    } else if (t === 'tr') {
      if (!table || table.g !== block.g) {
        const el = doc.createElement('table');
        el.setAttribute('class', 'tv-table');
        indent(el, block.q);
        container.append(el);
        table = { el, g: block.g, head: null, body: null };
      }
      let section;
      if (block.hd && !table.body) section = table.head ??= (() => { const s = doc.createElement('thead'); table.el.append(s); return s; })();
      else section = table.body ??= (() => { const s = doc.createElement('tbody'); table.el.append(s); return s; })();
      const tr = mark(doc.createElement('tr'), b);
      for (const cell of block.c || []) {
        const td = doc.createElement(block.hd ? 'th' : 'td');
        if (block.hd) td.setAttribute('scope', 'col');
        appendRuns(doc, td, cell, o);
        tr.append(td);
      }
      section.append(tr);
    } else if (t === 'pre') {
      const el = mark(doc.createElement('pre'), b);
      indent(el, block.q);
      el.append(doc.createTextNode(block.x ?? ''));
      container.append(el);
    } else if (t === 'img') {
      const fig = mark(doc.createElement('figure'), b);
      indent(fig, block.q);
      const img = doc.createElement('img');
      img.setAttribute('alt', block.alt ?? '');
      img.setAttribute('class', block.inv ? (block.em ? 'tv-formula tv-inv' : 'tv-inv') : (block.em ? 'tv-formula' : ''));
      if (block.w) img.setAttribute('width', String(Math.round(block.w)));
      if (block.h) img.setAttribute('height', String(Math.round(block.h)));
      o.image?.(img, block.src);
      fig.append(img);
      container.append(fig);
    } else if (t === 'hr') {
      container.append(mark(doc.createElement('hr'), b));
    }
  });
  const shown = (blocks?.length ?? 0) - (skip >= 0 && skip < (blocks?.length ?? 0) ? 1 : 0);
  if (!shown) {
    const p = doc.createElement('p');
    p.append(doc.createTextNode('(Nothing to read in this part.)'));
    container.append(p);
  }
  return shown;
}

/**
 * The block at the top of the view: of the blocks' tops and bottoms (in the view's scrolled
 * coordinates, in order), the first that reaches below `top` (a block cut by the top edge
 * counts). 0 when there are none.
 * @param {Array<{ b: number, top: number, bottom: number }>} rects
 * @param {number} top
 */
export function topBlock(rects, top) {
  for (const r of rects) if (r.bottom > top + 1) return r.b;
  return rects.length ? rects[rects.length - 1].b : 0;
}

// ---------------------------------------------------------------------------------------------
// The view on the page

const STATIC = `
  <header class="tv-bar">
    <button type="button" class="tv-prev" aria-label="Previous part">←<span class="tv-wide"> Previous part</span></button>
    <button type="button" class="tv-close" aria-label="Close text view" title="Back to the book in 3D (T or Esc)">Close<span class="tv-wide"> text view</span></button>
    <button type="button" class="tv-toc-btn" aria-expanded="false" aria-controls="tv-toc">Contents</button>
    <span class="tv-size" role="group" aria-label="Text size">
      <button type="button" class="tv-smaller" aria-label="Smaller text">A−</button><button type="button" class="tv-bigger" aria-label="Larger text">A+</button>
    </span>
    <label class="tv-theme"><span class="tv-wide">Theme</span> <select class="tv-theme-sel" aria-label="Theme"><option value="paper">Paper</option><option value="sepia">Sepia</option><option value="night">Night</option></select></label>
    <span class="tv-where"><span class="tv-label tv-wide" aria-hidden="true"></span><input class="tv-slider" type="range" min="0" max="1000" step="1" aria-label="Where in the book"></span>
    <button type="button" class="tv-back" hidden>↩ Back</button>
    <button type="button" class="tv-putback">Put back</button>
    <button type="button" class="tv-next" aria-label="Next part"><span class="tv-wide">Next part </span>→</button>
  </header>
  <nav class="tv-toc" id="tv-toc" aria-label="Contents" hidden><ol class="tv-toc-list"></ol></nav>
  <div class="tv-col">
    <p class="tv-partno"></p>
    <h1 id="tv-title" class="tv-title" tabindex="-1"></h1>
    <p class="tv-sub"></p>
    <div class="tv-body"></div>
    <nav class="tv-parts" aria-label="At the end"><button type="button" class="tv-prev" aria-label="Previous part">←<span class="tv-wide"> Previous part</span></button><button type="button" class="tv-next" aria-label="Next part"><span class="tv-wide">Next part </span>→</button></nav>
  </div>`;

const isField = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);

/** A screen too short for a toolbar that stays (style.css: the same height). */
const SHORT = typeof matchMedia === 'function' ? matchMedia('(max-height: 420px)') : { matches: false };

/**
 * The text view of the open book, on a screen. `interaction` is the reader's driver
 * (interaction.js): it calls follow() after every page turn or jump, bookClosing() and
 * bookOpened() around a book, and toggle() for T.
 */
export class TextView {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root where the view goes (the overlay, inside the page's <main>)
   * @param {object} o.interaction interaction.js's Interaction
   * @param {(libId: string, bookId: string, c: number) => Promise<object[]>} o.getChunk api.js
   * @param {(src: string) => Promise<{ url: string|null, release(): void }>} o.imageSource api.js
   * @param {(text: string) => void} o.announce a polite status (overlay.announce)
   * @param {(away: boolean) => HTMLElement|null} [o.returnFocus] where focus goes when the view
   *   closes (away: the book is being put back)
   * @param {boolean} [o.tv] a TV's remote (common's tvMode): the view holds the focus, not its title
   */
  constructor({ root, interaction, getChunk, imageSource, announce, returnFocus, tv = false }) {
    Object.assign(this, { I: interaction, getChunk, imageSource, announce, returnFocus, tv });
    const doc = root.ownerDocument;
    this.doc = doc;
    const el = doc.createElement('article');
    el.className = 'tv-view';
    el.hidden = true;
    el.tabIndex = -1; // a click on its text keeps the keys here (the controls leave them alone: data-own-keys)
    el.setAttribute('aria-labelledby', 'tv-title');
    el.setAttribute('data-own-keys', '');
    el.innerHTML = STATIC; // the view's own markup only: the book's text goes in as text (renderBlocks)
    root.append(el);
    this.el = el;
    this.$ = (sel) => el.querySelector(sel);
    this.c = -1; // the part shown
    this.bookKey = null;
    this._open = false;
    this._showing = Promise.resolve();
    // The place shared with the 3D book, { c, b }: where the view put itself, or the block at its
    // top once the reader's own scrolling rests (_sync). The view's own scrolls are not reading
    // (near a part's end the block aimed at cannot reach the top): _self while a smooth one runs,
    // _selfTop where an instant one left the view (or put the text back: a slid-away toolbar).
    // _moved: the reader has scrolled since the place was taken.
    this._at = null;
    this._self = false;
    this._selfTop = null;
    this._moved = false;
    this._quiet = false; // a jump of the 3D book to the view's place: the view stays as it is
    this._still = 0; // sounds' links being followed (_playSound): the view stays too
    this._wire();
  }

  /** The height of the sticky toolbar over the text (0 while it is slid away). */
  _barH() {
    const bar = this.$('.tv-bar');
    return bar.classList.contains('tv-away') ? 0 : bar.getBoundingClientRect().height;
  }

  /**
   * On a short screen (a phone held sideways, 400% zoom) the toolbar slides away while the reader
   * scrolls down and comes back when they scroll up or reach it with Tab: it would otherwise
   * cover half the text, and one that scrolled away would take the reader to the top, away from
   * their place, for a size or a theme.
   */
  _headroom() {
    const y = this.el.scrollTop;
    const dy = y - (this._lastY ?? y);
    this._lastY = y;
    const bar = this.$('.tv-bar');
    if (!SHORT.matches || !this.$('.tv-toc').hidden) bar.classList.remove('tv-away');
    else if (dy > 2 && y > bar.offsetHeight) bar.classList.add('tv-away');
    else if (dy < -2) bar.classList.remove('tv-away');
  }

  get isOpen() { return this._open; }

  _wire() {
    const I = this.I;
    const q = (sel, fn) => this.el.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    // What starts from the reader's place brings the 3D book there first (_sync), so a size, Back
    // or a turn starts from where the view is, not from where the 3D book was left.
    const synced = (fn) => () => this._sync().then(fn);
    q('.tv-close', () => this.close());
    q('.tv-toc-btn', () => this._toggleToc());
    q('.tv-smaller', synced(() => this._size(-1)));
    q('.tv-bigger', synced(() => this._size(1)));
    q('.tv-back', synced(() => I.goBack()));
    q('.tv-putback', synced(() => I.putBack()));
    q('.tv-prev', () => this._part(-1));
    q('.tv-next', () => this._part(1));
    this.$('.tv-theme-sel').addEventListener('change', (e) => this._theme(e.target.value));
    this.$('.tv-slider').addEventListener('change', (e) => I.jumpToProgress(Number(e.target.value) / 1000));
    this.el.addEventListener('scroll', () => {
      if (!this._self && this.el.scrollTop !== this._selfTop) this._moved = true;
      this._headroom();
      this._restSoon();
    }, { passive: true });
    const bar = this.$('.tv-bar');
    // Reached with Tab, a slid-away toolbar comes back. The browser has scrolled the text towards
    // its button already (before the scroll's event): the text goes back, the reader's place stays.
    bar.addEventListener('focusin', (e) => {
      this._barFocus = e.target; // where Menu comes back to on a TV (cardStart)
      bar.classList.remove('tv-away');
      if (this._lastY != null && this.el.scrollTop !== this._lastY) {
        this.el.scrollTop = this._lastY;
        this._selfTop = this._lastY;
      }
    });
    // What Tab or a jump scrolls to stops below the sticky toolbar, not under it (scroll-margin on
    // the text: a scroll-padding would count the toolbar's own buttons as hidden and scroll to them).
    new ResizeObserver(() => { this.el.style.setProperty('--tv-bar-h', `${bar.offsetHeight}px`); }).observe(bar);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.$('.tv-toc').hidden) this._toggleToc(false);
        else this.close();
      } else if (isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) {
        // the slider's and the theme's own keys
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        this._sync().then(() => I.turn(dir));
      } else if (this.tv && e.target === this.el && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        // A TV's remote while reading: the text scrolls (the WebView would move the focus instead).
        e.preventDefault();
        const step = Math.round((this.el.clientHeight - this._barH()) * 0.4) * (e.key === 'ArrowDown' ? 1 : -1);
        this.el.scrollBy({ top: step, behavior: e.repeat || I.reduced ? 'auto' : 'smooth' });
      }
    });
  }

  /** The text size, one step, the view staying at its place. */
  async _size(step) {
    this.aim(this._at);
    try {
      await this.I.changeFont(step);
    } finally {
      this._aim = null;
    }
  }

  /** A theme: the colours change, the text and its place do not. */
  async _theme(name) {
    this._quiet = true;
    try {
      await this.I.setTheme(name);
    } finally {
      this._quiet = false;
    }
  }

  /** The view scrolled: once it rests (a quarter second), its place is shared (_rest). */
  _restSoon() {
    clearTimeout(this._restTimer);
    this._restTimer = setTimeout(() => this._rest(), 250);
  }

  /** A smooth scroll of the view's own: its scroll events, until the next rest, are not the reader's. */
  _selfScrolled() {
    this._self = true;
    this._restSoon(); // ends it even when nothing scrolled
  }

  _rest() {
    this._self = false;
    if (this._moved) this._sync();
  }

  /**
   * The reader's place, the block at the view's top once they have scrolled, becomes the shared
   * one: the 3D book goes there in place (the view covers it), unless it shows that block
   * already. Also at once, before anything that starts from the place (a size, Back, a turn).
   */
  async _sync() {
    const I = this.I;
    if (!this._open || I.state !== 'read' || this.c < 0) return;
    if (this._moved) this._at = { c: this.c, b: this._topBlock() };
    this._moved = false;
    if (!this._at) return;
    this._quiet = true;
    try {
      await I.jumpToAnchor(this._at, { inPlace: true });
    } finally {
      this._quiet = false;
    }
  }

  /** T, and the overlay's "Text view" button: opens it, or closes it back to the 3D book. */
  toggle() {
    return this._open ? this.close() : this.open();
  }

  /**
   * Opens it at the open page's first block, or at the view's own last place while the 3D book
   * still shows it (closed and opened again). A screen only: in a headset nothing changes.
   */
  async open() {
    const I = this.I;
    if (this._open || I.state !== 'read' || I.controls.presenting) return;
    this._open = true;
    this.el.hidden = false;
    this._style();
    const same = this.bookKey === `${I.book.libId}\n${I.book.id}` && this._at && I._showsBlock(this._at);
    await this._show(same ? this._at : I.reader.anchorOf(I._currentRef()), { smooth: false });
    this._home().focus({ preventScroll: true });
  }

  /**
   * Where the focus goes in the view: its title, for the keyboard and a screen reader to carry on
   * from; on a TV the view itself, which holds the remote's focus while reading (ui/remote.js).
   */
  _home() {
    return this.tv ? this.el : this.$('.tv-title');
  }

  /** Whether its contents are open. */
  get tocOpen() {
    return this._open && !this.$('.tv-toc').hidden;
  }

  /** Closes its contents (Back on a TV). */
  closeToc() {
    this._toggleToc(false);
  }

  /** What a TV remote's card is while the view is open: its contents when open, else the whole view. */
  layer() {
    return this.tocOpen ? this.$('.tv-toc') : this.el;
  }

  /** Menu on a TV: the toolbar's control used last, else its first that can be used. */
  cardStart() {
    const bar = this.$('.tv-bar');
    const usable = (e) => e && bar.contains(e) && !e.disabled && !e.hidden && e.getClientRects().length > 0;
    return usable(this._barFocus) ? this._barFocus : [...bar.querySelectorAll('button, select, input')].find(usable) ?? null;
  }

  /** OK on a TV: the first link on the screen, below the toolbar, to go on from link to link; or none. */
  linkHere() {
    const top = this.el.getBoundingClientRect().top + this._barH();
    const bottom = this.el.getBoundingClientRect().bottom;
    for (const a of this.$('.tv-body').querySelectorAll('a[href]')) {
      const r = a.getBoundingClientRect();
      if (r.bottom > top && r.top < bottom && r.height > 0) return a;
      if (r.top >= bottom) break;
    }
    return null;
  }

  /**
   * Closes it, leaving the 3D book open at the block at the top of the view (keepPlace), and
   * gives focus back.
   */
  async close({ keepPlace = true } = {}) {
    if (!this._open) return;
    const I = this.I;
    const place = keepPlace && I.state === 'read' && this.c >= 0;
    if (place && this._moved) this._at = { c: this.c, b: this._topBlock() };
    clearTimeout(this._restTimer);
    this._moved = this._self = false;
    this._open = false;
    this._toggleToc(false);
    this.el.hidden = true;
    if (place && this._at) await I.jumpToAnchor(this._at, { inPlace: true });
    this.returnFocus?.(!keepPlace)?.focus?.({ preventScroll: true });
  }

  /**
   * Where a jump is going (a link, Back, the contents, a part): { c, b?, f? }. A spread of two
   * pages can begin on the part before (its left page), so the view shows the place aimed at,
   * not the spread's first page.
   */
  aim(at) {
    this._aim = at && Number.isInteger(at.c) ? { c: at.c, b: at.b ?? 0, f: at.f ?? null } : null;
  }

  /** After every page turn or jump of the 3D book: the view follows it. */
  follow() {
    const I = this.I;
    this._style();
    const aim = this._aim;
    this._aim = null;
    if (!this._open || I.state !== 'read') return;
    if (this._quiet || this._still) return this._header(); // the 3D book came to the view's place, or a sound plays
    const shown = I.reader.anchorOf(I._currentRef());
    let anchor = shown;
    // A place aimed at: its block, unless it named an element (f) the 3D page already found.
    if (aim && (aim.c !== shown.c || !aim.f)) anchor = { c: aim.c, b: aim.f ? 0 : aim.b };
    this._show(anchor);
  }

  /**
   * The book is being put back: the view closes, unless a link is taking the reader to another
   * book (keepTrail), whose part it shows once open.
   */
  bookClosing(keepTrail) {
    this._onRead = false;
    if (!this._open) return;
    if (keepTrail) this.$('.tv-body').replaceChildren(this.doc.createTextNode('Opening…'));
    else this.close({ keepPlace: false });
  }

  /**
   * What the part shown is called: in a Wikipedia volume, whose parts are articles, the
   * article's title (its contents entry); elsewhere null (the book's title says it).
   */
  _partTitle(c) {
    if (!this._wikipedia()) return null;
    return this.I.reader?.meta?.toc?.find((e) => e.c === c)?.title ?? null;
  }

  /** Whether the open book is a Wikipedia volume (its parts are articles). */
  _wikipedia() {
    const I = this.I;
    return I.libraries?.find((l) => l.id === I.book?.libId)?.kind === 'wikipedia';
  }

  /**
   * A book is in hand (taken out, not opened at once): what it is and what comes next, said
   * politely. A screen only.
   */
  bookInHand() {
    const I = this.I;
    if (I.controls.presenting || !I.book) return;
    const next = I.book.readable ? 'Enter reads it, T as text, Esc puts it back.' : 'It cannot be read here. Esc puts it back.';
    this.announce?.(`${I.book.title}, in your hands. ${next}`);
  }

  /** T with a book in hand: it is read, and goes straight into the text view. */
  openOnRead() {
    if (!this.I.controls.presenting) this._onRead = true;
  }

  /** A book has opened: its title said politely; the view opened when the visitor keeps it on. */
  bookOpened() {
    const I = this.I;
    const part = this._partTitle(I.reader?.anchorOf(I._currentRef()).c ?? 0);
    const title = part ?? I.book?.title ?? 'The book';
    const wanted = (!!I.settings.textView || this._onRead) && !I.controls.presenting;
    this._onRead = false;
    this.announce?.(`${title} is open.${this._open || wanted || I.controls.presenting ? '' : ' Text view: T.'}`);
    if (wanted && !this._open) this.open();
  }

  /** The theme's colours and the text size, as the 3D book has them. */
  _style() {
    const s = this.I.settings;
    this.el.setAttribute('data-theme', s.theme || 'paper');
    this.el.setAttribute('data-motion', this.I.reduced ? 'less' : 'full');
    this.el.style.setProperty('--tv-scale', String(s.fontScale || 1));
    this.$('.tv-theme-sel').value = s.theme || 'paper';
  }

  /** Shows the part an anchor is in (rendering it when it is another), scrolled to its block. */
  _show(anchor, { smooth = true } = {}) {
    const run = this._showing.then(() => this._showNow(anchor, smooth)).catch((err) => console.warn('text view', err));
    this._showing = run;
    return run;
  }

  async _showNow(anchor, smooth) {
    const I = this.I;
    if (!this._open || I.state !== 'read') return;
    const book = I.book;
    const key = `${book.libId}\n${book.id}`;
    if (key !== this.bookKey || anchor.c !== this.c) {
      const blocks = await this.getChunk(book.libId, book.id, anchor.c);
      if (!this._open || I.book !== book) return;
      // Focus in the view (a link just followed, which goes with the old part) moves to the new
      // part's heading, so the keyboard and a screen reader carry on from there.
      const active = this.doc.activeElement;
      const refocus = !active || active === this.doc.body || this.el.contains(active);
      const body = this.$('.tv-body');
      body.replaceChildren();
      this._release();
      const part = this._partTitle(anchor.c);
      this._blocks = blocks;
      this._soundEls = [];
      this._marked = null;
      renderBlocks(this.doc, body, blocks, {
        c: anchor.c,
        // An article begins with its title as a heading: the view's own title says it already.
        skip: part && blocks[0]?.t === 'h' && runsText(blocks[0].r) === part.replace(/\s+/g, ' ').trim() ? 0 : -1,
        // A sound plays at once, on the tap (the audio context needs it) and from where the view
        // is; any other link from the shared place, so Back returns here.
        onLink: (link) => (isSoundLink(link) ? this._playSound(link) : this._sync().then(() => I.followLink(link))),
        linkEl: (a, link) => { if (isSoundLink(link)) this._soundEls.push({ a, link }); },
        image: (img, src) => this._image(img, src),
      });
      this.$('.tv-title').textContent = part ?? book.title;
      this.$('.tv-sub').textContent = part ? `Volume: ${book.title}` : '';
      this.c = anchor.c;
      if (key !== this.bookKey) this._tocFilled = false;
      this.bookKey = key;
      smooth = false;
      if (refocus) this._home().focus({ preventScroll: true });
    }
    this._header();
    this._at = { c: anchor.c, b: anchor.b };
    this._moved = false;
    // The place lands below the toolbar, shown for the jump: its height now, since the observer
    // last saw it hidden (0) when the view opens and has not run again yet.
    const bar = this.$('.tv-bar');
    bar.classList.remove('tv-away');
    this.el.style.setProperty('--tv-bar-h', `${bar.offsetHeight}px`);
    const target = anchor.b > 0 ? this.el.querySelector(`[data-b="${anchor.b}"]`) : null;
    const smoothly = !!target && smooth && !I.reduced;
    if (smoothly) this._selfScrolled(); // a while: its scroll events until it rests are its own
    if (target) target.scrollIntoView({ block: 'start', behavior: smoothly ? 'smooth' : 'auto' });
    else this.el.scrollTo({ top: 0, behavior: 'auto' });
    // An instant scroll is done at once: its event is known by where it leaves the view.
    this._selfTop = smoothly ? null : this.el.scrollTop;
    this._lastY = this.el.scrollTop;
    this.markSound({ reveal: false });
  }

  /**
   * A sound's link, followed (it plays: interaction.js's followLink, called on the tap itself). The
   * view stays where it is meanwhile: the 3D book's label coming back after the link is resolved is
   * no turn of its own.
   */
  async _playSound(link) {
    this._still = (this._still ?? 0) + 1;
    try {
      await this.I.followLink(link);
    } finally {
      this._still--;
    }
  }

  /**
   * Marks the link of the sound playing (interaction.js's _playing: a sound list entry of this
   * book, SPEC §3.5) when it is in the part shown, as the 3D page's band marks it: aria-current
   * and a visible band (tv-playing); other links lose it. With `reveal`, a sound that has just
   * started is brought into view (Next: its link further down), without taking the focus.
   */
  markSound({ reveal = true } = {}) {
    const I = this.I;
    const item = I._playing;
    const book = I.book;
    const here = this._open && item && book && item.libId === book.libId && item.bookId === book.id
      && item.sound?.c === this.c ? item.sound : null;
    const links = here ? soundLinks(this._blocks, here) : null;
    let first = null;
    for (const { a, link } of this._soundEls ?? []) {
      const on = !!links?.has(link);
      if (on) {
        a.setAttribute('aria-current', 'true');
        a.classList.add('tv-playing');
        first ??= a;
      } else if (a.hasAttribute('aria-current')) {
        a.removeAttribute('aria-current');
        a.classList.remove('tv-playing');
      }
    }
    const changed = item !== this._marked;
    this._marked = item ?? null;
    if (first && reveal && changed) {
      first.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      this._selfTop = this.el.scrollTop; // the view's own scroll, not the reader's
      this._lastY = this.el.scrollTop;
    }
  }

  /** Where the reader is, Back, and the parts. */
  _header() {
    const I = this.I;
    const r = I.reader;
    const ref = I._currentRef();
    const label = r.labelOf(ref);
    this.$('.tv-label').textContent = label;
    const slider = this.$('.tv-slider');
    slider.value = String(Math.round(r.progressOf(ref) * 1000));
    slider.setAttribute('aria-valuetext', `Page ${label.replace(' / ', ' of ')}`);
    this.$('.tv-back').hidden = !I._trail?.length;
    const n = r.chunkCount;
    // A Wikipedia volume's parts are its articles, and are called so.
    const word = this._wikipedia() ? 'article' : 'part';
    for (const [sel, name, wide] of [['.tv-prev', `Previous ${word}`, ` Previous ${word}`], ['.tv-next', `Next ${word}`, `Next ${word} `]]) {
      for (const b of this.el.querySelectorAll(sel)) {
        b.disabled = sel === '.tv-prev' ? this.c <= 0 : this.c >= n - 1;
        b.setAttribute('aria-label', name);
        b.querySelector('.tv-wide').textContent = wide;
      }
    }
    this.$('.tv-partno').textContent = n > 1 ? `${word === 'article' ? 'Article' : 'Part'} ${this.c + 1} of ${n}` : '';
  }

  /** The previous or next part, from its start. */
  async _part(dir) {
    const n = this.I.reader?.chunkCount ?? 0;
    const c = this.c + dir;
    if (c < 0 || c >= n) return;
    this.aim({ c, b: 0 });
    try {
      // The spread may show the part's start already (on its right): the view goes there anyway.
      if (!(await this.I.jumpToAnchor({ c, b: 0 }))) this.follow();
    } finally {
      this._aim = null;
    }
    this._home().focus({ preventScroll: true });
  }

  /** The contents (the book's, or a Wikipedia volume's articles: a list that scrolls). */
  _toggleToc(show = this.$('.tv-toc').hidden) {
    const nav = this.$('.tv-toc');
    const btn = this.$('.tv-toc-btn');
    if (show && !this._tocFilled) {
      const list = this.$('.tv-toc-list');
      list.replaceChildren();
      for (const entry of this.I.reader?.meta?.toc ?? []) {
        const li = this.doc.createElement('li');
        li.className = `tv-toc-l${Math.min(6, entry.level || 1)}`;
        const a = this.doc.createElement('a');
        a.href = `#tv-${entry.c}-${entry.b}`;
        a.textContent = entry.title;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this._toggleToc(false);
          this.I.jumpToToc(entry).then(() => this._home().focus({ preventScroll: true }));
        });
        li.append(a);
        list.append(li);
      }
      if (!list.children.length) {
        const li = this.doc.createElement('li');
        li.textContent = 'This book has no contents.';
        list.append(li);
      }
      this._tocFilled = true;
    }
    // Closed from inside (Esc), focus goes back to its button, not to the page.
    if (!show && !nav.hidden && nav.contains(this.doc.activeElement)) btn.focus({ preventScroll: true });
    // A panel under the toolbar, over the text, so the reader's place stays where it is.
    if (show) {
      const top = Math.max(0, this.$('.tv-bar').getBoundingClientRect().bottom);
      nav.style.top = `${top}px`;
      nav.style.maxHeight = `min(60vh, ${Math.max(80, innerHeight - top - 8)}px)`;
    }
    nav.hidden = !show;
    btn.setAttribute('aria-expanded', String(!!show));
    if (show) {
      // Focus on where the reader is (the last entry at or before the part shown), not the
      // first of a thousand, in the middle of the list.
      const links = [...nav.querySelectorAll('a')];
      const toc = this.I.reader?.meta?.toc ?? [];
      let i = 0;
      toc.forEach((e, k) => { if (e.c <= this.c) i = k; });
      const here = links[Math.min(i, links.length - 1)];
      if (here) {
        const r = here.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        nav.scrollTop += r.top - n.top - (n.height - r.height) / 2;
        here.focus({ preventScroll: true });
      }
    }
  }

  /** The block at the top of the view: its index in the part shown. */
  _topBlock() {
    const top = this.el.getBoundingClientRect().top + this._barH();
    const rects = [];
    for (const n of this.$('.tv-body').querySelectorAll('[data-b]')) {
      const r = n.getBoundingClientRect();
      // An item's own lines end where a list inside it begins (that list's items are blocks).
      const inner = n.tagName === 'LI' ? n.querySelector(':scope > ul') : null;
      const bottom = inner ? Math.min(r.bottom, inner.getBoundingClientRect().top) : r.bottom;
      rects.push({ b: Number(n.getAttribute('data-b')), top: r.top, bottom });
    }
    return topBlock(rects, top);
  }

  /** A picture: loaded as the 3D reader loads it (api.imageSource), let go with its part. */
  _image(img, src) {
    this._sources ??= [];
    this.imageSource(src).then((source) => {
      if (!source?.url) return;
      this._sources.push(source);
      img.src = source.url;
    }).catch(() => {});
  }

  /** Lets go of the pictures of the part shown before (local books' blob URLs). */
  _release() {
    for (const s of this._sources ?? []) s.release?.();
    this._sources = [];
  }
}

