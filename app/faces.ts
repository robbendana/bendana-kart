// Hand-drawn cartoon faces for every racer, painted on a canvas so they work
// in the 3D race, the top-down view and the menus without image files.
// Each face has a set of expressions (blinks, a happy boost face, dizzy
// spin-outs, a cheering finish...) and its eyes can look left or right.

export type Expr = 'idle' | 'blink' | 'happy' | 'dizzy' | 'cheer' | 'ouch' | 'focus';
export const EXPRS: Expr[] = ['idle', 'blink', 'happy', 'dizzy', 'cheer', 'ouch', 'focus'];

type Top =
  | 'spikyHair' | 'dinoSpikes' | 'unicorn' | 'tuft' | 'antennaBulb' | 'bandana' | 'dragonHorns'
  | 'antenna2' | 'lionMane' | 'beeAntenna' | 'none';

type Spec = {
  skin: string;
  shape: 'round' | 'wide' | 'tall' | 'robot' | 'egg';
  ears?: { type: 'round' | 'pointy' | 'floppy' | 'long' | 'fin' | 'bolt'; color: string; inner?: string; tip?: string };
  top: Top;
  topColor?: string;
  muzzle?: { color: string; w: number; h: number; y: number };
  mask?: string; // gorilla face / penguin face: a light area over the eyes and mouth
  nose?: { type: 'dot' | 'triangle' | 'heart' | 'nostrils' | 'beak' | 'button'; color: string };
  eye: 'normal' | 'alien' | 'led';
  iris: string;
  lashes?: boolean;
  slit?: boolean;
  patches?: string;
  blush?: string;
  mark?: 'bolt' | 'spots' | 'scales' | 'freckles';
  markColor?: string;
  fangs?: boolean;
  buckTeeth?: boolean;
  whiskers?: boolean;
  wings?: boolean;
  stripe?: string;
};

const INK = '#231a33';

