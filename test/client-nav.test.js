// How the viewer moves in VR (public/js/nav.js): the Hallway's choice, shared through its key.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadNav, NAV_DEFAULTS, NAV_KEY, normalizeNav, saveNav } from '../public/js/nav.js';

/** A localStorage stand-in: a Map behind getItem / setItem, or one that refuses. */
const store = (entries = {}, { blocked = false } = {}) => {
  const m = new Map(Object.entries(entries));
  return {
    m,
    getItem: (k) => {
      if (blocked) throw new Error('SecurityError');
      return m.has(k) ? m.get(k) : null;
    },
    setItem: (k, v) => {
      if (blocked) throw new Error('QuotaExceededError');
      m.set(k, String(v));
    },
  };
};

describe('the movement choice', () => {
  it('is read from the Hallway\'s key, as the Hallway writes it', () => {
    assert.equal(NAV_KEY, 'hallway.nav');
    assert.deepEqual(NAV_DEFAULTS, { move: 'smooth', turn: 'snap' });
    assert.deepEqual(loadNav(store({ 'hallway.nav': '{"move":"teleport","turn":"smooth"}' })), { move: 'teleport', turn: 'smooth' });
    // The stored choice wins over this site's older setting.
    assert.deepEqual(loadNav(store({ 'hallway.nav': '{"move":"smooth","turn":"snap"}' }), { smoothMove: false }), { move: 'smooth', turn: 'snap' });
  });

  it('falls back to this site\'s own setting, then to the defaults', () => {
    assert.deepEqual(loadNav(store()), { move: 'smooth', turn: 'snap' });
    assert.deepEqual(loadNav(store(), { smoothMove: false }), { move: 'teleport', turn: 'snap' });
    assert.deepEqual(loadNav(null, { smoothMove: false }), { move: 'teleport', turn: 'snap' }, 'no storage');
    assert.deepEqual(loadNav(store({}, { blocked: true })), { move: 'smooth', turn: 'snap' }, 'storage refused');
    assert.deepEqual(loadNav(store({ 'hallway.nav': 'not json' }), { smoothMove: false }), { move: 'teleport', turn: 'snap' });
    // Unknown or missing values: the defaults, value by value.
    assert.deepEqual(loadNav(store({ 'hallway.nav': '{"move":"fly"}' }), { smoothMove: false }), { move: 'teleport', turn: 'snap' });
    assert.deepEqual(loadNav(store({ 'hallway.nav': '{"turn":"smooth"}' })), { move: 'smooth', turn: 'smooth' });
    assert.deepEqual(normalizeNav(null), NAV_DEFAULTS);
    assert.deepEqual(normalizeNav(['teleport']), NAV_DEFAULTS);
  });

  it('is kept under the Hallway\'s key, complete and valid', () => {
    const s = store();
    assert.equal(saveNav(s, { move: 'teleport', turn: 'sideways', extra: 1 }), true);
    assert.deepEqual(JSON.parse(s.m.get('hallway.nav')), { move: 'teleport', turn: 'snap' });
    assert.deepEqual(loadNav(s), { move: 'teleport', turn: 'snap' });
    assert.equal(saveNav(store({}, { blocked: true }), { move: 'teleport' }), false);
    assert.equal(saveNav(null, { move: 'teleport' }), false);
  });
});
