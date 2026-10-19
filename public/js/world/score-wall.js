// The wall of scores (SPEC §5.3, §5.6 "Sounds"): in a room whose books play, the pictures beside
// their sounds' links (a tune's score, SPEC §3.5 sound lists `pic`) framed on the wall, above
// the bookcases in a rotunda, between the windows in a hall; pointing at one plays its sound,
// from where it hangs. Two draw calls however many: the frames, and the pictures from one atlas,
// uploaded once its pictures are in (a texture upload per picture would cost a frame each on a
// Quest).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './canvas-texture.js';

/** Pictures on a wall at most: the atlas's tiles. */
export const WALL_SLOTS = 16;
const TILE_W = 512;
const TILE_H = 256;
const COLS = 4;
/** The atlas is uploaded when its pictures are in, or this long after they started loading (ms). */
const UPLOAD_WAIT = 8000;
const PAPER = '#f3ead6';

/**
 * Where a rotunda's pictures hang, facing the middle: over its bookcases (one each, above the
 * section signs), then on the wall between its windows (where two are far enough apart, not by
 * the door), up to WALL_SLOTS.
 * @param {number} R the wall's radius
 * @param {number[]} angles the bookcases' angles (world.js _layoutRotunda: 0 = −Z, toward +X)
 * @param {number[]} [windows] the windows' angles (1.1 m wide)
 * @param {boolean} [door] whether the door stands at the far side (angle π)
 * @returns {Array<{ position: THREE.Vector3, yaw: number, w: number, h: number }>}
 */
export function rotundaSlots(R, angles, windows = [], door = false) {
  const r = R - 0.05;
  const at = (a, y, w, h) => ({ position: new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r), yaw: -a, w, h });
  const step = Math.max(1, Math.ceil(angles.length / WALL_SLOTS));
  const out = [];
  for (let i = 0; i < angles.length && out.length < WALL_SLOTS; i += step) out.push(at(angles[i], 3.42, 1.04, 0.52));
  const sorted = [...windows].sort((a, b) => a - b);
  const span = angles.length ? [angles[0] - 0.6 / R, angles.at(-1) + 0.6 / R] : null;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (let i = 0; i + 1 < sorted.length && out.length < WALL_SLOTS; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    if ((b - a) * R < 1.1 + 0.9 + 0.3) continue; // no room between them
    const mid = (a + b) / 2;
    if (span && norm(mid) > span[0] && norm(mid) < span[1]) continue; // over the bookcases already
    if (door && Math.abs(norm(mid - Math.PI)) * R < 1.6) continue; // the door and its plaque
    out.push(at(mid, 2.2, 0.9, 0.45));
  }
  return out;
}

/** Where a hall's pictures hang: on its long walls between the windows (room.js createHall's). */
export function hallSlots({ minX, maxX, minZ, maxZ }, y = 2.05) {
  const out = [];
  for (let z = maxZ - 2.5 - 1.6; z > minZ + 1.5 && out.length < WALL_SLOTS; z -= 3.2) {
    out.push({ position: new THREE.Vector3(minX + 0.03, y, z), yaw: Math.PI / 2, w: 1.0, h: 0.5 });
    if (out.length < WALL_SLOTS) out.push({ position: new THREE.Vector3(maxX - 0.03, y, z), yaw: -Math.PI / 2, w: 1.0, h: 0.5 });
  }
  return out;
}

export class ScoreWall {
  /**
   * @param {object} mats the room's shared materials (room.js)
   * @param {Array<{ position: THREE.Vector3, yaw: number, w: number, h: number }>} slots
   */
  constructor(mats, slots) {
    this.group = new THREE.Group();
    this.group.name = 'score-wall';
    this.slots = slots;
    this.items = [];
    this._mats = mats;
    this.pictures = null; // the pictures' mesh (raycast: a picture is two triangles)
    this._canvas = null;
    this._token = 0;
  }

