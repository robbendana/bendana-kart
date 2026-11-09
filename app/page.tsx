'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/* =========================================================================
   Bendana Kart: a family kart racer.
   Everything (track, physics, items, rendering, multiplayer) lives here.
   Multiplayer uses Supabase Realtime channels only (broadcast + presence).
   It never reads or writes any database table.
   ========================================================================= */

// ---------- World and race constants ----------
const WORLD_W = 2400;
const WORLD_H = 1600;
const HALF_W = 105; // half the road width, in world units
const LAPS = 3;
const SAMPLE_SPACING = 8;
const BOX_RESPAWN_MS = 6000;
const CHANNEL_PREFIX = 'bendana-kart:room:';
const KART_RADIUS = 26;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';
const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
// Realtime connection. The env vars win when set; otherwise the game uses the
// OgaVox project's public URL and publishable key (safe to ship in a browser).
// Only Realtime channels are used: no database tables are ever touched.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xesdaxactbxmhymzkqys.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_8MrTcMFPlAsSQTK2zGG5ag_Sdwd5Bno';

type KartSpec = {
  name: string;
  emoji: string;
  color: string;
  dark: string;
  maxSpeed: number;
  accel: number;
  turn: number;
  grip: number;
  blurb: string;
};

const KARTS: KartSpec[] = [
  { name: 'Red Flash', emoji: '🏎️', color: '#ef4444', dark: '#991b1b', maxSpeed: 570, accel: 410, turn: 2.7, grip: 7.5, blurb: 'Top speed' },
  { name: 'Dino Turbo', emoji: '🦖', color: '#22c55e', dark: '#166534', maxSpeed: 530, accel: 500, turn: 2.9, grip: 8, blurb: 'Fast starts' },
  { name: 'Cosmic Dash', emoji: '🦄', color: '#a855f7', dark: '#6b21a8', maxSpeed: 540, accel: 450, turn: 3.3, grip: 9.5, blurb: 'Best steering' },
  { name: 'Kong Kart', emoji: '🦍', color: '#f59e0b', dark: '#92400e', maxSpeed: 590, accel: 360, turn: 2.5, grip: 6.5, blurb: 'Big and strong' },
];

type ItemKind = 'rocket' | 'banana' | 'blast';
const ITEMS: Record<ItemKind, { emoji: string; label: string }> = {
  rocket: { emoji: '🚀', label: 'Turbo Rocket' },
  banana: { emoji: '🍌', label: 'Banana Peel' },
  blast: { emoji: '💥', label: 'Homing Blast' },
};
const ITEM_KINDS: ItemKind[] = ['rocket', 'banana', 'blast'];

// ---------- Small math helpers ----------
type Vec = { x: number; y: number };
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a: number) => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;
const randId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const roomCode = () => {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
  return s;
};
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const fmtTime = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${s.toString().padStart(2, '0')}.${d}`;
};
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Track geometry (closed Catmull-Rom spline through waypoints) ----------
const WAYPOINTS: Vec[] = [
  [300, 820], [300, 420], [480, 230], [780, 240], [940, 430], [1150, 560], [1360, 420], [1520, 230],
  [1860, 210], [2120, 360], [2160, 660], [1960, 830], [1700, 860], [1600, 1010], [1800, 1160], [2060, 1260],
  [2060, 1430], [1700, 1490], [1300, 1410], [1100, 1210], [850, 1150], [650, 1380], [400, 1410], [270, 1160],
].map(([x, y]) => ({ x, y }));

type Track = { xs: Float32Array; ys: Float32Array; tx: Float32Array; ty: Float32Array; n: number };

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildTrack(): Track {
  const raw: Vec[] = [];
  const m = WAYPOINTS.length;
  for (let i = 0; i < m; i++) {
    const p0 = WAYPOINTS[(i - 1 + m) % m];
    const p1 = WAYPOINTS[i];
    const p2 = WAYPOINTS[(i + 1) % m];
    const p3 = WAYPOINTS[(i + 2) % m];
    let len = 0;
    let prev = p1;
    for (let s = 1; s <= 24; s++) {
      const q = catmull(p0, p1, p2, p3, s / 24);
      len += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    const steps = Math.max(2, Math.ceil(len / SAMPLE_SPACING));
    for (let s = 0; s < steps; s++) raw.push(catmull(p0, p1, p2, p3, s / steps));
  }
  const n = raw.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = raw[i].x;
    ys[i] = raw[i].y;
  }
  for (let i = 0; i < n; i++) {
    const a = raw[(i - 1 + n) % n];
    const b = raw[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    tx[i] = (b.x - a.x) / l;
    ty[i] = (b.y - a.y) / l;
  }
  return { xs, ys, tx, ty, n };
}

const TRACK = buildTrack();

function nearestOnTrack(x: number, y: number, hint: number): { idx: number; dist: number } {
  const { xs, ys, n } = TRACK;
  let best = 0;
  let bd = Infinity;
  if (hint >= 0) {
    for (let o = -45; o <= 45; o++) {
      const i = (hint + o + n) % n;
      const dx = xs[i] - x;
      const dy = ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (Math.sqrt(bd) < HALF_W * 2.2) return { idx: best, dist: Math.sqrt(bd) };
    bd = Infinity;
  }
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - x;
    const dy = ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { idx: best, dist: Math.sqrt(bd) };
}

function gridPose(slot: number) {
  const { xs, ys, tx, ty, n } = TRACK;
  const row = Math.floor(slot / 2);
  const idx = (n - 14 - row * 11 + n) % n;
  const side = slot % 2 === 0 ? -42 : 42;
  const nx = -ty[idx];
  const ny = tx[idx];
  return { x: xs[idx] + nx * side, y: ys[idx] + ny * side, angle: Math.atan2(ty[idx], tx[idx]), idx };
}

// ---------- Canvas helpers ----------
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const spriteCache = new Map<string, HTMLCanvasElement>();
function emojiSprite(emoji: string, size: number): HTMLCanvasElement {
  const key = `${emoji}|${size}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  const px = Math.ceil(size * 2.5);
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  if (g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.floor(px * 0.78)}px ${EMOJI_FONT}`;
    g.fillText(emoji, px / 2, px / 2 + px * 0.05);
  }
  spriteCache.set(key, c);
  return c;
}
function drawEmoji(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, size: number) {
  ctx.drawImage(emojiSprite(emoji, size), x - size / 2, y - size / 2, size, size);
}

function traceTrack(ctx: CanvasRenderingContext2D) {
  const { xs, ys, n } = TRACK;
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.closePath();
}

let trackCanvasCache: HTMLCanvasElement | null = null;
function getTrackCanvas(): HTMLCanvasElement {
  if (trackCanvasCache) return trackCanvasCache;
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  // Mowed lawn stripes
  for (let x = 0; x < WORLD_W; x += 80) {
    ctx.fillStyle = (x / 80) % 2 === 0 ? '#5fbf5a' : '#6acb62';
    ctx.fillRect(x, 0, 80, WORLD_H);
  }
  // Hedge border
  ctx.strokeStyle = '#2f7d32';
  ctx.lineWidth = 44;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  // Scenery on the grass
  const rnd = mulberry32(11);
  const big = ['🌳', '🌲', '🌴', '🪨', '🏠'];
  const small = ['🌼', '🌷', '🍄', '🌻', '🌸'];
  for (let i = 0; i < 300; i++) {
    const x = 50 + rnd() * (WORLD_W - 100);
    const y = 50 + rnd() * (WORLD_H - 100);
    const isBig = rnd() < 0.4;
    const { dist } = nearestOnTrack(x, y, -1);
    if (dist < HALF_W + (isBig ? 70 : 40)) continue;
    const list = isBig ? big : small;
    const e = list[Math.floor(rnd() * list.length)];
    ctx.font = `${isBig ? 46 + rnd() * 22 : 20 + rnd() * 10}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(e, x, y);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Shadow, curbs, asphalt, centre line
  traceTrack(ctx);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = HALF_W * 2 + 44;
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = HALF_W * 2 + 24;
  ctx.stroke();
  ctx.setLineDash([30, 30]);
  ctx.strokeStyle = '#ef4444';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = HALF_W * 2;
  ctx.stroke();
  ctx.strokeStyle = '#535e6e';
  ctx.lineWidth = HALF_W * 1.3;
  ctx.stroke();
  ctx.setLineDash([40, 40]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.setLineDash([]);
  // Start / finish checkers
  const { xs, ys, tx, ty } = TRACK;
  ctx.save();
  ctx.translate(xs[0], ys[0]);
  ctx.rotate(Math.atan2(ty[0], tx[0]));
  const sq = 15;
  let col = 0;
  for (let yy = -HALF_W; yy < HALF_W; yy += sq) {
    for (let r = 0; r < 2; r++) {
      ctx.fillStyle = (col + r) % 2 === 0 ? '#ffffff' : '#111827';
      ctx.fillRect(-sq + r * sq, yy, sq, Math.min(sq, HALF_W - yy));
    }
    col++;
  }
  ctx.restore();
  trackCanvasCache = c;
  return c;
}

