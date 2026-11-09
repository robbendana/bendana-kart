// Karts and drivers for the 3D view. Each kart is built from a few merged
// meshes (so a full grid of racers stays cheap on phones) plus a handful of
// moving parts: wheels that spin and steer, a sprung body that bounces, rolls
// and pitches, and a driver whose arms hold a steering wheel that turns.
//
// Local kart space: +X is forward, +Y is up, +Z is the driver's right.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { KartView } from './view3d';

// ---------------------------------------------------------------------------
// Shared textures and sprites
// ---------------------------------------------------------------------------

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

export const textureCache = new Map<string, THREE.Texture>();

export function emojiTexture(e: string): THREE.Texture {
  const hit = textureCache.get(e);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `100px ${EMOJI_FONT}`;
    g.fillText(e, 64, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(e, t);
  return t;
}

export function glowTexture(): THREE.Texture {
  const hit = textureCache.get('__glow');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  textureCache.set('__glow', t);
  return t;
}

/** A soft round puff used for exhaust smoke. */
function puffTexture(): THREE.Texture {
  const hit = textureCache.get('__puff');
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    for (const [x, y, r] of [[32, 34, 22], [22, 28, 14], [42, 27, 15], [30, 22, 13]]) {
      const grd = g.createRadialGradient(x, y, 1, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.5)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  textureCache.set('__puff', t);
  return t;
}

export function tagTexture(text: string, color: string): { tex: THREE.Texture; aspect: number } {
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  const font = 'bold 40px system-ui, -apple-system, sans-serif';
  let w = 200;
  if (g0) {
    g0.font = font;
    w = Math.ceil(g0.measureText(text).width) + 44;
  }
  c.width = w;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(15,23,42,0.8)';
    g.strokeStyle = color;
    g.lineWidth = 5;
    const r = 28;
    g.beginPath();
    g.moveTo(r, 3);
    g.arcTo(w - 3, 3, w - 3, 61, r);
    g.arcTo(w - 3, 61, 3, 61, r);
    g.arcTo(3, 61, 3, 3, r);
    g.arcTo(3, 3, w - 3, 3, r);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 64 };
}

export function emojiSprite(e: string, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), transparent: true, alphaTest: 0.15 }));
  s.scale.set(size, size, 1);
  return s;
}

const smooth = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a: number) => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};

// ---------------------------------------------------------------------------
// Geometry helpers: parts are baked with vertex colours and merged
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Parts {
  list: THREE.BufferGeometry[] = [];
  constructor(private uv = false) {}

  addM(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation | null, m: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!this.uv) g.deleteAttribute('uv');
    else if (!g.getAttribute('uv')) return this;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.applyMatrix4(m);
    if (color !== null) {
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    this.list.push(g);
    return this;
  }

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation | null, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
    return this.addM(geo, color, _m);
  }

  /** A rod (cylinder) or limb (capsule) between two points. */
  between(a: V3, b: V3, r: number, color: THREE.ColorRepresentation, capsule = false, seg = 8) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const len = d.length();
    if (len < 0.001) return this;
    const geo = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.01, len), 3, seg) : new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(UP, d.normalize());
    _m.compose(va.add(vb).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    return this.addM(geo, color, _m);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    this.list = [];
    return g;
  }
}

const rbox = (w: number, h: number, d: number, r = 1, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
/** Cylinder whose axis runs along X (for gauges, thrusters, pipes). */
const cylX = (rt: number, rb: number, h: number, seg = 12) => cyl(rt, rb, h, seg).rotateZ(-Math.PI / 2);
/** Cylinder whose axis runs along Z (for axles and wheels). */
const cylZ = (r: number, h: number, seg = 12) => cyl(r, r, h, seg).rotateX(Math.PI / 2);

/** A side profile (x forward, y up) extruded across the kart's width. */
function profile(pts: [number, number][], width: number, bevel = 1.2): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.5, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A flat outline (x forward, z sideways) given some thickness, e.g. wings. */
function plate(pts: [number, number][], thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -thick / 2, 0);
  return g;
}

const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// ---------------------------------------------------------------------------
// Body layouts
// ---------------------------------------------------------------------------

type Cfg = {
  name: string;
  rf: number; wf: number; // front wheel radius and width
  rr: number; wr: number; // rear wheel radius and width
  fx: number; rx: number; // front and rear axle x
  tz: number; // wheel centre distance from the middle
  seatX: number; seatY: number; // driver's hips
  wheelX: number; wheelY: number; // steering wheel centre
  knobby?: boolean;
  hover?: boolean;
  soft: number; // suspension softness (bigger = bouncier)
  shadow: [number, number];
  tagY: number;
};

// Footprints match the old boxes so bumping and items still line up.
const CFG: Cfg[] = [
  { name: 'Classic', rf: 6.5, wf: 5.5, rr: 7.5, wr: 7, fx: 17, rx: -16, tz: 16, seatX: -5, seatY: 11.5, wheelX: 4.5, wheelY: 17.5, soft: 1, shadow: [34, 24], tagY: 60 },
  { name: 'Speedster', rf: 6, wf: 5, rr: 7, wr: 7.5, fx: 22, rx: -19, tz: 15, seatX: -6, seatY: 10, wheelX: 3.5, wheelY: 16, soft: 0.8, shadow: [42, 22], tagY: 58 },
  { name: 'Monster Truck', rf: 13, wf: 11, rr: 13, wr: 11, fx: 16, rx: -16, tz: 20, seatX: -4, seatY: 23, wheelX: 5.5, wheelY: 29, knobby: true, soft: 1.8, shadow: [38, 32], tagY: 74 },
  { name: 'Jet Racer', rf: 0, wf: 0, rr: 0, wr: 0, fx: 0, rx: 0, tz: 0, seatX: -4, seatY: 18, wheelX: 5.5, wheelY: 24, hover: true, soft: 1.3, shadow: [40, 30], tagY: 68 },
  { name: 'Mini Buggy', rf: 6, wf: 5, rr: 8.5, wr: 8, fx: 14, rx: -13, tz: 15, seatX: -3, seatY: 12, wheelX: 6, wheelY: 18, knobby: true, soft: 1.3, shadow: [30, 24], tagY: 60 },
  { name: 'Bubble Car', rf: 6, wf: 5, rr: 6, wr: 5, fx: 12, rx: -12, tz: 15, seatX: -4, seatY: 12, wheelX: 5.5, wheelY: 18, soft: 1.5, shadow: [32, 26], tagY: 64 },
];

// Driver proportions (shared by every racer): a small suited body with a big
// helmet so the character's face reads at a glance.
const TORSO_TILT = 0.2; // leaning back in the seat
const SHOULDER_Y = 9.6;
const SHOULDER_Z = 5;
const HELMET_Y = 20.5;
const HELMET_R = 9.5;
const ARM_A = 7; // upper arm
const ARM_B = 7.2; // forearm
const WHEEL_R = 5.5;
const MAX_WHEEL_TURN = 1.25; // steering wheel turn at full lock, radians

/** Where to put a first-person camera for this body, in kart space. */
export function driverEye(body: number): { fwd: number; up: number } {
  const c = CFG[body] || CFG[0];
  return { fwd: c.seatX - 1, up: c.wheelY + 11 };
}

// ---------------------------------------------------------------------------
// The kart object
// ---------------------------------------------------------------------------

type Puff = { s: THREE.Sprite; age: number; life: number; x: number; y: number; z: number };

type AnimState = {
  init: boolean;
  prevHeading: number;
  prevSpeed: number;
  prevAir: number;
  peakAir: number;
  prevLand: number;
  yawRate: number;
  acc: number;
  steer: number;
  front: number;
  spinF: number;
  spinR: number;
  y: number; vy: number;
  roll: number; vroll: number;
  pitch: number; vpitch: number;
  sq: number; vsq: number;
  tRoll: number; vtRoll: number;
  tPitch: number; vtPitch: number;
  look: number;
  droop: number;
  flagX: number; vflagX: number;
  flagZ: number; vflagZ: number;
  scarf: number;
  puffAt: number;
  puffI: number;
  wave: number;
  cheer: number;
};

export type KartObj = {
  group: THREE.Group;
  model: THREE.Group;
  under: THREE.Group;
  body: THREE.Group;
  mounts: THREE.Group[]; // wheel mounts, front ones steer
  wheels: THREE.Mesh[];
  frontCount: number;
  tilt: THREE.Group;
  spin: THREE.Group;
  needle: THREE.Group;
  torso: THREE.Group;
  helmet: THREE.Group;
  face: THREE.Sprite;
  arms: THREE.Mesh[]; // upper L, fore L, upper R, fore R
  scarf: THREE.Mesh;
  flag: THREE.Group;
  flames: THREE.Mesh[];
  tips: { p: THREE.Vector3; d: THREE.Vector3 }[];
  puffs: Puff[];
  brake: THREE.MeshBasicMaterial;
  dizzy: THREE.Sprite;
  shadow: THREE.Mesh;
  shield: THREE.Mesh;
  tag: THREE.Sprite | null;
  bubble: THREE.Sprite | null;
  bubbleE: string;
  key: string;
  bob: number;
  alpha: number;
  cfg: Cfg;
  bodyIdx: number;
  st: AnimState;
};

