// 3D renderer for Bendana Kart. The race itself runs in a flat 2D world
// (x, y); this file only draws that world in 3D with three.js. World x maps
// to three.js X, world y maps to three.js Z, and up is Y. A kart heading of
// `a` radians points along (cos a, 0, sin a), which is rotation.y = -a.

import * as THREE from 'three';

export type CamMode = 'chase' | 'near' | 'driver' | 'orbit' | 'top';

export const CAM_MODES: { id: CamMode; icon: string; label: string }[] = [
  { id: 'chase', icon: '🎥', label: 'Chase cam' },
  { id: 'near', icon: '📷', label: 'Close cam' },
  { id: 'driver', icon: '🪖', label: "Driver's seat" },
  { id: 'orbit', icon: '🔄', label: '360° cam' },
  { id: 'top', icon: '🗺️', label: 'Top-down' },
];

export type SceneTrack = {
  xs: Float32Array;
  ys: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  n: number;
  halfW: number;
  worldW: number;
  worldH: number;
  ground: HTMLCanvasElement; // road, curbs and flat scenery, drawn once
  big: { x: number; y: number; e: string; size: number }[]; // tall scenery
  sky: string;
  horizon: string;
  hills: string;
  outside: string;
  edge: string;
  night: boolean;
  ramps?: { x: number; y: number; a: number; len: number; width: number }[];
};

export type KartView = {
  id: string;
  name: string;
  isMe: boolean;
  x: number;
  y: number;
  yaw: number; // where the body points (heading + drift + spin)
  heading: number; // where the kart is going
  speed: number;
  maxSpeed: number;
  emoji: string;
  color: string;
  dark: string;
  body: number;
  boost: boolean;
  toddler: boolean;
  blink: boolean;
  drifting: boolean;
  driftDir: number;
  spinning: boolean;
  finished: boolean;
  air?: number; // height above the road while jumping
  shield?: boolean; // the Bubble Shield item
  alpha?: number; // fades out when a player leaves
  bubble?: string; // emoji above the kart (reactions, snoozing)
  // Driving feel (filled for karts simulated on this device; missing for remote ones)
  steer?: number; // -1..1, front wheels and steering wheel
  slip?: number; // rad, body yaw minus heading (already included in yaw)
  hop?: number; // 0..1, drift-start hop (already included in air)
  bump?: number; // 0..1, wobble after a kart bump
  land?: number; // 0..1, landing squash (1 = just landed)
  accel?: number; // smoothed forward acceleration, units/s² (+ = speeding up)
};

export type FrameView = {
  now: number;
  dt: number;
  karts: KartView[]; // me first
  boxes: { x: number; y: number; visible: boolean; ghost: boolean }[];
  coins?: { x: number; y: number; visible: boolean }[];
  bananas: { id: string; x: number; y: number }[];
  blasts: { id: string; x: number; y: number }[];
  particles: { x: number; y: number; life: number; max: number; color: string; size: number }[];
  countdownLeft: number | null; // ms until GO, or null once racing
  introMs: number; // how long the opening fly-in lasts
  shake: number;
  mode: CamMode;
  lookBack: boolean;
  orbitYaw: number;
  orbitPitch: number;
  orbitDist: number;
  finishedFor: number; // ms since I finished, or -1
  kicks?: number; // counts my boost starts; a change kicks the FOV
  guide?: { x: number; y: number; c: number; a: number }[] | null; // driving line ahead (c: 0 green, 1 yellow, 2 red)
};

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';

const textureCache = new Map<string, THREE.Texture>();
function emojiTexture(e: string): THREE.Texture {
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

function glowTexture(): THREE.Texture {
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

function tagTexture(text: string, color: string): { tex: THREE.Texture; aspect: number } {
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

function emojiSprite(e: string, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(e), transparent: true, alphaTest: 0.15 }));
  s.scale.set(size, size, 1);
  return s;
}

const smooth = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrapAngle = (a: number) => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};

type KartObj = {
  group: THREE.Group;
  model: THREE.Group;
  wheels: THREE.Mesh[];
  flame: THREE.Mesh;
  shield: THREE.Mesh;
  driver: THREE.Sprite;
  tag: THREE.Sprite | null;
  key: string;
  bob: number;
  bubble: THREE.Sprite | null;
  bubbleE: string;
  alpha: number;
};

// Body sizes: [half length, half width, body height, ride height, wheel radius]
const BODY_DIMS: number[][] = [
  [26, 14, 11, 6, 7], // Classic
  [32, 12, 8, 5, 6.5], // Speedster
  [26, 16, 13, 17, 13], // Monster Truck
  [30, 13, 10, 12, 0], // Jet Racer (hovers)
  [20, 14, 9, 6, 7.5], // Mini Buggy
  [22, 17, 15, 6, 6], // Bubble Car
];

