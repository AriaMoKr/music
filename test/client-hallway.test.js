// The way out (public/js/hallway.js): the Hallway, or the place that linked here naming itself.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HALLWAY_URL } from '../public/js/config.js';
import { doorOf, wayOut } from '../public/js/hallway.js';

describe('the way out', () => {
  it('leads to the Hallway, naming this library as the door to come back to', () => {
    assert.equal(HALLWAY_URL, 'https://ariamokr.github.io/hallway/?from=music');
    for (const search of ['', '?place=demo', '?back=', '?xr=emulate&perf']) {
      assert.deepEqual(wayOut(search), {
        url: HALLWAY_URL, label: '← Hallway', title: 'Back to the Hallway, whose doors lead to other places',
        name: 'Hallway', host: 'ariamokr.github.io', custom: false,
      }, search);
    }
  });

  it('leads to the place that linked here instead, named by it or by its host', () => {
    const back = encodeURIComponent('https://example.org/my hall/?from=vrlbry');
    assert.deepEqual(wayOut(`?back=${back}&backname=${encodeURIComponent('  Garden   Hall ')}`), {
      url: 'https://example.org/my%20hall/?from=vrlbry', label: '← Garden Hall', title: 'Back to Garden Hall (example.org)',
      name: 'Garden Hall', host: 'example.org', custom: true,
    });
    assert.equal(wayOut(`?back=${back}`).label, '← example.org');
    assert.equal(wayOut('?back=http://localhost:8088/').url, 'http://localhost:8088/', 'a hallway being developed');
    const long = wayOut(`?back=${back}&backname=${'A very long name for a hallway of many doors'}`);
    assert.equal(long.label, '← A very long name for a…');
    assert.match(long.title, /^Back to A very long name for a hallway of many doors \(example\.org\)$/);
  });

  it('knows the Hallway\'s own doors: from=hallway and a way back on its address, kept as given', () => {
    // The link the Hallway's door opens (its README, "Going in"), in a shared session.
    const back = 'https://ariamokr.github.io/hallway/?from=music&room=k3vd-q8hn';
    const search = `?place=%7Egutenberg_en_all_2025-11&from=hallway&back=${encodeURIComponent(back)}&dx=0.12&yaw=-8&pitch=-3&dw=1.1&dh=2.25&glow=d9b26a`;
    assert.deepEqual(wayOut(search), {
      url: back, label: '← Hallway', title: 'Back to the Hallway, whose doors lead to other places',
      name: 'Hallway', host: 'ariamokr.github.io', custom: false,
    });
    assert.deepEqual(doorOf(wayOut(search)), doorOf(wayOut('')), 'the Hallway\'s view through the door back');
    assert.equal(doorOf(wayOut(`?from=hallway&back=${encodeURIComponent('https://ariamokr.github.io/hallway/?from=vrlbry-2')}`)).viewId, 'vrlbry-2');
    // Not the Hallway: another site on the same origin (as vrlbry is), another origin, or not from it.
    for (const [other, from, label] of [
      ['https://ariamokr.github.io/outside/', 'hallway', '← ariamokr.github.io'],
      ['https://example.org/hallway/', 'hallway', '← example.org'],
      [back, '', '← ariamokr.github.io'],
    ]) {
      const way = wayOut(`?from=${from}&back=${encodeURIComponent(other)}`);
      assert.deepEqual([way.url, way.label, way.custom], [other, label, true], other);
    }
  });

  it('takes only web addresses: anything else leads to the Hallway', () => {
    for (const back of ['javascript:alert(1)', 'data:text/html,hi', 'file:///C:/x', 'not a url', '//example.org/hall/', 'ftp://example.org/']) {
      assert.equal(wayOut(`?back=${encodeURIComponent(back)}`).url, HALLWAY_URL, back);
    }
  });

  it('puts the same place on the door back: the Hallway\'s corridor through it, or another place\'s name', () => {
    assert.deepEqual(doorOf(wayOut('')), {
      title: 'Hallway', subtitle: 'Doors to other places', sign: 'Hallway', color: '#9cc6b4', view: 'hallway',
      views: 'https://ariamokr.github.io/hallway/views/views.json', viewId: 'music',
    });
    const door = doorOf(wayOut(`?back=${encodeURIComponent('https://example.org/hall/')}&backname=Garden%20Hall`));
    assert.deepEqual([door.title, door.subtitle, door.sign, door.view, door.views], ['Garden Hall', 'example.org', 'Garden Hall', 'plain', null]);
  });
});
