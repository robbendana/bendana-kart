// The 3D world around the race: sky, ground, a crisp road, low-poly scenery,
// trackside props and weather. Everything is built from code (no asset files).
//
// World x maps to three.js X, world y maps to three.js Z, and up is Y.
// A heading of `a` radians points along (cos a, 0, sin a), which is rotation.y = -a.
//
// Performance rules, so tablets stay smooth:
//  - Scenery of one kind is one InstancedMesh (one draw call), with colors baked
//    into the vertices, so the whole world is a few dozen draw calls.
//  - Textures are small and tile; nothing is bigger than 1024 px.
//  - No shadow maps and no post-processing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { emojiSprite, glowTexture } from './kart3d';

export type SceneryItem = { x: number; y: number; e: string; size: number; big: boolean };

export type SceneTrack = {
  xs: Float32Array;
  ys: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  n: number;
  halfW: number;
  worldW: number;
  worldH: number;
  theme: number; // 0 meadow, 1 candy, 2 frosty, 3 dunes, 4 volcano
  name: string;
  colors: {
    grassA: string; grassB: string; edge: string; outside: string; road: string; roadInner: string;
    curbA: string; curbB: string; line: string; dust: string;
  };
  scenery: SceneryItem[];
  sky: string;
  horizon: string;
  hills: string;
  night: boolean;
  ramps?: { x: number; y: number; a: number; len: number; width: number }[];
  pads?: { x: number; y: number; a: number; len: number; width: number }[];
  hazards?: { x: number; y: number; a?: number; r?: number; len?: number; width?: number; kind?: string }[];
};

export type WorldState = { countdownLeft: number | null; excite: number };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrapAngle = (a: number) => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};

const _c = new THREE.Color();
/** Mix a CSS color toward white (k > 0) or black (k < 0). */
function shade(css: string, k: number): string {
  _c.set(css);
  if (k >= 0) _c.lerp(new THREE.Color('#ffffff'), k);
  else _c.lerp(new THREE.Color('#000000'), -k);
  return `#${_c.getHexString()}`;
}

function canvasOf(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  return c;
}

// ---------------------------------------------------------------------------
// Low-poly model kit: a model is a list of colored parts, merged into one mesh
// ---------------------------------------------------------------------------

type Part = { geo: THREE.BufferGeometry; glow: boolean };
type V3 = [number, number, number];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function part(src: THREE.BufferGeometry, color: number | string, pos: V3, scale: number | V3 = 1, rot: V3 = [0, 0, 0], glow = false): Part {
  const geo = src.index ? src.toNonIndexed() : src;
  if (geo !== src) src.dispose();
  const sc: V3 = typeof scale === 'number' ? [scale, scale, scale] : scale;
  _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
  geo.applyMatrix4(_m);
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return { geo, glow };
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);
const sph = (r: number, ws = 7, hs = 5) => new THREE.SphereGeometry(r, ws, hs);
const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);
const oct = (r: number) => new THREE.OctahedronGeometry(r, 0);
const tor = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 12);

function bake(parts: Part[]): { lit: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
  const lit = parts.filter((p) => !p.glow).map((p) => p.geo);
  const glow = parts.filter((p) => p.glow).map((p) => p.geo);
  const out = {
    lit: lit.length ? mergeGeometries(lit, false) : null,
    glow: glow.length ? mergeGeometries(glow, false) : null,
  };
  for (const p of parts) p.geo.dispose();
  return out;
}

// Every model stands on y = 0 and is about 1 unit tall; instances scale it up.
type Maker = () => Part[];

const pine = (leaf: number, snow: boolean): Maker => () => {
  const out = [part(cyl(0.055, 0.075, 0.26), 0x7c4a21, [0, 0.13, 0])];
  const layers: [number, number, number][] = [[0.36, 0.46, 0.44], [0.28, 0.4, 0.68], [0.19, 0.34, 0.9]];
  for (const [r, h, y] of layers) {
    out.push(part(cone(r, h, 7), leaf, [0, y, 0]));
    if (snow) out.push(part(cone(r * 0.72, h * 0.6, 7), 0xffffff, [0, y + h * 0.22, 0]));
  }
  return out;
};

const house = (wall: number, roof: number, snow: boolean): Maker => () => {
  const out = [
    part(box(0.72, 0.44, 0.6), wall, [0, 0.22, 0]),
    part(cone(0.6, 0.36, 4), roof, [0, 0.62, 0], [1, 1, 0.86], [0, Math.PI / 4, 0]),
    part(box(0.14, 0.24, 0.03), 0x7c2d12, [0, 0.12, 0.31]),
    part(box(0.14, 0.13, 0.03), 0x7dd3fc, [-0.22, 0.27, 0.31]),
    part(box(0.14, 0.13, 0.03), 0x7dd3fc, [0.22, 0.27, 0.31]),
    part(box(0.1, 0.26, 0.1), 0x9ca3af, [0.2, 0.72, -0.1]),
  ];
  if (snow) out.push(part(box(0.14, 0.05, 0.14), 0xffffff, [0.2, 0.86, -0.1]));
  return out;
};

const rock = (a: number, b: number): Maker => () => [
  part(ico(0.42), a, [0, 0.2, 0], [1, 0.62, 0.85], [0.3, 0.5, 0]),
  part(ico(0.26), b, [0.3, 0.13, 0.14], [1, 0.7, 1], [0.8, 0.2, 0.4]),
  part(ico(0.18), a, [-0.32, 0.09, -0.12], [1, 0.7, 1], [0.1, 1.2, 0.6]),
];

const flower = (petal: number, heart: number, tall = 0.5): Maker => () => {
  const out = [
    part(cyl(0.025, 0.03, tall, 5), 0x15803d, [0, tall / 2, 0]),
    part(sph(0.1, 6, 4), heart, [0, tall + 0.06, 0], [1, 0.6, 1]),
    part(sph(0.09, 5, 3), 0x16a34a, [0.1, tall * 0.4, 0], [1.4, 0.35, 0.7]),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    out.push(part(sph(0.085, 5, 3), petal, [Math.cos(a) * 0.15, tall + 0.05, Math.sin(a) * 0.15], [1, 0.45, 1]));
  }
  return out;
};

const mushroom = (cap: number, glow: boolean): Maker => () => {
  const out = [
    part(cyl(0.09, 0.12, 0.36, 6), 0xfef3c7, [0, 0.18, 0]),
    part(new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), cap, [0, 0.33, 0], [1, 0.75, 1], [0, 0, 0], glow),
  ];
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7;
    out.push(part(sph(0.05, 5, 3), 0xffffff, [Math.cos(a) * 0.17, 0.5, Math.sin(a) * 0.17]));
  }
  return out;
};

const crystal = (a: number, b: number, s = 1): Maker => () => [
  part(oct(0.2), a, [0, 0.42 * s, 0], [0.8 * s, 2.2 * s, 0.8 * s], [0, 0.4, 0.12], true),
  part(oct(0.15), b, [0.2 * s, 0.26 * s, 0.08 * s], [0.8 * s, 1.8 * s, 0.8 * s], [0.3, 0.2, -0.5], true),
  part(oct(0.12), a, [-0.18 * s, 0.2 * s, -0.06 * s], [0.8 * s, 1.7 * s, 0.8 * s], [-0.2, 0.9, 0.5], true),
  part(ico(0.18), 0x3f3f46, [0, 0.04, 0], [1.6 * s, 0.4, 1.4 * s]),
];

