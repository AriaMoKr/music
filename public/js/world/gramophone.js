// The gramophone (SPEC §5.3): in the room of a library whose books play (Gutenberg's Music ZIM,
// "Books that play"), in place of the globe. It plays what the catalogue stand's Listen tab gives
// it, from its horn (interaction.js routes the sound through a PannerNode there), its record
// turning meanwhile; pointing at it pauses or goes on. Four draw calls: wood, dark wood, brass,
// the record.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './canvas-texture.js';

/** The record's turn, in radians a second (78 rpm). */
const SPIN = (78 / 60) * 2 * Math.PI;
/** How fast it comes up to speed and stops (1/s). */
const EASE = 2.5;
/** Where the sound comes from: the horn's mouth, in the gramophone's frame. */
export const HORN_MOUTH = Object.freeze({ x: 0, y: 1.28, z: 0.3 });

/** A shellac record seen from above: grooves catching the light, a red label. */
function recordCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0b0a';
  g.beginPath();
  g.arc(128, 128, 127, 0, Math.PI * 2);
  g.fill();
  for (let r = 44; r < 124; r += 2.2) {
    g.strokeStyle = `rgba(255,255,255,${0.03 + 0.03 * Math.sin(r * 0.7)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(128, 128, r, 0, Math.PI * 2);
    g.stroke();
  }
  // A highlight across the grooves: it turns with the record, so the record is seen to turn.
  const sheen = g.createLinearGradient(0, 0, 256, 256);
  sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.65, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.arc(128, 128, 42, 0, Math.PI * 2, true);
  g.fill();
  g.fillStyle = '#8e1f1a';
  g.beginPath();
  g.arc(128, 128, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d9b26a';
  g.font = '600 30px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('♪', 128, 116);
  g.font = '600 11px Georgia, serif';
  g.fillText('VRLBRY', 128, 146);
  g.fillStyle = '#e8e0d0';
  g.beginPath();
  g.arc(128, 128, 3, 0, Math.PI * 2);
  g.fill();
  return c;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A cylinder from point a to point b (its axis along them). */
function rod(r, a, b, seg = 10) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  geo.applyQuaternion(q);
  const mid = from.add(to).multiplyScalar(0.5);
  return geo.translate(mid.x, mid.y, mid.z);
}

/** The horn: a flaring bell from its neck behind the turntable, its mouth up and toward the front. */
function hornGeometry() {
  const L = 0.55;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(0.018 + 0.21 * t ** 3, t * L));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.rotateX(1.0); // its axis from +Y toward +Z
  return geo.translate(0, 0.98, -0.16);
}

/**
 * Builds a gramophone standing at (x, z), its horn facing `yaw` (rotation about Y; 0 = +Z).
 * @param {object} mats the room's shared materials (room.js)
 * @returns {{ group: THREE.Group, meshes: THREE.Mesh[], collider: object, mouth: THREE.Vector3,
 *   level: number, setMusic(playing: boolean): void, update(dt: number): void }} (its record's
 *   texture is disposed with the room: disposeRoom)
 */
export function makeGramophone(mats, { x, z, yaw }) {
  const group = new THREE.Group();
  group.name = 'gramophone';
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  // A cabinet with a slab on top, and the turntable's plinth.
  const wood = new THREE.Mesh(mergeGeometries([
    box(0.5, 0.7, 0.44, 0, 0.37, 0),
    box(0.46, 0.08, 0.42, 0, 0.785, 0),
  ]), mats.wood);
  const dark = new THREE.Mesh(mergeGeometries([
    box(0.56, 0.03, 0.5, 0, 0.735, 0),
    box(0.54, 0.02, 0.48, 0, 0.01, 0),
    box(0.4, 0.5, 0.01, 0, 0.38, 0.222), // the cabinet's door
  ]), mats.darkWood);
  const brass = new THREE.Mesh(mergeGeometries([
    hornGeometry(),
    rod(0.02, [0, 0.83, -0.16], [0, 0.99, -0.16]), // the neck
    rod(0.008, [0.13, 0.85, -0.13], [0.05, 0.84, 0.07]), // the tone arm
    rod(0.006, [0, 0.825, 0], [0, 0.85, 0], 8), // the spindle
    new THREE.TorusGeometry(0.17, 0.006, 6, 40).rotateX(Math.PI / 2).translate(0, 0.826, 0), // the platter's rim
    rod(0.012, [0.25, 0.55, 0.05], [0.33, 0.55, 0.05]), // the crank
  ]), mats.brassDouble);
  const record = new THREE.Mesh(new THREE.CircleGeometry(0.165, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({
    map: canvasTexture(recordCanvas()),
  }));
  record.position.y = 0.828;
  group.add(wood, dark, brass, record);
  group.updateMatrixWorld(true);
  const mouth = new THREE.Vector3(HORN_MOUTH.x, HORN_MOUTH.y, HORN_MOUTH.z).applyMatrix4(group.matrixWorld);
  let target = 0;
  let level = 0;
  return {
    group,
    meshes: [wood, dark, brass, record],
    collider: { type: 'circle', x, z, r: 0.4, h: 1.4 },
    /** Where the sound comes from (world space): the horn's mouth. */
    mouth,
    /** How far the music is up: 0 silent … 1 playing (eased: the room's lights follow it). */
    get level() { return level; },
    setMusic(playing) {
      target = playing ? 1 : 0;
    },
    update(dt) {
      if (level !== target) level = target > level ? Math.min(target, level + EASE * dt) : Math.max(target, level - EASE * dt);
      if (level) record.rotation.y -= SPIN * level * dt;
    },
  };
}