// ---------- Sound (generated tones, no audio files) ----------
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audioCtx = new Ctor();
    }
    if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}
function beep(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.04) {
  try {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {
    /* sound is optional */
  }
}

// ---------- Game state types ----------
type Kart = {
  id: string;
  name: string;
  kartIdx: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  steer: number;
  idx: number;
  lap: number;
  progress: number;
  offroad: boolean;
  item: ItemKind | null;
  rollT: number;
  boostT: number;
  spinT: number;
  spinA: number;
  toddler: boolean;
  bot: boolean;
  finished: boolean;
  finishTime: number;
  botTimer: number;
  lane: number;
  skill: number;
};

type Snap = { t: number; x: number; y: number; a: number };
type Remote = {
  id: string;
  name: string;
  kartIdx: number;
  toddler: boolean;
  snaps: Snap[];
  lastSeen: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  spinA: number;
  boost: boolean;
  lap: number;
  idx: number;
  progress: number;
  finished: boolean;
  finishTime: number;
};
type Box = { id: string; x: number; y: number; hiddenUntil: number };
type Banana = { id: string; x: number; y: number; owner: string; safeUntil: number };
type Blast = { id: string; x: number; y: number; angle: number; owner: string; target: string | null; life: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Input = { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean };

type Game = {
  mode: 'solo' | 'multi';
  meId: string;
  goAt: number;
  phase: 'countdown' | 'racing';
  karts: Kart[]; // karts simulated on this device (me first, then bots in solo)
  remotes: Map<string, Remote>;
  boxes: Box[];
  bananas: Banana[];
  blasts: Blast[];
  particles: Particle[];
  camX: number;
  camY: number;
  lastSend: number;
  sendInterval: number;
  lastBeep: number;
  send: (event: string, payload: Record<string, unknown>) => void;
};

type Racer = {
  id: string;
  name: string;
  kartIdx: number;
  x: number;
  y: number;
  progress: number;
  finished: boolean;
  finishTime: number;
  isMe: boolean;
};

function makeKart(id: string, name: string, kartIdx: number, slot: number, toddler: boolean, bot: boolean): Kart {
  const p = gridPose(slot);
  return {
    id, name, kartIdx,
    x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, steer: 0,
    idx: p.idx, lap: 0, progress: p.idx,
    offroad: false, item: null, rollT: 0, boostT: 0, spinT: 0, spinA: 0,
    toddler, bot, finished: false, finishTime: 0,
    botTimer: 1 + Math.random() * 2,
    lane: bot ? (Math.random() - 0.5) * 70 : 0,
    skill: bot ? 0.84 + Math.random() * 0.06 : 1,
  };
}

function makeBoxes(): Box[] {
  const { xs, ys, tx, ty, n } = TRACK;
  const out: Box[] = [];
  [0.13, 0.33, 0.52, 0.7, 0.88].forEach((f, i) => {
    const idx = Math.floor(f * n);
    const nx = -ty[idx];
    const ny = tx[idx];
    [-58, 0, 58].forEach((lane, j) => {
      out.push({ id: `b${i}_${j}`, x: xs[idx] + nx * lane, y: ys[idx] + ny * lane, hiddenUntil: 0 });
    });
  });
  return out;
}

function createGame(mode: 'solo' | 'multi', order: string[], meId: string, profile: Profile): Game {
  const now = performance.now();
  const karts: Kart[] = [];
  if (mode === 'solo') {
    const others = [0, 1, 2, 3].filter((i) => i !== profile.kartIdx);
    karts.push(makeKart(meId, profile.name || 'You', profile.kartIdx, 3, profile.toddler, false));
    others.forEach((k, i) => karts.push(makeKart(`bot${i}`, `${KARTS[k].name} Bot`, k, i, false, true)));
  } else {
    const slot = Math.max(0, order.indexOf(meId));
    karts.push(makeKart(meId, profile.name || 'Racer', profile.kartIdx, slot === -1 ? order.length : slot, profile.toddler, false));
  }
  const players = Math.max(1, order.length);
  return {
    mode, meId,
    goAt: now + 3200,
    phase: 'countdown',
    karts,
    remotes: new Map(),
    boxes: makeBoxes(),
    bananas: [],
    blasts: [],
    particles: [],
    camX: karts[0].x,
    camY: karts[0].y,
    lastSend: 0,
    // Supabase counts every broadcast once when sent and once per player who
    // receives it, against a 2 million per month free quota shared with the
    // rest of the project. So positions go out a few times a second and the
    // other screens smooth the gaps by interpolating.
    sendInterval: players <= 2 ? 150 : players === 3 ? 200 : 250,
    lastBeep: 4,
    send: () => undefined,
  };
}

function racers(G: Game): Racer[] {
  const list: Racer[] = G.karts.map((k) => ({
    id: k.id, name: k.name, kartIdx: k.kartIdx, x: k.x, y: k.y,
    progress: k.progress, finished: k.finished, finishTime: k.finishTime, isMe: k.id === G.meId,
  }));
  G.remotes.forEach((r) => {
    list.push({
      id: r.id, name: r.name, kartIdx: r.kartIdx, x: r.x, y: r.y,
      progress: r.progress, finished: r.finished, finishTime: r.finishTime, isMe: false,
    });
  });
  return list;
}

function rankRacers(list: Racer[]): Racer[] {
  return [...list].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

function spawnParticles(G: Game, x: number, y: number, count: number, colorFn: (i: number) => string, speed: number, life: number, size: number) {
  for (let i = 0; i < count; i++) {
    if (G.particles.length > 450) G.particles.shift();
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color: colorFn(i), size: size * (0.6 + Math.random() * 0.6) });
  }
}

function spinOut(G: Game, k: Kart) {
  if (k.toddler) return; // Toddler Assist karts are invincible
  k.spinT = 1;
  k.boostT = 0;
  spawnParticles(G, k.x, k.y, 14, () => '#fde047', 220, 0.6, 7);
  if (k.id === G.meId) beep(180, 0.35, 'sawtooth', 0.05);
}

function autopilot(k: Kart): { steer: number; throttle: number } {
  const { xs, ys, tx, ty, n } = TRACK;
  const speed = Math.hypot(k.vx, k.vy);
  const look = Math.round(9 + speed / 45);
  const j = (k.idx + look) % n;
  const px = xs[j] - ty[j] * k.lane;
  const py = ys[j] + tx[j] * k.lane;
  const diff = wrapAngle(Math.atan2(py - k.y, px - k.x) - k.angle);
  const steer = clamp(diff * 2.8, -1, 1);
  const ad = Math.abs(diff);
  const throttle = ad > 0.9 ? 0.25 : ad > 0.5 && speed > 320 ? 0.55 : 1;
  return { steer, throttle };
}

function drive(k: Kart, dt: number, throttleIn: number, brake: number, speedMul: number) {
  const st = KARTS[k.kartIdx];
  let throttle = throttleIn;
  let fx = Math.cos(k.angle);
  let fy = Math.sin(k.angle);
  let fwd = k.vx * fx + k.vy * fy;
  const lat0 = -k.vx * fy + k.vy * fx;
  const off = k.offroad && !k.toddler;
  let maxS = st.maxSpeed * speedMul * (off ? 0.42 : 1);
  let acc = st.accel;
  if (k.boostT > 0) {
    maxS = st.maxSpeed * 1.6 * speedMul;
    acc *= 2.4;
    throttle = 1;
  }
  if (throttle > 0 && fwd < maxS) fwd = Math.min(maxS, fwd + acc * throttle * dt);
  if (brake > 0) {
    if (fwd > 20) fwd -= 950 * brake * dt;
    else if (fwd > -st.maxSpeed * 0.35) fwd -= acc * 0.7 * brake * dt;
  }
  if (throttle === 0 && brake === 0) {
    const f = Math.min(Math.abs(fwd), 240 * dt);
    fwd -= Math.sign(fwd) * f;
  }
  // Going faster than allowed (for example after hitting the grass) decays quickly
  if (fwd > maxS) fwd = Math.max(maxS, fwd - (off ? 1500 : 500) * dt);
  fwd *= 1 - 0.12 * dt;
  const sf = clamp(Math.abs(fwd) / 160, 0, 1);
  const turnRate = st.turn * (1 - 0.25 * clamp(Math.abs(fwd) / st.maxSpeed, 0, 1.4));
  k.angle = wrapAngle(k.angle + k.steer * turnRate * sf * (fwd >= 0 ? 1 : -1) * dt);
  const lat = lat0 * Math.exp(-st.grip * dt);
  fx = Math.cos(k.angle);
  fy = Math.sin(k.angle);
  k.vx = fx * fwd - fy * lat;
  k.vy = fy * fwd + fx * lat;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  const m = 34;
  if (k.x < m) { k.x = m; k.vx = Math.abs(k.vx) * 0.3; }
  if (k.x > WORLD_W - m) { k.x = WORLD_W - m; k.vx = -Math.abs(k.vx) * 0.3; }
  if (k.y < m) { k.y = m; k.vy = Math.abs(k.vy) * 0.3; }
  if (k.y > WORLD_H - m) { k.y = WORLD_H - m; k.vy = -Math.abs(k.vy) * 0.3; }
}

function rollItem(place: number, total: number): ItemKind {
  const behind = total > 1 ? (place - 1) / (total - 1) : 0.5; // 0 = leader, 1 = last
  const pRocket = 0.2 + behind * 0.3;
  const pBanana = 0.55 - behind * 0.45;
  const r = Math.random();
  if (r < pRocket) return 'rocket';
  if (r < pRocket + pBanana) return 'banana';
  return 'blast';
}

function findTargetAhead(G: Game, k: Kart): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  for (const r of racers(G)) {
    if (r.id === k.id || r.finished) continue;
    const gap = r.progress - k.progress;
    if (gap > 0 && gap < bestGap) {
      bestGap = gap;
      best = r.id;
    }
  }
  return best;
}