export type KartLook = Pick<KartView, 'body' | 'color' | 'dark' | 'emoji' | 'name' | 'isMe'>;

export const kartKey = (k: KartLook) => `${k.body}|${k.color}|${k.dark}|${k.emoji}|${k.name}|${k.isMe ? 1 : 0}`;

const TIRE = '#1f2430';
const RIM = '#d7dde5';
const DARKGREY = '#2b3240';
const CHROME = '#e8edf3';
const SEAT = '#1c2230';

function wheelGeo(r: number, w: number, side: number, hub: THREE.ColorRepresentation, knobby: boolean): THREE.BufferGeometry {
  const P = new Parts();
  // Tyre with rounded shoulders, turned on a lathe (axis Y), then laid on Z
  const pts = [
    new THREE.Vector2(r * 0.62, -w / 2),
    new THREE.Vector2(r * 0.9, -w / 2),
    new THREE.Vector2(r * 0.98, -w / 2 + w * 0.12),
    new THREE.Vector2(r, -w / 2 + w * 0.3),
    new THREE.Vector2(r, w / 2 - w * 0.3),
    new THREE.Vector2(r * 0.98, w / 2 - w * 0.12),
    new THREE.Vector2(r * 0.9, w / 2),
    new THREE.Vector2(r * 0.62, w / 2),
  ];
  P.add(new THREE.LatheGeometry(pts, 20).rotateX(Math.PI / 2), TIRE);
  // Tread blocks
  const blocks = knobby ? 14 : 10;
  for (let i = 0; i < blocks; i++) {
    const a = (i / blocks) * Math.PI * 2;
    const bw = knobby ? r * 0.32 : r * 0.16;
    const bh = knobby ? r * 0.12 : r * 0.05;
    for (const off of knobby ? [-0.22, 0.22] : [0]) {
      P.add(new THREE.BoxGeometry(bw, bh, w * (knobby ? 0.4 : 0.75)), TIRE,
        [Math.cos(a) * r, Math.sin(a) * r, off * w + (knobby ? (i % 2 ? 0.06 : -0.06) * w : 0)], [0, 0, a - Math.PI / 2]);
    }
  }
  // Rim, dish, spokes and hub cap on the outside face
  const face = side * w * 0.36;
  P.add(cylZ(r * 0.62, w * 0.8, 16), RIM);
  P.add(cylZ(r * 0.5, 0.6, 14), DARKGREY, [0, 0, face]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    P.add(new THREE.BoxGeometry(r * 0.5, r * 0.13, w * 0.12), RIM, [Math.cos(a) * r * 0.27, Math.sin(a) * r * 0.27, face + side * 0.35], [0, 0, a]);
  }
  P.add(cylZ(r * 0.2, w * 0.2, 10), hub, [0, 0, face + side * 0.5]);
  P.add(cylZ(r * 0.08, w * 0.24, 6), CHROME, [0, 0, face + side * 0.6]);
  return P.build()!;
}

function steeringGeo(paint: THREE.ColorRepresentation, yoke: boolean): THREE.BufferGeometry {
  // Built with the column along X (toward the driver is -X)
  const P = new Parts();
  if (yoke) {
    // Jet Racer: an aircraft-style yoke with two grips
    P.add(rbox(1.2, 1.6, WHEEL_R * 2.1, 0.6), '#111827');
    for (const s of [-1, 1]) P.add(rbox(1.4, WHEEL_R * 1.2, 1.6, 0.6), '#111827', [0, WHEEL_R * 0.35, s * WHEEL_R]);
  } else {
    P.add(new THREE.TorusGeometry(WHEEL_R, 0.85, 8, 24).rotateY(Math.PI / 2), '#111827');
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      P.add(new THREE.BoxGeometry(0.6, WHEEL_R, 1.1), '#9ca3af', [0.3, Math.cos(a) * WHEEL_R * 0.5, Math.sin(a) * WHEEL_R * 0.5], [a, 0, 0]);
    }
    // Top centre marker so turning reads from far away
    P.add(rbox(0.9, 1.2, 1.4, 0.3), '#facc15', [0, WHEEL_R, 0]);
  }
  P.add(cylX(1.9, 1.9, 1.4, 14), '#374151');
  P.add(cylX(1.3, 1.3, 1.6, 12), paint, [-0.3, 0, 0]);
  // Gloves at ten and two (they turn with the wheel)
  for (const s of [-1, 1]) {
    const a = Math.PI / 3;
    const hy = Math.cos(a) * WHEEL_R;
    const hz = s * Math.sin(a) * WHEEL_R;
    P.add(sph(1.75, 10, 8), '#f8fafc', [-0.6, hy, hz], [0, 0, 0], [1.1, 1, 1.15]);
    P.add(sph(0.7, 6, 5), '#f8fafc', [0.3, hy + 1.2, hz - s * 0.6]); // thumb
  }
  return P.build()!;
}

function helmetGeo(paint: THREE.ColorRepresentation, stripe: THREE.ColorRepresentation): THREE.BufferGeometry {
  const P = new Parts();
  const R = HELMET_R;
  // Shell with an open face toward +X. three.js spheres put phi = PI at +X.
  const gap = 1.95; // half-width of the face opening, radians
  P.add(new THREE.SphereGeometry(R, 20, 6, 0, Math.PI * 2, 0, 0.36 * Math.PI), paint);
  P.add(new THREE.SphereGeometry(R, 20, 8, Math.PI + gap, Math.PI * 2 - gap * 2, 0.36 * Math.PI, 0.46 * Math.PI), paint);
  // Racing stripe over the top
  P.add(new THREE.SphereGeometry(R * 1.02, 3, 5, -0.18, 0.36, 0, 0.3 * Math.PI), stripe);
  P.add(new THREE.SphereGeometry(R * 1.02, 3, 4, Math.PI - 0.18, 0.36, 0, 0.34 * Math.PI), stripe);
  // Visor rim around the face opening
  const browY = R * Math.cos(0.36 * Math.PI);
  P.add(new THREE.TorusGeometry(R * Math.sin(0.36 * Math.PI), 0.7, 5, 12, gap * 2).rotateX(Math.PI / 2).rotateY(gap), '#111827', [0, browY, 0]);
  // Goggles resting on the forehead
  const gy = R * Math.cos(0.3 * Math.PI);
  const gr = R * Math.sin(0.3 * Math.PI) + 0.3;
  P.add(new THREE.TorusGeometry(gr, 0.55, 5, 24).rotateX(Math.PI / 2), '#111827', [0, gy, 0]);
  for (const s of [-1, 1]) {
    P.add(cylX(1.9, 1.9, 1.4, 12), '#334155', [gr * Math.cos(s * 0.33), gy + 0.3, gr * Math.sin(s * 0.33)], [0, -s * 0.33, 0]);
    P.add(cylX(1.4, 1.4, 1.6, 12), '#7dd3fc', [gr * Math.cos(s * 0.33) + 0.2, gy + 0.3, gr * Math.sin(s * 0.33)], [0, -s * 0.33, 0]);
  }
  // Chin bar stubs and a little rear spoiler
  for (const s of [-1, 1]) P.add(sph(2, 8, 6), paint, [R * 0.55, -R * 0.62, s * R * 0.5]);
  P.add(rbox(4, 1.2, 6, 0.5), stripe, [-R * 0.8, R * 0.55, 0], [0, 0, -0.5]);
  // Neck
  P.add(cyl(2.2, 2.6, 4, 10), '#334155', [0, -R - 0.5, 0]);
  return P.build()!;
}

function torsoGeo(suit: THREE.ColorRepresentation, trim: THREE.ColorRepresentation): THREE.BufferGeometry {
  const P = new Parts();
  // Pivot is the hips. Torso goes up +Y.
  P.add(new THREE.CapsuleGeometry(3.7, 4.4, 4, 12), suit, [0, 5.4, 0], [0, 0, 0], [0.95, 1, 1.2]);
  P.add(sph(2.5, 10, 8), suit, [0, SHOULDER_Y, SHOULDER_Z], [0, 0, 0], [1, 0.9, 1]);
  P.add(sph(2.5, 10, 8), suit, [0, SHOULDER_Y, -SHOULDER_Z], [0, 0, 0], [1, 0.9, 1]);
  // Front zip panel and collar
  P.add(rbox(1, 6.5, 2.6, 0.4), trim, [3.35, 5.8, 0]);
  P.add(new THREE.TorusGeometry(2.4, 0.7, 6, 14).rotateX(Math.PI / 2), trim, [0, 10.6, 0]);
  // Harness straps
  for (const s of [-1, 1]) {
    P.add(rbox(0.6, 8, 1.2, 0.3), '#111827', [3.2, 6, s * 2.2], [0.12 * s, 0, 0]);
    P.add(rbox(0.6, 8, 1.2, 0.3), '#111827', [-3.3, 6.2, s * 2.2], [0.12 * s, 0, 0]);
  }
  // Belt
  P.add(new THREE.TorusGeometry(3.8, 0.6, 5, 16).rotateX(Math.PI / 2), '#111827', [0, 1.6, 0], [0, 0, 0], [0.95, 1, 1.15]);
  // Back number disc
  P.add(cylX(2.1, 2.1, 0.5, 14), '#f8fafc', [-3.6, 6.4, 0]);
  return P.build()!;
}