function buildKart(k: KartView): KartObj {
  const group = new THREE.Group();
  const model = new THREE.Group();
  group.add(model);
  const [hl, hw, bh, ride, wr] = BODY_DIMS[k.body] || BODY_DIMS[0];
  const main = new THREE.MeshLambertMaterial({ color: k.color });
  const dark = new THREE.MeshLambertMaterial({ color: k.dark });
  const black = new THREE.MeshLambertMaterial({ color: 0x111827 });
  const glass = new THREE.MeshLambertMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.55 });
  const chrome = new THREE.MeshLambertMaterial({ color: 0xe5e7eb });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    model.add(m);
    return m;
  };

  // Blob shadow on the road
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(hl + 8, hw + 10, 1);
  shadow.position.y = 0.7;
  group.add(shadow);

  const yBody = ride + bh / 2;
  if (k.body === 5) {
    // Bubble Car: a round body with a glass dome
    const ball = add(new THREE.SphereGeometry(1, 20, 14), main, 0, yBody, 0);
    ball.scale.set(hl, bh * 0.75, hw);
    const dome = add(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, -2, yBody + bh * 0.4, 0);
    dome.scale.set(hl * 0.6, bh * 0.9, hw * 0.75);
  } else if (k.body === 3) {
    // Jet Racer: pointed nose, fins and glowing thrusters
    add(new THREE.BoxGeometry(hl * 1.5, bh, hw * 2), main, -hl * 0.2, yBody, 0);
    const nose = add(new THREE.ConeGeometry(hw, hl * 0.8, 4), main, hl * 0.9, yBody, 0);
    nose.rotation.z = -Math.PI / 2;
    nose.rotation.x = Math.PI / 4;
    for (const s of [-1, 1]) {
      const fin = add(new THREE.BoxGeometry(14, 2, 12), dark, -hl * 0.8, yBody + 2, s * (hw + 5));
      fin.rotation.x = s * 0.3;
      const thr = add(
        new THREE.CylinderGeometry(4.5, 5.5, 10, 12),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
        -hl - 2, yBody - 1, s * 7,
      );
      thr.rotation.z = Math.PI / 2;
    }
    add(new THREE.BoxGeometry(6, 14, 4), dark, -hl * 0.85, yBody + bh / 2 + 6, 0);
  } else {
    add(new THREE.BoxGeometry(hl * 2, bh, hw * 2), main, 0, yBody, 0);
    // Nose
    const nose = add(new THREE.BoxGeometry(hl * 0.5, bh * 0.7, hw * 1.5), main, hl * 1.05, yBody - bh * 0.1, 0);
    nose.rotation.z = -0.15;
    // Front bumper
    add(new THREE.BoxGeometry(4, 4, hw * 1.7), chrome, hl * 1.3, ride + 3, 0);
    if (k.body === 1) {
      // Speedster: low spoiler and side fins
      add(new THREE.BoxGeometry(8, 2, hw * 2.6), dark, -hl + 2, yBody + bh + 7, 0);
      add(new THREE.BoxGeometry(3, 8, 3), dark, -hl + 2, yBody + bh / 2 + 3, -hw * 0.9);
      add(new THREE.BoxGeometry(3, 8, 3), dark, -hl + 2, yBody + bh / 2 + 3, hw * 0.9);
    } else if (k.body === 4) {
      // Mini Buggy: roll cage
      const bar = new THREE.TorusGeometry(hw * 0.95, 1.6, 6, 16, Math.PI);
      const cage = add(bar, chrome, -hl * 0.35, yBody + bh / 2, 0);
      cage.rotation.y = Math.PI / 2;
    } else {
      // Classic and Monster Truck: rear wing
      add(new THREE.BoxGeometry(6, 2.5, hw * 2.4), dark, -hl - 1, yBody + bh / 2 + 7, 0);
      add(new THREE.BoxGeometry(3, 7, 3), dark, -hl - 1, yBody + bh / 2 + 3, 0);
    }
    // Seat back
    add(new THREE.BoxGeometry(4, 10, hw * 1.1), dark, -hl * 0.35, yBody + bh / 2 + 4, 0);
    // Windscreen
    const ws = add(new THREE.BoxGeometry(1.5, 8, hw * 1.3), glass, hl * 0.35, yBody + bh / 2 + 4, 0);
    ws.rotation.z = 0.5;
  }

  // Wheels
  const wheels: THREE.Mesh[] = [];
  if (wr > 0) {
    const wgeo = new THREE.CylinderGeometry(wr, wr, wr * 0.9, 14);
    wgeo.rotateX(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(wr * 0.45, wr * 0.45, wr * 0.95, 8);
    hub.rotateX(Math.PI / 2);
    for (const [fx, sz] of [[0.62, -1], [0.62, 1], [-0.62, -1], [-0.62, 1]]) {
      const w = new THREE.Mesh(wgeo, black);
      w.position.set(fx * hl, wr, sz * (hw + wr * 0.35));
      w.add(new THREE.Mesh(hub, chrome));
      model.add(w);
      wheels.push(w);
    }
  }

  // Boost flame out the back
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(6, 26, 10),
    new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9 }),
  );
  flame.rotation.z = Math.PI / 2;
  flame.position.set(-hl - 15, yBody, 0);
  flame.visible = false;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(3.5, 18, 8), new THREE.MeshBasicMaterial({ color: 0xfde047 }));
  inner.position.y = 3;
  flame.add(inner);
  model.add(flame);

  // The character rides on top, always facing the camera
  const driver = emojiSprite(k.emoji, 34);
  driver.position.set(-hl * 0.1, yBody + bh / 2 + 14, 0);
  model.add(driver);

  // Toddler Assist bubble
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(42, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shield.position.y = 18;
  shield.visible = false;
  group.add(shield);

  let tag: THREE.Sprite | null = null;
  if (!k.isMe) {
    const { tex, aspect } = tagTexture(k.name, k.color);
    // Same size on screen at any distance, so names stay readable but never huge
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
    tag.scale.set(0.042 * aspect, 0.042, 1);
    tag.position.y = yBody + bh / 2 + 44;
    tag.renderOrder = 10;
    group.add(tag);
  }

  return { group, model, wheels, flame, shield, driver, tag, key: `${k.body}|${k.color}|${k.emoji}|${k.name}`, bob: Math.random() * 10, bubble: null, bubbleE: '', alpha: 1 };
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) {
      const mm = mat as THREE.SpriteMaterial;
      // Emoji textures are shared through the cache, so only free tag textures.
      if (mm.map && !Array.from(textureCache.values()).includes(mm.map)) mm.map.dispose();
      mat.dispose();
    }
  });
}

