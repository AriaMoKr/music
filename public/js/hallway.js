// The way out (SPEC §5.6 "Kiosk panel"): the card's and the catalogue stand's "← Hallway" lead to
// the Hallway this library was made for (config.js HALLWAY_URL), or to whatever place has it
// behind one of its doors and says so in the link that brings visitors here:
//   https://ariamokr.github.io/vrlbry/?back=<that place's address>&backname=<its name>
// (both URL-encoded). Only http(s) addresses are taken, and another place is named on the button
// (by `backname`, else its host), so a link cannot send visitors somewhere unsaid. The door back
// in the room (world/door.js) leads there too, saying where (doorOf). Pure.

import { HALLWAY_URL } from './config.js';

/** The longest name shown on the button (characters). */
const NAME_MAX = 24;

/**
 * Where the way out leads, from the page's query string.
 * @param {string} search location.search
 * @returns {{ url: string, label: string, title: string, name: string, host: string, custom: boolean }}
 */
export function wayOut(search = '') {
  const params = new URLSearchParams(search);
  let url = null;
  try {
    url = params.get('back') ? new URL(params.get('back')) : null;
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return {
      url: HALLWAY_URL, label: '← Hallway', title: 'Back to the Hallway, whose doors lead to other places',
      name: 'Hallway', host: new URL(HALLWAY_URL).host, custom: false,
    };
  }
  const name = (params.get('backname') || '').replace(/\s+/g, ' ').trim() || url.host;
  const shown = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
  return { url: url.href, label: `← ${shown}`, title: `Back to ${name} (${url.host})`, name, host: url.host, custom: true };
}

/**
 * What the door back (world/door.js) says and shows: the Hallway's corridor through it, or another
 * place's name, with its name on the plaque and the sign.
 * @param {ReturnType<typeof wayOut>} way
 */
export function doorOf(way) {
  return way.custom
    ? { title: way.name, subtitle: way.host, sign: way.name, color: '#9cc6b4', view: 'plain' }
    : { title: 'Hallway', subtitle: 'Doors to other places', sign: 'Hallway', color: '#9cc6b4', view: 'hallway' };
}