const MODELS: Record<string, Maker> = {
  // ----- Meadow -----
  roundTree: () => [
    part(cyl(0.065, 0.09, 0.42), 0x7c4a21, [0, 0.21, 0]),
    part(ico(0.34), 0x2f9e44, [0, 0.62, 0]),
    part(ico(0.25), 0x51cf66, [0.17, 0.8, 0.06], 1, [0.5, 0.3, 0]),
    part(ico(0.23), 0x37b24d, [-0.18, 0.74, -0.1], 1, [0.2, 1.1, 0.4]),
    part(ico(0.2), 0x40c057, [0.02, 0.92, -0.02], 1, [1.0, 0.4, 0.2]),
  ],
  pine: pine(0x1f7a3a, false),
  palm: () => {
    const out = [
      part(cyl(0.05, 0.07, 0.36, 6), 0x9a6b3f, [0.02, 0.18, 0], 1, [0, 0, -0.08]),
      part(cyl(0.045, 0.05, 0.36, 6), 0xa9794a, [0.06, 0.52, 0], 1, [0, 0, -0.14]),
      part(cyl(0.04, 0.045, 0.24, 6), 0x9a6b3f, [0.11, 0.8, 0], 1, [0, 0, -0.2]),
      part(sph(0.06, 5, 4), 0x5c3d1e, [0.16, 0.86, 0.05]),
      part(sph(0.06, 5, 4), 0x5c3d1e, [0.1, 0.86, -0.06]),
    ];
    for (let k = 0; k < 7; k++) {
      const yaw = (k / 7) * Math.PI * 2;
      out.push(part(cone(0.085, 0.56, 4), k % 2 ? 0x2f9e44 : 0x40c057, [0.14 + Math.cos(yaw) * 0.24, 0.9, -Math.sin(yaw) * 0.24], [1, 1, 0.35], [0, yaw, -1.95]));
    }
    return out;
  },
  rock: rock(0x9ca3af, 0x6b7280),
  house: house(0xfef3c7, 0xdc2626, false),
  daisy: flower(0xffffff, 0xfacc15),
  tulip: flower(0xf43f5e, 0xfda4af, 0.42),
  sunflower: flower(0xfacc15, 0x78350f, 0.8),
  blossom: flower(0xf9a8d4, 0xfef08a, 0.36),
  mushroom: mushroom(0xef4444, false),

  // ----- Candy -----
  lollipop: () => {
    const out = [part(cyl(0.03, 0.03, 0.62, 6), 0xffffff, [0, 0.31, 0])];
    const cols = [0xf43f5e, 0xffffff, 0xf43f5e, 0xfde047];
    cols.forEach((c, i) => {
      out.push(part(cyl(0.32 - i * 0.075, 0.32 - i * 0.075, 0.07 + i * 0.03, 14), c, [0, 0.82, 0], 1, [Math.PI / 2, 0, 0]));
    });
    return out;
  },
  cupcake: () => [
    part(cyl(0.3, 0.21, 0.32, 10), 0x38bdf8, [0, 0.16, 0]),
    part(sph(0.33, 8, 5), 0xf9a8d4, [0, 0.4, 0], [1, 0.55, 1]),
    part(sph(0.25, 8, 5), 0xfbcfe8, [0, 0.58, 0], [1, 0.6, 1]),
    part(sph(0.16, 7, 5), 0xf9a8d4, [0, 0.74, 0], [1, 0.7, 1]),
    part(sph(0.08, 6, 5), 0xdc2626, [0, 0.88, 0]),
  ],
  donut: () => [
    part(tor(0.3, 0.14), 0xd9a066, [0, 0.46, 0]),
    part(tor(0.3, 0.125), 0xf472b6, [0, 0.46, 0.05]),
    part(box(0.06, 0.02, 0.02), 0xfde047, [0.2, 0.62, 0.17], 1, [0, 0, 0.6]),
    part(box(0.06, 0.02, 0.02), 0x38bdf8, [-0.24, 0.5, 0.17], 1, [0, 0, -0.4]),
    part(box(0.06, 0.02, 0.02), 0xffffff, [0.1, 0.2, 0.17], 1, [0, 0, 1.2]),
    part(box(0.06, 0.02, 0.02), 0xa3e635, [-0.12, 0.73, 0.17], 1, [0, 0, 0.2]),
  ],
  cake: () => [
    part(cyl(0.42, 0.42, 0.28, 12), 0xfef3c7, [0, 0.14, 0]),
    part(cyl(0.43, 0.43, 0.05, 12), 0xf472b6, [0, 0.28, 0]),
    part(cyl(0.3, 0.3, 0.24, 12), 0xfbcfe8, [0, 0.42, 0]),
    part(cyl(0.31, 0.31, 0.05, 12), 0xffffff, [0, 0.54, 0]),
    part(cyl(0.18, 0.18, 0.2, 10), 0xfef3c7, [0, 0.66, 0]),
    part(cyl(0.02, 0.02, 0.14, 5), 0x38bdf8, [0, 0.83, 0]),
    part(sph(0.045, 5, 4), 0xfde047, [0, 0.93, 0], [1, 1.5, 1], [0, 0, 0], true),
  ],
  iceCream: () => [
    part(cone(0.2, 0.5, 8), 0xe0a96d, [0, 0.25, 0], 1, [Math.PI, 0, 0]),
    part(sph(0.23, 8, 6), 0xf9a8d4, [0, 0.58, 0]),
    part(sph(0.19, 8, 6), 0xa7f3d0, [0, 0.82, 0]),
    part(sph(0.06, 6, 5), 0xdc2626, [0, 1.0, 0]),
  ],
  wrappedCandy: () => [
    part(sph(0.22, 7, 5), 0x38bdf8, [0, 0.2, 0], [1.2, 0.85, 0.85]),
    part(cone(0.14, 0.2, 5), 0xbae6fd, [0.36, 0.2, 0], 1, [0, 0, Math.PI / 2]),
    part(cone(0.14, 0.2, 5), 0xbae6fd, [-0.36, 0.2, 0], 1, [0, 0, -Math.PI / 2]),
  ],
  chocolate: () => [
    part(box(0.6, 0.12, 0.4), 0x6b3a1e, [0, 0.06, 0]),
    part(box(0.24, 0.05, 0.14), 0x8b5a3c, [-0.15, 0.14, -0.1]),
    part(box(0.24, 0.05, 0.14), 0x8b5a3c, [0.15, 0.14, -0.1]),
    part(box(0.24, 0.05, 0.14), 0x8b5a3c, [-0.15, 0.14, 0.1]),
    part(box(0.24, 0.05, 0.14), 0x8b5a3c, [0.15, 0.14, 0.1]),
  ],
  cookie: () => [
    part(cyl(0.32, 0.32, 0.08, 10), 0xd9a066, [0, 0.04, 0]),
    part(sph(0.05, 5, 3), 0x5c3d1e, [0.12, 0.09, 0.08]),
    part(sph(0.05, 5, 3), 0x5c3d1e, [-0.14, 0.09, 0.02]),
    part(sph(0.05, 5, 3), 0x5c3d1e, [0.02, 0.09, -0.16]),
    part(sph(0.05, 5, 3), 0x5c3d1e, [-0.04, 0.09, 0.2]),
  ],
  gumdrop: () => [
    part(new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xef4444, [0, 0, 0], [1, 1.3, 1]),
    part(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xa3e635, [0.42, 0, 0.1], [1, 1.3, 1]),
  ],

  // ----- Frosty -----
  snowman: () => [
    part(sph(0.28, 8, 6), 0xffffff, [0, 0.26, 0]),
    part(sph(0.21, 8, 6), 0xf8fafc, [0, 0.62, 0]),
    part(sph(0.15, 8, 6), 0xffffff, [0, 0.9, 0]),
    part(cone(0.035, 0.16, 5), 0xf97316, [0, 0.9, 0.2], 1, [Math.PI / 2, 0, 0]),
    part(sph(0.022, 4, 3), 0x111827, [-0.05, 0.95, 0.135]),
    part(sph(0.022, 4, 3), 0x111827, [0.05, 0.95, 0.135]),
    part(cyl(0.17, 0.17, 0.02, 9), 0x1f2937, [0, 1.02, 0]),
    part(cyl(0.11, 0.11, 0.16, 9), 0x1f2937, [0, 1.1, 0]),
    part(tor(0.15, 0.04), 0xdc2626, [0, 0.77, 0], 1, [Math.PI / 2, 0, 0]),
    part(cyl(0.015, 0.015, 0.36, 4), 0x7c4a21, [0.32, 0.68, 0], 1, [0, 0, -1.1]),
    part(cyl(0.015, 0.015, 0.36, 4), 0x7c4a21, [-0.32, 0.68, 0], 1, [0, 0, 1.1]),
    part(sph(0.025, 4, 3), 0x111827, [0, 0.66, 0.2]),
    part(sph(0.025, 4, 3), 0x111827, [0, 0.56, 0.21]),
  ],
  snowPine: pine(0x1e6b52, true),
  icePeak: () => [
    part(cone(0.6, 1.1, 5), 0x93c5fd, [0, 0.55, 0]),
    part(cone(0.3, 0.55, 5), 0xffffff, [0, 0.84, 0]),
    part(cone(0.34, 0.6, 5), 0xbfdbfe, [0.4, 0.3, 0.12]),
    part(cone(0.16, 0.26, 5), 0xffffff, [0.4, 0.48, 0.12]),
  ],
  iceBlock: () => [
    part(box(0.5, 0.5, 0.5), 0xa5f3fc, [0, 0.27, 0], 1, [0.05, 0.4, 0.08]),
    part(box(0.3, 0.3, 0.3), 0xcffafe, [0.36, 0.15, 0.2], 1, [0, 0.9, 0.1]),
    part(box(0.36, 0.04, 0.36), 0xffffff, [0.01, 0.54, 0], 1, [0.05, 0.4, 0.08]),
  ],
  cabin: house(0x92400e, 0xffffff, true),
  snowMound: () => [
    part(new THREE.SphereGeometry(0.4, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, [0, 0, 0], [1.2, 0.55, 1]),
    part(new THREE.SphereGeometry(0.24, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xf1f5f9, [0.4, 0, 0.16], [1.1, 0.6, 1]),
  ],
  penguin: () => [
    part(sph(0.24, 8, 6), 0x1f2937, [0, 0.34, 0], [0.9, 1.35, 0.85]),
    part(sph(0.19, 8, 6), 0xffffff, [0, 0.3, 0.08], [0.85, 1.25, 0.75]),
    part(sph(0.17, 8, 6), 0x1f2937, [0, 0.7, 0]),
    part(cone(0.05, 0.14, 5), 0xf59e0b, [0, 0.68, 0.19], 1, [Math.PI / 2, 0, 0]),
    part(sph(0.035, 5, 4), 0xffffff, [-0.07, 0.75, 0.13]),
    part(sph(0.035, 5, 4), 0xffffff, [0.07, 0.75, 0.13]),
    part(box(0.12, 0.03, 0.18), 0xf59e0b, [-0.1, 0.015, 0.08]),
    part(box(0.12, 0.03, 0.18), 0xf59e0b, [0.1, 0.015, 0.08]),
    part(sph(0.07, 5, 4), 0x1f2937, [-0.24, 0.38, 0], [0.5, 2.4, 1.2], [0, 0, -0.35]),
    part(sph(0.07, 5, 4), 0x1f2937, [0.24, 0.38, 0], [0.5, 2.4, 1.2], [0, 0, 0.35]),
  ],
  iceCrystal: crystal(0xa5f3fc, 0xe0f2fe, 0.8),

  // ----- Dunes -----
  cactus: () => [
    part(cyl(0.11, 0.13, 0.84, 8), 0x2f9e44, [0, 0.42, 0]),
    part(sph(0.11, 8, 4), 0x2f9e44, [0, 0.84, 0]),
    part(cyl(0.07, 0.07, 0.24, 7), 0x37b24d, [0.2, 0.44, 0], 1, [0, 0, Math.PI / 2]),
    part(cyl(0.07, 0.075, 0.3, 7), 0x37b24d, [0.3, 0.6, 0]),
    part(sph(0.07, 7, 4), 0x37b24d, [0.3, 0.75, 0]),
    part(cyl(0.065, 0.065, 0.2, 7), 0x37b24d, [-0.18, 0.3, 0], 1, [0, 0, Math.PI / 2]),
    part(cyl(0.065, 0.07, 0.22, 7), 0x37b24d, [-0.26, 0.42, 0]),
    part(sph(0.065, 7, 4), 0x37b24d, [-0.26, 0.53, 0]),
    part(sph(0.05, 6, 4), 0xf472b6, [0, 0.95, 0]),
  ],
  arch: () => [
    part(box(0.26, 0.8, 0.3), 0xd97706, [-0.42, 0.4, 0], 1, [0, 0.2, 0.05]),
    part(box(0.24, 0.72, 0.3), 0xea580c, [0.42, 0.36, 0], 1, [0, -0.3, -0.06]),
    part(box(1.2, 0.22, 0.34), 0xf59e0b, [0, 0.86, 0], 1, [0, 0, 0.04]),
    part(box(0.8, 0.1, 0.3), 0xd97706, [0.05, 1.0, 0], 1, [0, 0.1, -0.03]),
  ],
  mesa: () => [
    part(cyl(0.56, 0.72, 0.36, 7), 0xc2410c, [0, 0.18, 0]),
    part(cyl(0.5, 0.56, 0.24, 7), 0xea580c, [0, 0.48, 0]),
    part(cyl(0.46, 0.5, 0.12, 7), 0xf59e0b, [0, 0.66, 0]),
    part(cyl(0.2, 0.26, 0.3, 6), 0xea580c, [0.2, 0.84, 0.1]),
  ],
  sandRock: rock(0xd6a35c, 0xb7791f),
  hut: () => [
    part(cyl(0.36, 0.38, 0.4, 9), 0xe0c08a, [0, 0.2, 0]),
    part(cone(0.52, 0.48, 9), 0xa16207, [0, 0.64, 0]),
    part(box(0.16, 0.26, 0.04), 0x5c3d1e, [0, 0.13, 0.37]),
  ],
  dryBush: () => [
    part(ico(0.22), 0xa3a04a, [0, 0.16, 0], [1.3, 0.8, 1.2], [0.4, 0.2, 0.1]),
    part(ico(0.15), 0x8a8f3c, [0.24, 0.1, 0.08], 1, [0.2, 0.9, 0.5]),
    part(cyl(0.012, 0.012, 0.36, 4), 0x7c4a21, [-0.1, 0.24, 0], 1, [0.3, 0, 0.5]),
    part(cyl(0.012, 0.012, 0.3, 4), 0x7c4a21, [0.1, 0.26, -0.06], 1, [-0.3, 0, -0.5]),
  ],
  pebbles: () => [
    part(ico(0.18), 0xd6a35c, [0, 0.08, 0], [1.2, 0.6, 1], [0.5, 0.1, 0.3]),
    part(ico(0.12), 0xb7791f, [0.26, 0.05, 0.1], [1, 0.6, 1], [0.1, 0.7, 0.2]),
    part(ico(0.09), 0xe0c08a, [-0.2, 0.04, -0.14], [1, 0.6, 1]),
  ],
  bones: () => [
    part(cyl(0.035, 0.035, 0.5, 5), 0xf8fafc, [0, 0.05, 0], 1, [0, 0.4, Math.PI / 2]),
    part(sph(0.06, 5, 4), 0xf8fafc, [0.25, 0.06, -0.1]),
    part(sph(0.06, 5, 4), 0xf8fafc, [-0.25, 0.06, 0.1]),
    part(sph(0.15, 7, 5), 0xf1f5f9, [0.1, 0.13, 0.26], [1, 0.9, 1.1]),
    part(sph(0.035, 4, 3), 0x1f2937, [0.05, 0.16, 0.39]),
    part(sph(0.035, 4, 3), 0x1f2937, [0.16, 0.16, 0.38]),
  ],

  // ----- Volcano -----
  miniVolcano: () => [
    part(cyl(0.2, 0.62, 0.78, 8), 0x3b2a26, [0, 0.39, 0]),
    part(cyl(0.22, 0.24, 0.06, 8), 0x57342c, [0, 0.79, 0]),
    part(cyl(0.17, 0.17, 0.05, 8), 0xff7a1a, [0, 0.81, 0], 1, [0, 0, 0], true),
    part(box(0.05, 0.6, 0.03), 0xff7a1a, [0.14, 0.45, 0.33], 1, [-0.5, 0.4, 0], true),
    part(box(0.04, 0.44, 0.03), 0xfbbf24, [-0.3, 0.42, 0.18], 1, [-0.3, -1.0, 0.45], true),
    part(box(0.04, 0.5, 0.03), 0xff7a1a, [-0.05, 0.42, -0.36], 1, [0.5, 0.1, 0], true),
  ],
  flame: () => [
    part(ico(0.22), 0x3f3f46, [0.18, 0.07, 0.1], [1, 0.5, 1]),
    part(ico(0.2), 0x52525b, [-0.2, 0.07, -0.05], [1, 0.5, 1], [0.5, 0.3, 0]),
    part(ico(0.18), 0x3f3f46, [0, 0.06, -0.22], [1, 0.5, 1], [0.1, 0.9, 0]),
    part(cone(0.2, 0.7, 6), 0xf97316, [0, 0.42, 0], 1, [0, 0, 0], true),
    part(cone(0.12, 0.46, 6), 0xfde047, [0.02, 0.36, 0.02], 1, [0, 0, 0], true),
    part(cone(0.09, 0.36, 5), 0xf97316, [0.15, 0.3, -0.06], 1, [0, 0, -0.25], true),
    part(cone(0.08, 0.3, 5), 0xef4444, [-0.14, 0.27, 0.05], 1, [0, 0, 0.3], true),
  ],
  lavaRock: rock(0x44403c, 0x292524),
  gems: crystal(0x22d3ee, 0xe879f9),
  tower: () => {
    const out = [
      part(cyl(0.26, 0.32, 0.9, 8), 0x57534e, [0, 0.45, 0]),
      part(cyl(0.32, 0.3, 0.1, 8), 0x44403c, [0, 0.94, 0]),
      part(cone(0.26, 0.34, 8), 0x7f1d1d, [0, 1.17, 0]),
      part(box(0.09, 0.14, 0.03), 0xfbbf24, [0, 0.62, 0.285], 1, [0, 0, 0], true),
      part(box(0.09, 0.14, 0.03), 0xfbbf24, [0.27, 0.4, 0.1], 1, [0, 1.2, 0], true),
      part(box(0.12, 0.2, 0.03), 0x1c1917, [0, 0.1, 0.32]),
    ];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      out.push(part(box(0.1, 0.1, 0.1), 0x57534e, [Math.cos(a) * 0.28, 1.03, Math.sin(a) * 0.28], 1, [0, -a, 0]));
    }
    return out;
  },
  ember: () => [
    part(ico(0.16), 0x44403c, [0, 0.05, 0], [1.4, 0.45, 1.2]),
    part(cone(0.1, 0.36, 5), 0xf97316, [0, 0.24, 0], 1, [0, 0, 0], true),
    part(cone(0.05, 0.22, 5), 0xfde047, [0.01, 0.2, 0.01], 1, [0, 0, 0], true),
  ],
  glowShroom: mushroom(0xc084fc, true),
  spark: crystal(0xfde047, 0xfb923c, 0.6),
};

// Which model stands in for each scenery emoji, per theme
const EMOJI_MODELS: Record<string, string>[] = [
  { '🌳': 'roundTree', '🌲': 'pine', '🌴': 'palm', '🪨': 'rock', '🏠': 'house', '🌼': 'daisy', '🌷': 'tulip', '🍄': 'mushroom', '🌻': 'sunflower', '🌸': 'blossom' },
  { '🍭': 'lollipop', '🧁': 'cupcake', '🍩': 'donut', '🎂': 'cake', '🍦': 'iceCream', '🍬': 'wrappedCandy', '🍫': 'chocolate', '🍪': 'cookie', '🍓': 'gumdrop', '🍒': 'gumdrop' },
  { '⛄': 'snowman', '🌲': 'snowPine', '🏔️': 'icePeak', '🧊': 'iceBlock', '🏠': 'cabin', '❄️': 'snowMound', '🐧': 'penguin', '🧣': 'snowMound', '⭐': 'iceCrystal', '🎿': 'snowMound' },
  { '🌵': 'cactus', '🐪': 'arch', '🏜️': 'mesa', '🪨': 'sandRock', '🛖': 'hut', '🦂': 'pebbles', '🌾': 'dryBush', '🦎': 'pebbles', '🐚': 'bones', '☀️': 'dryBush' },
  { '🌋': 'miniVolcano', '🔥': 'flame', '🪨': 'lavaRock', '💎': 'gems', '🏰': 'tower', '🦴': 'bones', '💀': 'bones', '🍄': 'glowShroom', '✨': 'spark' },
];
// Volcano has '🔥' in both its big and small lists; the small one is an ember vent
const SMALL_OVERRIDE: Record<string, string>[] = [{}, {}, {}, {}, { '🔥': 'ember' }];
// How much bigger than its emoji a model stands (some are naturally squat)
const MODEL_SCALE: Record<string, number> = {
  house: 1.0, cabin: 1.0, rock: 1.1, sandRock: 1.1, lavaRock: 1.2, mesa: 1.9, arch: 1.5, icePeak: 1.7, miniVolcano: 1.7, tower: 1.35,
  cake: 1.1, chocolate: 1.5, cookie: 1.4, penguin: 1.5, snowMound: 1.6, bones: 1.3, pebbles: 1.3, gumdrop: 1.3, wrappedCandy: 1.2,
  sunflower: 1.5, dryBush: 1.4, ember: 1.5, spark: 1.5, glowShroom: 1.3, mushroom: 1.2, iceCrystal: 1.4,
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function roadCanvas(t: SceneTrack): HTMLCanvasElement {
  const r = rng(77 + t.theme);
  return canvasOf(512, 512, (g, w, h) => {
    const c = t.colors;
    g.fillStyle = c.road;
    g.fillRect(0, 0, w, h);
    // A slightly lighter driving lane down the middle, like worn asphalt
    const lane = g.createLinearGradient(0, 0, w, 0);
    lane.addColorStop(0, 'rgba(0,0,0,0)');
    lane.addColorStop(0.2, c.roadInner);
    lane.addColorStop(0.8, c.roadInner);
    lane.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lane;
    g.fillRect(w * 0.1, 0, w * 0.8, h);
    // Grain
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
    }
    const wrapY = (fn: (dy: number) => void) => {
      fn(0);
      fn(-h);
      fn(h);
    };
    if (t.theme === 1) {
      // Sprinkles pressed into the chocolate
      const cols = ['#f9a8d4', '#fde047', '#7dd3fc', '#ffffff', '#a3e635'];
      for (let i = 0; i < 46; i++) {
        const x = 30 + r() * (w - 60);
        const y = r() * h;
        const a = r() * Math.PI;
        g.fillStyle = cols[i % cols.length];
        g.globalAlpha = 0.6;
        wrapY((dy) => {
          g.save();
          g.translate(x, y + dy);
          g.rotate(a);
          g.fillRect(-7, -2, 14, 4);
          g.restore();
        });
      }
      g.globalAlpha = 1;
    } else if (t.theme === 2) {
      // Shiny streaks on the ice
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineCap = 'round';
      for (let i = 0; i < 22; i++) {
        const x = 20 + r() * (w - 40);
        const y = r() * h;
        const len = 30 + r() * 80;
        g.lineWidth = 1 + r() * 3;
        wrapY((dy) => {
          g.beginPath();
          g.moveTo(x, y + dy);
          g.lineTo(x + len * 0.25, y + dy + len);
          g.stroke();
        });
      }
    } else if (t.theme === 3) {
      // Tyre tracks in the packed sand
      g.fillStyle = 'rgba(60,30,0,0.12)';
      for (const u of [0.3, 0.36, 0.64, 0.7]) g.fillRect(w * u - 5, 0, 10, h);
    } else if (t.theme === 4) {
      // Glowing cracks
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        let x = 30 + r() * (w - 60);
        let y = r() * h;
        const pts: [number, number][] = [[x, y]];
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 60;
          y += 14 + r() * 26;
          pts.push([x, y]);
        }
        for (const [lw, col] of [[6, 'rgba(249,115,22,0.22)'], [2, 'rgba(253,186,116,0.6)']] as [number, string][]) {
          g.strokeStyle = col;
          g.lineWidth = lw;
          wrapY((dy) => {
            g.beginPath();
            pts.forEach(([px, py], k) => (k ? g.lineTo(px, py + dy) : g.moveTo(px, py + dy)));
            g.stroke();
          });
        }
      }
    }
    // Solid edge lines and a dashed centre line
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillRect(9, 0, 9, h);
    g.fillRect(w - 18, 0, 9, h);
    g.fillStyle = c.line;
    g.fillRect(w / 2 - 6, 0, 12, h / 2);
  });
}