function addLegs(B: Parts, c: Cfg, suit: THREE.ColorRepresentation, stretch = 1) {
  for (const s of [-1, 1]) {
    const hip: V3 = [c.seatX + 0.5, c.seatY + 0.5, s * 2.5];
    const knee: V3 = [c.seatX + 7.5 * stretch, c.seatY + 4, s * 3.2];
    const foot: V3 = [c.seatX + 13.5 * stretch, c.seatY - 0.5, s * 3];
    B.between(hip, knee, 2.4, suit, true);
    B.between(knee, foot, 2, suit, true);
    B.add(rbox(4, 2.6, 2.8, 1), '#111827', [foot[0] + 1, foot[1], foot[2]]);
  }
}

function addSeat(B: Parts, c: Cfg, accent: THREE.ColorRepresentation) {
  const x = c.seatX;
  const y = c.seatY;
  B.add(rbox(9, 2.4, 10.5, 1), SEAT, [x + 0.5, y - 1.3, 0]);
  B.add(rbox(2.4, 13, 11, 1.1), SEAT, [x - 5.4, y + 5, 0], [0, 0, TORSO_TILT + 0.05]);
  for (const s of [-1, 1]) B.add(rbox(3, 9, 1.8, 0.8), accent, [x - 4.4, y + 3.6, s * 5.8], [0, 0, TORSO_TILT + 0.05]);
}

function addDash(B: Parts, c: Cfg, paint: THREE.ColorRepresentation) {
  const dx = c.wheelX + 3.6;
  const dy = c.wheelY - 2.8;
  B.add(rbox(4.5, 3.6, 13, 1.2), '#111827', [dx, dy, 0]);
  // Two gauges facing the driver
  for (const s of [-1, 1]) {
    B.add(cylX(1.9, 1.9, 0.8, 16), '#374151', [dx - 2.3, dy + 0.7, s * 4]);
    B.add(cylX(1.5, 1.5, 0.9, 16), '#f8fafc', [dx - 2.45, dy + 0.7, s * 4]);
  }
  B.add(new THREE.BoxGeometry(0.3, 1.2, 0.3), '#ef4444', [dx - 2.95, dy + 1.2, -4], [0.9, 0, 0]);
  // Shift light and steering column
  B.add(sph(0.6, 6, 5), paint, [dx - 1.6, dy + 2, 0]);
  B.between([dx, dy, 0], [c.wheelX + 0.6, c.wheelY - 0.3, 0], 0.8, '#4b5563');
}

function addPlateDecal(D: Parts, pos: V3, rot: V3, size: number) {
  D.add(new THREE.PlaneGeometry(size, size), null, pos, rot);
}

function addExhaust(B: Parts, from: V3, to: V3, tips: KartObj['tips']) {
  B.between(from, to, 1.1, CHROME, false, 10);
  const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
  const tip = new THREE.Vector3(...to).addScaledVector(d, 0.8);
  B.between(to, [tip.x, tip.y, tip.z], 1.5, '#4b5563', false, 10);
  tips.push({ p: tip.clone().addScaledVector(d, 0.8), d });
}

function addFlag(paint: THREE.ColorRepresentation): THREE.BufferGeometry {
  const P = new Parts();
  P.add(cyl(0.3, 0.45, 24, 6), '#e5e7eb', [0, 12, 0]);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 24, 0, 0, 17.5, 0, -8, 21.5, 0], 3));
  tri.computeVertexNormals();
  P.add(tri, paint);
  P.add(sph(0.8, 6, 5), '#facc15', [0, 24.4, 0]);
  return P.build()!;
}

// ---------------------------------------------------------------------------

