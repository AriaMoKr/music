// The shared session (SPEC §5.6 "Together"): the Hallway's (AriaMoKr/layersharedsession, peer to
// peer over WebRTC with Trystero, through public Nostr relays; common's README, "Going in"). Its
// room is in the address (?room=), so the address is the invitation: the Hallway's door brings it
// here, and the way back carries it on (main.js, common's leaveUrl), so the visitor stays in it.
// This page is its door's id in the session (together-space.js PAGE_ID). The others in it who
// stand in the same room of the library (together-space.js: each place and room is laid out on its
// own) are drawn by the layer's avatars.js, as in the Hallway: a head with a visor on its front, a
// hand per tracked controller, a ring on the floor and their name.
//
// The session module (and Trystero under it, ~240 kB) loads only when a session is joined, so a
// visit without one costs nothing. The vendor modules are named by relative URL (server/vendor.js
// rewrites their bare imports, and the Pages build copies them).

import { createAvatars, readPose } from '../vendor/layersharedsession/avatars.js';
import { loadIdentity } from '../vendor/layersharedsession/identity.js';
import { emptyPose } from '../vendor/layersharedsession/pose.js';
import { APP_ID, PAGE_ID, spaceKey } from './together-space.js';

const SPACE_PREFIX = spaceKey('');

const storage = (name) => {
  try {
    return window[name];
  } catch {
    return null;
  }
};

export class Together {
  /**
   * @param {object} o
   * @param {import('three').Scene} o.scene
   * @param {import('three').Camera} o.camera the viewer's head
   * @param {import('three').WebGLRenderer} o.renderer
   * @param {() => Array<{ controller: import('three').Object3D, source: XRInputSource|null }>} o.hands the controllers (controls.js)
   */
  constructor({ scene, camera, renderer, hands }) {
    this.camera = camera;
    this.renderer = renderer;
    this.hands = hands;
    this.session = null;
    this.room = null; // the room joined, or kept while paused (going out by the door)
    this.paused = false;
    this.space = null; // where in the library this visitor is (together-space.js spaceOf)
    this.onChange = () => {};
    this.onNotice = () => {}; // (text)
    this.avatars = createAvatars({ parent: scene }); // its group 'visitors'; the labels in the page's sans
    this._pose = emptyPose();
    this._joining = 0; // which join is current: a slow import must not join a room left since
    // Whether a visitor is drawn: in this library and in the same room of it. Made once, and each
    // avatar keeps its key (spaceKey), so placing them allocates nothing per frame.
    this._isHere = (peer, a) => peer.page === PAGE_ID && a.spaceKey !== undefined && this.session.get(a.spaceKey) === this.space;
  }

  /** In a session (joined, or joining). */
  get active() {
    return !!this.room && !this.paused;
  }

  /** Who else is in the session: in this room (here), elsewhere in the library, on another page. */
  company() {
    let here = 0, library = 0, away = 0;
    if (this.session) {
      for (const p of this.session.peers.values()) {
        if (p.page !== PAGE_ID) {
          if (p.page) away++;
        } else if (p.memberId && this.session.get(spaceKey(p.memberId)) === this.space) here++;
        else library++;
      }
    }
    return { here, library, away };
  }

  /** Joins `room` (an invitation's, the Hallway door's) and keeps it in the address. */
  start(room) {
    this._leave();
    this.room = room;
    this.paused = false;
    this._setAddress(room);
    this._join();
    this.onChange();
  }

  /** Leaves the session and takes the room out of the address. */
  stop() {
    this._leave();
    this.room = null;
    this.paused = false;
    this._setAddress(null);
    this.onChange();
  }

  /** Leaves for now, keeping the room: going out by the door (its link carries the room on). */
  pause() {
    if (!this.active) return;
    this._leave();
    this.paused = true;
    this.onChange();
  }

  /** Back after a pause (the navigation didn't happen, or Back restored this page). */
  resume() {
    if (!this.paused || !this.room) return;
    this.paused = false;
    this._join();
    this.onChange();
  }

  /** Where in the library this visitor now is (together-space.js spaceOf), told to the others. */
  setSpace(space) {
    if (space === this.space) return;
    this.space = space;
    if (this.session && this.session.self.memberId) this.session.set(spaceKey(this.session.self.memberId), space);
    this.onChange();
  }

  async _join() {
    const ticket = ++this._joining;
    let joinSession;
    try {
      ({ joinSession } = await import('../vendor/layersharedsession/session.js'));
    } catch (err) {
      console.warn(`vrlbry: the shared session could not be loaded (${err.message})`);
      return;
    }
    if (ticket !== this._joining || !this.active) return;
    const identity = loadIdentity(storage('sessionStorage'), storage('localStorage'));
    const s = joinSession({ appId: APP_ID, room: this.room, page: PAGE_ID, identity, storage: storage('sessionStorage') });
    this.session = s;
    s.set(spaceKey(s.self.memberId), this.space);
    s.on('self', (self) => s.set(spaceKey(self.memberId), this.space)); // a member id replaced (another tab had it)
    s.on('join', (p) => {
      this._show(p);
      this.onNotice(p.page === PAGE_ID ? `${p.name} is in the library` : `${p.name} is in the session`);
      this.onChange();
    });
    s.on('update', (p) => {
      const a = this._show(p);
      if (a.page !== p.page && p.page === PAGE_ID) this.onNotice(`${p.name} came into the library`);
      a.page = p.page;
      this.onChange();
    });
    s.on('shared', ({ key }) => { if (key.startsWith(SPACE_PREFIX)) this.onChange(); });
    s.on('leave', (p) => {
      this.avatars.drop(p.peerId);
      this.onNotice(`${p.name || 'Someone'} left the session`);
      this.onChange();
    });
    this.onChange();
  }

  /** A visitor's avatar (the layer's avatars.js), with the key of where they are in the library. */
  _show(peer) {
    const a = this.avatars.show(peer);
    if (peer.memberId && a.memberId !== peer.memberId) {
      a.memberId = peer.memberId;
      a.spaceKey = spaceKey(peer.memberId); // made once, not per frame
    }
    return a;
  }

  _leave() {
    this._joining++;
    if (!this.session) return;
    this.session.leave();
    this.session = null;
    this.avatars.clear();
  }

  _setAddress(room) {
    try {
      const url = new URL(location.href);
      if (room) url.searchParams.set('room', room);
      else url.searchParams.delete('room');
      history.replaceState(history.state, '', url.href);
    } catch { /* an address that cannot change (a sandbox) */ }
  }

  /**
   * Per frame: sends where the head and hands are (at most 15 times a second), and places the
   * others who are in this room of the library. Allocates nothing (GC pauses on a Quest).
   */
  update(now) {
    const s = this.session;
    if (!s) return;
    s.setPose(readPose(this.camera, this.renderer.xr.isPresenting ? this.hands() : null, this._pose));
    s.tick();
    this.avatars.place(now, s.peers, this._isHere);
  }
}