function curbCanvas(t: SceneTrack): HTMLCanvasElement {
  return canvasOf(32, 128, (g, w, h) => {
    g.fillStyle = t.colors.curbA;
    g.fillRect(0, 0, w, h);
    g.fillStyle = t.colors.curbB;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(w - 5, 0, 5, h);
  });
}

function groundCanvas(t: SceneTrack): HTMLCanvasElement {
  const W = 1024;
  const H = Math.round((W * t.worldH) / t.worldW);
  const k = W / t.worldW;
  const r = rng(301 + t.theme * 13);
  return canvasOf(W, H, (g) => {
    const c = t.colors;
    g.fillStyle = c.grassA;
    g.fillRect(0, 0, W, H);
    // Mowing stripes on a slant
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.5);
    g.fillStyle = c.grassB;
    const band = 92 * k;
    for (let x = -W; x < W; x += band * 2) g.fillRect(x, -W, band, W * 2);
    g.restore();
    // Soft light and dark patches so the ground is not one flat color
    for (let i = 0; i < 150; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = 30 + r() * 110;
      const light = r() < 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, light ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.13)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Worn ground beside the road
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(t.xs[0] * k, t.ys[0] * k);
    for (let i = 3; i < t.n; i += 3) g.lineTo(t.xs[i] * k, t.ys[i] * k);
    g.closePath();
    const dirt = shade(t.theme === 2 ? '#93c5fd' : c.dust, t.theme === 4 ? -0.55 : -0.1);
    for (const [extra, a] of [[190, 0.07], [130, 0.1], [80, 0.14], [40, 0.2]] as [number, number][]) {
      g.strokeStyle = dirt;
      g.globalAlpha = a;
      g.lineWidth = (t.halfW * 2 + extra) * k;
      g.stroke();
    }
    g.globalAlpha = 1;
    // Darker toward the fence
    const edge = 60 * k;
    g.strokeStyle = 'rgba(0,0,0,0.14)';
    g.lineWidth = edge;
    g.strokeRect(edge / 2, edge / 2, W - edge, H - edge);
  });
}