function buildBody(idx: number, c: Cfg, paint: string, dark: string, B: Parts, F: Parts, G: Parts, L: Parts, K: Parts, D: Parts, tips: KartObj['tips']) {
  const light = mix(paint, '#ffffff', 0.35);
  const accent = mix(paint, '#ffffff', 0.15);
  const head = '#fff7cc';
  const tail = '#7f1d1d';

  if (idx === 0) {
    // ----- Classic: an open-wheel go-kart with side pods and a rear wing
    F.add(rbox(44, 1.6, 20, 0.6), DARKGREY, [0, 6.8, 0]);
    F.add(cylZ(0.9, c.tz * 2, 8), CHROME, [c.rx, c.rr, 0]);
    F.add(cylZ(0.8, c.tz * 2 - 4, 8), CHROME, [c.fx, c.rf, 0]);
    F.add(rbox(3, 3, 37, 1.2), DARKGREY, [-25, 8, 0]); // rear bumper
    for (const s of [-1, 1]) {
      F.between([-8, 7.5, s * 14.6], [10, 7.5, s * 14.6], 0.9, CHROME); // nerf bars
      F.between([-8, 7.5, s * 14.6], [-5, 7.5, s * 10], 0.9, CHROME);
      F.between([10, 7.5, s * 14.6], [7, 7.5, s * 10], 0.9, CHROME);
    }
    B.add(profile([[-23, 7.5], [-23, 13], [-19, 15.5], [-11.5, 15.5], [-10.5, 10], [6, 10], [8.5, 15.2], [12, 15.6], [21, 13], [28, 10.5], [29.5, 8.5], [27, 7.2]], 20), paint);
    // Stripe down the nose
    B.add(rbox(16, 0.6, 4, 0.3), light, [18.5, 13.4, 0], [0, 0, -0.2]);
    for (const s of [-1, 1]) {
      // Side pods with a dark top stripe and a number roundel
      B.add(rbox(15, 6, 4, 1.6), paint, [0.5, 11, s * 12.5]);
      B.add(rbox(15.2, 1, 4.2, 0.4), dark, [0.5, 13.6, s * 12.5]);
      B.add(cylZ(3.1, 0.4, 16), '#f8fafc', [1, 10.6, s * 14.55]);
      addPlateDecal(D, [1, 10.6, s * 14.8], [0, s > 0 ? 0 : Math.PI, 0], 5.4);
    }
    // Front wing and bumper
    F.add(rbox(4, 1.2, 32, 0.5), dark, [27, 6.6, 0]);
    for (const s of [-1, 1]) F.add(rbox(6, 4, 0.8, 0.3), paint, [27, 7.8, s * 16]);
    F.add(rbox(2.6, 2.6, 22, 1), DARKGREY, [30.2, 8, 0]);
    // Engine on the rear deck
    B.add(rbox(8, 6, 9, 1.2), '#374151', [-17, 18.5, 0]);
    for (let i = 0; i < 3; i++) B.add(rbox(6.5, 0.6, 9.4, 0.25), '#9ca3af', [-17, 20 + i * 1.3, 0]);
    B.add(cylZ(2.6, 3, 14), accent, [-15.5, 19.5, -6.5]);
    B.add(cylZ(2, 3.2, 12), '#111827', [-15.5, 19.5, -6.5]);
    addExhaust(B, [-19, 17, 3], [-25.5, 20, 4.8], tips);
    addExhaust(B, [-19, 17, -1], [-25.5, 20, -2.8], tips);
    // Rear wing on two posts
    for (const s of [-1, 1]) B.add(rbox(1.4, 9, 1.4, 0.5), dark, [-21.5, 20, s * 7]);
    B.add(rbox(6.5, 1.5, 27, 0.6), paint, [-22, 25.2, 0], [0, 0, -0.15]);
    B.add(rbox(6.6, 0.5, 27.2, 0.2), light, [-22, 26, 0], [0, 0, -0.15]);
    for (const s of [-1, 1]) B.add(rbox(8, 6, 0.8, 0.3), dark, [-22, 24, s * 13.8]);
    // Rear plate and lights
    B.add(rbox(1, 8, 9, 0.5), '#f8fafc', [-24.2, 11.5, 0]);
    addPlateDecal(D, [-24.8, 11.5, 0], [0, -Math.PI / 2, 0], 7.4);
    for (const s of [-1, 1]) K.add(rbox(0.8, 2, 4, 0.4), tail, [-24.8, 11.8, s * 7.5]);
    for (const s of [-1, 1]) L.add(sph(1.6, 10, 8), head, [28, 11, s * 5.5], [0, 0, 0], [0.6, 1, 1]);
    // Small fly screen
    G.add(rbox(0.6, 5, 11, 0.3), null, [10.5, 18, 0], [0, 0, 0.55]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  } else if (idx === 1) {
    // ----- Speedster: long, low and pointy with a big double wing
    F.add(rbox(52, 1.4, 18, 0.6), DARKGREY, [1, 5.8, 0]);
    F.add(cylZ(0.9, c.tz * 2, 8), CHROME, [c.rx, c.rr, 0]);
    F.add(cylZ(0.8, c.tz * 2 - 4, 8), CHROME, [c.fx, c.rf, 0]);
    B.add(profile([[-28, 6.5], [-28.5, 11], [-24, 13], [-14, 14.5], [-11.5, 9], [5, 9], [8, 13.5], [16, 13], [30, 9.5], [38, 7.5], [38, 6], [30, 5.5]], 18), paint);
    // Shark fin on the engine cover
    B.add(plate([[0, 0], [12, 0], [0, -7]], 0.8).rotateX(Math.PI / 2), dark, [-24, 13.5, 0]);
    B.add(rbox(28, 0.6, 3.2, 0.3), light, [20, 11.6, 0], [0, 0, -0.14]);
    for (const s of [-1, 1]) {
      B.add(profile([[-8, 7], [-8, 12], [6, 11], [9, 7]], 4.5, 0.8), paint, [0, 0, s * 11]);
      B.add(rbox(1, 3.4, 3.4, 0.4), '#111827', [8.8, 9.2, s * 11]); // intake
      B.add(cylZ(3, 0.4, 16), '#f8fafc', [-1, 9.6, s * 13.4]);
      addPlateDecal(D, [-1, 9.6, s * 13.65], [0, s > 0 ? 0 : Math.PI, 0], 5.2);
    }
    // Front wing
    F.add(plate([[0, -17], [6, -17], [8, 0], [6, 17], [0, 17], [2, 0]], 1), dark, [33, 6, 0]);
    for (const s of [-1, 1]) F.add(rbox(8, 4.5, 0.8, 0.3), paint, [36, 7.5, s * 17]);
    // Big double rear wing
    for (const s of [-1, 1]) B.add(rbox(1.4, 15, 1.6, 0.5), dark, [-26, 20, s * 5]);
    B.add(rbox(7, 1.4, 30, 0.6), paint, [-27, 27.5, 0], [0, 0, -0.12]);
    B.add(rbox(5, 1.1, 30, 0.5), dark, [-29.5, 30.5, 0], [0, 0, -0.3]);
    for (const s of [-1, 1]) B.add(rbox(10, 8, 0.9, 0.3), dark, [-27.5, 27.5, s * 15.2]);
    addExhaust(B, [-24, 9, 2.5], [-30, 10, 2.5], tips);
    addExhaust(B, [-24, 9, -2.5], [-30, 10, -2.5], tips);
    B.add(rbox(1, 6, 8, 0.5), '#f8fafc', [-29.9, 15.5, 0]);
    addPlateDecal(D, [-30.5, 15.5, 0], [0, -Math.PI / 2, 0], 5.6);
    for (const s of [-1, 1]) K.add(rbox(0.8, 1.6, 5, 0.4), tail, [-29.8, 10.5, s * 6.5]);
    for (const s of [-1, 1]) L.add(rbox(2, 1, 4, 0.4), head, [33, 8.5, s * 4.5], [0, 0, -0.3]);
    G.add(rbox(0.5, 3.6, 10, 0.3), null, [9, 15, 0], [0, 0, 0.75]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  } else if (idx === 2) {
    // ----- Monster Truck: huge knobby tyres, high body, visible shocks
    F.add(cylZ(1.4, c.tz * 2 - 6, 8), DARKGREY, [c.rx, c.rr, 0]);
    F.add(cylZ(1.4, c.tz * 2 - 6, 8), DARKGREY, [c.fx, c.rf, 0]);
    for (const s of [-1, 1]) F.between([c.rx, c.rr, s * 6], [c.fx, c.rf, s * 6], 1.3, DARKGREY);
    F.add(rbox(10, 6, 10, 2), '#374151', [c.rx, c.rr, 0]); // diff
    F.add(rbox(8, 5, 9, 2), '#374151', [c.fx, c.rf, 0]);
    B.add(profile([[-26, 17], [-26, 25], [-22, 27.5], [-10, 27.5], [-8.5, 22], [8, 22], [10, 27.5], [16, 28.5], [26, 26], [28, 21], [26, 17]], 24, 1.6), paint);
    for (const s of [-1, 1]) {
      // Fender arches over each wheel
      for (const x of [c.fx, c.rx]) {
        B.add(new THREE.CylinderGeometry(15.2, 15.2, 12.5, 18, 1, true, Math.PI / 2 + 0.2, Math.PI - 0.4).rotateX(Math.PI / 2), dark, [x, c.rf + 1, s * c.tz]);
      }
      B.between([-20, 18.5, s * 14], [20, 18.5, s * 14], 1.3, CHROME);
      // Upper shock bodies
      B.between([c.fx, 27, s * (c.tz - 5.5)], [c.fx, 20, s * (c.tz - 5.5)], 1.7, '#ef4444');
      B.between([c.rx, 27, s * (c.tz - 5.5)], [c.rx, 20, s * (c.tz - 5.5)], 1.7, '#ef4444');
      B.add(cylZ(3.4, 0.4, 16), '#f8fafc', [0, 23.5, s * 12.2]);
      addPlateDecal(D, [0, 23.5, s * 12.45], [0, s > 0 ? 0 : Math.PI, 0], 6);
    }
    // Roll bar with a light bar
    B.add(new THREE.TorusGeometry(10, 1.1, 6, 16, Math.PI).rotateY(Math.PI / 2), CHROME, [-11, 27, 0]);
    for (let i = -1.5; i <= 1.5; i++) L.add(rbox(1.5, 1.8, 2.6, 0.5), '#fde68a', [-10, 37.6, i * 3.4]);
    B.add(rbox(1.6, 2.4, 14, 0.6), '#111827', [-10.6, 37.4, 0]);
    // Vertical exhaust stacks
    addExhaust(B, [-14, 25, 8], [-14, 36, 8], tips);
    addExhaust(B, [-14, 25, -8], [-14, 36, -8], tips);
    F.add(rbox(3, 4, 30, 1.2), DARKGREY, [29, 19, 0]); // push bar
    B.add(rbox(1, 7, 10, 0.5), '#f8fafc', [-27.6, 22, 0]);
    addPlateDecal(D, [-28.2, 22, 0], [0, -Math.PI / 2, 0], 7);
    for (const s of [-1, 1]) K.add(rbox(0.8, 2.4, 3.4, 0.4), tail, [-27.4, 25.2, s * 9]);
    for (const s of [-1, 1]) L.add(sph(2.2, 10, 8), head, [27.4, 24, s * 7], [0, 0, 0], [0.6, 1, 1]);
    G.add(rbox(0.6, 6, 18, 0.3), null, [12, 31, 0], [0, 0, 0.5]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  } else if (idx === 3) {
    // ----- Jet Racer: hovers on glowing pads, wings, fins and thrusters
    const y0 = 12;
    B.add(profile([[-30, y0], [-30, y0 + 8], [-24, y0 + 10], [-11, y0 + 10], [-9.5, y0 + 5], [6, y0 + 5], [10, y0 + 10], [18, y0 + 9], [40, y0 + 4], [40, y0 + 2.5], [30, y0]], 18, 1.4), paint);
    B.add(rbox(32, 0.6, 3.2, 0.3), light, [20, y0 + 7.4, 0], [0, 0, -0.17]);
    for (const s of [-1, 1]) {
      B.add(plate([[-14, s * 9], [4, s * 9], [-6, s * 25], [-14, s * 25]], 1.4), paint, [0, y0 + 3, 0]);
      B.add(rbox(9, 1.6, 2, 0.5), dark, [-10, y0 + 3, s * 25]);
      L.add(sph(0.9, 6, 5), s > 0 ? '#22c55e' : '#ef4444', [-10, y0 + 4.2, s * 25.5]);
      // Tail fins
      B.add(plate([[0, 0], [9, 0], [2, -10], [-3, -10]], 1).rotateX(Math.PI / 2).rotateX(s * 0.25), dark, [-29, y0 + 9, s * 6]);
      // Thrusters
      B.add(cylX(4.6, 5.4, 11, 14), '#374151', [-28, y0 + 4, s * 7]);
      L.add(cylX(3.6, 3.6, 0.8, 14), '#38bdf8', [-33.6, y0 + 4, s * 7]);
      tips.push({ p: new THREE.Vector3(-34, y0 + 4, s * 7), d: new THREE.Vector3(-1, 0, 0) });
      B.add(cylZ(3, 0.4, 16), '#f8fafc', [-18, y0 + 6, s * 9.2]);
      addPlateDecal(D, [-18, y0 + 6, s * 9.45], [0, s > 0 ? 0 : Math.PI, 0], 5.4);
    }
    // Hover pads glowing underneath
    for (const x of [-18, 18]) for (const s of [-1, 1]) {
      B.add(cyl(4, 4.6, 2, 14), '#374151', [x, y0 - 0.5, s * 7]);
      L.add(cyl(3.2, 3.2, 0.6, 14), '#67e8f9', [x, y0 - 1.6, s * 7]);
    }
    for (const s of [-1, 1]) K.add(rbox(0.8, 1.6, 3, 0.4), tail, [-31.4, y0 + 8, s * 2.5]);
    for (const s of [-1, 1]) L.add(rbox(2, 1, 3, 0.4), head, [36, y0 + 4.3, s * 3.2], [0, 0, -0.2]);
    B.add(rbox(1, 6.4, 6.4, 0.5), '#f8fafc', [-31.3, y0 + 4.5, 0]);
    addPlateDecal(D, [-31.9, y0 + 4.5, 0], [0, -Math.PI / 2, 0], 5.6);
    G.add(new THREE.SphereGeometry(9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), null, [9, y0 + 5, 0], [0, 0, 0], [1.3, 0.75, 0.9]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  } else if (idx === 4) {
    // ----- Mini Buggy: tube frame roll cage, knobby tyres, open engine
    F.add(rbox(32, 1.6, 18, 0.6), DARKGREY, [0, 7.8, 0]);
    F.add(cylZ(1, c.tz * 2, 8), CHROME, [c.rx, c.rr, 0]);
    F.add(cylZ(0.9, c.tz * 2 - 3, 8), CHROME, [c.fx, c.rf, 0]);
    B.add(profile([[-14, 8.5], [-14, 12], [-9, 12], [-8, 11], [8, 11], [11, 15], [17, 14], [21, 10], [20, 8.5]], 18), paint);
    B.add(rbox(8, 0.6, 3, 0.3), light, [15, 14.8, 0], [0, 0, -0.18]);
    // Roll cage
    const cage = '#e2e8f0';
    for (const s of [-1, 1]) {
      B.between([-10, 11, s * 9], [-9, 46, s * 11.5], 1.1, cage);
      B.between([-9, 46, s * 11.5], [8, 31, s * 10.5], 1.1, cage);
      B.between([8, 31, s * 10.5], [11, 14, s * 9], 1.1, cage);
      B.between([-10, 12, s * 9], [11, 14, s * 9], 1.1, cage);
      B.add(cylZ(3, 0.4, 16), '#f8fafc', [1, 10.2, s * 9.2]);
      addPlateDecal(D, [1, 10.2, s * 9.45], [0, s > 0 ? 0 : Math.PI, 0], 5.2);
    }
    B.between([-9, 46, -11.5], [-9, 46, 11.5], 1.1, cage);
    B.between([8, 31, -10.5], [8, 31, 10.5], 1.1, cage);
    B.between([-10, 12, -9], [-9.5, 30, 11], 0.9, cage);
    // Exposed engine and a big air filter
    B.add(rbox(8, 7, 9, 1.4), '#374151', [-15, 13.5, 0]);
    for (let i = 0; i < 4; i++) B.add(rbox(6, 0.6, 9.4, 0.25), '#9ca3af', [-15, 13 + i * 1.3, 0]);
    B.add(cyl(3, 3, 4, 14), accent, [-13, 19.5, 0]);
    B.add(cyl(3.3, 3.3, 0.8, 14), '#111827', [-13, 21.6, 0]);
    addExhaust(B, [-17, 12, 4], [-21, 18, 5], tips);
    F.add(rbox(3, 3, 22, 1.2), DARKGREY, [-22.5, 9, 0]);
    F.add(rbox(3, 4, 20, 1.2), DARKGREY, [22.5, 10, 0]);
    // Rear antenna-style tail lights on the bumper
    for (const s of [-1, 1]) K.add(rbox(1, 2, 3, 0.4), tail, [-24.2, 9, s * 8.5]);
    B.add(rbox(1, 6, 7, 0.5), '#f8fafc', [-19.6, 13.5, 0]);
    addPlateDecal(D, [-20.2, 13.5, 0], [0, -Math.PI / 2, 0], 5.6);
    for (const s of [-1, 1]) L.add(sph(2, 10, 8), head, [8.8, 32.6, s * 4], [0, 0, 0], [0.6, 1, 1]);
    B.add(rbox(1.6, 2.4, 12, 0.6), '#111827', [8, 32.4, 0]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  } else {
    // ----- Bubble Car: a round tub, big glass dome and headlight eyes
    const y0 = 16;
    B.add(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), paint, [0, y0, 0], [0, 0, 0], [23, 10, 17]);
    B.add(new THREE.TorusGeometry(1, 0.08, 6, 32).rotateX(Math.PI / 2), dark, [0, y0, 0], [0, 0, 0], [23, 11, 17]);
    // Rear cowl behind the seat
    B.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), paint, [-15.5, y0, 0], [0, 0, 0], [8, 9, 14]);
    // Headlight eyes
    for (const s of [-1, 1]) {
      B.add(cylX(3.6, 3.6, 2, 16), CHROME, [19.5, y0 - 1.5, s * 6.5], [0, s * 0.35, 0]);
      L.add(sph(3, 14, 10), '#fffbeb', [20.6, y0 - 1.5, s * 6.9], [0, 0, 0], [0.55, 1, 1]);
      B.add(sph(1.3, 10, 8), '#111827', [22.2, y0 - 1, s * 6.4]);
      B.add(cylZ(3.2, 0.4, 16), '#f8fafc', [-2, y0 - 4, s * 15.8]);
      addPlateDecal(D, [-2, y0 - 4, s * 16.05], [0, s > 0 ? 0 : Math.PI, 0], 5.6);
    }
    B.add(rbox(2, 2, 18, 1), CHROME, [22.5, 8.5, 0]);
    B.add(rbox(2, 2, 22, 1), CHROME, [-22.5, 9, 0]);
    for (const s of [-1, 1]) K.add(rbox(0.8, 2.4, 3.6, 0.4), tail, [-22, 13.5, s * 8]);
    addPlateDecal(D, [-23.7, 13.4, 0], [0, -Math.PI / 2, 0], 6);
    F.add(cylZ(0.9, c.tz * 2, 8), DARKGREY, [c.rx, c.rr, 0]);
    F.add(cylZ(0.9, c.tz * 2, 8), DARKGREY, [c.fx, c.rf, 0]);
    tips.push({ p: new THREE.Vector3(-23, 9, 4), d: new THREE.Vector3(-1, 0.1, 0) });
    G.add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), null, [0, y0, 0], [0, 0, 0], [21, 30, 15.5]);
    addSeat(B, c, accent);
    addDash(B, c, paint);
  }
}

