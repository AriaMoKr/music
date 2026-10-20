// The shared session (SPEC §5.6 "Together"): the Hallway's (its together.js and README, "Going
// in"; AriaMoKr/layersharedsession, peer to peer over WebRTC with Trystero, through public Nostr
// relays). Its room is in the address (?room=), so the address is the invitation: the Hallway's
// door brings it here, and the way back carries it on (main.js), so the visitor stays in it.
// This page is `music` in the session. The others in it who stand in the same room of the
// library (together-space.js: each place and room is laid out on its own) are drawn as in the
// Hallway: a head with a visor on its front, a hand per tracked controller, a ring on the floor
// and their name.
//
// The session module (and Trystero under it, ~240 kB) loads only when a session is joined, so a
// visit without one costs nothing. The vendor modules are named by relative URL (server/vendor.js
// rewrites their bare imports, and the Pages build copies them).

import * as THREE from 'three';
import { loadIdentity } from '../vendor/layersharedsession/identity.js';
import { emptyPose, hasPart, INTERP_DELAY_MS, latestPose, PART, PART_LENGTH, samplePose, setPart } from '../vendor/layersharedsession/pose.js';
import { APP_ID, PAGE_ID, spaceKey } from './together-space.js';

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';

const storage = (name) => {
  try {
    return window[name];
  } catch {
    return null;
  }
};

/** A box whose faces are shaded as if lit from above (an unlit material, as the Hallway's). */
function shadedBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  // BoxGeometry's faces, 4 vertices each: +x, -x, +y, -y, +z, -z.
  const shade = [0.78, 0.78, 1, 0.55, 0.88, 0.88];
  const colors = [];
  for (const s of shade) for (let i = 0; i < 4; i++) colors.push(s, s, s);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

let parts = null;
/** The avatars' shared geometry and visor, made with the first one. */
function avatarParts() {
  return (parts ||= {
    head: shadedBox(0.2, 0.24, 0.22),
    visor: shadedBox(0.17, 0.06, 0.02).translate(0, 0.02, -0.115),
    hand: shadedBox(0.06, 0.04, 0.12),
    ring: new THREE.RingGeometry(0.2, 0.25, 32).rotateX(-Math.PI / 2),
    visorMaterial: new THREE.MeshBasicMaterial({ color: '#15110c', vertexColors: true }),
  });
}

