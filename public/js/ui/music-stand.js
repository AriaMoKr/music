// The music stand (SPEC §5.6 "Sounds"): beside the open book while a sound plays. A MIDI song
// shows as a piano roll (media/roll.js), a recording as its picture (a tune's score); a playhead
// moves across either. Below, practice: the tempo (the pitch kept), a loop round a passage, and
// for a song its key and its parts (each muted, or played with another instrument). The canvas
// is drawn again only when something changes or the roll needs its next window; the playhead is
// a mesh in front of it, moved every frame (nothing allocated).

import * as THREE from 'three';
import { Panel, UI } from './panel.js';
import { FAMILY_NAMES, ROLL_SPAN, drawRoll, inWindow, partColor, rollLayout, windowFor } from '../media/roll.js';
import { RATE_MAX, RATE_MIN } from '../media/synth.js';

export const STAND_W = 0.46;
export const STAND_H = 0.4;
const PX = 1300;
/** The roll's (or the picture's) box on the canvas, in px. */
const ROLL = { x: 16, y: 64, w: 566, h: 220 };
/** Parts shown (four to a row); a song with more shows the first. */
const MAX_PARTS = 8;
const RATE_STEP = 0.1;
/** The instrument families a part is given in turn (⇄): not the synth effects and sounds. */
const SWAP_FAMILIES = 12;

export class MusicStand {
  /** @param {{ onClose: () => void }} o ✕ */
  constructor({ onClose }) {
    this.onClose = onClose;
    this.panel = new Panel({ width: STAND_W, height: STAND_H, pxPerMeter: PX });
    this.panel.visible = false;
    this.panel.mesh.name = 'music-stand';
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this._k = this.panel.width / this.panel.w; // metres a canvas pixel
    this.playhead = new THREE.Mesh(new THREE.PlaneGeometry(3 * this._k, ROLL.h * this._k), mat);
    this.playhead.position.set(0, this.panel.height / 2 - (ROLL.y + ROLL.h / 2) * this._k, 0.001);
    this.playhead.renderOrder = 11;
    this.panel.mesh.add(this.playhead);
    this.swap = false; // tapping a part changes its instrument instead of muting it
    this.loopA = null; // a loop's start, set while its end is not yet (s)
    this._player = null;
    this._title = '';
    this._pic = null; // the picture's URL (a recording's)
    this._image = null; // { src, image } of it, once loaded
    this._loadImage = null;
    this._song = null;
    this._layout = null;
    this._from = -1; // where the roll's window starts (s)
    this._x = -1; // the playhead's pixel, as last placed
  }

  get mesh() {
    return this.panel.mesh;
  }

  get visible() {
    return this.panel.visible;
  }

  set visible(v) {
    this.panel.visible = v;
  }

  /**
   * Shows the sound playing: `player` the SoundPlayer, `title` what the sound is called, `pic`
   * its picture (a recording shows it), `loadImage(url)` a Promise of an Image (api.imageSource).
   */
  show(player, title, pic = null, loadImage = null) {
    if (player.media !== this._media) { // another sound: its loop is not this one's
      this._media = player.media;
      this.loopA = null;
    }
    Object.assign(this, { _player: player, _title: title, _pic: pic, _loadImage: loadImage });
    this.fill();
  }