// ---------------------------------------------------------------------------

export function buildKart(k: KartLook): KartObj {
  const idx = CFG[k.body] ? k.body : 0;
  const c = CFG[idx];
  const group = new THREE.Group();
  const model = new THREE.Group();
  const under = new THREE.Group();
  const body = new THREE.Group();
  group.add(model);
  model.add(under);
  model.add(body);

  const paint = k.color;
  const dark = k.dark;
  const suit = mix(dark, '#0f172a', 0.15).getStyle();
  const trim = '#f8fafc';
  const paintMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x4b5563, side: idx === 2 || idx === 5 ? THREE.DoubleSide : THREE.FrontSide });
  const matte = new THREE.MeshLambertMaterial({ vertexColors: true });

  const B = new Parts();
  const F = new Parts();
  const G = new Parts();
  const L = new Parts();
  const K = new Parts();
  const D = new Parts(true);
  const tips: KartObj['tips'] = [];
  buildBody(idx, c, paint, dark, B, F, G, L, K, D, tips);
  addLegs(B, c, suit, idx === 1 ? 1.08 : 1);

  const put = (parent: THREE.Object3D, g: THREE.BufferGeometry | null, mat: THREE.Material) => {
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    parent.add(m);
    return m;
  };
  put(body, B.build(), paintMat);
  put(under, F.build(), paintMat);
  put(body, G.build(), new THREE.MeshPhongMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.35, shininess: 120, specular: 0xffffff, depthWrite: false, side: THREE.DoubleSide }));
  put(body, L.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  const brake = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
  put(body, K.build(), brake);
  const decal = put(body, D.build(), new THREE.MeshBasicMaterial({ map: emojiTexture(k.emoji), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
  if (decal) decal.renderOrder = 1;

  // Wheels: a mount (which steers) holds the spinning wheel
  const mounts: THREE.Group[] = [];
  const wheels: THREE.Mesh[] = [];
  let frontCount = 0;
  if (!c.hover) {
    const geoCache = new Map<string, THREE.BufferGeometry>();
    for (const [front, s] of [[1, -1], [1, 1], [0, -1], [0, 1]]) {
      const r = front ? c.rf : c.rr;
      const w = front ? c.wf : c.wr;
      const key = `${front}${s}`;
      let g = geoCache.get(key);
      if (!g) {
        g = wheelGeo(r, w, s, idx === 2 ? '#facc15' : paint, !!c.knobby);
        geoCache.set(key, g);
      }
      const mount = new THREE.Group();
      mount.position.set(front ? c.fx : c.rx, r, s * c.tz);
      const wheel = new THREE.Mesh(g, matte);
      mount.add(wheel);
      if (idx === 2) {
        // Lower shock tube rides with the wheel
        const P = new Parts();
        P.between([0, 0, -s * 5.5], [0, 10, -s * 5.5], 1.1, CHROME);
        P.add(new THREE.TorusGeometry(1.6, 0.4, 5, 10).rotateX(Math.PI / 2), '#facc15', [0, 4, -s * 5.5]);
        P.add(new THREE.TorusGeometry(1.6, 0.4, 5, 10).rotateX(Math.PI / 2), '#facc15', [0, 6, -s * 5.5]);
        mount.add(new THREE.Mesh(P.build()!, paintMat));
      }
      under.add(mount);
      mounts.push(mount);
      wheels.push(wheel);
      if (front) frontCount++;
    }
  }

  // Steering wheel: tilt holds the column angle, spin turns with input
  const tilt = new THREE.Group();
  tilt.position.set(c.wheelX, c.wheelY, 0);
  tilt.rotation.z = -0.5;
  const spin = new THREE.Group();
  tilt.add(spin);
  spin.add(new THREE.Mesh(steeringGeo(paint, idx === 3), paintMat));
  body.add(tilt);

  // Speedo needle on the right gauge
  const needle = new THREE.Group();
  needle.position.set(c.wheelX + 3.6 - 2.95, c.wheelY - 2.8 + 0.7, 4);
  const nm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.3).translate(0, 0.6, 0), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  needle.add(nm);
  body.add(needle);

  // Driver
  const torso = new THREE.Group();
  torso.position.set(c.seatX, c.seatY, 0);
  torso.rotation.z = TORSO_TILT;
  body.add(torso);
  const torsoMesh = new THREE.Mesh(torsoGeo(suit, trim), matte);
  torso.add(torsoMesh);
  const helmet = new THREE.Group();
  helmet.position.set(0.6, HELMET_Y, 0);
  torso.add(helmet);
  const helmetMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x6b7280, side: THREE.DoubleSide });
  helmet.add(new THREE.Mesh(helmetGeo(paint, trim), helmetMat));
  const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(k.emoji), transparent: true, alphaTest: 0.15 }));
  face.scale.set(HELMET_R * 2.1, HELMET_R * 2.1, 1);
  face.position.set(1.2, -0.5, 0);
  helmet.add(face);
  // The character's emoji as a sticker on the back of the helmet, so you can
  // tell who is who from behind
  const sticker = new THREE.Mesh(
    new THREE.SphereGeometry(HELMET_R * 1.03, 10, 10, -0.75, 1.5, Math.PI / 2 - 0.85, 1.5),
    new THREE.MeshBasicMaterial({ map: emojiTexture(k.emoji), transparent: true, alphaTest: 0.2 }),
  );
  helmet.add(sticker);

  // Arms: upper and fore for each side, placed every frame by a two-bone IK
  const arms: THREE.Mesh[] = [];
  const upperGeo = new THREE.CapsuleGeometry(1.75, ARM_A, 3, 8).translate(0, ARM_A / 2, 0);
  const foreGeo = new THREE.CapsuleGeometry(1.5, ARM_B, 3, 8).translate(0, ARM_B / 2, 0);
  for (let i = 0; i < 2; i++) {
    const up = new THREE.Mesh(new Parts().add(upperGeo, suit).build()!, matte);
    const fp = new Parts();
    fp.add(foreGeo, suit);
    fp.add(new THREE.CylinderGeometry(1.75, 1.75, 1.5, 10), trim, [0, ARM_B - 0.6, 0]); // glove cuff
    const fore = new THREE.Mesh(fp.build()!, matte);
    body.add(up);
    body.add(fore);
    arms.push(up, fore);
  }
  upperGeo.dispose();
  foreGeo.dispose();

  // Scarf trailing from the neck
  const SEG = 7;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3));
  const idxs: number[] = [];
  for (let i = 0; i < SEG - 1; i++) {
    const a = i * 2;
    idxs.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  sg.setIndex(idxs);
  const scarf = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: mix(paint, '#ffffff', 0.25), side: THREE.DoubleSide }));
  scarf.position.set(-1.6, 11.8, 0);
  scarf.frustumCulled = false;
  torso.add(scarf);

  // Safety flag on a whippy pole
  const flag = new THREE.Group();
  const flagPos: Record<number, V3> = { 0: [-20, 15.5, -11], 1: [-22, 13, -9], 2: [-22, 27, -11], 3: [-26, 21, -5], 4: [-16, 17, -8], 5: [-15, 22, -9] };
  flag.position.set(...(flagPos[idx] ?? flagPos[0]));
  flag.add(new THREE.Mesh(addFlag(idx === 2 ? '#facc15' : mix(paint, '#ffffff', 0.5)), matte));
  body.add(flag);

  // Exhaust flames (always on for the jet, otherwise only when boosting)
  const flames: THREE.Mesh[] = [];
  const flameP = new Parts();
  flameP.add(new THREE.ConeGeometry(2.6, 14, 10).rotateZ(Math.PI / 2).translate(-7, 0, 0), '#f97316');
  flameP.add(new THREE.ConeGeometry(1.5, 9, 8).rotateZ(Math.PI / 2).translate(-4.5, 0, 0), '#fde047');
  const flameGeo = flameP.build()!;
  for (const t of tips) {
    const fm = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    fm.position.copy(t.p);
    fm.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), t.d);
    fm.visible = false;
    body.add(fm);
    flames.push(fm);
  }

  // Exhaust puffs
  const puffs: Puff[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xe5e7eb, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    body.add(s);
    puffs.push({ s, age: 1, life: 1, x: 0, y: 0, z: 0 });
  }

  // Dizzy stars for spin-outs
  const dizzy = emojiSprite('💫', 12);
  dizzy.visible = false;
  body.add(dizzy);

  // Blob shadow on the road
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(c.shadow[0], c.shadow[1], 1);
  shadow.position.y = 0.7;
  group.add(shadow);

  // Toddler Assist / Bubble Shield sphere
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(44, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shield.position.y = 20;
  shield.visible = false;
  group.add(shield);

  let tag: THREE.Sprite | null = null;
  if (!k.isMe) {
    const { tex, aspect } = tagTexture(k.name, k.color);
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
    tag.material.userData.ownMap = true;
    tag.scale.set(0.042 * aspect, 0.042, 1);
    tag.position.y = c.tagY;
    tag.renderOrder = 10;
    group.add(tag);
  }

  const st: AnimState = {
    init: false, prevHeading: 0, prevSpeed: 0, prevAir: 0, peakAir: 0, prevLand: 0, yawRate: 0, acc: 0, steer: 0, front: 0,
    spinF: 0, spinR: 0, y: 0, vy: 0, roll: 0, vroll: 0, pitch: 0, vpitch: 0, sq: 0, vsq: 0, tRoll: 0, vtRoll: 0,
    tPitch: 0, vtPitch: 0, look: 0, droop: 0, flagX: 0, vflagX: 0, flagZ: 0, vflagZ: 0, scarf: Math.random() * 10,
    puffAt: 0, puffI: 0, wave: 0, cheer: 0,
  };

  return {
    group, model, under, body, mounts, wheels, frontCount, tilt, spin, needle, torso, helmet, face, arms, scarf, flag,
    flames, tips, puffs, brake, dizzy, shadow, shield, tag, bubble: null, bubbleE: '', key: kartKey(k),
    bob: Math.random() * 10, alpha: 1, cfg: c, bodyIdx: idx, st,
  };
}