export class View3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, 1, 2, 9000);
  private world = new THREE.Group();
  private karts = new Map<string, KartObj>();
  private boxes: THREE.Group[] = [];
  private coins: THREE.Group[] = [];
  private bananas = new Map<string, THREE.Group>();
  private blasts = new Map<string, THREE.Group>();
  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private colorCache = new Map<string, THREE.Color>();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYaw = 0;
  private fov = 65;
  private lastMode: CamMode | null = null;
  private blendT = 0;
  private started = false;
  private track: SceneTrack | null = null;

  constructor(canvas: HTMLCanvasElement, lowPower: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.world);
    const cap = 600;
    this.pointPos = new Float32Array(cap * 3);
    this.pointCol = new Float32Array(cap * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 10, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // Resolution drops automatically on slow devices so the race stays smooth.
  private baseRatio = 1;
  private resScale = 1;
  private sizeW = 1;
  private sizeH = 1;
  private frameEma = 1 / 60;
  private adaptAt = 0;
  private goodFor = 0;

  setSize(w: number, h: number, pixelRatio: number) {
    this.baseRatio = pixelRatio;
    this.sizeW = w;
    this.sizeH = h;
    this.renderer.setPixelRatio(Math.max(0.5, pixelRatio * this.resScale));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTrack(t: SceneTrack) {
    this.track = t;
    for (const c of [...this.world.children]) {
      this.world.remove(c);
      disposeTree(c);
    }
    const { worldW: W, worldH: H } = t;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.horizon, 1400, 4200);

    const hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(t.outside), t.night ? 0.9 : 1.6);
    this.world.add(hemi);
    const sun = new THREE.DirectionalLight(t.night ? 0xffb38a : 0xffffff, t.night ? 1.1 : 1.8);
    sun.position.set(-600, 1200, -400);
    this.world.add(sun);

    // Ground: the same painted track the top-down view uses
    const tex = new THREE.CanvasTexture(t.ground);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const groundGeo = new THREE.PlaneGeometry(W, H);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: tex }));
    ground.position.set(W / 2, 0, H / 2);
    this.world.add(ground);

    const outerGeo = new THREE.PlaneGeometry(30000, 30000);
    outerGeo.rotateX(-Math.PI / 2);
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshLambertMaterial({ color: t.outside }));
    outer.position.set(W / 2, -1, H / 2);
    this.world.add(outer);

    // Low walls around the edge of the world
    const wallMat = new THREE.MeshLambertMaterial({ color: t.edge });
    for (const [x, z, w, d] of [[W / 2, -11, W + 44, 22], [W / 2, H + 11, W + 44, 22], [-11, H / 2, 22, H], [W + 11, H / 2, 22, H]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 26, d), wallMat);
      wall.position.set(x, 13, z);
      this.world.add(wall);
    }

    // Hills on the horizon
    const hillMat = new THREE.MeshLambertMaterial({ color: t.hills });
    const rnd = (() => {
      let s = 1234567;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    })();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
      const r = 2300 + rnd() * 700;
      const hgt = 260 + rnd() * 520;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(260 + rnd() * 260, hgt, 7), hillMat);
      hill.position.set(W / 2 + Math.cos(a) * r, hgt / 2 - 20, H / 2 + Math.sin(a) * r * 0.8);
      this.world.add(hill);
    }

    // Tall scenery as billboards
    for (const b of t.big) {
      const s = emojiSprite(b.e, b.size * 2.1);
      s.position.set(b.x, b.size * 0.95, b.y);
      this.world.add(s);
    }

    // Start / finish arch
    const i0 = 0;
    const sx = t.xs[i0];
    const sz = t.ys[i0];
    const nx = -t.ty[i0];
    const nz = t.tx[i0];
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 110, 10), postMat);
      post.position.set(sx + nx * s * (t.halfW + 26), 55, sz + nz * s * (t.halfW + 26));
      this.world.add(post);
    }
    const cc = document.createElement('canvas');
    cc.width = 256;
    cc.height = 32;
    const cg = cc.getContext('2d');
    if (cg) {
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 2; j++) {
          cg.fillStyle = (i + j) % 2 ? '#111827' : '#ffffff';
          cg.fillRect(i * 16, j * 16, 16, 16);
        }
      }
    }
    const ctex = new THREE.CanvasTexture(cc);
    ctex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(4, 22, (t.halfW + 26) * 2), new THREE.MeshLambertMaterial({ map: ctex }));
    banner.position.set(sx, 104, sz);
    banner.rotation.y = -Math.atan2(t.ty[i0], t.tx[i0]);
    this.world.add(banner);

    // Jump ramps: striped wedges rising toward the jump
    if (t.ramps) {
      const rampMat = new THREE.MeshLambertMaterial({ color: 0xf97316 });
      const stripeMat = new THREE.MeshLambertMaterial({ color: 0xfef3c7 });
      for (const r of t.ramps) {
        const rise = 14;
        const tilt = Math.atan2(rise, r.len);
        const slope = Math.hypot(rise, r.len);
        const g = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(slope, 3, r.width), rampMat);
        deck.rotation.z = tilt;
        deck.position.set(0, rise / 2, 0);
        g.add(deck);
        for (let i = -1; i <= 1; i += 2) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(slope * 0.98, 3.4, 6), stripeMat);
          st.rotation.z = tilt;
          st.position.set(0, rise / 2 + 0.2, i * r.width * 0.25);
          g.add(st);
        }
        const lip = new THREE.Mesh(new THREE.BoxGeometry(3, rise, r.width), new THREE.MeshLambertMaterial({ color: 0x7c2d12 }));
        lip.position.set(r.len / 2, rise / 2, 0);
        g.add(lip);
        g.position.set(r.x, 0, r.y);
        g.rotation.y = -r.a;
        this.world.add(g);
      }
    }

    // Clear old moving things; they are rebuilt on demand
    for (const k of this.karts.values()) {
      this.scene.remove(k.group);
      disposeTree(k.group);
    }
    this.karts.clear();
    for (const b of this.boxes) this.scene.remove(b);
    this.boxes = [];
    for (const c of this.coins) this.scene.remove(c);
    this.coins = [];
    this.bananas.forEach((b) => this.scene.remove(b));
    this.bananas.clear();
    this.blasts.forEach((b) => this.scene.remove(b));
    this.blasts.clear();
    this.started = false;
  }

  private kartObj(k: KartView): KartObj {
    const key = `${k.body}|${k.color}|${k.emoji}|${k.name}`;
    let o = this.karts.get(k.id);
    if (o && o.key !== key) {
      this.scene.remove(o.group);
      disposeTree(o.group);
      o = undefined;
    }
    if (!o) {
      o = buildKart(k);
      this.karts.set(k.id, o);
      this.scene.add(o.group);
    }
    return o;
  }

  private colorOf(s: string): THREE.Color {
    let c = this.colorCache.get(s);
    if (!c) {
      c = new THREE.Color();
      try {
        // three.js ignores alpha in rgba()/hsla(), which is fine for sparks
        c.setStyle(s.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)').replace(/^hsla\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'hsl($1,$2,$3)'));
      } catch {
        c.set(0xffffff);
      }
      if (this.colorCache.size > 400) this.colorCache.clear();
      this.colorCache.set(s, c);
    }
    return c;
  }

  private adapt(now: number, dt: number) {
    if (dt <= 0 || dt >= 0.1) return;
    this.frameEma += (dt - this.frameEma) * 0.05;
    if (now < this.adaptAt) return;
    this.adaptAt = now + 1500;
    if (this.frameEma > 1 / 42 && this.resScale > 0.45) {
      this.resScale *= 0.8;
      this.goodFor = 0;
      this.setSize(this.sizeW, this.sizeH, this.baseRatio);
    } else if (this.frameEma < 1 / 57 && this.resScale < 1) {
      this.goodFor += 1;
      if (this.goodFor >= 4) {
        this.resScale = Math.min(1, this.resScale * 1.15);
        this.goodFor = 0;
        this.setSize(this.sizeW, this.sizeH, this.baseRatio);
      }
    }
  }

  render(f: FrameView) {
    if (!this.track) return;
    const { now, dt } = f;
    this.adapt(now, dt);
    const me = f.karts[0];

    // ----- Karts -----
    const seen = new Set<string>();
    for (const k of f.karts) {
      seen.add(k.id);
      const o = this.kartObj(k);
      const hover = k.body === 3 ? Math.sin(now / 160 + o.bob) * 2 : 0;
      o.group.position.set(k.x, hover + (k.air ?? 0), k.y);
      o.group.rotation.y = -k.yaw;
      // Lean into drifts and turns
      const lean = k.drifting ? -k.driftDir * 0.14 : 0;
      o.model.rotation.x += (lean - o.model.rotation.x) * smooth(10, dt);
      o.model.rotation.z = k.boost ? 0.05 : 0;
      const spinRate = (k.speed * dt) / 7;
      for (const w of o.wheels) w.rotation.z -= spinRate;
      o.flame.visible = k.boost;
      if (k.boost) {
        const s = 0.8 + Math.random() * 0.5;
        o.flame.scale.set(1, s, 1);
      }
      const sh = k.toddler || !!k.shield;
      o.shield.visible = sh;
      if (sh) {
        o.shield.scale.setScalar(1 + Math.sin(now / 250) * 0.05);
        const sm = o.shield.material as THREE.MeshBasicMaterial;
        sm.color.set(k.shield ? 0xfde047 : 0x38bdf8);
        sm.opacity = k.shield ? 0.28 : 0.16;
      }
      // Emoji bubble above the kart
      const be = k.bubble ?? '';
      if (be !== o.bubbleE) {
        o.bubbleE = be;
        if (o.bubble) {
          o.group.remove(o.bubble);
          o.bubble.material.dispose();
          o.bubble = null;
        }
        if (be) {
          o.bubble = emojiSprite(be, 30);
          o.bubble.position.y = k.isMe ? 70 : 92;
          o.group.add(o.bubble);
        }
      }
      if (o.bubble) o.bubble.position.y = (k.isMe ? 70 : 92) + Math.sin(now / 200) * 3;
      // Fade out a kart whose player left
      const al = k.alpha ?? 1;
      if (Math.abs(al - o.alpha) > 0.02) {
        o.alpha = al;
        o.group.traverse((c) => {
          const m = (c as THREE.Mesh).material as THREE.Material | undefined;
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
      const hideMe = k.isMe && f.mode === 'driver' && !f.lookBack && f.countdownLeft === null && f.finishedFor < 0;
      o.group.visible = !k.blink;
      o.driver.visible = !hideMe;
    }
    for (const [id, o] of this.karts) {
      if (!seen.has(id)) {
        this.scene.remove(o.group);
        disposeTree(o.group);
        this.karts.delete(id);
      }
    }

    // ----- Item boxes -----
    while (this.boxes.length < f.boxes.length) {
      const g = new THREE.Group();
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(30, 30, 30),
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, emissive: 0x333333 }),
      );
      g.add(cube);
      const gift = emojiSprite('🎁', 22);
      g.add(gift);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
      glow.scale.set(70, 70, 1);
      g.add(glow);
      this.scene.add(g);
      this.boxes.push(g);
    }
    f.boxes.forEach((b, i) => {
      const g = this.boxes[i];
      g.visible = b.visible || b.ghost;
      if (!g.visible) return;
      g.position.set(b.x, 26 + Math.sin(now / 300 + b.x) * 4, b.y);
      const cube = g.children[0] as THREE.Mesh;
      cube.rotation.set(now / 900, now / 700, now / 1100);
      const mat = cube.material as THREE.MeshLambertMaterial;
      mat.color.setHSL(((now / 8 + b.x) % 360) / 360, 0.85, 0.6);
      mat.opacity = b.ghost ? 0.25 : 0.8;
    });
    for (let i = f.boxes.length; i < this.boxes.length; i++) this.boxes[i].visible = false;

    // ----- Coins -----
    const coins = f.coins ?? [];
    while (this.coins.length < coins.length) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(8, 8, 2.5, 18),
        new THREE.MeshLambertMaterial({ color: 0xfacc15, emissive: 0x7a5a00 }),
      );
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      this.scene.add(g);
      this.coins.push(g);
    }
    coins.forEach((c, i) => {
      const g = this.coins[i];
      g.visible = c.visible;
      if (!c.visible) return;
      g.position.set(c.x, 14 + Math.sin(now / 250 + c.x * 0.1) * 2, c.y);
      g.rotation.y = now / 300 + i;
    });
    for (let i = coins.length; i < this.coins.length; i++) this.coins[i].visible = false;

    // ----- Bananas and blasts -----
    const sync = (
      store: Map<string, THREE.Group>,
      list: { id: string; x: number; y: number }[],
      make: () => THREE.Group,
      place: (g: THREE.Group, it: { x: number; y: number }) => void,
    ) => {
      const ids = new Set<string>();
      for (const it of list) {
        ids.add(it.id);
        let g = store.get(it.id);
        if (!g) {
          g = make();
          store.set(it.id, g);
          this.scene.add(g);
        }
        place(g, it);
      }
      for (const [id, g] of store) {
        if (!ids.has(id)) {
          this.scene.remove(g);
          store.delete(id);
        }
      }
    };
    sync(
      this.bananas,
      f.bananas,
      () => {
        const g = new THREE.Group();
        const s = emojiSprite('🍌', 34);
        s.position.y = 15;
        g.add(s);
        const sh = new THREE.Mesh(new THREE.CircleGeometry(13, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.25, depthWrite: false }));
        sh.rotation.x = -Math.PI / 2;
        sh.position.y = 0.8;
        g.add(sh);
        return g;
      },
      (g, it) => g.position.set(it.x, 0, it.y),
    );
    sync(
      this.blasts,
      f.blasts,
      () => {
        const g = new THREE.Group();
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfb923c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.scale.set(80, 80, 1);
        g.add(glow);
        g.add(emojiSprite('💥', 40));
        return g;
      },
      (g, it) => {
        g.position.set(it.x, 22 + Math.sin(now / 90) * 3, it.y);
        (g.children[1] as THREE.Sprite).material.rotation = now / 80;
      },
    );

    // ----- Particles -----
    const np = Math.min(f.particles.length, this.pointPos.length / 3);
    for (let i = 0; i < np; i++) {
      const p = f.particles[i];
      const age = 1 - p.life / p.max;
      this.pointPos[i * 3] = p.x;
      this.pointPos[i * 3 + 1] = 4 + age * 16 + p.size;
      this.pointPos[i * 3 + 2] = p.y;
      const c = this.colorOf(p.color);
      this.pointCol[i * 3] = c.r;
      this.pointCol[i * 3 + 1] = c.g;
      this.pointCol[i * 3 + 2] = c.b;
    }
    const pg = this.points.geometry;
    pg.setDrawRange(0, np);
    (pg.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (pg.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // ----- Driving line and camera -----
    this.updateGuide(f);
    this.updateCamera(f, me);
    this.renderer.render(this.scene, this.camera);
  }

  // ----- Driving line: a flat ribbon on the road, fading at both ends -----
  private guideMesh: THREE.Mesh | null = null;
  private guidePos: Float32Array | null = null;
  private guideCol: Float32Array | null = null;
  private updateGuide(f: FrameView) {
    const pts = f.guide;
    if (!pts || pts.length < 2) {
      if (this.guideMesh) this.guideMesh.visible = false;
      return;
    }
    const N = 64;
    if (!this.guideMesh) {
      this.guidePos = new Float32Array(N * 2 * 3);
      this.guideCol = new Float32Array(N * 2 * 4);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.guidePos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(this.guideCol, 4));
      const idx: number[] = [];
      for (let i = 0; i < N - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(idx);
      this.guideMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      this.guideMesh.frustumCulled = false;
      this.guideMesh.renderOrder = 1;
      this.scene.add(this.guideMesh);
    }
    const pos = this.guidePos!;
    const col = this.guideCol!;
    const cols = [[0.29, 0.87, 0.5], [0.98, 0.8, 0.08], [0.97, 0.44, 0.44]];
    const m = Math.min(N, pts.length);
    for (let i = 0; i < N; i++) {
      const p = pts[Math.min(i, m - 1)];
      const q = pts[Math.min(Math.max(i + 1, 1), m - 1)];
      const r = pts[Math.max(0, Math.min(i, m - 1) - 1)];
      let dx = q.x - r.x;
      let dz = q.y - r.y;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const hw = 7;
      for (let s = 0; s < 2; s++) {
        const side = s ? 1 : -1;
        const o = (i * 2 + s) * 3;
        pos[o] = p.x - dz * hw * side;
        pos[o + 1] = 1.2;
        pos[o + 2] = p.y + dx * hw * side;
        const c = cols[p.c] ?? cols[0];
        const k = (i * 2 + s) * 4;
        col[k] = c[0];
        col[k + 1] = c[1];
        col[k + 2] = c[2];
        col[k + 3] = i < m ? p.a : 0;
      }
    }
    const g = this.guideMesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.guideMesh.visible = true;
  }

  // ----- Camera: a spring that follows where you are going -----
  private fovKick = 0;
  private lastKicks = -1;
  private dip = 0;
  private wasAir = false;
  private lastHeading = 0;
  private yawRate = 0;
  private lookSide = 0;
  private updateCamera(f: FrameView, me: KartView) {
    const { dt, now } = f;
    const portrait = this.camera.aspect < 1;
    const fx = Math.cos(me.heading);
    const fz = Math.sin(me.heading);
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = portrait ? 76 : 64;
    let posK = 9;
    const yawK = 5;
    const speedR = Math.min(1.3, Math.max(0, me.speed / (me.maxSpeed || 1)));

    if (this.lastMode !== f.mode) {
      if (this.lastMode !== null) this.blendT = 0.45;
      this.lastMode = f.mode;
    }
    this.blendT = Math.max(0, this.blendT - dt);

    // Turn rate (smoothed) for looking into turns and the driver's-seat roll
    if (dt > 0) {
      const w = wrapAngle(me.heading - this.lastHeading) / dt;
      this.yawRate += (Math.max(-6, Math.min(6, w)) - this.yawRate) * smooth(8, dt);
    }
    this.lastHeading = me.heading;
    // Boost kick: every new boost punches the field of view, then it settles
    const kicks = f.kicks ?? 0;
    if (this.lastKicks >= 0 && kicks !== this.lastKicks) this.fovKick = 12;
    this.lastKicks = kicks;
    this.fovKick += ((me.boost ? 6 : 0) - this.fovKick) * smooth(this.fovKick > 6 ? 3 : 4, dt);
    // Landing dip
    const inAir = (me.air ?? 0) > 2;
    if (this.wasAir && !inAir) this.dip = 7;
    this.wasAir = inAir;
    this.dip += (0 - this.dip) * smooth(9, dt);

    // Yaw follows the direction of travel with a little lag, so turns and
    // drifts swing the kart sideways on screen.
    if (!this.started) {
      this.camYaw = me.heading;
    }
    const slip = Math.max(-0.6, Math.min(0.6, me.slip ?? 0));
    const travel = me.speed > 80 && !me.spinning ? me.heading - slip * 0.6 : me.heading;
    const intro = f.countdownLeft !== null && f.countdownLeft > 900 && f.introMs > 0;
    const victory = f.finishedFor >= 0;

    if (intro) {
      // Opening fly-in: start high above the grid and swoop down behind the kart.
      const t = Math.min(1, Math.max(0, 1 - (f.countdownLeft! - 900) / f.introMs));
      const e = t * t * (3 - 2 * t);
      const around = (1 - e) * Math.PI * 1.25;
      const dist = 520 - 385 * e;
      const height = 360 - 298 * e;
      const a = me.heading + Math.PI + around;
      target.set(me.x + Math.cos(a) * dist, height, me.y + Math.sin(a) * dist);
      look.set(me.x + fx * 70 * e, 18, me.y + fz * 70 * e);
      this.camPos.copy(target);
      this.camLook.copy(look);
      this.camYaw = me.heading;
      this.started = true;
    } else if (victory) {
      // Victory lap: circle slowly around my kart
      const a = me.heading + Math.PI * 0.75 + f.finishedFor / 2600;
      target.set(me.x + Math.cos(a) * 120, 48, me.y + Math.sin(a) * 120);
      look.set(me.x, 20, me.y);
      posK = 3;
      fov = portrait ? 70 : 58;
    } else if (f.lookBack) {
      // Rear view: sit in front of the kart and look back at the chasers
      target.set(me.x + fx * 95, 46, me.y + fz * 95);
      look.set(me.x - fx * 160, 14, me.y - fz * 160);
      posK = 20;
      this.camYaw = me.heading;
    } else if (f.mode === 'orbit') {
      // 360 cam: drag to swing around the kart; angles are relative to the
      // kart's heading, so a front view stays a front view while driving.
      const a = me.heading + Math.PI + f.orbitYaw;
      const d = f.orbitDist;
      const cp = Math.cos(f.orbitPitch);
      target.set(me.x + Math.cos(a) * d * cp, 12 + Math.sin(f.orbitPitch) * d, me.y + Math.sin(a) * d * cp);
      look.set(me.x, 16, me.y);
      posK = 12;
    } else if (f.mode === 'driver') {
      // Driver's seat: low and fast, world spins with you when you spin out
      this.camYaw += wrapAngle(me.yaw * 0.25 + me.heading * 0.75 - this.camYaw) * smooth(14, dt);
      const cx = Math.cos(this.camYaw);
      const cz = Math.sin(this.camYaw);
      target.set(me.x + cx * 9, 30, me.y + cz * 9);
      look.set(me.x + cx * 220, 22, me.y + cz * 220);
      fov = (portrait ? 88 : 78) + 6 * speedR ** 1.5;
      posK = 40;
    } else {
      const near = f.mode === 'near';
      this.camYaw += wrapAngle(travel - this.camYaw) * smooth(yawK, dt);
      const cx = Math.cos(this.camYaw);
      const cz = Math.sin(this.camYaw);
      // On a tall phone screen sit a little higher so more road shows.
      // Faster: a little further back and lower, for a sense of speed.
      const sr = Math.min(1, speedR);
      const dist = (near ? 82 : portrait ? 120 : 132) + 14 * sr;
      const height = (near ? (portrait ? 42 : 34) : portrait ? 72 : 60) - 6 * sr;
      const ahead = near ? 90 : portrait ? 40 : 70;
      // Look a little into the turn
      this.lookSide += (Math.max(-40, Math.min(40, this.yawRate * 28)) - this.lookSide) * smooth(4, dt);
      const sx = -cz * this.lookSide;
      const sz = cx * this.lookSide;
      target.set(me.x - cx * dist, height, me.y - cz * dist);
      look.set(me.x + cx * ahead + sx, near ? 16 : portrait ? 8 : 18, me.y + cz * ahead + sz);
      fov += 9 * Math.min(1, speedR) ** 1.5;
    }
    if (!victory && !intro) fov += this.fovKick;
    if (this.blendT > 0) posK = Math.min(posK, 6);

    if (!intro) {
      const k = smooth(posK, dt);
      this.camPos.lerp(target, k);
      this.camLook.lerp(look, Math.min(1, k * 1.4));
    }
    this.fov += (fov - this.fov) * smooth(this.fovKick > 7 ? 10 : 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.camPos);
    if (!intro && !victory) this.camera.position.y -= this.dip;
    if (f.shake > 0) {
      // Smooth shake: sums of sine waves instead of random jitter
      const t = now / 1000;
      const nz = (a: number) => Math.sin(t * 23 + a) * 0.5 + Math.sin(t * 31 + a * 2.3) * 0.3 + Math.sin(t * 41 + a * 3.1) * 0.2;
      const s = f.shake * 0.25;
      this.camera.position.x += nz(0) * s;
      this.camera.position.y += nz(1.7) * s * 0.5;
      this.camera.position.z += nz(3.4) * s;
    }
    if (this.camera.position.y < 6) this.camera.position.y = 6;
    this.camera.lookAt(this.camLook);
    // Driver's seat: roll a little with the turn, and more in drifts
    if (f.mode === 'driver' && !f.lookBack && !victory) {
      const roll = Math.max(-0.06, Math.min(0.06, -this.yawRate * 0.03)) + (me.drifting ? me.driftDir * 0.05 : 0);
      this.camera.rotateZ(roll);
    }
  }

  dispose() {
    for (const c of [...this.world.children]) disposeTree(c);
    for (const k of this.karts.values()) disposeTree(k.group);
    this.renderer.dispose();
  }
}