function detailCanvas(t: SceneTrack): HTMLCanvasElement {
  const r = rng(909 + t.theme);
  return canvasOf(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    if (t.theme === 1) {
      const cols = ['#ffffff', '#fde047', '#7dd3fc', '#f472b6', '#a3e635'];
      for (let i = 0; i < 70; i++) {
        g.fillStyle = cols[i % cols.length];
        g.globalAlpha = 0.5;
        g.save();
        g.translate(r() * w, r() * h);
        g.rotate(r() * Math.PI);
        g.fillRect(-4, -1.5, 8, 3);
        g.restore();
      }
    } else if (t.theme === 2) {
      for (let i = 0; i < 160; i++) {
        g.fillStyle = r() < 0.7 ? 'rgba(255,255,255,0.75)' : 'rgba(125,170,220,0.3)';
        const s = 1 + r() * 2.2;
        g.fillRect(r() * w, r() * h, s, s);
      }
    } else if (t.theme === 3) {
      g.strokeStyle = 'rgba(120,60,0,0.13)';
      g.lineWidth = 2;
      for (let y = 8; y < h; y += 16) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 4 + y) * 3);
        g.stroke();
      }
    } else if (t.theme === 4) {
      for (let i = 0; i < 200; i++) {
        g.fillStyle = r() < 0.9 ? 'rgba(0,0,0,0.22)' : 'rgba(251,146,60,0.55)';
        const s = 1 + r() * 3;
        g.fillRect(r() * w, r() * h, s, s);
      }
    } else {
      for (let i = 0; i < 420; i++) {
        g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,60,0,0.16)';
        g.lineWidth = 1.5;
        const x = r() * w;
        const y = r() * h;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 5, y - 4 - r() * 7);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  });
}