  /** Fills the canvas again (a part muted, the tempo changed…). */
  fill() {
    const p = this.panel;
    const player = this._player;
    if (!player) return;
    const song = player.song;
    if (song !== this._song) {
      this._song = song;
      this._layout = song ? rollLayout(song) : null;
      this._from = -1;
    }
    p.clear();
    p.add({ type: 'text', x: 18, y: 16, w: 500, h: 36, size: 24, weight: '600', serif: true, color: UI.accent, maxLines: 1, text: `♪ ${this._title || 'Sound'}` });
    p.add({ id: 'stand-close', type: 'button', x: p.w - 66, y: 10, w: 52, h: 46, label: '✕', size: 24, onClick: () => this.onClose() });
    const synth = player.synth;
    if (song) {
      p.add({
        id: 'roll', type: 'custom', ...ROLL,
        draw: (g, el) => drawRoll(g, song, this._layout, el, Math.max(0, this._from), ROLL_SPAN,
          { muted: synth?.mutedChannels ?? null, transpose: synth?.transpose ?? 0 }),
      });
    } else {
      const pic = this._pic;
      if (pic && this._image?.src !== pic) {
        this._image = { src: pic, image: null };
        this._loadImage?.(pic).then((img) => {
          if (this._image?.src !== pic || !img) return;
          this._image.image = img;
          this.panel.set('pic', { image: img });
        }, () => {});
      }
      p.add({ type: 'rect', ...ROLL, radius: 8, color: '#f3ead6' });
      if (pic) p.add({ id: 'pic', type: 'image', x: ROLL.x + 6, y: ROLL.y + 6, w: ROLL.w - 12, h: ROLL.h - 12, image: this._image?.image ?? null });
      else p.add({ type: 'text', x: ROLL.x, y: ROLL.y + ROLL.h / 2 - 18, w: ROLL.w, h: 36, size: 24, color: '#6b5b45', align: 'center', text: 'A recording' });
    }
    // Practice: the tempo, a loop, and a song's key.
    const y = 294;
    let x = 16;
    const button = (id, label, w, onClick, extra = {}) => {
      p.add({ id, type: 'button', x, y, w, h: 48, label, size: 20, onClick, ...extra });
      x += w + 6;
    };
    const rate = player.rate;
    button('rate-down', '−', 44, () => this._rate(rate - RATE_STEP), { disabled: rate <= RATE_MIN + 1e-6 });
    button('rate', `${Math.round(rate * 100)}%`, 92, () => this._rate(1), { active: Math.abs(rate - 1) > 1e-6 });
    button('rate-up', '+', 44, () => this._rate(rate + RATE_STEP), { disabled: rate >= RATE_MAX - 1e-6 });
    x += 8;
    const loop = player.loop;
    button('loop', loop ? `Loop ${fmt(loop.a)}–${fmt(loop.b)}` : this.loopA != null ? `From ${fmt(this.loopA)}: to?` : 'Loop', 150, () => this._loop(),
      { active: !!loop || this.loopA != null });
    if (song && synth) {
      x += 8;
      const t = synth.transpose;
      button('key-down', '−', 44, () => this._key(t - 1));
      button('key', t ? `Key ${t > 0 ? '+' : ''}${t}` : 'Key', 84, () => this._key(0), { active: !!t });
      button('key-up', '+', 44, () => this._key(t + 1));
      // The parts: each muted or played again (or, with ⇄, played with the next instrument).
      const pw = (ROLL.w - 3 * 8) / 4;
      partGroups(this._layout.parts).forEach((group, i) => {
        const first = group.parts[0];
        const program = synth.programOf(first.ch) ?? first.program;
        const muted = group.parts.every((x) => synth.muted(x.ch));
        const bx = 16 + (i % 4) * (pw + 8);
        const by = 352 + Math.floor(i / 4) * 50;
        const name = first.drums ? 'Drums' : FAMILY_NAMES[(program >> 3) & 15];
        p.add({
          id: `part-${first.ch}`, type: 'button', x: bx, y: by, w: pw, h: 44, size: 18,
          label: `${muted ? '✕ ' : ''}${name}${group.parts.length > 1 ? ` ×${group.parts.length}` : ''}`,
          color: muted ? 'rgba(60,52,44,0.9)' : undefined, active: !muted && synth.programOf(first.ch) !== undefined,
          onClick: () => this._part(group),
        });
        p.add({ type: 'rect', x: bx + 8, y: by + 38, w: pw - 16, h: 3, color: partColor(first.ch) });
      });
      p.add({
        id: 'swap', type: 'button', x: 16, y: 456, w: 200, h: 44, size: 18, label: this.swap ? '⇄ Instrument: on' : '⇄ Instrument', active: this.swap,
        onClick: () => {
          this.swap = !this.swap;
          this.fill();
        },
      });
      p.add({
        type: 'text', x: 228, y: 468, w: ROLL.w - 212, h: 28, size: 17, color: UI.muted, maxLines: 1,
        text: this.swap ? 'Tap a part: it plays with the next instrument' : 'Tap a part to mute it, or hear it again',
      });
    } else {
      p.add({ type: 'text', x: 16, y: 360, w: ROLL.w, h: 60, size: 19, color: UI.muted, maxLines: 2, text: 'A recording: its tempo (the pitch kept) and a loop. A MIDI song also shows its notes, its key and its parts.' });
    }
    this._x = -1;
  }

  _rate(rate) {
    this._player.setRate(Math.round(rate * 10) / 10);
    this.fill();
  }

  /** Loop: off → its start here → its end here (it goes round) → off. */
  _loop() {
    const player = this._player;
    if (player.loop) {
      player.setLoop(null);
      this.loopA = null;
    } else if (this.loopA == null) {
      this.loopA = player.position;
    } else {
      const a = this.loopA;
      const b = player.position;
      this.loopA = null;
      player.setLoop(b > a ? { a, b } : { a: b, b: a });
    }
    this.fill();
  }

  _key(semitones) {
    this._player.synth?.setTranspose(semitones);
    this.fill();
  }

  /** A part (or a family of parts) tapped: muted or heard again, or (⇄) played with the next instrument family. */
  _part(group) {
    const synth = this._player.synth;
    if (!synth) return;
    const first = group.parts[0];
    if (this.swap && !first.drums) {
      const now = (synth.programOf(first.ch) ?? first.program) >> 3;
      const next = (now + 1) % SWAP_FAMILIES;
      for (const part of group.parts) synth.setProgram(part.ch, next === part.program >> 3 ? null : next * 8);
    } else {
      const mute = !group.parts.every((x) => synth.muted(x.ch));
      for (const part of group.parts) synth.setMuted(part.ch, mute);
    }
    this.fill();
  }

  /** Every frame while shown: the playhead, and the roll's next window when it gets there. */
  update() {
    const player = this._player;
    if (!player) return;
    const pos = player.position;
    let frac;
    if (this._song) {
      if (this._from < 0 || !inWindow(pos, this._from)) {
        this._from = windowFor(pos);
        this.panel.markDirty();
      }
      frac = (pos - this._from) / ROLL_SPAN;
    } else {
      const d = player.duration;
      frac = d ? pos / d : 0;
    }
    const x = Math.round(ROLL.x + Math.max(0, Math.min(1, frac)) * ROLL.w);
    if (x === this._x) return;
    this._x = x;
    this.playhead.position.x = (x - this.panel.w / 2) * this._k;
  }
}

/**
 * The parts as the stand's buttons show them: one each, or with more than MAX_PARTS (a
 * symphony's 16 channels) one per instrument family ("Strings ×5"), the drums apart; at most
 * MAX_PARTS buttons either way.
 * @returns {Array<{ parts: object[] }>}
 */
export function partGroups(parts) {
  if (parts.length <= MAX_PARTS) return parts.map((part) => ({ parts: [part] }));
  const byFamily = new Map();
  for (const part of parts) {
    const key = part.drums ? 'drums' : part.program >> 3;
    if (!byFamily.has(key)) byFamily.set(key, { parts: [] });
    byFamily.get(key).parts.push(part);
  }
  return [...byFamily.values()].slice(0, MAX_PARTS);
}

/** "1:05", or "12.5s" under a minute. */
function fmt(s) {
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