// Keyed by the racer's emoji so every part of the game can find the face.
const SPECS: Record<string, Spec> = {
  '🏎️': {
    skin: '#f6c9a3', shape: 'round', ears: { type: 'round', color: '#f6c9a3', inner: '#e9a988' }, top: 'spikyHair', topColor: '#ef4444',
    nose: { type: 'button', color: '#e9a07c' }, eye: 'normal', iris: '#2563eb', blush: '#fb7185', mark: 'bolt', markColor: '#facc15',
  },
  '🦖': {
    skin: '#4ade80', shape: 'wide', top: 'dinoSpikes', topColor: '#facc15', muzzle: { color: '#bbf7d0', w: 1.0, h: 0.42, y: 0.42 },
    nose: { type: 'nostrils', color: '#166534' }, eye: 'normal', iris: '#f59e0b', fangs: true, mark: 'spots', markColor: '#22c55e',
  },
  '🦄': {
    skin: '#fdf4ff', shape: 'round', ears: { type: 'pointy', color: '#fdf4ff', inner: '#f9a8d4' }, top: 'unicorn', topColor: '#fcd34d',
    muzzle: { color: '#fbcfe8', w: 0.62, h: 0.36, y: 0.5 }, nose: { type: 'nostrils', color: '#db2777' }, eye: 'normal', iris: '#a855f7',
    lashes: true, blush: '#f472b6',
  },
  '🦍': {
    skin: '#4b5563', shape: 'wide', ears: { type: 'round', color: '#4b5563', inner: '#c8a68a' }, top: 'tuft', topColor: '#374151',
    mask: '#d9b99b', nose: { type: 'nostrils', color: '#3f2d22' }, eye: 'normal', iris: '#7c2d12',
  },
  '🤖': {
    skin: '#cbd5e1', shape: 'robot', ears: { type: 'bolt', color: '#94a3b8' }, top: 'antennaBulb', topColor: '#ef4444',
    eye: 'led', iris: '#22d3ee', blush: '#f472b6',
  },
  '🐶': {
    skin: '#f2b46a', shape: 'round', ears: { type: 'floppy', color: '#92400e' }, top: 'none',
    muzzle: { color: '#fff7ed', w: 0.78, h: 0.46, y: 0.42 }, nose: { type: 'dot', color: '#1f1720' }, eye: 'normal', iris: '#7c3f12',
    patches: '#c47a2c', blush: '#fb923c',
  },
  '🐱': {
    skin: '#f9a8d4', shape: 'wide', ears: { type: 'pointy', color: '#f9a8d4', inner: '#fdf2f8' }, top: 'none',
    muzzle: { color: '#fdf2f8', w: 0.6, h: 0.32, y: 0.45 }, nose: { type: 'heart', color: '#db2777' }, eye: 'normal', iris: '#16a34a',
    slit: true, whiskers: true, blush: '#ec4899', lashes: true,
  },
  '🐰': {
    skin: '#f1f5f9', shape: 'round', ears: { type: 'long', color: '#f1f5f9', inner: '#f9a8d4' }, top: 'none',
    muzzle: { color: '#ffffff', w: 0.58, h: 0.34, y: 0.45 }, nose: { type: 'heart', color: '#f472b6' }, eye: 'normal', iris: '#3b82f6',
    buckTeeth: true, blush: '#f9a8d4', whiskers: true,
  },
  '🐢': {
    skin: '#86efac', shape: 'egg', top: 'bandana', topColor: '#f97316', nose: { type: 'nostrils', color: '#166534' }, eye: 'normal',
    iris: '#0f766e', mark: 'spots', markColor: '#4ade80', blush: '#fb923c',
  },
  '🐧': {
    skin: '#1e293b', shape: 'round', top: 'tuft', topColor: '#1e293b', mask: '#f8fafc', nose: { type: 'beak', color: '#f59e0b' },
    eye: 'normal', iris: '#0ea5e9', blush: '#fb7185',
  },
  '🐉': {
    skin: '#ef4444', shape: 'wide', ears: { type: 'fin', color: '#f97316' }, top: 'dragonHorns', topColor: '#fde68a',
    muzzle: { color: '#fecaca', w: 0.84, h: 0.4, y: 0.42 }, nose: { type: 'nostrils', color: '#7f1d1d' }, eye: 'normal', iris: '#facc15',
    slit: true, fangs: true, mark: 'scales', markColor: '#dc2626',
  },
  '👽': {
    skin: '#a3e635', shape: 'egg', top: 'antenna2', topColor: '#a3e635', eye: 'alien', iris: '#111827', blush: '#4d7c0f',
  },
  '🦊': {
    skin: '#f97316', shape: 'wide', ears: { type: 'pointy', color: '#f97316', inner: '#fff7ed', tip: '#3f2a1d' }, top: 'none',
    muzzle: { color: '#fff7ed', w: 0.95, h: 0.45, y: 0.4 }, nose: { type: 'dot', color: '#1f1720' }, eye: 'normal', iris: '#b45309',
    whiskers: true,
  },
  '🐼': {
    skin: '#ffffff', shape: 'round', ears: { type: 'round', color: '#1f2937', inner: '#1f2937' }, top: 'none',
    muzzle: { color: '#ffffff', w: 0.6, h: 0.34, y: 0.45 }, nose: { type: 'dot', color: '#1f2937' }, eye: 'normal', iris: '#1f2937',
    patches: '#1f2937', blush: '#f9a8d4',
  },
  '🦁': {
    skin: '#fcd34d', shape: 'round', ears: { type: 'round', color: '#f59e0b', inner: '#fde68a' }, top: 'lionMane', topColor: '#c2410c',
    muzzle: { color: '#fef3c7', w: 0.72, h: 0.4, y: 0.44 }, nose: { type: 'triangle', color: '#7c2d12' }, eye: 'normal', iris: '#92400e',
    whiskers: true,
  },
  '🐝': {
    skin: '#fde047', shape: 'round', top: 'beeAntenna', topColor: '#1f2937', nose: { type: 'button', color: '#facc15' },
    eye: 'normal', iris: '#1f2937', blush: '#fb923c', wings: true, stripe: '#1f2937',
  },
};

export const hasFace = (emoji: string) => !!SPECS[emoji];

// ----- small helpers --------------------------------------------------------

function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

type G = CanvasRenderingContext2D;

function ell(g: G, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient | null, stroke = true, lw = 6, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }
}

function poly(g: G, pts: number[][], fill: string | null, stroke = true, lw = 6) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.lineJoin = 'round';
    g.stroke();
  }
}

function line(g: G, pts: number[][], lw = 6, color = INK) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.lineWidth = lw;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

function star(g: G, x: number, y: number, r: number, fill: string) {
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  poly(g, pts, fill, true, 4);
}

function spiral(g: G, x: number, y: number, r: number, color: string, dir: number) {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = dir * t * Math.PI * 4.2;
    const rr = r * t;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.lineWidth = 5;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.stroke();
}

// ----- the face painter ----------------------------------------------------

const S = 256;
const CX = 128;
const CY = 138;
const R = 86;

function headPath(g: G, sp: Spec) {
  g.beginPath();
  if (sp.shape === 'robot') {
    const w = R * 1.9;
    const h = R * 1.75;
    const x = CX - w / 2;
    const y = CY - h / 2;
    const r = 34;
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  } else if (sp.shape === 'egg') {
    // wide forehead, narrower chin
    g.moveTo(CX, CY - R * 1.02);
    g.bezierCurveTo(CX + R * 1.25, CY - R * 1.0, CX + R * 1.0, CY + R * 0.85, CX, CY + R * 0.95);
    g.bezierCurveTo(CX - R * 1.0, CY + R * 0.85, CX - R * 1.25, CY - R * 1.0, CX, CY - R * 1.02);
    g.closePath();
  } else if (sp.shape === 'wide') {
    g.ellipse(CX, CY + 4, R * 1.1, R * 0.92, 0, 0, Math.PI * 2);
  } else {
    g.ellipse(CX, CY, R, R * 0.98, 0, 0, Math.PI * 2);
  }
}