  /**
   * Hangs a picture per item (up to the slots): items { pic, … }, their pictures loaded with
   * `loadImage(url)` (a Promise of an Image, or null) and drawn into the atlas, uploaded once.
   */
  setItems(items, loadImage) {
    const token = ++this._token;
    this._clear();
    this.items = items.slice(0, this.slots.length);
    if (!this.items.length) return;
    const n = this.items.length;
    const frames = [];
    const pics = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    this.items.forEach((_, i) => {
      const s = this.slots[i];
      m.compose(s.position, q.setFromAxisAngle(up, s.yaw), one);
      // The frame: a box a little bigger than the picture, set into the wall.
      frames.push(new THREE.BoxGeometry(s.w + 0.1, s.h + 0.1, 0.04).translate(0, 0, 0.01).applyMatrix4(m));
      const pic = new THREE.PlaneGeometry(s.w, s.h).translate(0, 0, 0.032);
      // Its tile of the atlas.
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const rows = Math.ceil(WALL_SLOTS / COLS);
      const uv = pic.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, (col + uv.getX(k)) / COLS, 1 - (row + 1 - uv.getY(k)) / rows);
      }
      pics.push(pic.applyMatrix4(m));
    });
    this._frames = new THREE.Mesh(mergeGeometries(frames), this._mats.darkWood);
    this._frames.name = 'score-frames';
    const canvas = document.createElement('canvas');
    canvas.width = TILE_W * COLS;
    canvas.height = TILE_H * Math.ceil(WALL_SLOTS / COLS);
    const g = canvas.getContext('2d');
    g.fillStyle = PAPER;
    g.fillRect(0, 0, canvas.width, canvas.height);
    this._canvas = canvas;
    const tex = canvasTexture(canvas);
    this.pictures = new THREE.Mesh(mergeGeometries(pics), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a2418 }));
    this.pictures.name = 'score-pictures';
    this.pictures.visible = false; // until its one upload: a blank atlas is not uploaded first
    this.group.add(this._frames, this.pictures);
    // The pictures, as they come; the atlas uploaded once they are all in (or after a while).
    let left = n;
    let uploaded = false;
    const upload = () => {
      if (uploaded || token !== this._token) return;
      uploaded = true;
      tex.needsUpdate = true;
      this.pictures.visible = true;
    };
    const timer = setTimeout(upload, UPLOAD_WAIT);
    this.items.forEach((item, i) => {
      Promise.resolve(item.pic ? loadImage(item.pic) : null).catch(() => null).then((img) => {
        if (token !== this._token) return;
        if (img) drawTile(g, img, (i % COLS) * TILE_W, Math.floor(i / COLS) * TILE_H);
        if (--left === 0) {
          clearTimeout(timer);
          upload();
        }
      });
    });
  }

  /** The item whose picture a raycast hit (its face), or null. */
  itemAt(hit) {
    if (!hit || hit.object !== this.pictures || !this.pictures.visible || hit.faceIndex == null) return null;
    return this.items[Math.floor(hit.faceIndex / 2)] ?? null;
  }

  /** Where item i hangs (the sound plays from there). */
  positionOf(i) {
    return this.slots[i]?.position ?? null;
  }

  _clear() {
    for (const mesh of [this._frames, this.pictures]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      if (mesh === this.pictures) {
        mesh.material.map.dispose();
        mesh.material.dispose();
      }
      mesh.removeFromParent();
    }
    this._frames = this.pictures = null;
    this.items = [];
  }

  dispose() {
    this._token++;
    this._clear();
  }
}

/** A picture into its tile: on paper, as large as fits, with a margin (a score is black on white or clear). */
function drawTile(g, img, x, y) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const pad = 14;
  const s = Math.min((TILE_W - 2 * pad) / iw, (TILE_H - 2 * pad) / ih);
  const w = iw * s;
  const h = ih * s;
  g.fillStyle = PAPER;
  g.fillRect(x, y, TILE_W, TILE_H);
  g.drawImage(img, x + (TILE_W - w) / 2, y + (TILE_H - h) / 2, w, h);
}
