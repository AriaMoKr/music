// How the viewer moves in VR (SPEC §5.6 "Kiosk panel"): the Hallway's choice, which its control
// panel keeps in localStorage as `hallway.nav` = { move: 'smooth' | 'teleport', turn: 'snap' |
// 'smooth' } (its settings.js; its README, "Going in"). The sites on this origin (the Hallway,
// outside, vrlbry) share it, so a visitor's choice comes with them through the doors, and a
// change on the kiosk here is kept there too. Before anyone has stored one, vrlbry's own older
// setting (`settings.smoothMove`) decides how to move. It is the Hallway's key, not this site's:
// "Reset stored data" (reset.js) leaves it. Pure (the storage is passed in), for the tests.

/** The Hallway's key (not under vrlbry's storage prefix: the same key the Hallway reads). */
export const NAV_KEY = 'hallway.nav';
const CHOICES = { move: ['smooth', 'teleport'], turn: ['snap', 'smooth'] };
export const NAV_DEFAULTS = Object.freeze({ move: 'smooth', turn: 'snap' });

/** A complete, valid choice from whatever was stored (unknown or missing values: the defaults). */
export function normalizeNav(value, defaults = NAV_DEFAULTS) {
  const out = { ...defaults };
  if (value && typeof value === 'object') {
    for (const k of Object.keys(CHOICES)) if (CHOICES[k].includes(value[k])) out[k] = value[k];
  }
  return out;
}

/**
 * The visitor's choice: the Hallway's stored one, else from vrlbry's settings.
 * @param {Storage|null} storage localStorage, or null where it cannot be read
 * @param {{ smoothMove?: boolean }} [settings] vrlbry's settings
 */
export function loadNav(storage, settings = {}) {
  const defaults = { ...NAV_DEFAULTS, move: settings.smoothMove === false ? 'teleport' : 'smooth' };
  try {
    const raw = storage?.getItem(NAV_KEY);
    return raw == null ? defaults : normalizeNav(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

/** Keeps the choice where the Hallway reads it; false when it could not be stored. */
export function saveNav(storage, nav) {
  try {
    storage.setItem(NAV_KEY, JSON.stringify(normalizeNav(nav)));
    return true;
  } catch {
    return false; // storage blocked (a private window): the choice lasts this visit
  }
}