function drawBehind(g: G, sp: Spec) {
  const tc = sp.topColor ?? INK;
  if (sp.top === 'lionMane') {
    const n = 16;
    const pts: number[][] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const rr = i % 2 ? R * 1.18 : R * 1.42;
      pts.push([CX + Math.cos(a) * rr, CY + Math.sin(a) * rr * 0.98]);
    }
    poly(g, pts, tc);
    const pts2 = pts.map(([x, y]) => [CX + (x - CX) * 0.86, CY + (y - CY) * 0.86]);
    poly(g, pts2, shade(tc, 0.25), false);
  }
  if (sp.wings) {
    for (const s of [-1, 1]) {
      ell(g, CX + s * R * 1.0, CY - R * 0.55, R * 0.42, R * 0.28, 'rgba(186,230,253,0.85)', true, 5, s * -0.6);
      ell(g, CX + s * R * 0.92, CY - R * 0.2, R * 0.3, R * 0.2, 'rgba(186,230,253,0.85)', true, 5, s * -0.2);
    }
  }
  if (sp.top === 'unicorn') {
    // rainbow mane flowing down one side and over the back
    const cols = ['#f472b6', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa'];
    cols.forEach((c, i) => {
      ell(g, CX - R * 0.78 + i * 6, CY - R * 0.35 + i * 18, R * 0.36, R * 0.24, c, true, 4, -0.5);
    });
  }
  const e = sp.ears;
  if (e) {
    for (const s of [-1, 1]) {
      if (e.type === 'round') {
        ell(g, CX + s * R * 0.86, CY - R * 0.72, R * 0.34, R * 0.34, e.color);
        if (e.inner) ell(g, CX + s * R * 0.86, CY - R * 0.72, R * 0.18, R * 0.18, e.inner, false);
      } else if (e.type === 'pointy') {
        const bx = CX + s * R * 0.62;
        poly(g, [[bx - s * R * 0.36, CY - R * 0.62], [bx + s * R * 0.42, CY - R * 1.38], [bx + s * R * 0.42, CY - R * 0.36]], e.color);
        if (e.inner) poly(g, [[bx - s * R * 0.14, CY - R * 0.66], [bx + s * R * 0.32, CY - R * 1.16], [bx + s * R * 0.3, CY - R * 0.52]], e.inner, false);
        if (e.tip) poly(g, [[bx + s * R * 0.2, CY - R * 1.1], [bx + s * R * 0.42, CY - R * 1.38], [bx + s * R * 0.42, CY - R * 1.06]], e.tip, false);
      } else if (e.type === 'long') {
        for (const [col, sc] of [[e.color, 1], [e.inner ?? e.color, 0.55]] as [string, number][]) {
          ell(g, CX + s * R * 0.42, CY - R * 1.25, R * 0.26 * sc, R * 0.72 * (sc === 1 ? 1 : 0.8), col, sc === 1, 6, s * 0.18);
        }
      } else if (e.type === 'fin') {
        const bx = CX + s * R * 0.95;
        poly(g, [[bx, CY - R * 0.4], [bx + s * R * 0.55, CY - R * 0.75], [bx + s * R * 0.4, CY - R * 0.25], [bx + s * R * 0.55, CY - R * 0.05], [bx, CY + R * 0.05]], e.color);
      } else if (e.type === 'bolt') {
        ell(g, CX + s * R * 1.0, CY, R * 0.2, R * 0.3, e.color);
        ell(g, CX + s * R * 1.08, CY, R * 0.08, R * 0.14, shade(e.color, -0.3), false);
      }
    }
  }
  if (sp.top === 'dinoSpikes') {
    for (let i = -2; i <= 2; i++) {
      const x = CX + i * R * 0.32;
      const y = CY - R * 0.82 + Math.abs(i) * R * 0.12;
      poly(g, [[x - R * 0.16, y + R * 0.1], [x, y - R * 0.34], [x + R * 0.16, y + R * 0.1]], tc);
    }
  }
  if (sp.top === 'dragonHorns') {
    for (const s of [-1, 1]) {
      poly(g, [[CX + s * R * 0.3, CY - R * 0.7], [CX + s * R * 0.62, CY - R * 1.42], [CX + s * R * 0.62, CY - R * 0.62]], tc);
    }
  }
  if (sp.top === 'antenna2' || sp.top === 'beeAntenna') {
    for (const s of [-1, 1]) {
      const tx = CX + s * R * 0.62;
      const ty = CY - R * 1.38;
      g.beginPath();
      g.moveTo(CX + s * R * 0.25, CY - R * 0.85);
      g.quadraticCurveTo(CX + s * R * 0.35, CY - R * 1.3, tx, ty);
      g.lineWidth = 7;
      g.strokeStyle = INK;
      g.stroke();
      ell(g, tx, ty, R * 0.14, R * 0.14, sp.top === 'beeAntenna' ? '#1f2937' : '#d9f99d');
    }
  }
  if (sp.top === 'antennaBulb') {
    line(g, [[CX, CY - R * 0.85], [CX, CY - R * 1.3]], 7);
    ell(g, CX, CY - R * 1.36, R * 0.16, R * 0.16, tc);
    ell(g, CX - R * 0.05, CY - R * 1.41, R * 0.05, R * 0.05, 'rgba(255,255,255,0.8)', false);
  }
}

