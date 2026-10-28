// music's TV remote (public/js/ui/music-remote.js, SPEC §5.9): the walking hint with the dot on
// the gramophone says what OK does there, in the overlay's own hint (vrlbry's).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import './helpers/vendor.js';

const { gramophoneHint } = await import('../public/js/ui/music-remote.js');

/** The overlay's walking hint on a TV (TV_HINTS.walk in ui/overlay.js), as the page shows it. */
const WALK = JSON.parse(`"${readFileSync(new URL('../public/js/ui/overlay.js', import.meta.url), 'utf8')
  .match(/^\s*walk: '((?:[^'\\]|\\.)*)'/m)[1].replace(/"/g, '\\"')}"`);

describe("the walking hint with a TV's dot on the gramophone", () => {
  it("says what OK does there, in place of the overlay's book", () => {
    assert.match(WALK, /OK takes the book at the dot/, "the overlay's walking hint has its OK clause");
    const play = gramophoneHint(WALK, 'play');
    assert.equal(play, WALK.replace('OK takes the book at the dot', 'OK plays the gramophone'));
    assert.match(gramophoneHint(WALK, 'pause'), / · OK pauses the gramophone · /);
    assert.equal(play.split('\n')[1], WALK.split('\n')[1], "TalkBack's line stays");
  });

  it("is the overlay's own off the gramophone", () => {
    assert.equal(gramophoneHint(WALK, null), WALK);
  });

  it('finds the OK clause however the walking hint is worded', () => {
    assert.equal(gramophoneHint('OK: the book · Menu', 'play'), 'OK plays the gramophone · Menu');
    assert.equal(gramophoneHint('walk · OK takes it', 'pause'), 'walk · OK pauses the gramophone');
    assert.equal(gramophoneHint('walk · turn', 'play'), 'walk · turn', 'nothing to change without one');
  });
});