function fireItem(G: Game, k: Kart, now: number) {
  if (!k.item || k.rollT > 0 || G.phase !== 'racing') return;
  const item = k.item;
  k.item = null;
  const fx = Math.cos(k.angle);
  const fy = Math.sin(k.angle);
  if (item === 'rocket') {
    k.boostT = 2;
    if (k.id === G.meId) beep(520, 0.25, 'triangle', 0.06);
  } else if (item === 'banana') {
    const b: Banana = { id: randId(), x: k.x - fx * 46, y: k.y - fy * 46, owner: k.id, safeUntil: now + 700 };
    G.bananas.push(b);
    G.send('banana_drop', { id: b.id, x: Math.round(b.x), y: Math.round(b.y), owner: b.owner });
    if (k.id === G.meId) beep(300, 0.12, 'square', 0.04);
  } else {
    const target = findTargetAhead(G, k);
    const bl: Blast = { id: randId(), x: k.x + fx * 40, y: k.y + fy * 40, angle: k.angle, owner: k.id, target, life: target ? 4 : 2.5 };
    G.blasts.push(bl);
    G.send('blast_fire', { id: bl.id, x: Math.round(bl.x), y: Math.round(bl.y), a: +bl.angle.toFixed(3), owner: bl.owner, target: bl.target });
    if (k.id === G.meId) beep(700, 0.18, 'sawtooth', 0.04);
  }
}

function racerPos(G: Game, id: string): Vec | null {
  for (const k of G.karts) if (k.id === id) return { x: k.x, y: k.y };
  const r = G.remotes.get(id);
  return r ? { x: r.x, y: r.y } : null;
}

function step(G: Game, dt: number, now: number, input: Input) {
  if (G.phase === 'countdown') {
    const left = Math.ceil((G.goAt - now) / 1000);
    if (left < G.lastBeep && left > 0) {
      G.lastBeep = left;
      beep(440, 0.15, 'square', 0.05);
    }
    if (now >= G.goAt) {
      G.phase = 'racing';
      beep(880, 0.4, 'square', 0.06);
    }
  }
  const racing = G.phase === 'racing';
  const all = racers(G);
  const ranked = rankRacers(all);
  const me = G.karts[0];

  for (const k of G.karts) {
    let throttle = 0;
    let brake = 0;
    let steerTarget = 0;
    let speedMul = 1;
    const isMe = k.id === G.meId;
    if (racing && k.spinT <= 0) {
      if (k.bot || k.finished) {
        const a = autopilot(k);
        steerTarget = a.steer;
        throttle = k.finished ? 0.5 : a.throttle;
        if (k.bot) {
          speedMul = k.skill;
          if (k.progress < me.progress - 150) speedMul += 0.12;
          else if (k.progress > me.progress + 260) speedMul -= 0.1;
        }
      } else if (isMe) {
        throttle = input.up ? 1 : 0;
        brake = input.down ? 1 : 0;
        if (k.toddler) {
          const a = autopilot(k);
          steerTarget = a.steer;
          if (throttle > 0) throttle = a.throttle;
          brake = 0;
        } else {
          steerTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        }
      }
    }
    if (k.bot || k.toddler || k.finished) k.steer = steerTarget;
    else k.steer += clamp(steerTarget - k.steer, -dt * 7, dt * 7);

    if (k.spinT > 0) {
      k.spinT -= dt;
      k.spinA = (1 - Math.max(0, k.spinT)) * Math.PI * 2;
      k.vx *= Math.exp(-2.8 * dt);
      k.vy *= Math.exp(-2.8 * dt);
      k.steer = 0;
      if (k.spinT <= 0) k.spinA = 0;
    }
    if (k.boostT > 0) k.boostT -= dt;
    if (k.rollT > 0) k.rollT -= dt;

    drive(k, dt, k.spinT > 0 ? 0 : throttle, k.spinT > 0 ? 0 : brake, speedMul);

    // Track position, laps and off-road check
    const prev = k.idx;
    const near = nearestOnTrack(k.x, k.y, k.idx);
    k.idx = near.idx;
    k.offroad = near.dist > HALF_W;
    const n = TRACK.n;
    if (prev > n * 0.75 && k.idx < n * 0.25) k.lap++;
    else if (prev < n * 0.25 && k.idx > n * 0.75) k.lap--;
    k.progress = k.lap * n + k.idx;
    if (!k.finished && k.lap > LAPS) {
      k.finished = true;
      k.finishTime = now - G.goAt;
      if (isMe) {
        G.send('finish', { id: k.id, name: k.name, k: k.kartIdx, ft: Math.round(k.finishTime) });
        beep(660, 0.2, 'triangle', 0.06);
        setTimeout(() => beep(990, 0.4, 'triangle', 0.06), 180);
      }
    }

    // Particles for boost and grass
    const speed = Math.hypot(k.vx, k.vy);
    if (k.boostT > 0) {
      for (let i = 0; i < 3; i++) {
        if (G.particles.length > 450) G.particles.shift();
        const back = k.angle + Math.PI + (Math.random() - 0.5) * 0.6;
        G.particles.push({
          x: k.x - Math.cos(k.angle) * 28, y: k.y - Math.sin(k.angle) * 28,
          vx: Math.cos(back) * 160 + k.vx * 0.2, vy: Math.sin(back) * 160 + k.vy * 0.2,
          life: 0.5, max: 0.5, color: `hsl(${(now / 3 + i * 60) % 360},100%,60%)`, size: 9,
        });
      }
    } else if (k.offroad && !k.toddler && speed > 120 && Math.random() < 0.5) {
      G.particles.push({ x: k.x, y: k.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.5, max: 0.5, color: '#a16207', size: 6 });
    }

    if (!racing) continue;

    // Item boxes
    for (const b of G.boxes) {
      if (now < b.hiddenUntil) continue;
      if ((b.x - k.x) ** 2 + (b.y - k.y) ** 2 < 36 * 36) {
        b.hiddenUntil = now + BOX_RESPAWN_MS;
        G.send('box_take', { id: b.id });
        spawnParticles(G, b.x, b.y, 16, (i) => `hsl(${i * 40},95%,65%)`, 260, 0.5, 6);
        if (!k.item) {
          const place = ranked.findIndex((r) => r.id === k.id) + 1;
          k.item = rollItem(place || 1, ranked.length);
          k.rollT = 0.7;
          k.botTimer = 0.8 + Math.random() * 2.5;
          if (isMe) beep(980, 0.1, 'triangle', 0.05);
        }
      }
    }

    // Banana peels
    for (let i = G.bananas.length - 1; i >= 0; i--) {
      const b = G.bananas[i];
      if (b.owner === k.id && now < b.safeUntil) continue;
      if ((b.x - k.x) ** 2 + (b.y - k.y) ** 2 < 30 * 30) {
        G.bananas.splice(i, 1);
        G.send('banana_hit', { id: b.id });
        spinOut(G, k);
      }
    }

    // Bot item use
    if (k.bot && k.item && k.rollT <= 0) {
      k.botTimer -= dt;
      if (k.botTimer <= 0) {
        if (k.item !== 'blast' || findTargetAhead(G, k)) fireItem(G, k, now);
        else k.botTimer = 1;
      }
    }
  }

  // Blasts: homing projectiles
  for (let i = G.blasts.length - 1; i >= 0; i--) {
    const bl = G.blasts[i];
    bl.life -= dt;
    const tp = bl.target ? racerPos(G, bl.target) : null;
    if (tp) {
      const want = Math.atan2(tp.y - bl.y, tp.x - bl.x);
      const d = wrapAngle(want - bl.angle);
      bl.angle += clamp(d, -5 * dt, 5 * dt);
    }
    bl.x += Math.cos(bl.angle) * 820 * dt;
    bl.y += Math.sin(bl.angle) * 820 * dt;
    if (G.particles.length < 450) {
      G.particles.push({ x: bl.x, y: bl.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color: '#fb923c', size: 8 });
    }
    let gone = bl.life <= 0 || bl.x < 0 || bl.y < 0 || bl.x > WORLD_W || bl.y > WORLD_H;
    if (!gone) {
      for (const k of G.karts) {
        const eligible = bl.target ? bl.target === k.id : bl.owner !== k.id;
        if (!eligible) continue;
        if ((bl.x - k.x) ** 2 + (bl.y - k.y) ** 2 < 34 * 34) {
          G.send('blast_hit', { id: bl.id });
          spinOut(G, k);
          gone = true;
          break;
        }
      }
    }
    if (!gone && bl.target && G.remotes.has(bl.target) && tp) {
      // The target's own device decides the hit; here it just pops visually.
      if ((bl.x - tp.x) ** 2 + (bl.y - tp.y) ** 2 < 30 * 30) gone = true;
    }
    if (gone) {
      spawnParticles(G, bl.x, bl.y, 18, (j) => (j % 2 ? '#f97316' : '#fde047'), 280, 0.5, 8);
      G.blasts.splice(i, 1);
    }
  }

  // Kart bumping (only the karts this device simulates get pushed)
  const others: { id: string; x: number; y: number }[] = all.map((r) => ({ id: r.id, x: r.x, y: r.y }));
  for (const k of G.karts) {
    for (const o of others) {
      if (o.id === k.id) continue;
      const dx = k.x - o.x;
      const dy = k.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < KART_RADIUS * 2) {
        const push = (KART_RADIUS * 2 - d) * 0.5;
        k.x += (dx / d) * push;
        k.y += (dy / d) * push;
        k.vx *= 0.97;
        k.vy *= 0.97;
      }
    }
  }

  // Particles
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      G.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2 * dt;
    p.vy *= 1 - 2 * dt;
  }

  // Remote karts: interpolate between received snapshots
  const renderT = now - (G.sendInterval + 120);
  G.remotes.forEach((r, id) => {
    if (now - r.lastSeen > 6000) {
      G.remotes.delete(id);
      return;
    }
    const s = r.snaps;
    if (!s.length) return;
    if (renderT <= s[0].t) {
      r.x = s[0].x;
      r.y = s[0].y;
      r.angle = s[0].a;
      return;
    }
    for (let i = s.length - 2; i >= 0; i--) {
      if (s[i].t <= renderT) {
        const a = s[i];
        const b = s[i + 1];
        const t = clamp((renderT - a.t) / Math.max(1, b.t - a.t), 0, 1);
        r.x = lerp(a.x, b.x, t);
        r.y = lerp(a.y, b.y, t);
        r.angle = lerpAngle(a.a, b.a, t);
        return;
      }
    }
    const last = s[s.length - 1];
    const ex = Math.min(0.3, (renderT - last.t) / 1000);
    r.x = last.x + Math.cos(last.a) * r.speed * ex;
    r.y = last.y + Math.sin(last.a) * r.speed * ex;
    r.angle = last.a;
  });
}