function drawHead(g: G, sp: Spec) {
  const grd = g.createRadialGradient(CX - R * 0.35, CY - R * 0.45, R * 0.1, CX, CY, R * 1.15);
  grd.addColorStop(0, shade(sp.skin, 0.25));
  grd.addColorStop(0.6, sp.skin);
  grd.addColorStop(1, shade(sp.skin, -0.18));
  headPath(g, sp);
  g.fillStyle = grd;
  g.fill();
  // Details clipped to the head
  g.save();
  headPath(g, sp);
  g.clip();
  if (sp.stripe) {
    g.fillStyle = sp.stripe;
    g.fillRect(0, CY - R * 0.98, S, R * 0.28);
    g.fillRect(0, CY + R * 0.72, S, R * 0.3);
  }
  if (sp.mask) {
    // light face area: two eye lobes and a chin
    g.fillStyle = sp.mask;
    g.beginPath();
    g.ellipse(CX - R * 0.36, CY - R * 0.08, R * 0.46, R * 0.42, 0, 0, Math.PI * 2);
    g.ellipse(CX + R * 0.36, CY - R * 0.08, R * 0.46, R * 0.42, 0, 0, Math.PI * 2);
    g.ellipse(CX, CY + R * 0.38, R * 0.66, R * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (sp.mark === 'spots' || sp.mark === 'scales') {
    g.fillStyle = sp.markColor ?? shade(sp.skin, -0.2);
    const spots = sp.mark === 'spots'
      ? [[-0.55, -0.6, 0.12], [-0.3, -0.78, 0.08], [0.6, -0.5, 0.1], [0.75, -0.2, 0.07], [-0.78, -0.15, 0.08]]
      : [[-0.3, -0.75, 0.1], [0, -0.82, 0.1], [0.3, -0.75, 0.1], [-0.15, -0.6, 0.09], [0.15, -0.6, 0.09]];
    for (const [x, y, r] of spots) {
      g.beginPath();
      g.ellipse(CX + x * R, CY + y * R, r * R, r * R * (sp.mark === 'scales' ? 0.7 : 1), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (sp.top === 'bandana') {
    g.fillStyle = sp.topColor ?? '#f97316';
    g.fillRect(0, CY - R * 0.78, S, R * 0.3);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(CX - R + i * R * 0.4, CY - R * 0.63, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  headPath(g, sp);
  g.lineWidth = 7;
  g.strokeStyle = INK;
  g.stroke();
  if (sp.top === 'bandana') {
    // knot tails at the side
    poly(g, [[CX + R * 0.86, CY - R * 0.62], [CX + R * 1.32, CY - R * 0.86], [CX + R * 1.2, CY - R * 0.5]], sp.topColor ?? '#f97316', true, 5);
    poly(g, [[CX + R * 0.86, CY - R * 0.62], [CX + R * 1.28, CY - R * 0.3], [CX + R * 1.05, CY - R * 0.2]], sp.topColor ?? '#f97316', true, 5);
  }
  if (sp.shape === 'robot') {
    // dark visor across the eyes and a mouth grille panel
    const w = R * 1.5;
    const h = R * 0.62;
    g.beginPath();
    g.roundRect(CX - w / 2, CY - R * 0.48, w, h, 22);
    g.fillStyle = '#1e293b';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    g.roundRect(CX - R * 0.5, CY + R * 0.32, R, R * 0.36, 14);
    g.fillStyle = '#1e293b';
    g.fill();
    g.stroke();
    for (const s of [-1, 1]) ell(g, CX + s * R * 0.8, CY + R * 0.62, R * 0.07, R * 0.07, '#94a3b8', false);
  }
  if (sp.patches) {
    for (const s of [-1, 1]) {
      if (sp.patches === '#1f2937' || s < 0) {
        ell(g, CX + s * R * 0.36, CY - R * 0.06, R * 0.3, R * 0.36, sp.patches, false, 0, s * -0.5);
      }
    }
  }
  if (sp.muzzle) {
    const m = sp.muzzle;
    ell(g, CX, CY + R * m.y, R * m.w * 0.7, R * m.h * 0.75, m.color, true, 5);
  }
  if (sp.mark === 'bolt') {
    poly(g, [[CX + R * 0.62, CY + R * 0.08], [CX + R * 0.5, CY + R * 0.3], [CX + R * 0.6, CY + R * 0.3], [CX + R * 0.5, CY + R * 0.52], [CX + R * 0.74, CY + R * 0.22], [CX + R * 0.64, CY + R * 0.22], [CX + R * 0.74, CY + R * 0.08]], sp.markColor ?? '#facc15', true, 3);
  }
  if (sp.mark === 'freckles') {
    g.fillStyle = shade(sp.skin, -0.3);
    for (const s of [-1, 1]) for (const [dx, dy] of [[0.5, 0.2], [0.6, 0.28], [0.45, 0.32]]) {
      g.beginPath();
      g.arc(CX + s * dx * R, CY + dy * R, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Hair and horns that sit on top of the head
  const tc = sp.topColor ?? INK;
  if (sp.top === 'spikyHair') {
    const pts: number[][] = [[CX - R * 0.98, CY - R * 0.05]];
    const spikes = 6;
    for (let i = 0; i <= spikes; i++) {
      const t = i / spikes;
      const a = Math.PI + t * Math.PI;
      const rr = R * 1.02;
      pts.push([CX + Math.cos(a) * rr, CY + Math.sin(a) * rr * 0.98]);
      if (i < spikes) {
        const a2 = a + Math.PI / spikes / 2;
        pts.push([CX + Math.cos(a2) * R * 1.42, CY + Math.sin(a2) * R * 1.32 - 6]);
      }
    }
    pts.push([CX + R * 0.98, CY - R * 0.05], [CX + R * 0.7, CY - R * 0.5], [CX + R * 0.3, CY - R * 0.42], [CX, CY - R * 0.58], [CX - R * 0.35, CY - R * 0.4], [CX - R * 0.72, CY - R * 0.5]);
    poly(g, pts, tc, true, 6);
    poly(g, [[CX - R * 0.3, CY - R * 1.02], [CX - R * 0.05, CY - R * 1.2], [CX + R * 0.05, CY - R * 0.92]], shade(tc, 0.35), false);
  }
  if (sp.top === 'tuft') {
    poly(g, [[CX - R * 0.22, CY - R * 0.9], [CX - R * 0.1, CY - R * 1.25], [CX + R * 0.02, CY - R * 0.95], [CX + R * 0.18, CY - R * 1.2], [CX + R * 0.22, CY - R * 0.88]], tc, true, 5);
  }
  if (sp.top === 'unicorn') {
    // golden spiral horn and a fringe
    poly(g, [[CX - R * 0.17, CY - R * 0.82], [CX + R * 0.05, CY - R * 1.62], [CX + R * 0.2, CY - R * 0.8]], tc);
    for (let i = 1; i <= 3; i++) line(g, [[CX - R * 0.15 + i * 0.05 * R, CY - R * (0.82 + i * 0.19)], [CX + R * 0.17 - i * 0.02 * R, CY - R * (0.74 + i * 0.19)]], 4);
    ell(g, CX - R * 0.42, CY - R * 0.76, R * 0.32, R * 0.2, '#f472b6', true, 4, -0.4);
    ell(g, CX - R * 0.1, CY - R * 0.84, R * 0.24, R * 0.16, '#a78bfa', true, 4, 0.2);
  }
}

function eyePos(sp: Spec): { dx: number; y: number; rx: number; ry: number } {
  if (sp.eye === 'alien') return { dx: R * 0.42, y: CY - R * 0.05, rx: R * 0.3, ry: R * 0.38 };
  if (sp.eye === 'led') return { dx: R * 0.38, y: CY - R * 0.17, rx: R * 0.2, ry: R * 0.2 };
  const wide = sp.shape === 'wide';
  return { dx: R * (wide ? 0.4 : 0.36), y: CY - R * 0.1, rx: R * 0.22, ry: R * 0.27 };
}

function drawEyes(g: G, sp: Spec, ex: Expr, look: number) {
  const { dx, y, rx, ry } = eyePos(sp);
  const led = sp.eye === 'led';
  const alien = sp.eye === 'alien';
  const lineCol = led ? sp.iris : INK;
  const glow = (on: boolean) => {
    g.shadowColor = on ? sp.iris : 'transparent';
    g.shadowBlur = on ? 14 : 0;
  };
  for (const s of [-1, 1]) {
    const x = CX + s * dx;
    glow(led);
    if (ex === 'blink') {
      g.beginPath();
      g.arc(x, y - ry * 0.3, rx * 0.9, Math.PI * 0.15, Math.PI * 0.85);
      g.lineWidth = 7;
      g.strokeStyle = lineCol;
      g.lineCap = 'round';
      g.stroke();
      if (sp.lashes) line(g, [[x + s * rx * 0.85, y + ry * 0.15], [x + s * rx * 1.2, y + ry * 0.05]], 5);
    } else if (ex === 'happy') {
      g.beginPath();
      g.arc(x, y + ry * 0.35, rx * 0.9, Math.PI * 1.15, Math.PI * 1.85);
      g.lineWidth = 8;
      g.strokeStyle = lineCol;
      g.lineCap = 'round';
      g.stroke();
    } else if (ex === 'cheer') {
      glow(false);
      star(g, x, y, rx * 1.15, led ? sp.iris : '#facc15');
      ell(g, x - rx * 0.25, y - ry * 0.2, rx * 0.16, rx * 0.16, 'rgba(255,255,255,0.9)', false);
    } else if (ex === 'dizzy') {
      if (!led && !alien) ell(g, x, y, rx, ry, '#ffffff', true, 5);
      if (alien) ell(g, x, y, rx, ry, sp.iris, true, 5);
      spiral(g, x, y, rx * 0.85, led ? sp.iris : alien ? '#d9f99d' : INK, s);
    } else if (ex === 'ouch') {
      line(g, [[x - s * rx * 0.8, y - ry * 0.55], [x + s * rx * 0.5, y], [x - s * rx * 0.8, y + ry * 0.55]], 8, lineCol);
    } else {
      // idle and focus: open eyes with pupils that can look sideways
      const lx = look * rx * 0.35;
      if (led) {
        g.beginPath();
        const h = ex === 'focus' ? ry * 0.7 : ry * 1.5;
        g.roundRect(x - rx * 0.75 + lx * 0.6, y - h / 2, rx * 1.5, h, 8);
        g.fillStyle = sp.iris;
        g.fill();
        glow(false);
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.fillRect(x - rx * 0.5 + lx * 0.6, y - h / 2 + 4, rx * 0.4, 4);
      } else if (alien) {
        ell(g, x, y, rx, ry, sp.iris, true, 5, s * 0.5);
        ell(g, x - rx * 0.3 + lx, y - ry * 0.35, rx * 0.26, ry * 0.2, 'rgba(255,255,255,0.9)', false);
        ell(g, x + rx * 0.25 + lx, y + ry * 0.3, rx * 0.1, rx * 0.1, 'rgba(255,255,255,0.7)', false);
      } else {
        ell(g, x, y, rx, ry, '#ffffff', true, 5);
        const pr = rx * 0.62;
        ell(g, x + lx, y + ry * 0.12, pr, pr * 1.05, sp.iris, false);
        if (sp.slit) ell(g, x + lx, y + ry * 0.12, pr * 0.25, pr * 0.85, INK, false);
        else ell(g, x + lx, y + ry * 0.12, pr * 0.55, pr * 0.58, INK, false);
        ell(g, x + lx - pr * 0.35, y - ry * 0.12, pr * 0.3, pr * 0.3, '#ffffff', false);
        if (sp.lashes) {
          line(g, [[x + s * rx * 0.7, y - ry * 0.75], [x + s * rx * 1.15, y - ry * 1.05]], 5);
          line(g, [[x + s * rx * 0.95, y - ry * 0.35], [x + s * rx * 1.35, y - ry * 0.5]], 5);
        }
      }
      if (ex === 'focus' && !led) {
        // half-closed lids for a determined look
        g.save();
        g.beginPath();
        g.ellipse(x, y, rx + 3, ry + 3, 0, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = alien ? shade(sp.skin, -0.1) : shade(sp.skin, -0.05);
        g.beginPath();
        g.moveTo(x - rx * 1.2, y - ry * 1.2);
        g.lineTo(x + rx * 1.2, y - ry * 1.2);
        g.lineTo(x + rx * 1.2, y - ry * 0.1 + s * ry * 0.25);
        g.lineTo(x - rx * 1.2, y - ry * 0.1 - s * ry * 0.25);
        g.fill();
        g.restore();
        line(g, [[x - rx, y - ry * 0.1 - s * ry * 0.25], [x + rx, y - ry * 0.1 + s * ry * 0.25]], 6);
      }
    }
    glow(false);
  }
  // Eyebrows (not for robots or aliens)
  if (!led && !alien) {
    const by = y - ry * 1.35;
    for (const s of [-1, 1]) {
      const x = CX + s * dx;
      let inner = 0;
      let outer = 0;
      if (ex === 'focus') { inner = 12; outer = -4; }
      else if (ex === 'ouch' || ex === 'dizzy') { inner = -10; outer = 6; }
      else if (ex === 'cheer' || ex === 'happy') { inner = -6; outer = -6; }
      const col = sp.mask || sp.skin === '#ffffff' || sp.patches ? INK : shade(sp.skin, -0.45);
      line(g, [[x - s * rx * 0.75, by + inner], [x + s * rx * 0.75, by + outer]], 7, col);
    }
  }
}

function drawNose(g: G, sp: Spec) {
  const n = sp.nose;
  if (!n) return;
  const m = sp.muzzle;
  const ny = m ? CY + R * (m.y - m.h * 0.35) : CY + R * 0.2;
  if (n.type === 'dot') {
    ell(g, CX, ny, R * 0.13, R * 0.1, n.color, true, 4);
    ell(g, CX - R * 0.04, ny - R * 0.04, R * 0.04, R * 0.03, 'rgba(255,255,255,0.7)', false);
  } else if (n.type === 'button') {
    ell(g, CX, ny, R * 0.08, R * 0.06, n.color, false);
  } else if (n.type === 'triangle') {
    poly(g, [[CX - R * 0.13, ny - R * 0.06], [CX + R * 0.13, ny - R * 0.06], [CX, ny + R * 0.1]], n.color, true, 4);
  } else if (n.type === 'heart') {
    g.beginPath();
    const s = R * 0.07;
    g.moveTo(CX, ny + s * 1.3);
    g.bezierCurveTo(CX - s * 2.2, ny - s * 0.2, CX - s, ny - s * 1.6, CX, ny - s * 0.4);
    g.bezierCurveTo(CX + s, ny - s * 1.6, CX + s * 2.2, ny - s * 0.2, CX, ny + s * 1.3);
    g.fillStyle = n.color;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
  } else if (n.type === 'nostrils') {
    for (const s of [-1, 1]) ell(g, CX + s * R * 0.12, ny, R * 0.045, R * 0.06, n.color, false, 0, s * 0.4);
  }
}

function drawMouth(g: G, sp: Spec, ex: Expr) {
  const m = sp.muzzle;
  const my = sp.shape === 'robot' ? CY + R * 0.5 : m ? CY + R * (m.y + m.h * 0.12) : sp.mask ? CY + R * 0.42 : CY + R * 0.4;
  const w = R * (sp.shape === 'wide' ? 0.36 : 0.3);
  const led = sp.eye === 'led';
  const col = led ? sp.iris : INK;
  if (led) {
    g.shadowColor = sp.iris;
    g.shadowBlur = 10;
  }
  if (sp.nose?.type === 'beak') {
    // Penguin: the beak opens for big expressions
    const open = ex === 'happy' || ex === 'cheer' ? R * 0.16 : ex === 'ouch' ? R * 0.1 : 0;
    const by = CY + R * 0.22;
    if (open > 0) {
      poly(g, [[CX - R * 0.2, by + 2], [CX + R * 0.2, by + 2], [CX, by + open + R * 0.16]], '#c2410c', true, 5);
      ell(g, CX, by + open * 0.6, R * 0.1, open * 0.4, '#f472b6', false);
    }
    poly(g, [[CX - R * 0.22, by], [CX + R * 0.22, by], [CX, by - R * 0.18]], sp.nose.color, true, 5);
    poly(g, [[CX - R * 0.2, by + 1], [CX + R * 0.2, by + 1], [CX, by + R * 0.16 - (open ? 0 : 2)]], shade(sp.nose.color, -0.15), true, 5);
    if (ex === 'dizzy') line(g, [[CX - R * 0.2, by + R * 0.3], [CX - R * 0.07, by + R * 0.25], [CX + R * 0.07, by + R * 0.32], [CX + R * 0.2, by + R * 0.26]], 5);
    g.shadowBlur = 0;
    return;
  }
  if (ex === 'idle' || ex === 'blink') {
    g.beginPath();
    g.arc(CX, my - w * 0.55, w, Math.PI * 0.2, Math.PI * 0.8);
    g.lineWidth = 7;
    g.strokeStyle = col;
    g.lineCap = 'round';
    g.stroke();
    if (sp.fangs) for (const s of [-1, 1]) poly(g, [[CX + s * w * 0.55, my - 4], [CX + s * w * 0.3, my - 4], [CX + s * w * 0.45, my + 10]], '#ffffff', true, 3);
    if (sp.buckTeeth) {
      g.beginPath();
      g.roundRect(CX - 10, my - 6, 20, 16, 3);
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.stroke();
      line(g, [[CX, my - 6], [CX, my + 10]], 3);
    }
  } else if (ex === 'happy' || ex === 'cheer') {
    const ww = ex === 'cheer' ? w * 1.25 : w * 1.05;
    const hh = ex === 'cheer' ? w * 1.15 : w * 0.85;
    g.beginPath();
    g.moveTo(CX - ww, my - hh * 0.25);
    g.quadraticCurveTo(CX, my - hh * 0.05, CX + ww, my - hh * 0.25);
    g.quadraticCurveTo(CX + ww * 0.8, my + hh, CX, my + hh);
    g.quadraticCurveTo(CX - ww * 0.8, my + hh, CX - ww, my - hh * 0.25);
    g.closePath();
    g.fillStyle = led ? '#0e7490' : '#7f1d1d';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = col;
    g.stroke();
    if (!led) {
      g.save();
      g.clip();
      ell(g, CX, my + hh * 0.85, ww * 0.6, hh * 0.45, '#fb7185', false);
      g.fillStyle = '#ffffff';
      g.fillRect(CX - ww, my - hh * 0.3, ww * 2, hh * 0.28);
      g.restore();
    }
    if (sp.fangs && !led) for (const s of [-1, 1]) poly(g, [[CX + s * ww * 0.7, my - hh * 0.18], [CX + s * ww * 0.45, my - hh * 0.18], [CX + s * ww * 0.58, my + hh * 0.2]], '#ffffff', true, 3);
  } else if (ex === 'dizzy') {
    const pts: number[][] = [];
    for (let i = 0; i <= 8; i++) pts.push([CX - w + (i / 8) * w * 2, my + Math.sin(i * 1.4) * 6]);
    line(g, pts, 6, col);
  } else if (ex === 'ouch') {
    ell(g, CX, my + 4, w * 0.38, w * 0.48, led ? '#0e7490' : '#7f1d1d', true, 6);
  } else if (ex === 'focus') {
    g.beginPath();
    g.roundRect(CX - w * 0.95, my - w * 0.3, w * 1.9, w * 0.6, 10);
    g.fillStyle = led ? '#0e7490' : '#ffffff';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = col;
    g.stroke();
    if (!led) line(g, [[CX - w * 0.9, my], [CX + w * 0.9, my]], 3);
  }
  g.shadowBlur = 0;
}

function drawCheeks(g: G, sp: Spec, ex: Expr) {
  if (sp.whiskers) {
    const m = sp.muzzle;
    const wy = m ? CY + R * m.y : CY + R * 0.35;
    for (const s of [-1, 1]) {
      line(g, [[CX + s * R * 0.5, wy - 4], [CX + s * R * 0.95, wy - 14]], 3);
      line(g, [[CX + s * R * 0.5, wy + 6], [CX + s * R * 0.98, wy + 6]], 3);
    }
  }
  if (sp.blush) {
    const strong = ex === 'happy' || ex === 'cheer' || ex === 'ouch';
    for (const s of [-1, 1]) {
      g.globalAlpha = strong ? 0.75 : 0.45;
      ell(g, CX + s * R * 0.62, CY + R * 0.28, R * 0.15, R * 0.09, sp.blush, false);
      g.globalAlpha = 1;
    }
  }
}

function paintFace(g: G, sp: Spec, ex: Expr, look: number) {
  g.clearRect(0, 0, S, S);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  drawBehind(g, sp);
  drawHead(g, sp);
  if (sp.ears?.type === 'floppy') {
    for (const sd of [-1, 1]) {
      ell(g, CX + sd * R * 0.92, CY - R * 0.12, R * 0.26, R * 0.55, sp.ears.color, true, 6, sd * 0.35);
      ell(g, CX + sd * R * 0.95, CY - R * 0.05, R * 0.12, R * 0.36, shade(sp.ears.color, 0.15), false, 0, sd * 0.35);
    }
  }
  drawCheeks(g, sp, ex);
  drawEyes(g, sp, ex, look);
  drawNose(g, sp);
  drawMouth(g, sp, ex);
  // Sweat drop when hurt, sparkles when cheering
  if (ex === 'ouch') {
    g.beginPath();
    const x = CX + R * 0.88;
    const y = CY - R * 0.55;
    g.moveTo(x, y - 18);
    g.quadraticCurveTo(x + 14, y + 4, x, y + 8);
    g.quadraticCurveTo(x - 14, y + 4, x, y - 18);
    g.fillStyle = '#7dd3fc';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
  }
  if (ex === 'cheer') {
    star(g, CX - R * 1.08, CY - R * 0.7, 12, '#fde047');
    star(g, CX + R * 1.1, CY - R * 0.45, 9, '#fde047');
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** A 256x256 canvas with the face drawn on it, or null for unknown racers. */
export function faceCanvas(emoji: string, ex: Expr = 'idle', look = 0): HTMLCanvasElement | null {
  const sp = SPECS[emoji];
  if (!sp || typeof document === 'undefined') return null;
  const lk = ex === 'idle' || ex === 'focus' ? Math.sign(look) : 0;
  const key = `${emoji}|${ex}|${lk}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (g) paintFace(g, sp, ex, lk);
  cache.set(key, c);
  return c;
}
