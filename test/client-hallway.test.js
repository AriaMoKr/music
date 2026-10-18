// The way out (public/js/hallway.js): the Hallway, or the place that linked here naming itself.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HALLWAY_URL } from '../public/js/config.js';
import { doorOf, wayOut } from '../public/js/hallway.js';

describe('the way out', () => {
  it('leads to the Hallway, naming this library as the door to come back to', () => {
    assert.equal(HALLWAY_URL, 'https://ariamokr.github.io/hallway/?from=vrlbry');
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

  it('takes only web addresses: anything else leads to the Hallway', () => {
    for (const back of ['javascript:alert(1)', 'data:text/html,hi', 'file:///C:/x', 'not a url', '//example.org/hall/', 'ftp://example.org/']) {
      assert.equal(wayOut(`?back=${encodeURIComponent(back)}`).url, HALLWAY_URL, back);
    }
  });

  it('puts the same place on the door back: the Hallway\'s corridor through it, or another place\'s name', () => {
    assert.deepEqual(doorOf(wayOut('')), {
      title: 'Hallway', subtitle: 'Doors to other places', sign: 'Hallway', color: '#9cc6b4', view: 'hallway',
      views: 'https://ariamokr.github.io/hallway/views/views.json', viewId: 'vrlbry',
    });
    const door = doorOf(wayOut(`?back=${encodeURIComponent('https://example.org/hall/')}&backname=Garden%20Hall`));
    assert.deepEqual([door.title, door.subtitle, door.sign, door.view, door.views], ['Garden Hall', 'example.org', 'Garden Hall', 'plain', null]);
  });
});
