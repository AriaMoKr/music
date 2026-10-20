// The shared session's pure parts (public/js/together-space.js): where in the library a visitor
// is, and the session in words.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_ID, companyText, PAGE_ID, sessionText, spaceKey, spaceOf } from '../public/js/together-space.js';

describe('the shared session', () => {
  it('is the Hallway\'s, with this page as vrlbry', () => {
    assert.equal(APP_ID, 'ariamokr-layersharedsession-test');
    assert.equal(PAGE_ID, 'vrlbry');
    // layersharedsession takes keys of at most 64 characters, and page ids of [a-z0-9-].
    assert.ok(spaceKey('u8yhkfn3h6as').length <= 64);
    assert.match(PAGE_ID, /^[a-z0-9-]{1,32}$/);
  });

  it('tells rooms of the library apart: place, genre, letter and page', () => {
    assert.equal(spaceOf('demo'), spaceOf('demo', null));
    assert.equal(spaceOf('demo', { genre: null, letter: null }), spaceOf('demo'));
    assert.equal(spaceOf('demo', { page: 0 }), spaceOf('demo'));
    const rooms = [
      spaceOf('demo'), spaceOf('*'), spaceOf('~gutenberg_en_all_2025-11'),
      spaceOf('wikisource_en_all_maxi_2026-09', { genre: 'Poetry' }),
      spaceOf('wikisource_en_all_maxi_2026-09', { letter: 'A' }),
      spaceOf('wikisource_en_all_maxi_2026-09', { genre: 'Poetry', letter: 'A' }),
      spaceOf('wikisource_en_all_maxi_2026-09', { genre: 'Poetry', letter: 'A', page: 1 }),
      spaceOf(null),
    ];
    assert.equal(new Set(rooms).size, rooms.length);
  });

  it('says who else is in it', () => {
    assert.equal(companyText({}), 'Just you so far');
    assert.equal(companyText({ here: 2 }), 'With you: 2 here');
    assert.equal(companyText({ here: 1, library: 1, away: 3 }), 'With you: 1 here, 1 elsewhere in the library, 3 in another place');
    assert.equal(companyText({ away: 1 }), 'With you: 1 in another place');
    assert.equal(sessionText({ room: null, active: false }), '');
    assert.equal(sessionText({ room: 'k3vd-q8hn', active: true, company: { here: 1 } }), 'Shared session k3vd-q8hn · With you: 1 here');
    assert.equal(sessionText({ room: 'k3vd-q8hn', active: false }), 'Shared session k3vd-q8hn', 'paused, going out by the door');
  });
});