function labelSprite(text, color) {
  const size = 44;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const font = `600 ${size}px ${SANS}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + size;
  const h = Math.ceil(size * 1.6);
  canvas.width = w;
  canvas.height = h;
  g.font = font;
  g.fillStyle = `${color}d9`;
  g.beginPath();
  g.roundRect(0, 0, w, h, h / 2);
  g.fill();
  g.fillStyle = '#1a1208';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  const height = 0.1;
  sprite.scale.set((height * w) / h, height, 1);
  return sprite;
}

export class Together {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera} o.camera the viewer's head
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {() => Array<{ controller: THREE.Object3D, source: XRInputSource|null }>} o.hands the controllers (controls.js)
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
    this.group = new THREE.Group();
    this.group.name = 'visitors';
    scene.add(this.group);
    this.avatars = []; // index loops, no allocation per frame
    this._pose = emptyPose();
    this._sample = emptyPose();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._joining = 0; // which join is current: a slow import must not join a room left since
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
    s.on('shared', ({ key }) => { if (key.startsWith('vrlbry.space.')) this.onChange(); });
    s.on('leave', (p) => {
      this._drop(p.peerId);
      this.onNotice(`${p.name || 'Someone'} left the session`);
      this.onChange();
    });
    this.onChange();
  }

  _leave() {
    this._joining++;
    if (!this.session) return;
    this.session.leave();
    this.session = null;
    while (this.avatars.length) this._drop(this.avatars[0].peerId);
  }

  _setAddress(room) {
    try {
      const url = new URL(location.href);
      if (room) url.searchParams.set('room', room);
      else url.searchParams.delete('room');
      history.replaceState(history.state, '', url.href);
    } catch { /* an address that cannot change (a sandbox) */ }
  }

  /** The avatar for a visitor, made or relabelled. */
  _show(peer) {
    let a = this.avatars.find((x) => x.peerId === peer.peerId);
    if (!a) {
      const p = avatarParts();
      const material = new THREE.MeshBasicMaterial({ color: peer.color, vertexColors: true });
      const ringMaterial = new THREE.MeshBasicMaterial({ color: peer.color, transparent: true, opacity: 0.55, depthWrite: false });
      const head = new THREE.Mesh(p.head, material);
      head.add(new THREE.Mesh(p.visor, p.visorMaterial));
      const hands = [new THREE.Mesh(p.hand, material), new THREE.Mesh(p.hand, material)];
      const ring = new THREE.Mesh(p.ring, ringMaterial);
      const group = new THREE.Group();
      group.name = `visitor ${peer.peerId}`;
      group.visible = false;
      group.add(head, hands[0], hands[1], ring);
      this.group.add(group);
      a = { peerId: peer.peerId, group, head, hands, ring, material, ringMaterial, label: null, name: null, color: null, page: peer.page, memberId: null, spaceKey: null };
      this.avatars.push(a);
    }
    if (peer.memberId && a.memberId !== peer.memberId) {
      a.memberId = peer.memberId;
      a.spaceKey = spaceKey(peer.memberId); // made once, not per frame
    }
    const name = peer.name || '…';
    if (a.name !== name || a.color !== peer.color) {
      if (a.label) {
        a.group.remove(a.label);
        a.label.material.map.dispose();
        a.label.material.dispose();
      }
      a.label = labelSprite(name, peer.color);
      a.group.add(a.label);
      a.material.color.set(peer.color);
      a.ringMaterial.color.set(peer.color);
      a.name = name;
      a.color = peer.color;
    }
    return a;
  }

  _drop(peerId) {
    const i = this.avatars.findIndex((x) => x.peerId === peerId);
    if (i < 0) return;
    const a = this.avatars[i];
    this.avatars.splice(i, 1);
    this.group.remove(a.group);
    a.material.dispose();
    a.ringMaterial.dispose();
    if (a.label) {
      a.label.material.map.dispose();
      a.label.material.dispose();
    }
  }

  /**
   * Per frame: sends where the head and hands are (at most 15 times a second), and places the
   * others who are in this room of the library. Allocates nothing (GC pauses on a Quest).
   */
  update(now) {
    const s = this.session;
    if (!s) return;
    const pose = this._pose;
    this.camera.getWorldPosition(this._pos);
    this.camera.getWorldQuaternion(this._quat);
    setPart(pose, PART.head, this._pos, this._quat);
    setPart(pose, PART.left, null);
    setPart(pose, PART.right, null);
    if (this.renderer.xr.isPresenting) {
      const hands = this.hands();
      for (let i = 0; i < hands.length; i++) {
        const side = hands[i].source?.handedness;
        if (side !== 'left' && side !== 'right') continue;
        hands[i].controller.getWorldPosition(this._pos);
        hands[i].controller.getWorldQuaternion(this._quat);
        setPart(pose, side === 'left' ? PART.left : PART.right, this._pos, this._quat);
      }
    }
    s.setPose(pose);
    s.tick();

    for (let i = 0; i < this.avatars.length; i++) {
      const a = this.avatars[i];
      const peer = s.peers.get(a.peerId);
      const here = peer && peer.page === PAGE_ID && a.spaceKey && s.get(a.spaceKey) === this.space;
      const p = here && latestPose(peer.buffer) ? samplePose(peer.buffer, now - INTERP_DELAY_MS, this._sample) : null;
      if (!p || !hasPart(p, PART.head)) {
        a.group.visible = false;
        continue;
      }
      a.group.visible = true;
      a.head.position.fromArray(p, 0);
      a.head.quaternion.fromArray(p, 3);
      for (let h = 0; h < 2; h++) {
        const part = h === 0 ? PART.left : PART.right;
        const hand = a.hands[h];
        hand.visible = hasPart(p, part);
        if (!hand.visible) continue;
        hand.position.fromArray(p, part * PART_LENGTH);
        hand.quaternion.fromArray(p, part * PART_LENGTH + 3);
      }
      a.ring.position.set(p[0], 0.01, p[2]); // the library's floor is level, at 0
      a.label.position.set(p[0], p[1] + 0.25, p[2]);
    }
  }
}