// ---------- Rendering ----------
function drawKart(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, spinA: number,
  kartIdx: number, boost: boolean, toddler: boolean, t: number,
) {
  const spec = KARTS[kartIdx] || KARTS[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 10, 32, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(angle + spinA);
  if (boost) {
    const fl = 18 + Math.sin(t / 30) * 6;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(-26, -9);
    ctx.lineTo(-26 - fl, 0);
    ctx.lineTo(-26, 9);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(-26, -5);
    ctx.lineTo(-26 - fl * 0.6, 0);
    ctx.lineTo(-26, 5);
    ctx.fill();
  }
  ctx.fillStyle = '#111827';
  for (const [wx, wy] of [[-16, -19], [12, -19], [-16, 13], [12, 13]]) {
    roundRectPath(ctx, wx, wy, 14, 7, 2);
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, -14, 0, 14);
  g.addColorStop(0, spec.color);
  g.addColorStop(1, spec.dark);
  ctx.fillStyle = g;
  roundRectPath(ctx, -26, -14, 52, 28, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  roundRectPath(ctx, 15, -8, 10, 16, 4);
  ctx.fill();
  ctx.fillStyle = spec.dark;
  ctx.fillRect(-31, -15, 6, 30);
  ctx.restore();
  drawEmoji(ctx, spec.emoji, 0, -8, 42);
  if (toddler) {
    const r = 40 + Math.sin(t / 250) * 3;
    ctx.fillStyle = 'rgba(56,189,248,0.14)';
    ctx.strokeStyle = 'rgba(56,189,248,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = 'rgba(15,23,42,0.78)';
  roundRectPath(ctx, x - w / 2, y - 12, w, 24, 12);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

function render(ctx: CanvasRenderingContext2D, G: Game, track: HTMLCanvasElement, w: number, h: number, dpr: number, now: number) {
  const me = G.karts[0];
  const zoom = clamp(Math.min(w, h) / 720, 0.5, 1.35);
  const tx = me.x + me.vx * 0.25;
  const ty = me.y + me.vy * 0.25;
  G.camX += (tx - G.camX) * 0.12;
  G.camY += (ty - G.camY) * 0.12;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1f6f2a';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 - G.camX * zoom), dpr * (h / 2 - G.camY * zoom));
  ctx.drawImage(track, 0, 0);

  // Item boxes
  for (const b of G.boxes) {
    const hidden = now < b.hiddenUntil;
    if (hidden && b.hiddenUntil - now > 500) continue;
    const bob = Math.sin(now / 300 + b.x) * 4;
    ctx.save();
    ctx.globalAlpha = hidden ? 0.35 : 1;
    ctx.translate(b.x, b.y + bob);
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 36);
    glow.addColorStop(0, 'rgba(255,255,255,0.7)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(now / 700);
    ctx.fillStyle = `hsla(${(now / 8 + b.x) % 360},90%,60%,0.85)`;
    roundRectPath(ctx, -17, -17, 34, 34, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.rotate(-now / 700);
    drawEmoji(ctx, '🎁', 0, 0, 24);
    ctx.restore();
  }

  // Bananas
  for (const b of G.bananas) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 8, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEmoji(ctx, '🍌', b.x, b.y, 32);
  }

  // Particles
  for (const p of G.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * (p.life / p.max)), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Blasts
  for (const bl of G.blasts) {
    const glow = ctx.createRadialGradient(bl.x, bl.y, 2, bl.x, bl.y, 26);
    glow.addColorStop(0, 'rgba(253,224,71,0.9)');
    glow.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(bl.x, bl.y);
    ctx.rotate(now / 80);
    drawEmoji(ctx, '💥', 0, 0, 30);
    ctx.restore();
  }

  // Karts, drawn top to bottom so nearer ones overlap
  type Drawable = { y: number; draw: () => void; tag: (() => void) | null };
  const list: Drawable[] = [];
  for (const k of G.karts) {
    const isMe = k.id === G.meId;
    list.push({
      y: k.y,
      draw: () => drawKart(ctx, k.x, k.y, k.angle, k.spinA, k.kartIdx, k.boostT > 0, k.toddler, now),
      tag: () => drawTag(ctx, k.x, k.y - 52, isMe ? `⭐ ${k.name}` : k.name, KARTS[k.kartIdx].color),
    });
  }
  G.remotes.forEach((r) => {
    if (!r.snaps.length) return;
    list.push({
      y: r.y,
      draw: () => drawKart(ctx, r.x, r.y, r.angle, r.spinA, r.kartIdx, r.boost, r.toddler, now),
      tag: () => drawTag(ctx, r.x, r.y - 52, r.name, (KARTS[r.kartIdx] || KARTS[0]).color),
    });
  });
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.draw();
  for (const d of list) d.tag?.();

  // Minimap
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mw = clamp(w * 0.22, 110, 190);
  const ms = mw / WORLD_W;
  const mh = WORLD_H * ms;
  const mx = w - mw - 12;
  const my = 64;
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  roundRectPath(ctx, mx - 6, my - 6, mw + 12, mh + 12, 10);
  ctx.fill();
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale(ms, ms);
  traceTrack(ctx);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = HALF_W * 0.9;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const dots: { x: number; y: number; c: string; me: boolean }[] = [];
  G.remotes.forEach((r) => dots.push({ x: r.x, y: r.y, c: (KARTS[r.kartIdx] || KARTS[0]).color, me: false }));
  for (const k of G.karts) dots.push({ x: k.x, y: k.y, c: KARTS[k.kartIdx].color, me: k.id === G.meId });
  for (const d of dots) {
    ctx.fillStyle = d.c;
    ctx.strokeStyle = d.me ? '#ffffff' : '#0f172a';
    ctx.lineWidth = 2 / ms;
    ctx.beginPath();
    ctx.arc(d.x, d.y, (d.me ? 7 : 5.5) / ms, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- React UI ----------
type Profile = { name: string; kartIdx: number; toddler: boolean };
type LobbyPlayer = { id: string; name: string; kartIdx: number; toddler: boolean; joinedAt: number };
type Standing = { id: string; name: string; kartIdx: number; place: number; time: string | null; isMe: boolean };
type Hud = {
  place: number;
  total: number;
  lap: number;
  time: string;
  item: ItemKind | null;
  rolling: boolean;
  countdown: number | null;
  finished: boolean;
  boost: boolean;
  standings: Standing[];
};
type RaceCfg = { mode: 'solo' | 'multi'; order: string[]; nonce: number };
type Screen = 'menu' | 'lobby' | 'race';

const EMPTY_HUD: Hud = { place: 1, total: 1, lap: 1, time: '0:00.0', item: null, rolling: false, countdown: 3, finished: false, boost: false, standings: [] };

function computeHud(G: Game, now: number): Hud {
  const me = G.karts[0];
  const ranked = rankRacers(racers(G));
  const standings: Standing[] = ranked.map((r, i) => ({
    id: r.id, name: r.name, kartIdx: r.kartIdx, place: i + 1,
    time: r.finished ? fmtTime(r.finishTime) : null, isMe: r.isMe,
  }));
  let countdown: number | null = null;
  if (G.phase === 'countdown') countdown = Math.max(1, Math.ceil((G.goAt - now) / 1000));
  else if (now - G.goAt < 800) countdown = 0;
  let rollingItem = me.item;
  if (me.item && me.rollT > 0) rollingItem = ITEM_KINDS[Math.floor(now / 90) % 3];
  return {
    place: standings.findIndex((s) => s.isMe) + 1,
    total: standings.length,
    lap: clamp(me.lap, 1, LAPS),
    time: fmtTime(me.finished ? me.finishTime : G.phase === 'racing' ? now - G.goAt : 0),
    item: rollingItem,
    rolling: !!me.item && me.rollT > 0,
    countdown,
    finished: me.finished,
    boost: me.boostT > 0,
    standings,
  };
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-white/90">
      <span className="w-14 shrink-0">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/25">
        <div className="h-full rounded-full bg-white" style={{ width: `${Math.round(clamp(value, 0.1, 1) * 100)}%` }} />
      </div>
    </div>
  );
}

function KartPicker({ value, onPick, compact }: { value: number; onPick: (i: number) => void; compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {KARTS.map((k, i) => {
        const active = i === value;
        return (
          <button
            key={k.name}
            type="button"
            onClick={() => onPick(i)}
            className={`rounded-2xl p-3 text-left transition active:scale-95 ${active ? 'ring-4 ring-white shadow-xl scale-[1.02]' : 'ring-2 ring-white/20 opacity-85 hover:opacity-100'}`}
            style={{ background: `linear-gradient(145deg, ${k.color}, ${k.dark})` }}
          >
            <div className={`${compact ? 'text-3xl' : 'text-5xl'} text-center drop-shadow`}>{k.emoji}</div>
            <div className="mt-1 text-center text-sm font-black text-white">{k.name}</div>
            {!compact && (
              <div className="mt-2 space-y-1">
                <StatBar label="Speed" value={(k.maxSpeed - 480) / 120} />
                <StatBar label="Accel" value={(k.accel - 300) / 220} />
                <StatBar label="Steering" value={(k.turn - 2.2) / 1.2} />
                <div className="pt-1 text-center text-[11px] font-bold text-white/80">{k.blurb}</div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ToddlerToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition active:scale-[0.98] ${on ? 'bg-gradient-to-r from-sky-400 to-cyan-300 text-slate-900 shadow-lg shadow-sky-500/40' : 'bg-white/15 text-white ring-2 ring-white/25'}`}
    >
      <span className="text-4xl">🛡️</span>
      <span className="flex-1">
        <span className="block text-lg font-black">Toddler Assist Mode</span>
        <span className="block text-sm font-semibold opacity-80">Steers by itself and nothing can spin you out. Just hold GAS!</span>
      </span>
      <span className={`flex h-8 w-14 items-center rounded-full p-1 transition ${on ? 'bg-slate-900/80 justify-end' : 'bg-black/30 justify-start'}`}>
        <span className="h-6 w-6 rounded-full bg-white" />
      </span>
    </button>
  );
}

export default function BendanaKartPage() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [profile, setProfile] = useState<Profile>({ name: '', kartIdx: 0, toddler: false });
  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [netStatus, setNetStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [netError, setNetError] = useState('');
  const [race, setRace] = useState<RaceCfg | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [isTouch, setIsTouch] = useState(false);
  const [myId, setMyId] = useState('');
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supaRef = useRef<SupabaseClient | null>(null);
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false, fire: false });
  const profileRef = useRef<Profile>(profile);
  const playersRef = useRef<LobbyPlayer[]>([]);
  const myIdRef = useRef('');
  const joinedAtRef = useRef(0);
  const lastTouchRef = useRef(0);

  const multiplayerReady = Boolean(SUPABASE_URL && SUPABASE_KEY);

  // One-time setup: player id, saved profile, touch detection, ?room= link
  useEffect(() => {
    const id = randId();
    myIdRef.current = id;
    setMyId(id);
    try {
      const saved = window.localStorage.getItem('bendana-kart-profile');
      if (saved) {
        const p = JSON.parse(saved) as Partial<Profile>;
        setProfile({
          name: typeof p.name === 'string' ? p.name.slice(0, 14) : '',
          kartIdx: typeof p.kartIdx === 'number' && p.kartIdx >= 0 && p.kartIdx < KARTS.length ? p.kartIdx : 0,
          toddler: !!p.toddler,
        });
      }
    } catch {
      /* storage unavailable */
    }
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
    try {
      const code = new URLSearchParams(window.location.search).get('room');
      if (code && /^[A-Za-z]{4}$/.test(code)) setJoinCode(code.toUpperCase());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    profileRef.current = profile;
    try {
      window.localStorage.setItem('bendana-kart-profile', JSON.stringify(profile));
    } catch {
      /* storage unavailable */
    }
  }, [profile]);

  const getSupabase = useCallback((): SupabaseClient | null => {
    if (supaRef.current) return supaRef.current;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    supaRef.current = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 40 } },
    });
    return supaRef.current;
  }, []);

  const startRace = useCallback((mode: 'solo' | 'multi', order: string[]) => {
    setHud(EMPTY_HUD);
    setRace({ mode, order, nonce: Date.now() + Math.random() });
    setScreen('race');
  }, []);

  const leaveRoom = useCallback(() => {
    const ch = channelRef.current;
    channelRef.current = null;
    if (ch) {
      void ch.untrack().catch(() => undefined);
      const sb = supaRef.current;
      if (sb) void sb.removeChannel(ch);
    }
    setRoom(null);
    setPlayers([]);
    playersRef.current = [];
    setNetStatus('idle');
  }, []);

  // Clean up the realtime connection when the page closes
  useEffect(() => {
    return () => {
      const ch = channelRef.current;
      if (ch && supaRef.current) void supaRef.current.removeChannel(ch);
      channelRef.current = null;
    };
  }, []);

  const trackMe = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const p = profileRef.current;
    void ch.track({ name: p.name || 'Racer', kartIdx: p.kartIdx, toddler: p.toddler, joinedAt: joinedAtRef.current });
  }, []);

  const joinRoom = useCallback((code: string) => {
    unlockAudio();
    setNetError('');
    const sb = getSupabase();
    if (!sb) {
      setNetError('Multiplayer is not set up yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    leaveRoom();
    joinedAtRef.current = Date.now();
    setNetStatus('connecting');
    const ch = sb.channel(CHANNEL_PREFIX + code, {
      config: { broadcast: { self: false, ack: false }, presence: { key: myIdRef.current } },
    });

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as unknown as Record<string, Array<Record<string, unknown>>>;
      const list: LobbyPlayer[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        const m = metas[metas.length - 1];
        if (!m) continue;
        list.push({
          id: key,
          name: String(m.name ?? 'Racer').slice(0, 14),
          kartIdx: clamp(Number(m.kartIdx) || 0, 0, KARTS.length - 1),
          toddler: !!m.toddler,
          joinedAt: Number(m.joinedAt) || 0,
        });
      }
      list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      playersRef.current = list;
      setPlayers(list);
    });
    ch.on('presence', { event: 'leave' }, ({ key }) => {
      gameRef.current?.remotes.delete(String(key));
    });

    ch.on('broadcast', { event: 'kart_move' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || G.mode !== 'multi' || !payload) return;
      const id = String(payload.id);
      if (id === G.meId) return;
      const now = performance.now();
      let r = G.remotes.get(id);
      if (!r) {
        r = {
          id, name: '', kartIdx: 0, toddler: false, snaps: [], lastSeen: now,
          x: Number(payload.x), y: Number(payload.y), angle: Number(payload.a),
          speed: 0, spinA: 0, boost: false, lap: 0, idx: 0, progress: 0, finished: false, finishTime: 0,
        };
        G.remotes.set(id, r);
      }
      r.name = String(payload.n ?? 'Racer').slice(0, 14);
      r.kartIdx = clamp(Number(payload.k) || 0, 0, KARTS.length - 1);
      r.toddler = !!payload.t;
      r.speed = Number(payload.s) || 0;
      r.spinA = Number(payload.sp) || 0;
      r.boost = !!payload.b;
      r.lap = Number(payload.l) || 0;
      r.idx = Number(payload.i) || 0;
      r.progress = r.lap * TRACK.n + r.idx;
      if (payload.f && !r.finished) {
        r.finished = true;
        r.finishTime = Number(payload.ft) || 0;
      }
      r.lastSeen = now;
      r.snaps.push({ t: now, x: Number(payload.x), y: Number(payload.y), a: Number(payload.a) });
      if (r.snaps.length > 12) r.snaps.shift();
    });
    ch.on('broadcast', { event: 'box_take' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      const b = G.boxes.find((x) => x.id === payload.id);
      if (b) b.hiddenUntil = performance.now() + BOX_RESPAWN_MS;
    });
    ch.on('broadcast', { event: 'banana_drop' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      const id = String(payload.id);
      if (G.bananas.some((b) => b.id === id)) return;
      G.bananas.push({ id, x: Number(payload.x), y: Number(payload.y), owner: String(payload.owner), safeUntil: 0 });
    });
    ch.on('broadcast', { event: 'banana_hit' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      G.bananas = G.bananas.filter((b) => b.id !== payload.id);
    });
    ch.on('broadcast', { event: 'blast_fire' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      const id = String(payload.id);
      if (G.blasts.some((b) => b.id === id)) return;
      const target = payload.target ? String(payload.target) : null;
      G.blasts.push({ id, x: Number(payload.x), y: Number(payload.y), angle: Number(payload.a), owner: String(payload.owner), target, life: target ? 4 : 2.5 });
    });
    ch.on('broadcast', { event: 'blast_hit' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      const bl = G.blasts.find((b) => b.id === payload.id);
      if (bl) spawnParticles(G, bl.x, bl.y, 18, (j) => (j % 2 ? '#f97316' : '#fde047'), 280, 0.5, 8);
      G.blasts = G.blasts.filter((b) => b.id !== payload.id);
    });
    ch.on('broadcast', { event: 'finish' }, ({ payload }) => {
      const G = gameRef.current;
      if (!G || !payload) return;
      const r = G.remotes.get(String(payload.id));
      if (r) {
        r.finished = true;
        r.finishTime = Number(payload.ft) || 0;
      }
    });
    ch.on('broadcast', { event: 'race_start' }, ({ payload }) => {
      const order = Array.isArray(payload?.order) ? (payload.order as unknown[]).map(String) : playersRef.current.map((p) => p.id);
      startRace('multi', order);
    });
    ch.on('broadcast', { event: 'to_lobby' }, () => {
      setScreen('lobby');
      setRace(null);
    });

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setNetStatus('connected');
        trackMe();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setNetStatus('error');
        setNetError('Could not reach the race server. Check the internet connection and try again.');
      } else if (status === 'CLOSED') {
        setNetStatus((s) => (s === 'connected' ? 'idle' : s));
      }
    });
    channelRef.current = ch;
    setRoom(code);
    setScreen('lobby');
  }, [getSupabase, leaveRoom, startRace, trackMe]);

  const hostRace = () => joinRoom(roomCode());
  const joinRace = () => {
    const code = joinCode.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code)) joinRoom(code);
    else setNetError('Room codes are 4 letters.');
  };

  const isHost = players.length > 0 && players[0].id === myId;

  const hostStart = () => {
    unlockAudio();
    const ch = channelRef.current;
    if (!ch) return;
    const order = playersRef.current.map((p) => p.id);
    if (!order.includes(myIdRef.current)) order.push(myIdRef.current);
    void ch.send({ type: 'broadcast', event: 'race_start', payload: { order } });
    startRace('multi', order);
  };

  const backToLobby = () => {
    if (race?.mode === 'multi' && isHost) void channelRef.current?.send({ type: 'broadcast', event: 'to_lobby', payload: {} });
    setRace(null);
    setScreen(race?.mode === 'multi' && channelRef.current ? 'lobby' : 'menu');
  };

  const quitToMenu = () => {
    leaveRoom();
    setRace(null);
    setScreen('menu');
  };

  // Re-announce my kart when I change it in the lobby
  useEffect(() => {
    if (screen === 'lobby' && netStatus === 'connected') trackMe();
  }, [profile, screen, netStatus, trackMe]);

  // ---------- The race loop ----------
  useEffect(() => {
    if (screen !== 'race' || !race) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const track = getTrackCanvas();
    const G = createGame(race.mode, race.order, myIdRef.current, profileRef.current);
    G.send = (event, payload) => {
      const ch = channelRef.current;
      if (G.mode === 'multi' && ch) void ch.send({ type: 'broadcast', event, payload }).catch(() => undefined);
    };
    gameRef.current = G;
    const input = inputRef.current;
    input.up = input.down = input.left = input.right = input.fire = false;

    let w = 1;
    let h = 1;
    let dpr = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    const keyMap: Record<string, keyof Input> = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) input.fire = true;
        return;
      }
      const k = keyMap[e.code];
      if (k) {
        e.preventDefault();
        input[k] = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = keyMap[e.code];
      if (k) input[k] = false;
    };
    const onBlur = () => {
      input.up = input.down = input.left = input.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    let sent = { x: -1e6, y: -1e6, a: 0, l: -1, b: false, f: false };
    let last = performance.now();
    let hudAt = 0;
    let hudKey = '';
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      if (dt < 0) dt = 0;
      let rem = dt;
      while (rem > 1e-6) {
        const s = Math.min(rem, 1 / 60);
        step(G, s, now, input);
        rem -= s;
      }
      const me = G.karts[0];
      if (input.fire) {
        input.fire = false;
        fireItem(G, me, now);
      }
      if (G.mode === 'multi') {
        // Send only when something changed, plus a slow heartbeat so others
        // know this player is still here.
        const changed =
          Math.abs(me.x - sent.x) > 3 || Math.abs(me.y - sent.y) > 3 ||
          Math.abs(wrapAngle(me.angle - sent.a)) > 0.04 || me.spinT > 0 ||
          me.lap !== sent.l || (me.boostT > 0) !== sent.b || me.finished !== sent.f;
        const interval = changed ? G.sendInterval : 2000;
        if (now - G.lastSend >= interval) {
          G.lastSend = now;
          sent = { x: me.x, y: me.y, a: me.angle, l: me.lap, b: me.boostT > 0, f: me.finished };
          G.send('kart_move', {
            id: me.id, n: me.name, e: KARTS[me.kartIdx].emoji, k: me.kartIdx, t: me.toddler ? 1 : 0,
            x: Math.round(me.x), y: Math.round(me.y), a: +me.angle.toFixed(3),
            s: Math.round(Math.hypot(me.vx, me.vy)), l: me.lap, i: me.idx,
            sp: +me.spinA.toFixed(2), b: me.boostT > 0 ? 1 : 0,
            f: me.finished ? 1 : 0, ft: Math.round(me.finishTime),
          });
        }
      }
      render(ctx, G, track, w, h, dpr, now);
      if (now - hudAt > 100) {
        hudAt = now;
        const next = computeHud(G, now);
        const key = JSON.stringify(next);
        if (key !== hudKey) {
          hudKey = key;
          setHud(next);
        }
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      input.up = input.down = input.left = input.right = input.fire = false;
      if (gameRef.current === G) gameRef.current = null;
    };
  }, [screen, race]);

  // ---------- Touch controls ----------
  const press = (key: keyof Input, on: boolean) => {
    inputRef.current[key] = on;
  };
  const holdHandlers = (key: keyof Input) => ({
    onTouchStart: () => {
      lastTouchRef.current = Date.now();
      press(key, true);
    },
    onTouchEnd: () => {
      lastTouchRef.current = Date.now();
      press(key, false);
    },
    onTouchCancel: () => press(key, false),
    onMouseDown: () => {
      if (Date.now() - lastTouchRef.current > 800) press(key, true);
    },
    onMouseUp: () => {
      if (Date.now() - lastTouchRef.current > 800) press(key, false);
    },
    onMouseLeave: () => {
      if (Date.now() - lastTouchRef.current > 800) press(key, false);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const fireHandlers = {
    onTouchStart: () => {
      lastTouchRef.current = Date.now();
      inputRef.current.fire = true;
    },
    onMouseDown: () => {
      if (Date.now() - lastTouchRef.current > 800) inputRef.current.fire = true;
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  const shareUrl = typeof window !== 'undefined' && room ? `${window.location.origin}${window.location.pathname}?room=${room}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const nameInput = (
    <input
      value={profile.name}
      onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value.slice(0, 14) }))}
      placeholder="Your name"
      maxLength={14}
      className="w-full rounded-2xl border-0 bg-white/90 px-5 py-4 text-xl font-black text-slate-900 placeholder:text-slate-400 shadow-inner outline-none focus:ring-4 focus:ring-yellow-300"
    />
  );

  // ---------- Screens ----------
  if (screen === 'menu') {
    return (
      <main className="min-h-[100dvh] w-full overflow-y-auto bg-gradient-to-br from-sky-500 via-fuchsia-500 to-amber-400 px-4 py-6 sm:py-10">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <header className="text-center">
            <h1 className="text-5xl font-black tracking-tight text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.25)] sm:text-6xl">
              Bendana Kart 🏁
            </h1>
            <p className="mt-2 text-lg font-bold text-white/90">Race your family from any phone, tablet or computer.</p>
          </header>

          <section className="rounded-3xl bg-black/20 p-4 backdrop-blur sm:p-5">
            <h2 className="mb-3 text-lg font-black text-white">1. What&apos;s your name?</h2>
            {nameInput}
          </section>

          <section className="rounded-3xl bg-black/20 p-4 backdrop-blur sm:p-5">
            <h2 className="mb-3 text-lg font-black text-white">2. Pick your kart</h2>
            <KartPicker value={profile.kartIdx} onPick={(i) => setProfile((p) => ({ ...p, kartIdx: i }))} />
          </section>

          <section className="rounded-3xl bg-black/20 p-4 backdrop-blur sm:p-5">
            <ToddlerToggle on={profile.toddler} onToggle={() => setProfile((p) => ({ ...p, toddler: !p.toddler }))} />
          </section>

          <section className="grid gap-3 rounded-3xl bg-black/20 p-4 backdrop-blur sm:grid-cols-3 sm:p-5">
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                startRace('solo', []);
              }}
              className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 px-4 py-5 text-xl font-black text-slate-900 shadow-lg active:scale-95"
            >
              🏁 Practice
              <span className="block text-sm font-bold opacity-75">vs. 3 robot karts</span>
            </button>
            <button
              type="button"
              onClick={hostRace}
              disabled={!multiplayerReady}
              className="rounded-2xl bg-gradient-to-b from-yellow-200 to-orange-400 px-4 py-5 text-xl font-black text-slate-900 shadow-lg active:scale-95 disabled:opacity-50"
            >
              📡 Host Race
              <span className="block text-sm font-bold opacity-75">get a room code</span>
            </button>
            <div className="flex flex-col gap-2 rounded-2xl bg-white/15 p-3">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase())}
                placeholder="CODE"
                inputMode="text"
                autoCapitalize="characters"
                className="w-full rounded-xl bg-white/90 px-3 py-2 text-center text-2xl font-black tracking-[0.4em] text-slate-900 outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-yellow-300"
              />
              <button
                type="button"
                onClick={joinRace}
                disabled={!multiplayerReady || joinCode.length !== 4}
                className="rounded-xl bg-gradient-to-b from-sky-300 to-indigo-500 px-3 py-2 text-lg font-black text-white shadow active:scale-95 disabled:opacity-50"
              >
                🔑 Join Race
              </button>
            </div>
          </section>

          {!multiplayerReady && (
            <p className="rounded-2xl bg-black/30 p-3 text-center text-sm font-semibold text-white">
              Multiplayer is off on this copy. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to turn it on.
            </p>
          )}
          {netError && <p className="rounded-2xl bg-red-600/80 p-3 text-center font-bold text-white">{netError}</p>}

          <p className="pb-4 text-center text-sm font-semibold text-white/85">
            Keyboard: W A S D or arrow keys to drive, Space to use an item. On a tablet, use the big buttons.
          </p>
        </div>
      </main>
    );
  }

  if (screen === 'lobby') {
    return (
      <main className="min-h-[100dvh] w-full overflow-y-auto bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-4 py-6 sm:py-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <header className="text-center">
            <p className="text-sm font-black uppercase tracking-widest text-white/80">Room code</p>
            <div className="mt-1 text-7xl font-black tracking-[0.25em] text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.3)]">{room}</div>
            <p className="mt-2 font-bold text-white/90">On the other devices, open Bendana Kart, tap Join Race and type this code.</p>
            {shareUrl && (
              <button type="button" onClick={copyLink} className="mt-3 rounded-full bg-white/20 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/40 active:scale-95">
                {copied ? '✅ Link copied' : '🔗 Copy invite link'}
              </button>
            )}
          </header>

          <section className="rounded-3xl bg-black/25 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-white">Racers ({players.length})</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${netStatus === 'connected' ? 'bg-green-400 text-green-950' : netStatus === 'error' ? 'bg-red-500 text-white' : 'bg-yellow-300 text-yellow-950'}`}>
                {netStatus === 'connected' ? 'Connected' : netStatus === 'error' ? 'Offline' : 'Connecting…'}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {players.map((p, i) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 text-white shadow"
                  style={{ background: `linear-gradient(90deg, ${KARTS[p.kartIdx].color}, ${KARTS[p.kartIdx].dark})` }}
                >
                  <span className="text-4xl">{KARTS[p.kartIdx].emoji}</span>
                  <span className="flex-1">
                    <span className="block text-xl font-black">
                      {p.name} {p.id === myId && <span className="text-sm opacity-80">(you)</span>}
                    </span>
                    <span className="block text-sm font-bold opacity-85">{KARTS[p.kartIdx].name}</span>
                  </span>
                  {p.toddler && <span className="text-2xl" title="Toddler Assist">🛡️</span>}
                  {i === 0 && <span className="text-2xl" title="Host">👑</span>}
                </li>
              ))}
              {players.length === 0 && <li className="rounded-2xl bg-white/10 p-4 text-center font-bold text-white/80">Connecting to the room…</li>}
            </ul>
            {players.length === 1 && netStatus === 'connected' && (
              <p className="mt-3 text-center text-sm font-bold text-white/80">Waiting for others to join…</p>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-3xl bg-black/25 p-4 backdrop-blur">
            <h2 className="text-lg font-black text-white">Your kart</h2>
            {nameInput}
            <KartPicker compact value={profile.kartIdx} onPick={(i) => setProfile((p) => ({ ...p, kartIdx: i }))} />
            <ToddlerToggle on={profile.toddler} onToggle={() => setProfile((p) => ({ ...p, toddler: !p.toddler }))} />
          </section>

          {netError && <p className="rounded-2xl bg-red-600/80 p-3 text-center font-bold text-white">{netError}</p>}

          <div className="flex flex-col gap-3 pb-6 sm:flex-row">
            <button type="button" onClick={quitToMenu} className="rounded-2xl bg-white/20 px-5 py-4 text-lg font-black text-white ring-2 ring-white/30 active:scale-95">
              ← Leave
            </button>
            {isHost ? (
              <button
                type="button"
                onClick={hostStart}
                disabled={netStatus !== 'connected'}
                className="flex-1 rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 px-5 py-4 text-2xl font-black text-slate-900 shadow-xl active:scale-95 disabled:opacity-50"
              >
                🏁 Start Race!
              </button>
            ) : (
              <div className="flex-1 rounded-2xl bg-white/15 px-5 py-4 text-center text-lg font-black text-white">
                Waiting for 👑 {players[0]?.name ?? 'the host'} to start…
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Race screen
  const meSpec = KARTS[profile.kartIdx];
  const btn = 'no-touch-ui pointer-events-auto flex select-none items-center justify-center rounded-full font-black text-white shadow-xl ring-4 ring-white/30 backdrop-blur active:scale-95';
  return (
    <main className="no-touch-ui fixed inset-0 overflow-hidden bg-slate-900" onContextMenu={(e) => e.preventDefault()}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {/* Top HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="rounded-2xl bg-slate-900/70 px-4 py-2 text-white shadow-lg ring-1 ring-white/20">
          <div className="text-3xl font-black leading-none sm:text-4xl">
            {ordinal(hud.place)}
            <span className="text-base font-bold text-white/70"> / {hud.total}</span>
          </div>
          <div className="mt-1 text-sm font-bold text-white/85">
            Lap {hud.lap}/{LAPS} · {hud.time}
          </div>
        </div>
        <button
          type="button"
          {...fireHandlers}
          className="no-touch-ui pointer-events-auto flex h-20 w-20 flex-col items-center justify-center rounded-3xl bg-gradient-to-b from-white/90 to-white/60 shadow-xl ring-4 ring-yellow-300 active:scale-95 sm:h-24 sm:w-24"
          aria-label="Use item"
        >
          <span className={`text-4xl sm:text-5xl ${hud.rolling ? 'animate-pulse' : ''}`}>{hud.item ? ITEMS[hud.item].emoji : '❔'}</span>
          <span className="text-[10px] font-black uppercase text-slate-700">{hud.item && !hud.rolling ? ITEMS[hud.item].label : 'Item'}</span>
        </button>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={race?.mode === 'multi' ? backToLobby : quitToMenu}
            className="pointer-events-auto rounded-full bg-slate-900/70 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20 active:scale-95"
          >
            ✕ Quit
          </button>
        </div>
      </div>

      {profile.toddler && (
        <div className="pointer-events-none absolute left-1/2 top-[7.5rem] -translate-x-1/2 rounded-full bg-sky-400/90 px-4 py-1 text-sm font-black text-slate-900 shadow sm:top-32">
          🛡️ Toddler Assist on: just hold GAS!
        </div>
      )}

      {/* Countdown */}
      {hud.countdown !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            key={hud.countdown}
            className={`animate-[ping_1s_ease-out_1] text-[9rem] font-black leading-none drop-shadow-[0_6px_0_rgba(0,0,0,0.35)] ${hud.countdown === 0 ? 'text-lime-300' : 'text-white'}`}
          >
            {hud.countdown === 0 ? 'GO!' : hud.countdown}
          </div>
        </div>
      )}
      {hud.countdown !== null && hud.countdown > 0 && !isTouch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-lg font-bold text-white drop-shadow">
          W A S D or arrow keys to drive · Space to use your item
        </div>
      )}

      {/* Touch controls */}
      {isTouch && !hud.finished && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {profile.toddler ? (
            <div className="rounded-2xl bg-sky-400/80 px-4 py-3 text-base font-black text-slate-900 shadow">🛡️ Auto-steer</div>
          ) : (
            <div className="flex gap-3">
              <button type="button" aria-label="Steer left" {...holdHandlers('left')} className={`${btn} h-24 w-24 bg-slate-900/45 text-5xl sm:h-28 sm:w-28`}>
                ◀
              </button>
              <button type="button" aria-label="Steer right" {...holdHandlers('right')} className={`${btn} h-24 w-24 bg-slate-900/45 text-5xl sm:h-28 sm:w-28`}>
                ▶
              </button>
            </div>
          )}
          <div className="flex items-end gap-3">
            <button type="button" aria-label="Use item" {...fireHandlers} className={`${btn} h-20 w-20 bg-gradient-to-b from-yellow-300/80 to-orange-500/80 text-4xl`}>
              {hud.item ? ITEMS[hud.item].emoji : '🎁'}
            </button>
            <div className="flex flex-col items-center gap-3">
              {!profile.toddler && (
                <button type="button" aria-label="Brake" {...holdHandlers('down')} className={`${btn} h-16 w-24 rounded-2xl bg-red-500/70 text-lg`}>
                  BRAKE
                </button>
              )}
              <button
                type="button"
                aria-label="Gas"
                {...holdHandlers('up')}
                className={`${btn} ${profile.toddler ? 'h-36 w-36 text-3xl' : 'h-28 w-28 text-2xl'} bg-gradient-to-b from-lime-400/85 to-green-600/85`}
              >
                GAS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {hud.finished && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-gradient-to-br from-yellow-300 via-orange-400 to-pink-500 p-1 shadow-2xl">
            <div className="rounded-[1.4rem] bg-slate-900/90 p-5 text-white">
              <div className="text-center text-6xl">{hud.place === 1 ? '🏆' : hud.place === 2 ? '🥈' : hud.place === 3 ? '🥉' : '🎉'}</div>
              <h2 className="mt-1 text-center text-3xl font-black">You finished {ordinal(hud.place)}!</h2>
              <ol className="mt-4 flex flex-col gap-2">
                {hud.standings.map((s) => (
                  <li key={s.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${s.isMe ? 'bg-white/20 ring-2 ring-yellow-300' : 'bg-white/10'}`}>
                    <span className="w-10 text-lg font-black">{ordinal(s.place)}</span>
                    <span className="text-2xl">{KARTS[s.kartIdx].emoji}</span>
                    <span className="flex-1 truncate font-bold">{s.name}</span>
                    <span className="text-sm font-bold text-white/80">{s.time ?? 'racing…'}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex flex-col gap-2">
                {race?.mode === 'solo' && (
                  <button type="button" onClick={() => startRace('solo', [])} className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 py-3 text-xl font-black text-slate-900 active:scale-95">
                    🔁 Race again
                  </button>
                )}
                {race?.mode === 'multi' && isHost && (
                  <button type="button" onClick={hostStart} className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 py-3 text-xl font-black text-slate-900 active:scale-95">
                    🔁 Race again (everyone)
                  </button>
                )}
                {race?.mode === 'multi' && !isHost && (
                  <p className="text-center text-sm font-bold text-white/80">Waiting for 👑 {players[0]?.name ?? 'the host'} to start the next race…</p>
                )}
                <button type="button" onClick={race?.mode === 'multi' ? backToLobby : quitToMenu} className="rounded-2xl bg-white/15 py-3 text-lg font-black text-white ring-1 ring-white/25 active:scale-95">
                  {race?.mode === 'multi' ? 'Back to lobby' : 'Main menu'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {hud.boost && (
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(251,146,60,0.55)]" style={{ borderColor: meSpec.color }} />
      )}
    </main>
  );
}
