// A minimal document for building DOM in Node (the text view's renderBlocks, the Now playing
// bar): elements with attributes, classes, children, text, click listeners and the focus, and
// markup() to read what was built.

class Node {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }

  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new Text(n) : n;
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  /** Whether `node` is this one or below it. */
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
}

class Text extends Node {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }

  get textContent() {
    return this.data;
  }
}

class Element extends Node {
  constructor(tag, doc = null) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = {};
    this.ownerDocument = doc;
    this.hidden = false;
  }

  /** Its classes (the class attribute): contains, add, remove, toggle. */
  get classList() {
    const get = () => new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
    const put = (set) => this.setAttribute('class', [...set].join(' '));
    return {
      contains: (c) => get().has(c),
      add: (c) => put(get().add(c)),
      remove: (c) => { const set = get(); set.delete(c); put(set); },
      toggle: (c, on = !get().has(c)) => { const set = get(); if (on) set.add(c); else set.delete(c); put(set); return on; },
    };
  }

  /** The focus to it: its document's activeElement. */
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  /** Clicks it: its listeners get an event whose default can be prevented. */
  click() {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of this.listeners.click ?? []) fn(e);
    return e;
  }

  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }

  /** Every element below it (depth first) that `pred` accepts. */
  findAll(pred) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (pred(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

/** A document: createElement, createTextNode and activeElement (its body until an element has the focus). */
export function fakeDocument() {
  const doc = {
    createElement: (tag) => new Element(tag, doc),
    createTextNode: (data) => new Text(data),
  };
  doc.body = new Element('body', doc);
  doc.activeElement = doc.body;
  return doc;
}

/** What a node holds, as markup (attributes in the order set; text as it is, not escaped). */
export function markup(node) {
  if (node.nodeType === 3) return node.data;
  const attrs = [...node.attributes].map(([k, v]) => ` ${k}="${v}"`).join('');
  const tag = node.tagName.toLowerCase();
  if (['br', 'hr', 'img'].includes(tag) && !node.childNodes.length) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.childNodes.map(markup).join('')}</${tag}>`;
}

/** The markup of an element's children. */
export function inner(node) {
  return node.childNodes.map(markup).join('');
}
