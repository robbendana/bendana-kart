// Extra 3D effects: tyre marks from drifting, fireworks, and the winners' stage.

import * as THREE from 'three';
import { glowTexture } from './kart3d';

// ---------------------------------------------------------------------------
// Tyre marks: dark strips laid down by drifting karts, fading after a few seconds
// ---------------------------------------------------------------------------

const SKID_CAP = 420; // strips kept at once (oldest are reused)
const SKID_LIFE = 5200; // ms before a strip has faded away

export class SkidMarks {
  mesh: THREE.Mesh;
  private pos = new Float32Array(SKID_CAP * 4 * 3);
  private col = new Float32Array(SKID_CAP * 4 * 4);
  private born = new Float64Array(SKID_CAP);
  private next = 0;
  private last = new Map<string, { lx: number; lz: number; rx: number; rz: number; at: number }>();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx: number[] = [];
    for (let i = 0; i < SKID_CAP; i++) {
      const a = i * 4;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.born.fill(-1e9);
  }

  clear() {
    this.col.fill(0);
    this.born.fill(-1e9);
    this.last.clear();
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private strip(x0: number, z0: number, x1: number, z1: number, now: number) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l = Math.hypot(dx, dz);
    if (l < 0.5) return;
    const nx = (-dz / l) * 2.6;
    const nz = (dx / l) * 2.6;
    const i = this.next;
    this.next = (i + 1) % SKID_CAP;
    const p = this.pos;
    const o = i * 12;
    p[o] = x0 - nx; p[o + 1] = 0.75; p[o + 2] = z0 - nz;
    p[o + 3] = x0 + nx; p[o + 4] = 0.75; p[o + 5] = z0 + nz;
    p[o + 6] = x1 - nx; p[o + 7] = 0.75; p[o + 8] = z1 - nz;
    p[o + 9] = x1 + nx; p[o + 10] = 0.75; p[o + 11] = z1 + nz;
    this.born[i] = now;
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Call once per frame with every kart; lays strips behind the ones that are sliding. */
  update(now: number, karts: { id: string; x: number; y: number; yaw: number; speed: number; drifting: boolean; spinning: boolean; air?: number }[]) {
    const seen = new Set<string>();
    for (const k of karts) {
      const sliding = (k.drifting || k.spinning) && k.speed > 90 && (k.air ?? 0) < 2;
      if (!sliding) continue;
      seen.add(k.id);
      const c = Math.cos(k.yaw);
      const s = Math.sin(k.yaw);
      const bx = k.x - c * 15;
      const bz = k.y - s * 15;
      const lx = bx + s * 12;
      const lz = bz - c * 12;
      const rx = bx - s * 12;
      const rz = bz + c * 12;
      const prev = this.last.get(k.id);
      if (prev && now - prev.at < 200 && Math.hypot(lx - prev.lx, lz - prev.lz) < 80) {
        if (Math.hypot(lx - prev.lx, lz - prev.lz) < 6) continue; // wait until it has moved a bit
        this.strip(prev.lx, prev.lz, lx, lz, now);
        this.strip(prev.rx, prev.rz, rx, rz, now);
      }
      this.last.set(k.id, { lx, lz, rx, rz, at: now });
    }
    for (const id of [...this.last.keys()]) if (!seen.has(id) && now - (this.last.get(id)?.at ?? 0) > 200) this.last.delete(id);
    // Fade
    const col = this.col;
    for (let i = 0; i < SKID_CAP; i++) {
      const a = Math.max(0, 1 - (now - this.born[i]) / SKID_LIFE) * 0.5;
      const o = i * 16;
      if (col[o + 3] === 0 && a === 0) continue;
      for (let v = 0; v < 4; v++) {
        col[o + v * 4] = 0.05;
        col[o + v * 4 + 1] = 0.05;
        col[o + v * 4 + 2] = 0.06;
        col[o + v * 4 + 3] = a;
      }
    }
    (this.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Fireworks: rockets that burst into falling sparks
// ---------------------------------------------------------------------------

const FW_CAP = 700;

export class Fireworks {
  points: THREE.Points;
  private pos = new Float32Array(FW_CAP * 3);
  private col = new Float32Array(FW_CAP * 3);
  private vel = new Float32Array(FW_CAP * 3);
  private life = new Float32Array(FW_CAP);
  private max = new Float32Array(FW_CAP);
  private base = new Float32Array(FW_CAP * 3);
  private next = 0;
  private c = new THREE.Color();

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 22, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    this.pos.fill(-99999);
  }

  burst(x: number, y: number, z: number, hue: number, count = 70, power = 150) {
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (k + 1) % FW_CAP;
      // Even directions on a sphere
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = power * (0.55 + Math.random() * 0.45);
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = y;
      this.pos[k * 3 + 2] = z;
      this.vel[k * 3] = Math.cos(a) * r * sp;
      this.vel[k * 3 + 1] = u * sp + 40;
      this.vel[k * 3 + 2] = Math.sin(a) * r * sp;
      this.max[k] = this.life[k] = 1.1 + Math.random() * 0.7;
      this.c.setHSL((hue + (Math.random() - 0.5) * 0.08 + 1) % 1, 1, i % 5 === 0 ? 0.85 : 0.6);
      this.base[k * 3] = this.c.r;
      this.base[k * 3 + 1] = this.c.g;
      this.base[k * 3 + 2] = this.c.b;
    }
  }

  update(dt: number) {
    let any = false;
    for (let k = 0; k < FW_CAP; k++) {
      if (this.life[k] <= 0) continue;
      any = true;
      this.life[k] -= dt;
      const drag = Math.exp(-1.6 * dt);
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * drag - 110 * dt;
      this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const f = Math.max(0, this.life[k] / this.max[k]);
      const b = f * f;
      this.col[k * 3] = this.base[k * 3] * b;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * b;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * b;
      if (this.life[k] <= 0) this.pos[k * 3 + 1] = -99999;
    }
    this.points.visible = any;
    if (any) {
      (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Winners' stage: a podium outside the track where the karts line up at the end
// ---------------------------------------------------------------------------

function numberTexture(n: string, bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, 0, 128, 14);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 96px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.fillText(n, 64, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Where each finishing place stands, relative to the stage centre: [x, height, z, turn] */
const SPOTS: [number, number, number, number][] = [
  [0, 54, 0, 0],
  [-84, 38, 4, -0.22],
  [84, 26, 4, 0.22],
  [-170, 9, 46, -0.42],
  [170, 9, 46, 0.42],
];

export class PodiumStage {
  group = new THREE.Group();
  private owned: { dispose: () => void }[] = [];
  private beams: THREE.Mesh[] = [];

  constructor(public cx: number, public cz: number, accent: string) {
    const g = this.group;
    g.position.set(cx, 0, cz);
    const lam = (color: THREE.ColorRepresentation) => {
      const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.owned.push(m);
      return m;
    };
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    // Round platform with a colored rim
    put(new THREE.CylinderGeometry(250, 262, 8, 40), lam(0xf1f5f9), 0, 4, 20);
    put(new THREE.CylinderGeometry(264, 270, 5, 40), lam(accent), 0, 2.5, 20);
    // Steps
    const golds = ['#fbbf24', '#cbd5e1', '#f59e0b'];
    const dark = ['#d97706', '#94a3b8', '#b45309'];
    for (let i = 0; i < 3; i++) {
      const [x, h, z] = SPOTS[i];
      const tex = numberTexture(String(i + 1), golds[i]);
      this.owned.push(tex);
      const front = new THREE.MeshBasicMaterial({ map: tex });
      this.owned.push(front);
      const side = lam(dark[i]);
      const top = lam(golds[i]);
      // BoxGeometry faces: +x, -x, +y, -y, +z, -z
      put(new THREE.BoxGeometry(82, h - 8, 86), [side, side, top, side, front, side], x, 8 + (h - 8) / 2, z);
    }
    // Backdrop: two towers, a checkered arch and a star
    const cc = document.createElement('canvas');
    cc.width = 384;
    cc.height = 32;
    const cg = cc.getContext('2d');
    if (cg) {
      for (let i = 0; i < 24; i++) {
        for (let j = 0; j < 2; j++) {
          cg.fillStyle = (i + j) % 2 ? '#111827' : '#ffffff';
          cg.fillRect(i * 16, j * 16, 16, 16);
        }
      }
    }
    const ct = new THREE.CanvasTexture(cc);
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.magFilter = THREE.NearestFilter;
    this.owned.push(ct);
    const checker = new THREE.MeshBasicMaterial({ map: ct });
    this.owned.push(checker);
    for (const s of [-1, 1]) {
      put(new THREE.BoxGeometry(18, 190, 18), lam(0xe2e8f0), s * 210, 95, -80);
      put(new THREE.BoxGeometry(24, 8, 24), lam(accent), s * 210, 60, -80);
      put(new THREE.BoxGeometry(24, 8, 24), lam(accent), s * 210, 130, -80);
      put(new THREE.SphereGeometry(14, 10, 8), lam(0xfacc15), s * 210, 204, -80);
    }
    put(new THREE.BoxGeometry(440, 30, 6), [checker, checker, checker, checker, checker, checker], 0, 176, -80);
    // Spotlight beams that sweep slowly
    for (const s of [-1, 0, 1]) {
      const geo = new THREE.ConeGeometry(46, 330, 14, 1, true);
      geo.translate(0, -165, 0);
      const mat = new THREE.MeshBasicMaterial({ color: s === 0 ? 0xfff3b0 : 0xbfdbfe, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      this.owned.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s * 150, 330, -60);
      m.renderOrder = 25;
      g.add(m);
      this.beams.push(m);
    }
    g.visible = false;
  }

  /** World position and facing for the racer who finished in `place` (0-based). */
  spot(place: number): { x: number; z: number; y: number; yaw: number } {
    const s = SPOTS[Math.min(place, SPOTS.length - 1)];
    return { x: this.cx + s[0], z: this.cz + s[2], y: s[1], yaw: Math.PI / 2 + s[3] };
  }

  update(now: number) {
    this.beams.forEach((b, i) => {
      b.rotation.z = Math.sin(now / 1300 + i * 2.1) * 0.35;
      b.rotation.x = 0.25 + Math.sin(now / 1700 + i) * 0.12;
    });
  }

  dispose() {
    for (const o of this.owned) o.dispose();
  }
}