export function disposeKart(o: KartObj) {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  o.group.traverse((ch) => {
    const m = ch as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => {
    const mm = m as THREE.SpriteMaterial;
    if (m.userData.ownMap && mm.map) mm.map.dispose();
    m.dispose();
  });
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/** Optional extra signals the driving code may send; all have fallbacks. */
type Extra = { steer: number; slip: number; hop: number; bump: number; land: number; accel: number };

export type AnimCtx = {
  now: number;
  dt: number;
  hideDriver: boolean; // hide all of my own driver (e.g. look-from-the-seat without a cockpit)
  cockpit: boolean; // first-person: hide my head and body, keep arms and wheel
  countdown: number | null;
  camera: THREE.Camera;
};

const spring = (x: number, v: number, target: number, k: number, damp: number, dt: number): [number, number] => {
  const nv = v + (k * (target - x) - damp * v) * dt;
  return [x + nv * dt, nv];
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _camQ = new THREE.Quaternion();
const _wq = new THREE.Quaternion();

function placeArm(upper: THREE.Mesh, fore: THREE.Mesh, S: THREE.Vector3, H: THREE.Vector3, pole: THREE.Vector3) {
  _d.copy(H).sub(S);
  let L = _d.length();
  if (L < 0.001) return;
  _d.multiplyScalar(1 / L);
  L = clamp(L, Math.abs(ARM_A - ARM_B) + 0.2, ARM_A + ARM_B - 0.05);
  const x = (ARM_A * ARM_A - ARM_B * ARM_B + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, ARM_A * ARM_A - x * x));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-6) _p.set(0, -1, 0);
  _p.normalize();
  const E = _a.copy(S).addScaledVector(_d, x).addScaledVector(_p, h);
  const Hr = _b.copy(S).addScaledVector(_d, L);
  upper.position.copy(S);
  upper.quaternion.setFromUnitVectors(UP, _c.copy(E).sub(S).normalize());
  fore.position.copy(E);
  fore.quaternion.setFromUnitVectors(UP, _c.copy(Hr).sub(E).normalize());
}

const _S = new THREE.Vector3();
const _H = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Converts a point in `obj` space up to `body` space using local matrices. */
function toBody(obj: THREE.Object3D, body: THREE.Object3D, p: THREE.Vector3) {
  let o: THREE.Object3D | null = obj;
  while (o && o !== body) {
    p.applyMatrix4(o.matrix);
    o = o.parent;
  }
  return p;
}

export function animateKart(o: KartObj, k: KartView, cx: AnimCtx) {
  const dt = clamp(cx.dt, 0.0001, 0.05);
  const now = cx.now;
  const s = o.st;
  const c = o.cfg;
  const ext = k as KartView & Partial<Extra>;
  const air = k.air ?? 0;
  const maxS = k.maxSpeed > 1 ? k.maxSpeed : 560;
  const sp = k.speed;
  const spN = clamp(sp / maxS, 0, 1.5);

  if (!s.init) {
    s.init = true;
    s.prevHeading = k.heading;
    s.prevSpeed = sp;
  }

  // ----- Place the kart in the world
  const hover = c.hover ? Math.sin(now / 160 + o.bob) * 1.6 : 0;
  o.group.position.set(k.x, hover + air, k.y);
  o.group.rotation.y = -k.yaw;
  o.group.visible = !k.blink;

  // ----- Motion signals (from the driving code when sent, else estimated)
  const yr = clamp(wrapAngle(k.heading - s.prevHeading) / dt, -6, 6);
  s.prevHeading = k.heading;
  s.yawRate += (yr - s.yawRate) * smooth(10, dt);
  const accRaw = clamp((sp - s.prevSpeed) / dt, -2500, 2500);
  s.prevSpeed = sp;
  s.acc += ((ext.accel ?? accRaw) - s.acc) * smooth(ext.accel !== undefined ? 20 : 6, dt);
  let slip = ext.slip ?? wrapAngle(k.yaw - k.heading);
  if (k.spinning || Math.abs(slip) > 1) slip = 0;
  const steerIn = k.spinning ? Math.sin(now / 70) : ext.steer ?? (sp > 12 ? clamp(s.yawRate / 2.4, -1, 1) : 0);
  s.steer += (steerIn - s.steer) * smooth(ext.steer !== undefined ? 22 : 12, dt);
  // Front wheels point where the kart travels, so drifts counter-steer.
  const frontTarget = clamp(s.steer * 0.42 * (k.drifting ? 0.45 : 1) - slip * 0.85, -0.62, 0.62);
  s.front += (frontTarget - s.front) * smooth(20, dt);
  const lat = clamp((sp * s.yawRate) / 1400, -1.2, 1.2); // sideways pull in a turn
  const soft = c.soft;
  const celebrating = k.finished && !k.spinning;

  // ----- Wheels: spin with speed, front ones steer, droop when airborne
  s.spinF += (sp * dt) / Math.max(1, c.rf);
  s.spinR += (sp * dt) / Math.max(1, c.rr) * (cx.countdown !== null && cx.countdown < 1200 ? 3 : 1);
  s.droop += ((air > 2 ? 2.8 : 0) - s.droop) * smooth(air > 2 ? 6 : 18, dt);
  o.under.position.y = -s.droop * 0.5;
  for (let i = 0; i < o.mounts.length; i++) {
    const front = i < o.frontCount;
    const m = o.mounts[i];
    m.position.y = (front ? c.rf : c.rr) - s.droop * 0.5;
    if (front) m.rotation.y = -s.front;
    o.wheels[i].rotation.z = -(front ? s.spinF : s.spinR);
  }

  // ----- Landing, hops and bumps kick the springs
  if (air > s.peakAir) s.peakAir = air;
  const landNow = ext.land !== undefined ? ext.land > s.prevLand + 0.3 : s.prevAir > 2 && air <= 0.5;
  if (landNow) {
    const hit = clamp(Math.max(s.peakAir, 18) / 40, 0.4, 1.5);
    s.vy -= 70 * hit * soft;
    s.vsq += 3.2 * hit;
    s.peakAir = 0;
  }
  if (air <= 0.5) s.peakAir = 0;
  s.prevAir = air;
  s.prevLand = ext.land ?? 0;
  const bump = ext.bump ?? 0;

  // ----- Sprung body: bounce, roll and pitch on springs
  const roadBuzz = sp > 30 ? Math.sin(now / 23 + o.bob) * 0.18 * spN * soft + Math.sin(now / 61) * 0.25 * spN * soft : 0;
  const idle = sp < 25 ? Math.sin(now / (cx.countdown !== null && cx.countdown < 1500 ? 14 : 22) + o.bob) * (cx.countdown !== null ? 0.3 : 0.16) : 0;
  const hop = (ext.hop ?? 0) * 5;
  [s.y, s.vy] = spring(s.y, s.vy, hop + roadBuzz + idle, 320 / soft, 13, dt);
  let rollT = c.hover ? lat * 0.32 : -lat * 0.075 * soft;
  if (k.drifting) rollT += -(k.driftDir || Math.sign(slip)) * 0.05 * (c.hover ? -1 : 1);
  if (bump > 0) rollT += Math.sin(now / 35) * bump * 0.14;
  if (k.spinning) rollT += Math.sin(now / 60) * 0.08;
  [s.roll, s.vroll] = spring(s.roll, s.vroll, rollT, 190 / soft, 11, dt);
  let pitchT = clamp(s.acc / 900, -1, 1) * 0.045 * soft + (k.boost ? 0.04 : 0);
  if (air > 2) pitchT += 0.05;
  [s.pitch, s.vpitch] = spring(s.pitch, s.vpitch, pitchT, 200 / soft, 12, dt);
  [s.sq, s.vsq] = spring(s.sq, s.vsq, 0, 420, 15, dt);
  o.body.position.y = s.y;
  o.body.position.x = sp < 25 ? Math.sin(now / 17 + o.bob) * 0.1 : 0;
  o.body.rotation.set(s.roll, 0, s.pitch);
  const sq = clamp(s.sq, -0.25, 0.3);
  const stretch = k.boost ? 0.04 : 0;
  o.body.scale.set(1 + sq * 0.45 + stretch, 1 - sq, 1 + sq * 0.45);

  // ----- Steering wheel and speedo
  const wheelTurn = clamp(s.front / 0.62, -1, 1) * MAX_WHEEL_TURN;
  o.spin.rotation.x = k.spinning ? Math.sin(now / 50) * 1.2 : wheelTurn;
  o.needle.rotation.x = -2.1 + clamp(spN, 0, 1.15) * 3.7 + (k.boost ? Math.sin(now / 25) * 0.08 : 0);

  // ----- Driver: lean into turns, lag behind on boosts, wobble on bumps
  let tRollT = lat * 0.2 + (k.drifting ? (k.driftDir || Math.sign(slip)) * 0.12 : 0);
  let tPitchT = TORSO_TILT + clamp(s.acc / 1200, -0.2, 0.2) * 0.6 + (k.boost ? 0.22 : 0);
  if (k.spinning) {
    tRollT = Math.sin(now / 55) * 0.35;
    tPitchT = TORSO_TILT + Math.cos(now / 70) * 0.15;
  } else if (celebrating) {
    tRollT = Math.sin(now / 180) * 0.12;
    tPitchT = TORSO_TILT - 0.05 + Math.abs(Math.sin(now / 160)) * 0.08;
  }
  if (landNow) s.vtPitch -= 1.6;
  [s.tRoll, s.vtRoll] = spring(s.tRoll, s.vtRoll, tRollT, 140, 9, dt);
  [s.tPitch, s.vtPitch] = spring(s.tPitch, s.vtPitch, tPitchT, 140, 9, dt);
  o.torso.rotation.set(s.tRoll, 0, s.tPitch);
  const breathe = 1 + Math.sin(now / 420 + o.bob) * 0.018;
  o.torso.scale.set(1, breathe, 1);
  // Head looks into the turn and bobs with the bounce
  const lookT = k.spinning ? Math.sin(now / 45) * 0.6 : celebrating ? Math.sin(now / 400) * 0.5 : clamp(s.steer * 0.45 - slip * 0.6, -0.6, 0.6) + (sp < 20 && !celebrating ? Math.sin(now / 1300 + o.bob) * 0.35 : 0);
  s.look += (lookT - s.look) * smooth(7, dt);
  o.helmet.rotation.set(s.tRoll * 0.6 + (k.spinning ? Math.sin(now / 40) * 0.25 : 0), -s.look, -s.vy * 0.004 - (k.boost ? 0.12 : 0) + (celebrating ? Math.sin(now / 140) * 0.1 : 0));
  o.helmet.position.y = HELMET_Y + (celebrating ? Math.abs(Math.sin(now / 160)) * 1.2 : 0) - clamp(s.vy * 0.01, -0.8, 0.8);

  // ----- Visibility for first-person views
  const showHead = !cx.hideDriver && !cx.cockpit;
  const showArms = !cx.hideDriver;
  o.torso.visible = showHead;
  for (let i = 0; i < o.arms.length; i++) o.arms[i].visible = showArms && (showHead || i % 2 === 1);
  o.tilt.visible = showArms || !cx.hideDriver;

  // ----- Arms: hands follow the wheel, wave when winning, flail in spins
  o.tilt.updateMatrix();
  o.spin.updateMatrix();
  o.torso.updateMatrix();
  if (showArms) {
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      toBody(o.torso, o.body, _S.set(0.2, SHOULDER_Y, side * (SHOULDER_Z + 0.4)));
      const a = Math.PI / 3;
      toBody(o.spin, o.body, _H.set(-0.6, Math.cos(a) * WHEEL_R, side * Math.sin(a) * WHEEL_R));
      const big = air > 14 && !celebrating && !k.spinning;
      if (k.spinning) {
        const ph = now / 90 + i * 2;
        _H.set(_S.x + 4 + Math.cos(ph) * 2, _S.y + 5 + Math.sin(ph) * 4, _S.z + side * (5 + Math.cos(ph * 1.3) * 2));
      } else if (celebrating && side > 0) {
        const w = Math.sin(now / 110);
        toBody(o.torso, o.body, _H.set(2.5, SHOULDER_Y + 11.5, side * (SHOULDER_Z + 4 + w * 2.5)));
      } else if (big && side < 0) {
        toBody(o.torso, o.body, _H.set(3, SHOULDER_Y + 11, side * (SHOULDER_Z + 4)));
      }
      _pole.set(-0.4, -1, side * 1.4);
      placeArm(o.arms[i * 2], o.arms[i * 2 + 1], _S, _H, _pole);
    }
  }

  // ----- Exhaust: flames when boosting, puffs when pulling away
  const jet = !!c.hover;
  for (const f of o.flames) {
    const on = k.boost || jet;
    f.visible = on;
    if (on) {
      const len = k.boost ? 1.1 + Math.random() * 0.5 : 0.35 + Math.random() * 0.15;
      const wide = k.boost ? 1 + Math.random() * 0.2 : 0.7;
      f.scale.set(len, wide, wide);
      const fm = f.material as THREE.MeshBasicMaterial;
      fm.color.set(k.boost ? 0xffffff : 0x7dd3fc);
    }
  }
  const camD = o.group.position.distanceTo(cx.camera.position);
  const near = camD < 900;
  if (near && o.tips.length && !jet) {
    const pulling = s.acc > 120 && sp < 260;
    const idling = sp < 25;
    const every = k.boost ? 1e9 : pulling ? 0.07 : idling ? (cx.countdown !== null ? 0.12 : 0.45) : 1e9;
    s.puffAt -= dt;
    if (s.puffAt <= 0 && every < 1e8) {
      s.puffAt = every;
      const p = o.puffs[s.puffI % o.puffs.length];
      const t = o.tips[s.puffI % o.tips.length];
      s.puffI++;
      p.age = 0;
      p.life = 0.55 + Math.random() * 0.25;
      p.x = t.p.x + t.d.x * 2;
      p.y = t.p.y + t.d.y * 2;
      p.z = t.p.z + t.d.z * 2;
    }
  }
  for (const p of o.puffs) {
    if (p.age >= p.life || !near) {
      p.s.visible = false;
      continue;
    }
    p.age += dt;
    const u = p.age / p.life;
    p.x -= (sp + 18) * dt;
    p.y += 9 * dt;
    p.s.visible = true;
    p.s.position.set(p.x, p.y, p.z);
    const sz = 3 + u * 8;
    p.s.scale.set(sz, sz, 1);
    p.s.material.opacity = 0.55 * (1 - u) * (k.alpha ?? 1);
  }

  // ----- Brake lights glow when slowing down
  const braking = s.acc < -260 && sp > 30;
  o.brake.color.setHex(braking ? 0xff2d2d : 0x7f1d1d);

  // ----- Flag whips around with speed and turns
  [s.flagZ, s.vflagZ] = spring(s.flagZ, s.vflagZ, spN * 0.22 + clamp(s.acc / 3000, -0.15, 0.25), 90, 5, dt);
  [s.flagX, s.vflagX] = spring(s.flagX, s.vflagX, -lat * 0.25 + (bump > 0 ? Math.sin(now / 40) * bump * 0.3 : 0), 90, 5, dt);
  o.flag.rotation.set(s.flagX, Math.sin(now / (90 - spN * 50) + o.bob) * (0.25 + spN * 0.3), s.flagZ);

  // ----- Scarf flutters behind the driver
  if (near && showHead) {
    s.scarf += dt * (5 + spN * 16);
    const droop = clamp(1.3 - spN * 1.3 - (k.boost ? 0.3 : 0), 0.04, 1.3);
    const pos = (o.scarf.geometry.attributes.position as THREE.BufferAttribute);
    const arr = pos.array as Float32Array;
    const L = 12;
    const n = arr.length / 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const amp = t * (0.5 + spN * 1.6);
      const x = -t * L * Math.cos(droop);
      const y = -t * L * Math.sin(droop) + Math.sin(s.scarf - t * 5) * amp;
      const z = Math.sin(s.scarf * 0.7 - t * 4) * amp * 0.6 - lat * t * 4;
      const tw = Math.sin(s.scarf * 0.9 - t * 3) * 0.4 * t;
      const hw = 1.5 - t * 0.4;
      arr[i * 6] = x;
      arr[i * 6 + 1] = y + Math.sin(tw) * hw;
      arr[i * 6 + 2] = z - Math.cos(tw) * hw;
      arr[i * 6 + 3] = x;
      arr[i * 6 + 4] = y - Math.sin(tw) * hw;
      arr[i * 6 + 5] = z + Math.cos(tw) * hw;
    }
    pos.needsUpdate = true;
    o.scarf.geometry.computeVertexNormals();
  }

  // ----- Dizzy stars orbit the head during a spin-out
  o.dizzy.visible = k.spinning && showHead;
  if (o.dizzy.visible) {
    const a = now / 110;
    toBody(o.torso, o.body, _tmp.set(0.6, HELMET_Y + HELMET_R + 3, 0));
    o.dizzy.position.set(_tmp.x + Math.cos(a) * 9, _tmp.y + Math.sin(a * 2) * 1.5, _tmp.z + Math.sin(a) * 9);
    o.dizzy.material.rotation = a;
  }

  // ----- Face: keep the character upright on screen as the head tilts
  if (near && showHead) {
    o.helmet.updateMatrixWorld(true);
    o.helmet.getWorldQuaternion(_wq);
    _up.set(0, 1, 0).applyQuaternion(_wq);
    _camQ.copy(cx.camera.quaternion).invert();
    _up.applyQuaternion(_camQ);
    o.face.material.rotation = Math.atan2(-_up.x, _up.y) * 0.85;
  }

  // ----- Shadow stays on the road and shrinks when airborne
  const lift = air + hover;
  o.shadow.position.y = 0.7 - lift;
  const shrink = 1 - clamp(lift / 120, 0, 0.5);
  o.shadow.scale.set(c.shadow[0] * shrink, c.shadow[1] * shrink, 1);
  (o.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * shrink;

  // ----- Shield bubble
  const sh = k.toddler || !!k.shield;
  o.shield.visible = sh;
  if (sh) {
    o.shield.scale.setScalar(1 + Math.sin(now / 250) * 0.05);
    const sm = o.shield.material as THREE.MeshBasicMaterial;
    sm.color.set(k.shield ? 0xfde047 : 0x38bdf8);
    sm.opacity = k.shield ? 0.28 : 0.16;
  }

  // ----- Emoji bubble above the kart
  const be = k.bubble ?? '';
  const by = c.tagY + (k.isMe ? 8 : 30);
  if (be !== o.bubbleE) {
    o.bubbleE = be;
    if (o.bubble) {
      o.group.remove(o.bubble);
      o.bubble.material.dispose();
      o.bubble = null;
    }
    if (be) {
      o.bubble = emojiSprite(be, 30);
      o.group.add(o.bubble);
    }
  }
  if (o.bubble) o.bubble.position.y = by + Math.sin(now / 200) * 3;

  // ----- Fade out a kart whose player left
  const al = k.alpha ?? 1;
  if (Math.abs(al - o.alpha) > 0.02) {
    o.alpha = al;
    o.group.traverse((ch) => {
      const m = (ch as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.userData.baseOpacity === undefined) {
        m.userData.baseOpacity = m.opacity;
        m.userData.baseTransparent = m.transparent;
      }
      m.transparent = al < 0.99 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * al;
      m.needsUpdate = true;
    });
  }
}