function skyCanvas(t: SceneTrack): HTMLCanvasElement {
  const r = rng(5 + t.theme);
  return canvasOf(64, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    // The dome's top is v = 1 (canvas y = 0); the horizon is the middle
    gr.addColorStop(0, shade(t.sky, t.night ? -0.5 : -0.38));
    gr.addColorStop(0.3, t.sky);
    gr.addColorStop(0.47, shade(t.horizon, t.night ? 0.1 : 0.25));
    gr.addColorStop(0.5, t.horizon);
    gr.addColorStop(1, t.horizon);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    if (t.night) {
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(255,${220 + Math.floor(r() * 35)},${180 + Math.floor(r() * 60)},${0.3 + r() * 0.6})`;
        g.fillRect(r() * w, r() * h * 0.4, 1, 1);
      }
    }
  });
}

function cloudCanvas(seed: number): HTMLCanvasElement {
  const r = rng(seed);
  return canvasOf(256, 128, (g, w, h) => {
    const puffs: [number, number, number][] = [];
    const n = 6 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) puffs.push([40 + ((w - 80) * i) / (n - 1), h * 0.62 - Math.sin((i / (n - 1)) * Math.PI) * (16 + r() * 22), 20 + r() * 18 + Math.sin((i / (n - 1)) * Math.PI) * 14]);
    // Shaded underside first, then the bright tops
    g.fillStyle = 'rgba(190,205,225,0.9)';
    for (const [x, y, rad] of puffs) {
      g.beginPath();
      g.arc(x, y + 7, rad, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    for (const [x, y, rad] of puffs) {
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // Flat bottom
    g.clearRect(0, h * 0.74, w, h);
  });
}

function chevronCanvas(): HTMLCanvasElement {
  return canvasOf(128, 64, (g, w, h) => {
    g.fillStyle = '#dc2626';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.strokeRect(2.5, 2.5, w - 5, h - 5);
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 3; k++) {
      const x = 14 + k * 36;
      g.beginPath();
      g.moveTo(x, 10);
      g.lineTo(x + 14, 10);
      g.lineTo(x + 34, h / 2);
      g.lineTo(x + 14, h - 10);
      g.lineTo(x, h - 10);
      g.lineTo(x + 20, h / 2);
      g.closePath();
      g.fill();
    }
  });
}

function padCanvas(): HTMLCanvasElement {
  return canvasOf(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fde047';
    for (let k = 0; k < 2; k++) {
      const x = k * 64;
      g.beginPath();
      g.moveTo(x + 6, 12);
      g.lineTo(x + 30, 12);
      g.lineTo(x + 58, h / 2);
      g.lineTo(x + 30, h - 12);
      g.lineTo(x + 6, h - 12);
      g.lineTo(x + 34, h / 2);
      g.closePath();
      g.fill();
    }
  });
}

function checkerCanvas(cols: number, rows: number): HTMLCanvasElement {
  return canvasOf(cols * 16, rows * 16, (g) => {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        g.fillStyle = (i + j) % 2 ? '#111827' : '#ffffff';
        g.fillRect(i * 16, j * 16, 16, 16);
      }
    }
  });
}

function signCanvas(text: string, bg: string): HTMLCanvasElement {
  return canvasOf(512, 96, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, shade(bg, 0.15));
    gr.addColorStop(1, shade(bg, -0.3));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = 58;
    g.font = `900 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    while (g.measureText(text).width > w - 50 && px > 20) {
      px -= 4;
      g.font = `900 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    }
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowOffsetY = 4;
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const POOLS: { fill: number; rim: number }[] = [
  { fill: 0x38bdf8, rim: 0xe8d9a8 },
  { fill: 0xfbbf24, rim: 0xfff7ed },
  { fill: 0xa5f3fc, rim: 0xffffff },
  { fill: 0x22d3ee, rim: 0x65a30d },
  { fill: 0xff6a1a, rim: 0x7c2d12 },
];

const WEATHER: { n: number; color: number; size: number; vx: number; vy: number; vz: number; sway: number; add: boolean; opacity: number }[] = [
  { n: 110, color: 0xfff7c2, size: 6, vx: 14, vy: -6, vz: 8, sway: 18, add: false, opacity: 0.75 },
  { n: 130, color: 0xffffff, size: 7, vx: 6, vy: -26, vz: 4, sway: 14, add: false, opacity: 0.9 },
  { n: 320, color: 0xffffff, size: 8, vx: 22, vy: -70, vz: 10, sway: 22, add: false, opacity: 0.95 },
  { n: 130, color: 0xf3d9a4, size: 6, vx: 95, vy: -3, vz: 30, sway: 10, add: false, opacity: 0.6 },
  { n: 210, color: 0xff9a3c, size: 9, vx: 10, vy: 46, vz: 6, sway: 26, add: true, opacity: 0.95 },
];

export class World3D {
  group = new THREE.Group();
  /** Stays centred on the camera (sky, sun, clouds). */
  private skyGroup = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private texs: THREE.Texture[] = [];
  private t: SceneTrack;
  private low: boolean;
  private aniso: number;
  private padTex: THREE.Texture | null = null;
  private glowMat: THREE.MeshBasicMaterial;
  private litMat: THREE.MeshLambertMaterial;
  private clouds: THREE.Group | null = null;
  private lamps: THREE.MeshBasicMaterial[] = [];
  private crowd: { bodies: THREE.InstancedMesh; heads: THREE.InstancedMesh; seats: { x: number; y: number; z: number; ph: number }[] } | null = null;
  private weather: { pts: THREE.Points; base: Float32Array; spec: (typeof WEATHER)[number] } | null = null;
  private floaters: { g: THREE.Object3D; r: number; a: number; y: number; w: number }[] = [];
  private pulse: THREE.MeshBasicMaterial[] = [];
  private smoke: THREE.Sprite[] = [];
  private dummy = new THREE.Object3D();
  private shadowMesh: THREE.Object3D | null = null;
  private detail = 0;
  /** Places props must avoid (stands, pools): [x, y, radius] */
  private keepOut: [number, number, number][] = [];

  constructor(t: SceneTrack, opts: { lowPower: boolean; maxAniso: number }) {
    this.t = t;
    this.low = opts.lowPower;
    // Sharp ground at a distance costs a weak phone GPU a lot per pixel
    this.aniso = Math.max(1, Math.min(opts.lowPower ? 2 : 8, opts.maxAniso));
    this.litMat = this.mat(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.glowMat = this.mat(new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.group.add(this.skyGroup);
    this.lights();
    this.sky();
    this.ground();
    this.road();
    this.mountains();
    this.gantry();
    this.stands();
    this.pools();
    this.bendSigns();
    this.pads();
    this.ramps();
    this.hazards();
    this.scenery();
    this.makeWeather();
    this.makeFloaters();
  }

  // ----- bookkeeping -----
  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }
  private tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
    const x = new THREE.CanvasTexture(c);
    x.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      x.wrapS = THREE.RepeatWrapping;
      x.wrapT = THREE.RepeatWrapping;
    }
    x.anisotropy = this.aniso;
    this.texs.push(x);
    return x;
  }
  private add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.group): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  /** Bake a model and add it as meshes (lit + glow) under a parent. */
  private model(parts: Part[], parent: THREE.Object3D): THREE.Group {
    const g = new THREE.Group();
    const b = bake(parts);
    if (b.lit) g.add(new THREE.Mesh(this.geo(b.lit), this.litMat));
    if (b.glow) g.add(new THREE.Mesh(this.geo(b.glow), this.glowMat));
    parent.add(g);
    return g;
  }

  private trackDist(x: number, y: number): number {
    const { xs, ys, n } = this.t;
    let bd = Infinity;
    for (let i = 0; i < n; i += 3) {
      const dx = xs[i] - x;
      const dy = ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) bd = d;
    }
    return Math.sqrt(bd);
  }
  private angleAt(i: number): number {
    const { tx, ty, n } = this.t;
    const j = ((Math.round(i) % n) + n) % n;
    return Math.atan2(ty[j], tx[j]);
  }
  private pointAt(i: number, lat: number): { x: number; y: number; a: number } {
    const { xs, ys, tx, ty, n } = this.t;
    const j = ((Math.round(i) % n) + n) % n;
    return { x: xs[j] - ty[j] * lat, y: ys[j] + tx[j] * lat, a: Math.atan2(ty[j], tx[j]) };
  }
  private inWorld(x: number, y: number, margin: number): boolean {
    return x > margin && y > margin && x < this.t.worldW - margin && y < this.t.worldH - margin;
  }

  // ----- lights and sky -----
  private lights() {
    const t = this.t;
    const hemi = new THREE.HemisphereLight(t.night ? 0xffd9c2 : 0xffffff, new THREE.Color(t.colors.grassA).lerp(new THREE.Color(0x444444), 0.4), t.night ? 1.15 : 1.5);
    this.group.add(hemi);
    const sun = new THREE.DirectionalLight(t.night ? 0xffa86b : 0xfff4e0, t.night ? 1.3 : 2.0);
    sun.position.set(-600, 1200, -400);
    this.group.add(sun);
  }

  private sky() {
    const t = this.t;
    const dome = new THREE.Mesh(
      this.geo(new THREE.SphereGeometry(8200, 20, 14)),
      this.mat(new THREE.MeshBasicMaterial({ map: this.tex(skyCanvas(t)), side: THREE.BackSide, fog: false, depthWrite: false })),
    );
    dome.renderOrder = -10;
    this.skyGroup.add(dome);
    // Sun (or a red moon over the volcano) with a soft halo
    const sunCol = t.night ? 0xff8a4a : t.theme === 3 ? 0xfff0b0 : 0xfffbe0;
    const dir = new THREE.Vector3(-0.42, 0.42, -0.8).normalize();
    for (const [size, op] of [[2600, 0.35], [900, 0.95]] as [number, number][]) {
      const s = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: glowTexture(), color: sunCol, transparent: true, opacity: op, fog: false, depthWrite: false, blending: THREE.AdditiveBlending })));
      s.scale.set(size, size, 1);
      s.position.copy(dir).multiplyScalar(7400);
      s.renderOrder = -9;
      this.skyGroup.add(s);
    }
    // Clouds drift slowly around the world
    const r = rng(41 + t.theme);
    const clouds = new THREE.Group();
    const tint = t.night ? 0x7a3b2e : t.theme === 1 ? 0xffe4f3 : 0xffffff;
    const texs = [this.tex(cloudCanvas(11)), this.tex(cloudCanvas(23)), this.tex(cloudCanvas(37))];
    const count = this.low ? 10 : 16;
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: texs[i % 3], color: tint, transparent: true, opacity: t.night ? 0.55 : 0.92, fog: false, depthWrite: false })));
      const a = (i / count) * Math.PI * 2 + r() * 0.3;
      const rad = 4200 + r() * 2600;
      const wdt = 1500 + r() * 1700;
      s.scale.set(wdt, wdt * 0.5, 1);
      s.position.set(Math.cos(a) * rad, 900 + r() * 1700, Math.sin(a) * rad);
      s.renderOrder = -8;
      clouds.add(s);
    }
    this.clouds = clouds;
    this.skyGroup.add(clouds);
  }

  // ----- ground and road -----
  private ground() {
    const t = this.t;
    const { worldW: W, worldH: H } = t;
    const plane = this.geo(new THREE.PlaneGeometry(W, H));
    plane.rotateX(-Math.PI / 2);
    this.add(plane, this.mat(new THREE.MeshLambertMaterial({ map: this.tex(groundCanvas(t)) })), W / 2, 0, H / 2);
    // Fine detail that tiles: grass blades, sprinkles, snow sparkle, sand ripples
    const dt = this.tex(detailCanvas(t), true);
    dt.repeat.set(W / 170, H / 170);
    const detail = this.add(plane, this.mat(new THREE.MeshLambertMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })), W / 2, 0.1, H / 2);
    detail.renderOrder = 1;
    // The land beyond the fence
    const outerGeo = this.geo(new THREE.PlaneGeometry(40000, 40000));
    outerGeo.rotateX(-Math.PI / 2);
    this.add(outerGeo, this.mat(new THREE.MeshLambertMaterial({ color: new THREE.Color(t.colors.grassA).lerp(new THREE.Color(t.colors.outside), 0.55) })), W / 2, -1.5, H / 2);
    // A low fence around the world, with posts
    const parts: Part[] = [];
    const rail = t.colors.edge;
    const post = shade(t.colors.edge, 0.45);
    for (const [x, z, w, d] of [[W / 2, -8, W + 32, 14], [W / 2, H + 8, W + 32, 14], [-8, H / 2, 14, H], [W + 8, H / 2, 14, H]]) {
      parts.push(part(box(w, 18, d), rail, [x, 9, z]));
      parts.push(part(box(w, 4, d + 4), post, [x, 20, z]));
    }
    for (let x = 0; x <= W; x += 260) {
      parts.push(part(box(18, 34, 18), post, [x, 17, -8]));
      parts.push(part(box(18, 34, 18), post, [x, 17, H + 8]));
    }
    for (let z = 260; z < H; z += 260) {
      parts.push(part(box(18, 34, 18), post, [-8, 17, z]));
      parts.push(part(box(18, 34, 18), post, [W + 8, 17, z]));
    }
    this.model(parts, this.group);
  }

  /** A flat strip that follows the track between two sideways offsets. */
  private ribbon(lat0: number, lat1: number, y: number, tileLen: number, stepN = 2): THREE.BufferGeometry {
    const { xs, ys, tx, ty, n } = this.t;
    const idx: number[] = [];
    for (let i = 0; i < n; i += stepN) idx.push(i);
    idx.push(0);
    const m = idx.length;
    const pos = new Float32Array(m * 2 * 3);
    const uv = new Float32Array(m * 2 * 2);
    const nor = new Float32Array(m * 2 * 3);
    let d = 0;
    const dist: number[] = [0];
    for (let k = 1; k < m; k++) {
      const a = idx[k - 1];
      const b = idx[k];
      d += Math.hypot(xs[b] - xs[a], ys[b] - ys[a]);
      dist.push(d);
    }
    const tiles = Math.max(1, Math.round(d / tileLen));
    for (let k = 0; k < m; k++) {
      const i = idx[k];
      const v = (dist[k] / d) * tiles;
      for (let s = 0; s < 2; s++) {
        const lat = s ? lat1 : lat0;
        const o = (k * 2 + s) * 3;
        pos[o] = xs[i] - ty[i] * lat;
        pos[o + 1] = y;
        pos[o + 2] = ys[i] + tx[i] * lat;
        nor[o + 1] = 1;
        uv[(k * 2 + s) * 2] = s;
        uv[(k * 2 + s) * 2 + 1] = v;
      }
    }
    const ind: number[] = [];
    for (let k = 0; k < m - 1; k++) {
      const a = k * 2;
      ind.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(ind);
    return this.geo(g);
  }

  private road() {
    const t = this.t;
    const hw = t.halfW;
    const off = (f: number) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    // Soft shadow under the road edge
    const shadow = this.add(this.ribbon(-hw - 34, hw + 34, 0.2, 100, 3), this.mat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false, ...off(-2) })));
    shadow.renderOrder = 2;
    // Curbs
    const curbTex = this.tex(curbCanvas(t), true);
    const curbMat = this.mat(new THREE.MeshLambertMaterial({ map: curbTex, ...off(-3) }));
    const c1 = this.add(this.ribbon(hw - 2, hw + 20, 0.3, 56), curbMat);
    const c2 = this.add(this.ribbon(-hw - 20, -hw + 2, 0.3, 56), curbMat);
    c1.renderOrder = 3;
    c2.renderOrder = 3;
    // Road surface
    const roadTex = this.tex(roadCanvas(t), true);
    const roadMat = this.mat(new THREE.MeshLambertMaterial({ map: roadTex, ...off(-4) }));
    const road = this.add(this.ribbon(-hw, hw, 0.4, 300), roadMat);
    road.renderOrder = 4;
    // Start / finish line
    const p = this.pointAt(0, 0);
    const lineGeo = this.geo(new THREE.PlaneGeometry(32, hw * 2));
    lineGeo.rotateX(-Math.PI / 2);
    const ct = this.tex(checkerCanvas(2, 16));
    ct.magFilter = THREE.NearestFilter;
    const line = this.add(lineGeo, this.mat(new THREE.MeshLambertMaterial({ map: ct, ...off(-6) })), p.x, 0.5, p.y);
    line.rotation.y = -p.a;
    line.renderOrder = 5;
    // Grid boxes painted on the start straight
    const slotGeo = this.geo(new THREE.PlaneGeometry(64, 46));
    slotGeo.rotateX(-Math.PI / 2);
    const slotTex = this.tex(canvasOf(64, 48, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(8, 3);
      g.lineTo(w - 3, 3);
      g.lineTo(w - 3, h - 3);
      g.lineTo(8, h - 3);
      g.stroke();
    }));
    const slotMat = this.mat(new THREE.MeshBasicMaterial({ map: slotTex, transparent: true, depthWrite: false, ...off(-6) }));
    for (let slot = 0; slot < 5; slot++) {
      const q = this.pointAt(t.n - 14 - slot * 8, slot % 2 === 0 ? -72 : 72);
      const m = this.add(slotGeo, slotMat, q.x, 0.5, q.y);
      m.rotation.y = -q.a;
      m.renderOrder = 5;
    }
  }

  // ----- far scenery -----
  private mountains() {
    const t = this.t;
    const r = rng(1234 + t.theme * 31);
    const cx = t.worldW / 2;
    const cz = t.worldH / 2;
    const k = t.worldW / 2400;
    const parts: Part[] = [];
    const base = t.hills;
    const count = this.low ? 20 : 28;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.2;
      const rad = (2350 + r() * 900) * k;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad * 0.82;
      const hgt = 300 + r() * 620;
      const wid = 300 + r() * 320;
      const yaw = r() * 3;
      const col = shade(base, (r() - 0.5) * 0.3);
      if (t.theme === 1) {
        // Gumdrop hills with a frosting cap
        const cols = ['#f472b6', '#c084fc', '#fb7185', '#f9a8d4', '#a78bfa'];
        parts.push(part(sph(1, 9, 6), cols[i % cols.length], [x, -20, z], [wid * 1.1, hgt * 0.9, wid * 1.1]));
        parts.push(part(sph(1, 8, 5), '#fff1f8', [x, hgt * 0.52, z], [wid * 0.62, hgt * 0.42, wid * 0.62]));
        if (i % 4 === 0) parts.push(part(sph(1, 7, 5), '#dc2626', [x, hgt * 0.96, z], wid * 0.13));
      } else if (t.theme === 3) {
        // Mesas and dunes
        if (i % 3 === 0) {
          parts.push(part(sph(1, 9, 5), '#e8a04a', [x, -30, z], [wid * 1.6, hgt * 0.45, wid * 1.2], [0, yaw, 0]));
        } else {
          parts.push(part(cyl(wid * 0.7, wid, hgt * 0.5, 7), '#b45309', [x, hgt * 0.25 - 20, z], 1, [0, yaw, 0]));
          parts.push(part(cyl(wid * 0.62, wid * 0.7, hgt * 0.25, 7), '#c2410c', [x, hgt * 0.62 - 20, z], 1, [0, yaw, 0]));
          parts.push(part(cyl(wid * 0.56, wid * 0.62, hgt * 0.1, 7), '#ea580c', [x, hgt * 0.8 - 20, z], 1, [0, yaw, 0]));
        }
      } else if (t.theme === 4) {
        const erupting = i % 5 === 0;
        if (erupting) {
          parts.push(part(cyl(wid * 0.3, wid * 1.2, hgt, 8), '#2b1a16', [x, hgt / 2 - 20, z], 1, [0, yaw, 0]));
          parts.push(part(cyl(wid * 0.27, wid * 0.27, 8, 8), '#ff6a1a', [x, hgt - 18, z], 1, [0, 0, 0], true));
          parts.push(part(box(wid * 0.07, hgt * 0.75, 8), '#ff7a1a', [x - Math.cos(a) * wid * 0.72, hgt * 0.5, z - Math.sin(a) * wid * 0.72], 1, [0, -a + Math.PI / 2, 0], true));
          const s = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a2a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
          s.scale.set(wid * 2.2, wid * 2.2, 1);
          s.position.set(x, hgt + 40, z);
          this.group.add(s);
          this.smoke.push(s);
        } else {
          parts.push(part(cone(wid, hgt, 6), shade('#2b1a16', r() * 0.12), [x, hgt / 2 - 20, z], 1, [0, yaw, 0]));
        }
      } else {
        // Green hills and far peaks (snow caps on the tall ones); Frosty is all peaks
        const peak = t.theme === 2 || hgt > 640;
        if (peak) {
          const rock = t.theme === 2 ? shade('#8fb4e3', (r() - 0.5) * 0.2) : shade('#5f7f95', (r() - 0.5) * 0.2);
          parts.push(part(cone(wid, hgt, 6), rock, [x, hgt / 2 - 20, z], 1, [0, yaw, 0]));
          parts.push(part(cone(wid * 0.5, hgt * 0.46, 6), '#ffffff', [x, hgt * 0.77 - 12, z], 1, [0, yaw, 0]));
        } else {
          parts.push(part(sph(1, 9, 6), col, [x, -30, z], [wid * 1.25, hgt * 0.8, wid * 1.1], [0, yaw, 0]));
        }
      }
    }
    this.model(parts, this.group);
  }

  // ----- start line -----
  private gantry() {
    const t = this.t;
    const p = this.pointAt(0, 0);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.y);
    g.rotation.y = -p.a; // local +X is the driving direction, local Z is across the road
    this.group.add(g);
    const span = t.halfW + 30;
    const parts: Part[] = [];
    for (const s of [-1, 1]) {
      parts.push(part(box(16, 136, 16), 0xe5e7eb, [0, 68, s * span]));
      parts.push(part(box(22, 10, 22), 0x475569, [0, 5, s * span]));
      parts.push(part(box(20, 6, 20), 0xef4444, [0, 40, s * span]));
      parts.push(part(box(20, 6, 20), 0xef4444, [0, 80, s * span]));
      // Balloons tied to each tower
      const cols = [0xef4444, 0xfacc15, 0x38bdf8, 0xa855f7, 0x4ade80];
      cols.forEach((c, i) => {
        const a = (i / cols.length) * Math.PI * 2;
        parts.push(part(sph(9, 8, 6), c, [Math.cos(a) * 9, 152 + (i % 2) * 9, s * span + Math.sin(a) * 9], [1, 1.2, 1]));
      });
      parts.push(part(cyl(0.6, 0.6, 14, 4), 0xffffff, [0, 142, s * span]));
    }
    parts.push(part(box(10, 8, span * 2), 0x475569, [0, 101, 0]));
    parts.push(part(box(10, 8, span * 2), 0x475569, [0, 139, 0]));
    // Light pod hanging under the beam, facing the grid
    parts.push(part(box(8, 20, 84), 0x1e293b, [-4, 88, 0]));
    this.model(parts, g);
    // Checkered banner (both sides)
    const ct = this.tex(checkerCanvas(32, 3));
    ct.magFilter = THREE.NearestFilter;
    const side = this.mat(new THREE.MeshLambertMaterial({ map: ct }));
    const plain = this.mat(new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
    this.add(this.geo(new THREE.BoxGeometry(5, 30, span * 2 - 16)), [side, side, plain, plain, plain, plain] as unknown as THREE.Material, 0, 120, 0, g);
    // Track name board on top
    const st = this.tex(signCanvas(t.name, t.colors.edge));
    const sm = this.mat(new THREE.MeshBasicMaterial({ map: st }));
    const dark = this.mat(new THREE.MeshLambertMaterial({ color: 0x1e293b }));
    this.add(this.geo(new THREE.BoxGeometry(6, 42, 224)), [sm, sm, dark, dark, dark, dark] as unknown as THREE.Material, 0, 166, 0, g);
    // Start lights
    const lampGeo = this.geo(new THREE.SphereGeometry(8, 12, 8));
    for (let i = 0; i < 3; i++) {
      const m = this.mat(new THREE.MeshBasicMaterial({ color: 0x334155 }));
      this.lamps.push(m);
      this.add(lampGeo, m, -9, 88, (i - 1) * 26, g);
    }
  }

  private stands() {
    const t = this.t;
    const r = rng(88 + t.theme);
    const seats: { x: number; y: number; z: number; ph: number }[] = [];
    const len = 250;
    for (const side of [-1, 1]) {
      const c = this.pointAt(t.n - 46, side * (t.halfW + 165));
      const e1 = this.pointAt(t.n - 46 - 16, side * (t.halfW + 165));
      const e2 = this.pointAt(t.n - 46 + 16, side * (t.halfW + 165));
      const need = t.halfW + 110;
      if (!this.inWorld(c.x, c.y, 150) || this.trackDist(c.x, c.y) < need || this.trackDist(e1.x, e1.y) < need || this.trackDist(e2.x, e2.y) < need) continue;
      this.keepOut.push([c.x, c.y, 190]);
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.y);
      // Local +X runs along the track; local -Z*side faces the road
      g.rotation.y = -c.a;
      this.group.add(g);
      const parts: Part[] = [];
      const away = side; // local Z direction pointing away from the road
      for (let tier = 0; tier < 4; tier++) {
        parts.push(part(box(len, 12 + tier * 12, 26), tier % 2 ? 0xcbd5e1 : 0xe2e8f0, [0, (12 + tier * 12) / 2, away * (tier * 26 - 38)]));
        for (let s = 0; s < 14; s++) {
          seats.push({ x: -len / 2 + 14 + s * ((len - 28) / 13), y: 12 + tier * 12, z: away * (tier * 26 - 38), ph: r() * 6.28 });
        }
      }
      // Roof on posts, striped in the track's colors
      for (const px of [-len / 2 + 6, len / 2 - 6]) parts.push(part(box(6, 96, 6), 0x64748b, [px, 48, away * 52]));
      for (let s = 0; s < 8; s++) {
        parts.push(part(box(len / 8 + 0.5, 4, 116), s % 2 ? t.colors.curbB : 0xffffff, [-len / 2 + (s + 0.5) * (len / 8), 98 - 0, away * 4], 1, [away * -0.12, 0, 0]));
      }
      this.model(parts, g);
      g.updateMatrixWorld(true);
      // Remember seats in world space
      for (let i = seats.length - 56; i < seats.length; i++) {
        const sLocal = seats[i];
        _p.set(sLocal.x, sLocal.y, sLocal.z).applyMatrix4(g.matrixWorld);
        seats[i] = { x: _p.x, y: _p.y, z: _p.z, ph: sLocal.ph };
      }
    }
    if (!seats.length) return;
    const bodyGeo = this.geo(new THREE.CylinderGeometry(4.2, 5, 11, 6));
    const headGeo = this.geo(new THREE.SphereGeometry(4.2, 7, 5));
    const bodies = new THREE.InstancedMesh(bodyGeo, this.mat(new THREE.MeshLambertMaterial()), seats.length);
    const heads = new THREE.InstancedMesh(headGeo, this.mat(new THREE.MeshLambertMaterial()), seats.length);
    const shirts = [0xef4444, 0xfacc15, 0x38bdf8, 0xa855f7, 0x4ade80, 0xfb923c, 0xf472b6, 0xffffff];
    const skins = [0xf5d0a9, 0xd9a066, 0x8d5524, 0xffe0bd, 0xc68642];
    seats.forEach((_, i) => {
      bodies.setColorAt(i, _c.set(shirts[Math.floor(r() * shirts.length)]));
      heads.setColorAt(i, _c.set(skins[Math.floor(r() * skins.length)]));
    });
    bodies.frustumCulled = false;
    heads.frustumCulled = false;
    this.group.add(bodies, heads);
    this.crowd = { bodies, heads, seats };
    this.updateCrowd(0, 0);
  }

  private updateCrowd(now: number, excite: number) {
    const c = this.crowd;
    if (!c) return;
    const d = this.dummy;
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    const amp = 1.2 + excite * 6;
    const speed = 0.004 + excite * 0.008;
    c.seats.forEach((s, i) => {
      const hop = Math.abs(Math.sin(now * speed + s.ph)) * amp;
      d.position.set(s.x, s.y + 5.5 + hop, s.z);
      d.updateMatrix();
      c.bodies.setMatrixAt(i, d.matrix);
      d.position.y += 9.5;
      d.updateMatrix();
      c.heads.setMatrixAt(i, d.matrix);
    });
    c.bodies.instanceMatrix.needsUpdate = true;
    c.heads.instanceMatrix.needsUpdate = true;
  }

  // ----- ponds, lakes and lava -----
  private pools() {
    const t = this.t;
    const r = rng(600 + t.theme * 7);
    const spec = POOLS[t.theme] ?? POOLS[0];
    const disc = this.geo(new THREE.CircleGeometry(1, 30));
    disc.rotateX(-Math.PI / 2);
    const off = (f: number) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    const rimMat = this.mat(new THREE.MeshLambertMaterial({ color: spec.rim, ...off(-2) }));
    const fillMat = this.mat(new THREE.MeshBasicMaterial({ color: spec.fill, ...off(-3) }));
    const shineMat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: t.theme === 4 ? 0.35 : 0.3, depthWrite: false, ...off(-4) }));
    if (t.theme === 4) {
      this.pulse.push(fillMat);
      shineMat.color.set(0xfde047);
    }
    const placed: [number, number, number][] = [];
    for (let tries = 0; tries < 400 && placed.length < 6; tries++) {
      const rad = 55 + r() * 95;
      const x = 180 + r() * (t.worldW - 360);
      const y = 180 + r() * (t.worldH - 360);
      if (this.trackDist(x, y) < t.halfW + rad * 1.25 + 60) continue;
      if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + rad + 220)) continue;
      if (this.keepOut.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + rad)) continue;
      placed.push([x, y, rad]);
      const yaw = r() * Math.PI;
      const kx = 1.25;
      const kz = 0.85;
      for (const [mat, s, yy, order] of [[rimMat, 1.12, 0.15, 2], [fillMat, 1, 0.25, 3], [shineMat, 0.55, 0.32, 4]] as [THREE.Material, number, number, number][]) {
        const m = this.add(disc, mat, x + (order === 4 ? rad * 0.2 : 0), yy, y - (order === 4 ? rad * 0.12 : 0));
        m.scale.set(rad * kx * s, 1, rad * kz * s);
        m.rotation.y = yaw;
        m.renderOrder = order;
      }
      this.keepOut.push([x, y, rad * 1.3]);
    }
  }

  // ----- arrow boards on the outside of sharp bends -----
  private bendSigns() {
    const t = this.t;
    const n = t.n;
    const win = 34;
    const turn = (i: number) => wrapAngle(this.angleAt(i + win) - this.angleAt(i - win));
    const spots: { i: number; s: number }[] = [];
    for (let i = 0; i < n; i += 4) {
      const v = turn(i);
      if (Math.abs(v) < 0.95) continue;
      let peak = true;
      for (let o = -48; o <= 48 && peak; o += 4) if (o !== 0 && Math.abs(turn(i + o)) > Math.abs(v)) peak = false;
      if (peak && !spots.some((s) => Math.abs(((s.i - i + n + n / 2) % n) - n / 2) < 70)) spots.push({ i, s: Math.sign(v) });
    }
    const boards: { x: number; y: number; a: number; s: number }[] = [];
    for (const sp of spots) {
      for (const o of [-20, -2, 16]) {
        const lat = -sp.s * (t.halfW + 48);
        const p = this.pointAt(sp.i + o, lat);
        if (!this.inWorld(p.x, p.y, 40) || this.trackDist(p.x, p.y) < t.halfW + 40) continue;
        boards.push({ x: p.x, y: p.y, a: p.a - sp.s * 0.25, s: sp.s });
      }
    }
    if (!boards.length) return;
    const geo = this.geo(new THREE.PlaneGeometry(54, 30));
    const mesh = new THREE.InstancedMesh(geo, this.mat(new THREE.MeshBasicMaterial({ map: this.tex(chevronCanvas()), side: THREE.DoubleSide })), boards.length);
    const postGeo = this.geo(new THREE.BoxGeometry(3, 16, 3));
    const posts = new THREE.InstancedMesh(postGeo, this.mat(new THREE.MeshLambertMaterial({ color: 0x475569 })), boards.length * 2);
    const d = this.dummy;
    boards.forEach((b, i) => {
      const yaw = Math.atan2(-Math.cos(b.a), -Math.sin(b.a));
      d.position.set(b.x, 29, b.y);
      d.rotation.set(0, yaw, 0);
      d.scale.set(b.s, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      d.scale.set(1, 1, 1);
      for (const k of [-1, 1]) {
        d.position.set(b.x + Math.cos(yaw) * k * 20, 8, b.y - Math.sin(yaw) * k * 20);
        d.updateMatrix();
        posts.setMatrixAt(i * 2 + (k > 0 ? 1 : 0), d.matrix);
      }
      this.keepOut.push([b.x, b.y, 34]);
    });
    mesh.frustumCulled = false;
    posts.frustumCulled = false;
    this.group.add(mesh, posts);
  }

  // ----- boost pads, ramps and hazards -----
  private pads() {
    const pads = this.t.pads ?? [];
    if (!pads.length) return;
    const tex = this.tex(padCanvas(), true);
    this.padTex = tex;
    const off = (f: number) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    const baseMat = this.mat(new THREE.MeshBasicMaterial({ color: 0x0ea5e9, ...off(-7) }));
    const rimMat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff, ...off(-6) }));
    const arrowMat = this.mat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, ...off(-8) }));
    for (const p of pads) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.y);
      g.rotation.y = -p.a;
      const plane = (w: number, h: number) => {
        const q = this.geo(new THREE.PlaneGeometry(w, h));
        q.rotateX(-Math.PI / 2);
        return q;
      };
      const rim = this.add(plane(p.len + 8, p.width + 8), rimMat, 0, 0.5, 0, g);
      rim.renderOrder = 6;
      const base = this.add(plane(p.len, p.width), baseMat, 0, 0.55, 0, g);
      base.renderOrder = 7;
      const arrows = this.add(plane(p.len, p.width * 0.8), arrowMat, 0, 0.6, 0, g);
      arrows.renderOrder = 8;
      // A soft glow so pads read from far away
      const glow = new THREE.Sprite(this.mat(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x67e8f9, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
      glow.scale.set(p.width * 1.6, p.width * 0.9, 1);
      glow.position.y = 8;
      g.add(glow);
      this.group.add(g);
    }
  }

  private ramps() {
    const ramps = this.t.ramps ?? [];
    for (const r of ramps) {
      const rise = 14;
      const tilt = Math.atan2(rise, r.len);
      const slope = Math.hypot(rise, r.len);
      const parts: Part[] = [part(box(slope, 3, r.width), 0xf97316, [0, rise / 2, 0], 1, [0, 0, tilt])];
      for (let i = 0; i < 6; i++) {
        parts.push(part(box(slope * 0.99, 3.5, r.width / 12), 0xfef3c7, [0, rise / 2 + 0.2, -r.width / 2 + (i * 2 + 0.5) * (r.width / 12) + r.width / 24], 1, [0, 0, tilt]));
      }
      parts.push(part(box(3, rise, r.width), 0x7c2d12, [r.len / 2, rise / 2, 0]));
      for (const s of [-1, 1]) parts.push(part(box(r.len, rise * 0.5, 4), 0x9a3412, [0, rise * 0.25, s * (r.width / 2)]));
      const g = this.model(parts, this.group);
      g.position.set(r.x, 0, r.y);
      g.rotation.y = -r.a;
    }
  }

  private hazards() {
    const hz = this.t.hazards ?? [];
    if (!hz.length) return;
    const looks: Record<string, { fill: number; rim: number; shine: number; op: number }> = {
      mud: { fill: 0x6b4423, rim: 0x4a2f17, shine: 0x8b5e3c, op: 0.95 },
      oil: { fill: 0x18181b, rim: 0x3f3f46, shine: 0xa78bfa, op: 0.9 },
      ice: { fill: 0xbae6fd, rim: 0xffffff, shine: 0xffffff, op: 0.85 },
      puddle: { fill: 0x60a5fa, rim: 0x93c5fd, shine: 0xffffff, op: 0.8 },
      water: { fill: 0x60a5fa, rim: 0x93c5fd, shine: 0xffffff, op: 0.8 },
      sand: { fill: 0xe8c078, rim: 0xd6a35c, shine: 0xfde68a, op: 0.95 },
      lava: { fill: 0xff6a1a, rim: 0x7c2d12, shine: 0xfde047, op: 1 },
      syrup: { fill: 0xf43f6e, rim: 0x9d174d, shine: 0xfecdd3, op: 0.92 },
      goo: { fill: 0xf472b6, rim: 0xdb2777, shine: 0xfce7f3, op: 0.9 },
      snow: { fill: 0xffffff, rim: 0xe2e8f0, shine: 0xffffff, op: 0.95 },
    };
    const disc = this.geo(new THREE.CircleGeometry(1, 22));
    disc.rotateX(-Math.PI / 2);
    const cache = new Map<string, THREE.Material[]>();
    const off = (f: number) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    for (const h of hz) {
      const kind = String(h.kind ?? '');
      const look = looks[kind] ?? { fill: 0x27272a, rim: 0x52525b, shine: 0xa1a1aa, op: 0.85 };
      let mats = cache.get(kind);
      if (!mats) {
        mats = [
          this.mat(new THREE.MeshBasicMaterial({ color: look.rim, transparent: true, opacity: look.op * 0.8, depthWrite: false, ...off(-9) })),
          this.mat(new THREE.MeshBasicMaterial({ color: look.fill, transparent: true, opacity: look.op, depthWrite: false, ...off(-10) })),
          this.mat(new THREE.MeshBasicMaterial({ color: look.shine, transparent: true, opacity: 0.35, depthWrite: false, ...off(-11) })),
        ];
        if (kind === 'lava') this.pulse.push(mats[1] as THREE.MeshBasicMaterial);
        cache.set(kind, mats);
      }
      const rx = h.len ? h.len / 2 : h.r ?? 40;
      const rz = h.width ? h.width / 2 : (h.r ?? 40) * (h.len ? 1 : 0.82);
      [1.14, 1, 0.5].forEach((s, i) => {
        const m = this.add(disc, mats![i], h.x + (i === 2 ? rx * 0.15 : 0), 0.62 + i * 0.04, h.y - (i === 2 ? rz * 0.15 : 0));
        m.scale.set(rx * s, 1, rz * s);
        m.rotation.y = -(h.a ?? 0);
        m.renderOrder = 9 + i;
      });
    }
  }

  // ----- trees, houses, flowers... -----
  private scenery() {
    const t = this.t;
    const r = rng(4242 + t.theme);
    const map = EMOJI_MODELS[t.theme] ?? {};
    const smallMap = SMALL_OVERRIDE[t.theme] ?? {};
    const groups = new Map<string, SceneryItem[]>();
    const fallback: SceneryItem[] = [];
    let smallSeen = 0;
    for (const it of t.scenery) {
      if (this.keepOut.some(([px, py, pr]) => Math.hypot(px - it.x, py - it.y) < pr + (it.big ? 30 : 8))) continue;
      // Slow devices draw every other small decoration
      if (!it.big && this.low && smallSeen++ % 2) continue;
      const key = (!it.big && smallMap[it.e]) || map[it.e];
      if (!key || !MODELS[key]) {
        fallback.push(it);
        continue;
      }
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(it);
    }
    const d = this.dummy;
    const shadows: [number, number, number][] = [];
    for (const [key, list] of groups) {
      const b = bake(MODELS[key]());
      const boost = MODEL_SCALE[key] ?? 1;
      const meshes: THREE.InstancedMesh[] = [];
      if (b.lit) meshes.push(new THREE.InstancedMesh(this.geo(b.lit), this.litMat, list.length));
      if (b.glow) meshes.push(new THREE.InstancedMesh(this.geo(b.glow), this.glowMat, list.length));
      list.forEach((it, i) => {
        const s = (it.big ? it.size * 1.55 : it.size * 1.1) * boost * (0.85 + r() * 0.3);
        d.position.set(it.x, 0, it.y);
        d.rotation.set(0, r() * Math.PI * 2, 0);
        d.scale.set(s, s * (0.9 + r() * 0.25), s);
        d.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, d.matrix);
        if (it.big) shadows.push([it.x, it.y, s * 0.42]);
      });
      for (const m of meshes) {
        m.frustumCulled = false;
        this.group.add(m);
      }
    }
    // Anything without a model still shows up as a standing picture
    for (const it of fallback) {
      if (!it.big) continue;
      const s = emojiSprite(it.e, it.size * 2.1);
      s.position.set(it.x, it.size * 0.95, it.y);
      this.group.add(s);
    }
    // Soft round shadows under the big things
    if (shadows.length) {
      const disc = this.geo(new THREE.CircleGeometry(1, 14));
      disc.rotateX(-Math.PI / 2);
      const sm = new THREE.InstancedMesh(disc, this.mat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), shadows.length);
      d.rotation.set(0, 0, 0);
      shadows.forEach(([x, y, rad], i) => {
        d.position.set(x + rad * 0.25, 0.22, y + rad * 0.2);
        d.scale.set(rad * 1.15, 1, rad);
        d.updateMatrix();
        sm.setMatrixAt(i, d.matrix);
      });
      sm.frustumCulled = false;
      sm.renderOrder = 2;
      this.group.add(sm);
      this.shadowMesh = sm;
    }
    d.scale.set(1, 1, 1);
  }

  // ----- snow, embers, petals -----
  private makeWeather() {
    const spec = WEATHER[this.t.theme] ?? WEATHER[0];
    const n = Math.round(spec.n * (this.low ? 0.6 : 1));
    const base = new Float32Array(n * 3);
    const r = rng(17);
    for (let i = 0; i < n * 3; i++) base[i] = r();
    const geo = this.geo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = this.mat(new THREE.PointsMaterial({
      size: spec.size, map: glowTexture(), color: spec.color, transparent: true, opacity: spec.opacity, depthWrite: false,
      sizeAttenuation: true, blending: spec.add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    }));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 20;
    this.group.add(pts);
    this.weather = { pts, base, spec };
  }

  // ----- hot-air balloons -----
  private makeFloaters() {
    const t = this.t;
    if (t.theme === 2 || t.theme === 4) return;
    const r = rng(73 + t.theme);
    const palettes = [[0xef4444, 0xffffff], [0xfacc15, 0x38bdf8], [0xa855f7, 0xfde047], [0x4ade80, 0xffffff]];
    const count = this.low ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const [ca, cb] = palettes[i % palettes.length];
      const parts: Part[] = [];
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const g = new THREE.SphereGeometry(1, 3, 8, (s / segs) * Math.PI * 2, (Math.PI * 2) / segs);
        parts.push(part(g, s % 2 ? ca : cb, [0, 1.25, 0], [1, 1.25, 1]));
      }
      parts.push(part(cyl(0.34, 0.2, 0.5, 8), ca, [0, 0.1, 0]));
      parts.push(part(box(0.3, 0.24, 0.3), 0x92400e, [0, -0.5, 0]));
      for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) parts.push(part(cyl(0.01, 0.01, 0.5, 3), 0x44403c, [dx, -0.2, dz]));
      const g = this.model(parts, this.group);
      const s = 110 + r() * 60;
      g.scale.set(s, s, s);
      const f = { g, r: 1500 + r() * 1500, a: r() * Math.PI * 2, y: 620 + r() * 420, w: (0.006 + r() * 0.008) * (i % 2 ? 1 : -1) };
      this.floaters.push(f);
    }
  }

  /** 0 = everything, 1 = no weather, floaters, shadows or crowd hops, 2 = also no crowd or clouds. */
  setDetail(d: number) {
    this.detail = d;
    if (this.weather) this.weather.pts.visible = d < 1;
    for (const f of this.floaters) f.g.visible = d < 1;
    if (this.shadowMesh) this.shadowMesh.visible = d < 1;
    if (this.crowd) {
      this.crowd.bodies.visible = d < 2;
      this.crowd.heads.visible = d < 2;
    }
    if (this.clouds) this.clouds.visible = d < 2;
  }

  // ----- per frame -----
  update(now: number, dt: number, cam: THREE.Camera, s: WorldState) {
    const t = this.t;
    this.skyGroup.position.set(cam.position.x, 0, cam.position.z);
    const lite = this.detail > 0;
    if (this.clouds && !lite) this.clouds.rotation.y += dt * 0.004;
    if (this.padTex) this.padTex.offset.x = -((now / 420) % 1);
    // Start lights: three reds count down, then green
    const cd = s.countdownLeft;
    this.lamps.forEach((m, i) => {
      const on = cd !== null && cd <= (3 - i) * 1000 && cd > 0;
      m.color.set(cd === null ? 0x4ade80 : on ? 0xef4444 : 0x334155);
    });
    if (!lite) this.updateCrowd(now, s.excite);
    // Lava and fire glow breathe
    const breathe = 0.86 + Math.sin(now / 420) * 0.14;
    for (const m of this.pulse) m.color.setRGB(1 * breathe, 0.28 * breathe + 0.06, 0.02);
    if (t.theme === 4) {
      const flick = 0.9 + Math.sin(now / 90) * 0.05 + Math.sin(now / 37) * 0.05;
      this.glowMat.color.setScalar(flick);
      this.smoke.forEach((sp, i) => (sp.material.opacity = 0.6 + Math.sin(now / 700 + i * 2) * 0.2));
    }
    for (const f of lite ? [] : this.floaters) {
      f.a += f.w * dt;
      f.g.position.set(t.worldW / 2 + Math.cos(f.a) * f.r, f.y + Math.sin(now / 2600 + f.r) * 18, t.worldH / 2 + Math.sin(f.a) * f.r);
      f.g.rotation.y += dt * 0.05;
    }
    const w = lite ? null : this.weather;
    if (w) {
      const B = 1300;
      const BY = 420;
      const pos = (w.pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const time = now / 1000;
      const sp = w.spec;
      const cx = cam.position.x;
      const cy = Math.max(0, cam.position.y - 120);
      const cz = cam.position.z;
      const n = pos.length / 3;
      const mod = (v: number, m: number) => ((v % m) + m) % m;
      for (let i = 0; i < n; i++) {
        const sway = Math.sin(time * 1.3 + i) * sp.sway;
        pos[i * 3] = cx - B / 2 + mod(w.base[i * 3] * B + sp.vx * time + sway - cx, B);
        pos[i * 3 + 1] = cy + mod(w.base[i * 3 + 1] * BY + sp.vy * time - cy, BY);
        pos[i * 3 + 2] = cz - B / 2 + mod(w.base[i * 3 + 2] * B + sp.vz * time + sway * 0.6 - cz, B);
      }
      (w.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const x of this.texs) x.dispose();
    this.group.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    this.geos = [];
    this.mats = [];
    this.texs = [];
  }
}
