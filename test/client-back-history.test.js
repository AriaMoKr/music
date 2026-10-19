// The browser's Back along the links followed in a book (public/js/back-history.js), with a fake
// history: entries, a current one, and popstate delivered later, as a browser does.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BackHistory } from '../public/js/back-history.js';

class FakeHistory {
  constructor() {
    this.entries = [{ state: null }];
    this.i = 0;
    this.pending = [];
    this.left = 0; // Backs past the first entry: the browser left the page
  }
  get state() { return this.entries[this.i].state; }
  pushState(state) {
    this.entries.length = this.i + 1;
    this.entries.push({ state: structuredClone(state) });
    this.i++;
  }
  replaceState(state) { this.entries[this.i].state = state; }
  back() { this.go(-1); }
  forward() { this.go(1); }
  go(n) {
    const j = this.i + n;
    if (j < 0) {
      this.left++;
      return;
    }
    if (j >= this.entries.length) return;
    this.i = j;
    this.pending.push(this.entries[j].state);
  }
}

/** Delivers the popstates until none are left (each may cause more). */
async function settle(h, bh) {
  for (let n = 0; n < 50 && h.pending.length; n++) {
    bh.popstate(h.pending.shift());
    await new Promise((r) => setTimeout(r, 0));
  }
}

function setup({ trail = true } = {}) {
  const h = new FakeHistory();
  const backs = [];
  const bh = new BackHistory({ history: h, load: 1, onBack: (d) => { backs.push(d); return trail; } });
  return { h, bh, backs };
}

describe('the browser\'s Back along the links followed', () => {
  it('goes back one link at a time, by the browser\'s Back or the toolbar\'s', async () => {
    const { h, bh, backs } = setup();
    bh.pushed(1);
    bh.pushed(2);
    assert.equal(h.entries.length, 3);
    h.back(); // the browser's Back
    await settle(h, bh);
    assert.deepEqual(backs, [1]);
    assert.equal(bh.back(), true, 'the toolbar\'s Back goes through the history');
    await settle(h, bh);
    assert.deepEqual(backs, [1, 0]);
    assert.equal(bh.back(), false, 'none of ours left: the toolbar does it itself');
    h.back();
    await settle(h, bh);
    assert.equal(h.left, 1, 'then Back leaves the page, as before');
  });

  it('keeps the state already there (the address\'s), and goes nowhere forward', async () => {
    const { h, bh, backs } = setup();
    h.replaceState({ other: true });
    bh.pushed(1);
    assert.deepEqual(h.state, { other: true, vrlbryTrail: 1, vrlbryLoad: 1 });
    h.back();
    await settle(h, bh);
    h.forward();
    await settle(h, bh);
    assert.deepEqual(backs, [0], 'Forward does not follow the link again');
    assert.equal(bh.depth, 1);
  });

  it('takes the entries back out when the book closes', async () => {
    const { h, bh, backs } = setup();
    bh.pushed(1);
    bh.pushed(2);
    bh.cleared();
    await settle(h, bh);
    assert.deepEqual(backs, [], 'nothing to go back to');
    assert.equal(h.i, 0);
    assert.equal(bh.back(), false);
    h.back();
    assert.equal(h.left, 1, 'the next Back leaves the page');
  });

  it('leaves its entries when the trail has no such place any more', async () => {
    const { h, bh, backs } = setup({ trail: false });
    bh.pushed(1);
    bh.pushed(2);
    h.back();
    await settle(h, bh);
    assert.deepEqual(backs, [1]);
    assert.equal(h.i, 0, 'rewound to the page itself');
  });

  it('passes over the entries an earlier load of the page left', async () => {
    const { h, bh, backs } = setup();
    h.pushState({ vrlbryTrail: 1, vrlbryLoad: 0 });
    h.pushState({ vrlbryTrail: 2, vrlbryLoad: 0 }); // then a reload: this load is 1
    h.back();
    await settle(h, bh);
    assert.deepEqual(backs, []);
    assert.equal(h.i, 0);
  });
});