// ---------------------------------------------------------------------------
// A turntable preview for the character picker
// ---------------------------------------------------------------------------

export class KartShowcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 4 / 3, 5, 1000);
  private obj: KartObj | null = null;
  private look: KartLook | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;
  private stand: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-60, 120, 80);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfdbfe, 0.8);
    rim.position.set(80, 40, -100);
    this.scene.add(rim);
    this.stand = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 48, 4, 40),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }),
    );
    this.stand.position.y = -2;
    this.scene.add(this.stand);
    this.camera.position.set(0, 60, 132);
    this.camera.lookAt(0, 18, 0);
  }

  setSize(w: number, h: number, dpr: number) {
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  set(look: KartLook) {
    this.look = look;
    const key = kartKey(look);
    if (this.obj && this.obj.key === key) return;
    if (this.obj) {
      this.scene.remove(this.obj.group);
      disposeKart(this.obj);
    }
    this.obj = buildKart(look);
    this.scene.add(this.obj.group);
    this.t = 0;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(now, dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(now: number, dt: number) {
    const o = this.obj;
    const look = this.look;
    if (!o || !look) return;
    this.t += dt;
    const t = this.t;
    // A little show: wiggle the wheel, rev the engine, wave hello
    const cyc = t % 7;
    const wave = cyc > 4.6 && cyc < 6.4;
    const yaw = -0.6 + t * 0.45;
    const v = {
      id: 'show', name: look.name, isMe: true, x: 0, y: 0, yaw, heading: yaw, speed: 0, maxSpeed: 560,
      emoji: look.emoji, color: look.color, dark: look.dark, body: look.body, boost: false, toddler: false,
      blink: false, drifting: false, driftDir: 0, spinning: false, finished: wave, air: 0, alpha: 1,
      steer: wave ? 0 : Math.sin(t * 1.7) * 0.9, accel: cyc > 3.6 && cyc < 4.4 ? 700 : 0,
    } as KartView & Partial<Extra>;
    animateKart(o, v, { now, dt, hideDriver: false, cockpit: false, countdown: cyc > 3.4 && cyc < 4.4 ? 1000 : null, camera: this.camera });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stop();
    if (this.obj) disposeKart(this.obj);
    this.obj = null;
    this.stand.geometry.dispose();
    (this.stand.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
