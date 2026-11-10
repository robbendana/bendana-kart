'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { View3D, CAM_MODES, type CamMode, type KartView, type SceneTrack } from './view3d';
import { KartShowcase } from './kart3d';
import { faceCanvas } from './faces';
import {
  beep, sfx, unlockAudio, setMuted, setMusicOn, setHaptics, startMusic, stopMusic, setMusicIntensity,
  playFanfare, engineStart, engineUpdate, engineStop, vibrate, isAudioRunning, musicDebug,
} from './audio';
import { say, stopVoice, unlockVoice, setVoiceOn, setVoiceMuted, voiceAvailable } from './voice';
import { HomeBackdrop, Logo, Sheet, QrCode, TrackThumb, type ThumbLook } from './ui';
import {
  wall, SupabaseRoom, LocalRoom, HostClock, RemoteKart, Sampler, EventLog, WakeLock, parseSamples, readSimOpts,
  sendIntervalFor, F_SPIN, F_BOOST, F_DRIFT, F_AIR, F_SHIELD, F_DONE, F_SNOOZE, F_DRAFT, F_RUSH, F_MAGNET,
  type Room, type Meta, type NetStatus, type NetEvent,
} from './net';
import {
  loadStore, saveStore, activeLocal, syncActive, setActive, addPlayer, adoptPlayer, removeLocal, applyRace, mergeBoard, wireBoard, totals, levelOf,
  type Store, type Gain,
} from './players';
import { WhoRow, GainStrip, FamilySheets, type Kit, type FamilyPanel } from './family-ui';

/* =========================================================================
   Bendana Kart: a family kart racer.
   Everything (track, physics, items, rendering, multiplayer) lives here.
   Multiplayer uses Supabase Realtime channels only (broadcast + presence).
   It never reads or writes any database table.
   ========================================================================= */

// ---------- World and race constants ----------
// Tracks are sized for 5 karts racing side by side: every layout is scaled up
// by TRACK_SCALE and the road is about five and a half karts wide.
const TRACK_SCALE = 1.3;
const WORLD_W = Math.round(2400 * TRACK_SCALE);
const WORLD_H = Math.round(1600 * TRACK_SCALE);
const HALF_W = 140; // half the road width, in world units
const LANE_K = HALF_W / 105; // lateral spacing relative to the original, narrower road
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
  { name: 'Robo Racer', emoji: '🤖', color: '#94a3b8', dark: '#334155', maxSpeed: 550, accel: 440, turn: 2.9, grip: 8, blurb: 'All-rounder' },
  { name: 'Rocket Pup', emoji: '🐶', color: '#fb923c', dark: '#9a3412', maxSpeed: 525, accel: 520, turn: 3.0, grip: 8, blurb: 'Zoomy starts' },
  { name: 'Kitty Comet', emoji: '🐱', color: '#f472b6', dark: '#9d174d', maxSpeed: 535, accel: 470, turn: 3.2, grip: 8.5, blurb: 'Nimble paws' },
  { name: 'Bunny Hop', emoji: '🐰', color: '#e2e8f0', dark: '#64748b', maxSpeed: 510, accel: 540, turn: 3.4, grip: 9, blurb: 'Light and quick' },
  { name: 'Turbo Turtle', emoji: '🐢', color: '#16a34a', dark: '#14532d', maxSpeed: 600, accel: 320, turn: 2.4, grip: 7, blurb: 'Slow start, huge speed' },
  { name: 'Penguin Slide', emoji: '🐧', color: '#38bdf8', dark: '#0c4a6e', maxSpeed: 540, accel: 430, turn: 3.0, grip: 11, blurb: 'Grips on ice' },
  { name: 'Blaze Dragon', emoji: '🐉', color: '#dc2626', dark: '#7f1d1d', maxSpeed: 580, accel: 390, turn: 2.7, grip: 7, blurb: 'Fiery and fast' },
  { name: 'Zippy Alien', emoji: '👽', color: '#84cc16', dark: '#3f6212', maxSpeed: 555, accel: 455, turn: 3.1, grip: 8, blurb: 'Out of this world' },
  { name: 'Foxy Flame', emoji: '🦊', color: '#ea580c', dark: '#7c2d12', maxSpeed: 560, accel: 430, turn: 3.0, grip: 7.5, blurb: 'Clever corners' },
  { name: 'Panda Pop', emoji: '🐼', color: '#f8fafc', dark: '#1e293b', maxSpeed: 545, accel: 420, turn: 2.8, grip: 9, blurb: 'Steady and calm' },
  { name: 'Lion Roar', emoji: '🦁', color: '#facc15', dark: '#a16207', maxSpeed: 585, accel: 380, turn: 2.6, grip: 7, blurb: 'King of speed' },
  { name: 'Sparkle Bee', emoji: '🐝', color: '#fde047', dark: '#713f12', maxSpeed: 520, accel: 500, turn: 3.5, grip: 8.5, blurb: 'Buzzy turns' },
];

// Optional paint jobs that override a character's kart colour
const PAINTS: { name: string; color: string; dark: string }[] = [
  { name: 'Ruby', color: '#ef4444', dark: '#7f1d1d' },
  { name: 'Sunset', color: '#fb923c', dark: '#9a3412' },
  { name: 'Lemon', color: '#facc15', dark: '#a16207' },
  { name: 'Lime', color: '#4ade80', dark: '#166534' },
  { name: 'Ocean', color: '#38bdf8', dark: '#1e3a8a' },
  { name: 'Grape', color: '#a855f7', dark: '#581c87' },
  { name: 'Bubblegum', color: '#f472b6', dark: '#9d174d' },
  { name: 'Midnight', color: '#334155', dark: '#020617' },
  { name: 'Gold', color: '#fcd34d', dark: '#b45309' },
  { name: 'Snow', color: '#f8fafc', dark: '#94a3b8' },
];

// Kart bodies change the look and nudge the driver's stats
type BodySpec = { name: string; icon: string; blurb: string; speed: number; accel: number; turn: number; grip: number; offroad: number };
const BODIES: BodySpec[] = [
  { name: 'Classic', icon: '🏁', blurb: 'Balanced', speed: 1, accel: 1, turn: 1, grip: 1, offroad: 1 },
  { name: 'Speedster', icon: '⚡', blurb: 'Faster, slower start', speed: 1.06, accel: 0.9, turn: 0.95, grip: 1, offroad: 0.95 },
  { name: 'Monster Truck', icon: '🛻', blurb: 'Bounces over grass', speed: 0.97, accel: 0.97, turn: 0.93, grip: 1.05, offroad: 1.5 },
  { name: 'Jet Racer', icon: '🚀', blurb: 'Fast but slidey', speed: 1.04, accel: 1.05, turn: 1, grip: 0.82, offroad: 0.95 },
  { name: 'Mini Buggy', icon: '🐞', blurb: 'Quick and twisty', speed: 0.95, accel: 1.12, turn: 1.1, grip: 1.05, offroad: 1.1 },
  { name: 'Bubble Car', icon: '🫧', blurb: 'Sticky tires, easy to drive', speed: 0.97, accel: 1.02, turn: 1.06, grip: 1.2, offroad: 1.05 },
];

type Stats = { maxSpeed: number; accel: number; turn: number; grip: number; offroad: number };
function kartStats(kartIdx: number, body: number): Stats {
  const k = KARTS[kartIdx] || KARTS[0];
  const b = BODIES[body] || BODIES[0];
  return { maxSpeed: k.maxSpeed * b.speed, accel: k.accel * b.accel, turn: k.turn * b.turn, grip: k.grip * b.grip, offroad: b.offroad };
}

function kartColors(kartIdx: number, paint: number): { color: string; dark: string } {
  if (paint >= 0 && paint < PAINTS.length) return PAINTS[paint];
  const k = KARTS[kartIdx] || KARTS[0];
  return { color: k.color, dark: k.dark };
}

type ItemKind = 'rocket' | 'rocket3' | 'banana' | 'banana3' | 'blast' | 'shield' | 'snooze' | 'magnet' | 'rush' | 'honk';
const ITEMS: Record<ItemKind, { emoji: string; label: string; charges: number }> = {
  rocket: { emoji: '🚀', label: 'Turbo Rocket', charges: 1 },
  rocket3: { emoji: '🚀', label: 'Triple Rockets', charges: 3 },
  banana: { emoji: '🍌', label: 'Banana Peel', charges: 1 },
  banana3: { emoji: '🍌', label: 'Triple Bananas', charges: 3 },
  blast: { emoji: '💥', label: 'Homing Blast', charges: 1 },
  shield: { emoji: '🫧', label: 'Bubble Shield', charges: 1 },
  snooze: { emoji: '💤', label: 'Snooze Cloud', charges: 1 },
  magnet: { emoji: '🧲', label: 'Coin Magnet', charges: 1 },
  rush: { emoji: '🌈', label: 'Rainbow Rush', charges: 1 },
  honk: { emoji: '📣', label: 'Mega Honk', charges: 1 },
};
const ITEM_KINDS: ItemKind[] = ['rocket', 'rocket3', 'banana', 'banana3', 'blast', 'shield', 'snooze', 'magnet', 'rush', 'honk'];
// Item odds by how far back you are: [leader, middle, last]
const ITEM_ODDS: Record<ItemKind, [number, number, number]> = {
  rocket: [10, 22, 20],
  rocket3: [0, 10, 22],
  banana: [34, 12, 0],
  banana3: [14, 10, 0],
  blast: [0, 18, 20],
  shield: [20, 12, 8],
  snooze: [0, 0, 12],
  magnet: [14, 8, 0], // coins for the front of the pack
  rush: [0, 4, 16], // the big comeback item
  honk: [8, 10, 6],
};
const RUSH_TIME = 3.5;
const MAGNET_TIME = 7;
const MAGNET_REACH = 240;
const HONK_REACH = 290;

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
type TrackDef = {
  name: string;
  emoji: string;
  blurb: string;
  points: number[][];
  grassA: string;
  grassB: string;
  edge: string;
  outside: string;
  road: string;
  roadInner: string;
  curbA: string;
  curbB: string;
  line: string;
  big: string[];
  small: string[];
  grip: number; // multiplies kart grip (ice is slippery)
  offroad: number; // top speed multiplier off the road
  dust: string;
  card: string;
};

const TRACKS: TrackDef[] = [
  {
    name: 'Sunny Meadow', emoji: '🌻', blurb: 'Grassy hills and flower patches',
    points: [
      [300, 820], [300, 420], [480, 230], [780, 240], [940, 430], [1150, 560], [1360, 420], [1520, 230],
      [1860, 210], [2120, 360], [2160, 660], [1960, 830], [1700, 860], [1600, 1010], [1800, 1160], [2060, 1260],
      [2060, 1420], [1700, 1460], [1300, 1400], [1100, 1210], [850, 1150], [650, 1370], [400, 1400], [270, 1160],
    ],
    grassA: '#5fbf5a', grassB: '#6acb62', edge: '#2f7d32', outside: '#1f6f2a',
    road: '#4b5563', roadInner: '#535e6e', curbA: '#ffffff', curbB: '#ef4444', line: 'rgba(255,255,255,0.5)',
    big: ['🌳', '🌲', '🌴', '🪨', '🏠'], small: ['🌼', '🌷', '🍄', '🌻', '🌸'],
    grip: 1, offroad: 0.42, dust: '#a16207', card: 'from-green-400 to-emerald-600',
  },
  {
    name: 'Candy Canyon', emoji: '🍭', blurb: 'Chocolate roads through a sweet shop',
    points: [
      [300, 320], [900, 250], [1200, 470], [1500, 250], [2100, 300], [2160, 690], [1770, 930], [2160, 1180],
      [2100, 1380], [1500, 1380], [1200, 1160], [900, 1380], [300, 1360], [240, 840],
    ],
    grassA: '#f9a8d4', grassB: '#fbcfe8', edge: '#db2777', outside: '#9d174d',
    road: '#7c4a2d', roadInner: '#8b5a3c', curbA: '#ffffff', curbB: '#ec4899', line: 'rgba(255,230,240,0.7)',
    big: ['🍭', '🧁', '🍩', '🎂', '🍦'], small: ['🍬', '🍫', '🍪', '🍓', '🍒'],
    grip: 1, offroad: 0.45, dust: '#f472b6', card: 'from-pink-400 to-fuchsia-600',
  },
  {
    name: 'Frosty Peaks', emoji: '⛄', blurb: 'Slippery ice, so steer early!',
    points: [
      [400, 1300], [300, 900], [400, 450], [800, 250], [1200, 400], [1300, 720], [1100, 950], [1250, 1150],
      [1700, 1180], [1920, 1060], [1840, 790], [1650, 600], [1800, 300], [2150, 350], [2220, 800], [2200, 1250],
      [2000, 1460], [700, 1460],
    ],
    grassA: '#f1f5f9', grassB: '#e2e8f0', edge: '#94a3b8', outside: '#64748b',
    road: '#7dd3fc', roadInner: '#a5e1fb', curbA: '#ffffff', curbB: '#3b82f6', line: 'rgba(255,255,255,0.8)',
    big: ['⛄', '🌲', '🏔️', '🧊', '🏠'], small: ['❄️', '🐧', '🧣', '⭐', '🎿'],
    grip: 0.55, offroad: 0.45, dust: '#ffffff', card: 'from-sky-300 to-blue-600',
  },
  {
    name: 'Dusty Dunes', emoji: '🌵', blurb: 'Hairpin turns in the hot desert',
    points: [
      [250, 800], [300, 300], [700, 200], [800, 600], [1000, 900], [1300, 700], [1250, 300], [1650, 200],
      [2150, 250], [2210, 650], [1840, 860], [2210, 1140], [2100, 1440], [1500, 1400], [1100, 1250], [700, 1440],
      [300, 1350],
    ],
    grassA: '#fcd34d', grassB: '#fde68a', edge: '#b45309', outside: '#92400e',
    road: '#a16207', roadInner: '#b07519', curbA: '#ffffff', curbB: '#f97316', line: 'rgba(255,255,255,0.55)',
    big: ['🌵', '🐪', '🏜️', '🪨', '🛖'], small: ['🦂', '🌾', '🦎', '🐚', '☀️'],
    grip: 1.05, offroad: 0.38, dust: '#d97706', card: 'from-amber-300 to-orange-600',
  },
  {
    name: 'Volcano Loop', emoji: '🌋', blurb: 'Tight twists past glowing lava',
    points: [
      [1200, 1420], [500, 1420], [250, 1100], [400, 750], [820, 820], [900, 560], [600, 420], [800, 230],
      [1250, 260], [1500, 420], [1400, 700], [1700, 840], [2000, 560], [2200, 820], [2150, 1200], [1800, 1300], [1500, 1150],
    ],
    grassA: '#3f2a26', grassB: '#47302b', edge: '#f97316', outside: '#1c1210',
    road: '#27272a', roadInner: '#303034', curbA: '#fde047', curbB: '#ef4444', line: 'rgba(253,224,71,0.6)',
    big: ['🌋', '🔥', '🪨', '💎', '🏰'], small: ['🔥', '🦴', '💀', '🍄', '✨'],
    grip: 1, offroad: 0.34, dust: '#f97316', card: 'from-orange-500 to-red-800',
  },
];

// Sky, horizon haze and distant hills for the 3D view, one per track
const SKIES: { sky: string; horizon: string; hills: string; night: boolean }[] = [
  { sky: '#7cc8ff', horizon: '#cdeaff', hills: '#3f8f47', night: false },
  { sky: '#ffc4e6', horizon: '#ffe4f3', hills: '#c0477f', night: false },
  { sky: '#bfdcff', horizon: '#eef6ff', hills: '#f8fafc', night: false },
  { sky: '#ffcf87', horizon: '#ffe8c2', hills: '#c2410c', night: false },
  { sky: '#2a0f0b', horizon: '#5b1d0f', hills: '#1c0d0a', night: true },
];

let TRACK_IDX = 0;
let THEME: TrackDef = TRACKS[0];

type Track = { xs: Float32Array; ys: Float32Array; tx: Float32Array; ty: Float32Array; n: number };

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildTrack(def: TrackDef): Track {
  const raw: Vec[] = [];
  const wp: Vec[] = def.points.map(([x, y]) => ({ x: x * TRACK_SCALE, y: y * TRACK_SCALE }));
  const m = wp.length;
  for (let i = 0; i < m; i++) {
    const p0 = wp[(i - 1 + m) % m];
    const p1 = wp[i];
    const p2 = wp[(i + 1) % m];
    const p3 = wp[(i + 2) % m];
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

let TRACK = buildTrack(TRACKS[0]);

function setTrack(i: number) {
  const idx = clamp(Math.floor(i) || 0, 0, TRACKS.length - 1);
  // (The first track is built at load, but its features are worked out here.)
  if (idx === TRACK_IDX && TRACK && featureCache.has(idx)) return;
  if (idx !== TRACK_IDX) {
    TRACK_IDX = idx;
    THEME = TRACKS[idx];
    TRACK = buildTrack(THEME);
  }
  FEATURES = computeFeatures();
  // Painted tracks are big (about 26 MB each). Keep only this track's, so a
  // cup of four tracks does not run a tablet out of canvas memory.
  for (const [key, c] of trackCanvasCache) {
    if (key.startsWith(`${idx}|`)) continue;
    c.width = 0;
    c.height = 0;
    trackCanvasCache.delete(key);
  }
}

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

// Staggered starting grid: left, right, left, right, left, each kart a little
// behind the one before, so all 5 have room to get away cleanly.
function gridPose(slot: number) {
  const { xs, ys, tx, ty, n } = TRACK;
  const idx = (n - 14 - slot * 8 + n) % n;
  const side = slot % 2 === 0 ? -72 : 72;
  const nx = -ty[idx];
  const ny = tx[idx];
  return { x: xs[idx] + nx * side, y: ys[idx] + ny * side, angle: Math.atan2(ty[idx], tx[idx]), idx };
}

// ---------- Track features: boost pads, ramps and coin rows ----------
// Placed automatically on the straightest stretches of each track.
type Pad = { idx: number; lat: number; x: number; y: number; a: number };
type Ramp = { idx: number; x: number; y: number; a: number };
// Hazards are round patches on the road that slow a kart down: mud, syrup,
// snow, sand or lava, one kind per track. They sit off the middle of the road,
// so a kart that keeps to the centre never touches one.
type HazardKind = 'mud' | 'syrup' | 'snow' | 'sand' | 'lava';
type Hazard = { idx: number; lat: number; x: number; y: number; a: number; r: number; kind: HazardKind };
const HAZARD_KINDS: HazardKind[] = ['mud', 'syrup', 'snow', 'sand', 'lava'];
const HAZARD_FRACS = [0.18, 0.47, 0.75, 0.93, 0.28, 0.57, 0.84, 0.38, 0.66]; // tried in this order, so they spread around the lap
const HAZARD_LOOK: Record<HazardKind, { fill: string; rim: string; spot: string; splash: string; emoji: string }> = {
  mud: { fill: '#6b4423', rim: '#4a2c14', spot: '#8a5a30', splash: '#6b4423', emoji: '💦' },
  syrup: { fill: '#e11d48', rim: '#9f1239', spot: '#fb7185', splash: '#fb7185', emoji: '🍯' },
  snow: { fill: '#f8fafc', rim: '#cbd5e1', spot: '#e2e8f0', splash: '#ffffff', emoji: '❄️' },
  sand: { fill: '#fde68a', rim: '#d97706', spot: '#fcd34d', splash: '#fcd34d', emoji: '🏜️' },
  lava: { fill: '#f97316', rim: '#7f1d1d', spot: '#fde047', splash: '#fb923c', emoji: '🔥' },
};
type Features = { pads: Pad[]; ramps: Ramp[]; coins: { idx: number; lat: number; x: number; y: number }[]; hazards: Hazard[] };
const PAD_LEN = 70;
const PAD_W = 76;
const RAMP_LEN = 36;
const BOX_FRACS = [0.13, 0.33, 0.52, 0.7, 0.88];
const COIN_FRACS = [0.22, 0.42, 0.61, 0.79];
let FEATURES: Features = { pads: [], ramps: [], coins: [], hazards: [] };
const featureCache = new Map<number, Features>();

function trackAngle(i: number) {
  const { tx, ty, n } = TRACK;
  const j = ((i % n) + n) % n;
  return Math.atan2(ty[j], tx[j]);
}
function trackPoint(i: number, lat: number) {
  const { xs, ys, tx, ty, n } = TRACK;
  const j = ((Math.round(i) % n) + n) % n;
  return { x: xs[j] - ty[j] * lat, y: ys[j] + tx[j] * lat, a: Math.atan2(ty[j], tx[j]) };
}
/** Signed distance along the track from feature index f to kart index k (wraps). */
function idxDelta(k: number, f: number) {
  const n = TRACK.n;
  return ((k - f + n + n / 2) % n + n) % n - n / 2;
}
function lateralOf(x: number, y: number, idx: number) {
  const { xs, ys, tx, ty } = TRACK;
  return (x - xs[idx]) * -ty[idx] + (y - ys[idx]) * tx[idx];
}

function computeFeatures(): Features {
  const hit = featureCache.get(TRACK_IDX);
  if (hit) return hit;
  const n = TRACK.n;
  const bend = (i: number) => Math.abs(wrapAngle(trackAngle(i + 22) - trackAngle(i - 22)));
  const banned = (i: number) => {
    const f = i / n;
    if (f < 0.07 || f > 0.95) return true; // keep the start straight clear
    return BOX_FRACS.some((b) => Math.abs(f - b) < 0.035);
  };
  const cands: { i: number; b: number }[] = [];
  for (let i = 0; i < n; i += 4) if (!banned(i)) cands.push({ i, b: bend(i) });
  cands.sort((a, b) => a.b - b.b);
  const picked: number[] = [];
  const far = (i: number, gap: number) => picked.every((p) => Math.abs(idxDelta(i, p)) > gap);
  const ramps: Ramp[] = [];
  for (const c of cands) {
    if (ramps.length >= 2) break;
    if (c.b > 0.35 || !far(c.i, n * 0.22)) continue;
    picked.push(c.i);
    const p = trackPoint(c.i, 0);
    ramps.push({ idx: c.i, ...p });
  }
  const pads: Pad[] = [];
  const lats = [0, -60, 60];
  for (const c of cands) {
    if (pads.length >= 3) break;
    if (c.b > 0.5 || !far(c.i, n * 0.1)) continue;
    picked.push(c.i);
    const lat = lats[pads.length % 3];
    pads.push({ idx: c.i, lat, ...trackPoint(c.i, lat) });
  }
  const coins: Features['coins'] = [];
  COIN_FRACS.forEach((fr, row) => {
    const lane = [-70, 0, 70, 0][row];
    for (let k = 0; k < 5; k++) {
      const idx = (Math.floor(fr * n) + k * 6) % n;
      const lat = lane + (row % 2 ? Math.sin(k) * 30 : 0);
      coins.push({ idx, lat, ...trackPoint(idx, lat) });
    }
  });
  // Hazards: alternate sides, clear of the pads, ramps, boxes and coin rows
  const hazards: Hazard[] = [];
  const line = raceLine();
  const rnd = mulberry32(977 + TRACK_IDX * 131);
  const kind = HAZARD_KINDS[TRACK_IDX % HAZARD_KINDS.length];
  let side = rnd() < 0.5 ? -1 : 1;
  for (const fr of HAZARD_FRACS) {
    if (hazards.length >= 5) break;
    const idx = Math.floor(fr * n);
    const jitter = rnd();
    const size = rnd();
    if (!far(idx, 34)) continue; // a pad or ramp is right here
    // Keep off the driving line, so following the coloured dots is always safe
    const rl = line[idx];
    if (Math.abs(rl) > 10) side = rl > 0 ? -1 : 1;
    const lat = side * (68 + jitter * 26) * LANE_K * 0.78;
    side = -side;
    const p = trackPoint(idx, lat);
    hazards.push({ idx, lat, x: p.x, y: p.y, a: p.a, r: 36 + size * 10, kind });
  }
  const out = { pads, ramps, coins, hazards };
  featureCache.set(TRACK_IDX, out);
  return out;
}

/** Track-following prediction for remote karts whose messages are late. */
function followTrack(x: number, y: number, a: number, speed: number, tau: number) {
  const near = nearestOnTrack(x, y, -1);
  if (near.dist > HALF_W * 1.6) return null;
  const i = near.idx;
  const ta = trackAngle(i);
  const rel = wrapAngle(a - ta);
  if (Math.abs(rel) > 1.3) return null; // going the wrong way or sideways
  const lat = lateralOf(x, y, i) * Math.exp(-tau / 1.5);
  const steps = (speed * Math.cos(rel) * tau) / SAMPLE_SPACING;
  const p = trackPoint(i + steps, clamp(lat, -HALF_W, HALF_W));
  return { x: p.x, y: p.y, a: p.a + rel * Math.exp(-tau / 0.6) };
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

type SceneryItem = { x: number; y: number; e: string; size: number; big: boolean };
const sceneryCache = new Map<number, SceneryItem[]>();
function sceneryItems(): SceneryItem[] {
  const cached = sceneryCache.get(TRACK_IDX);
  if (cached) return cached;
  const th = THEME;
  const rnd = mulberry32(11 + TRACK_IDX * 7);
  const out: SceneryItem[] = [];
  for (let i = 0; i < Math.round(300 * TRACK_SCALE * TRACK_SCALE); i++) {
    const x = 50 + rnd() * (WORLD_W - 100);
    const y = 50 + rnd() * (WORLD_H - 100);
    const isBig = rnd() < 0.4;
    const { dist } = nearestOnTrack(x, y, -1);
    if (dist < HALF_W + (isBig ? 70 : 40)) continue;
    const list = isBig ? th.big : th.small;
    const e = list[Math.floor(rnd() * list.length)];
    out.push({ x, y, e, size: isBig ? 46 + rnd() * 22 : 20 + rnd() * 10, big: isBig });
  }
  sceneryCache.set(TRACK_IDX, out);
  return out;
}

/** A hazard patch painted flat on the road: a wobbly blob with a rim and spots. */
function drawHazard(ctx: CanvasRenderingContext2D, hz: Hazard) {
  const look = HAZARD_LOOK[hz.kind];
  const rnd = mulberry32(Math.round(hz.x * 7 + hz.y * 13));
  ctx.save();
  ctx.translate(hz.x, hz.y);
  ctx.rotate(hz.a);
  const blob = (r: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = r * (0.86 + 0.14 * Math.sin(a * 3 + hz.x) + 0.06 * Math.sin(a * 5 + hz.y));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr * 1.12, Math.sin(a) * rr * 0.92);
      else ctx.lineTo(Math.cos(a) * rr * 1.12, Math.sin(a) * rr * 0.92);
    }
    ctx.closePath();
  };
  blob(hz.r + 5);
  ctx.fillStyle = look.rim;
  ctx.fill();
  blob(hz.r);
  const g = ctx.createRadialGradient(-hz.r * 0.2, -hz.r * 0.2, 2, 0, 0, hz.r);
  g.addColorStop(0, look.spot);
  g.addColorStop(1, look.fill);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = hz.kind === 'lava' ? 'rgba(254,240,138,0.85)' : 'rgba(255,255,255,0.28)';
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * hz.r * 0.6;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const trackCanvasCache = new Map<string, HTMLCanvasElement>();
function getTrackCanvas(flat = false): HTMLCanvasElement {
  const cacheKey = `${TRACK_IDX}|${flat ? 1 : 0}`;
  const cached = trackCanvasCache.get(cacheKey);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const th = THEME;
  // Ground stripes
  for (let x = 0; x < WORLD_W; x += 80) {
    ctx.fillStyle = (x / 80) % 2 === 0 ? th.grassA : th.grassB;
    ctx.fillRect(x, 0, 80, WORLD_H);
  }
  // Border
  ctx.strokeStyle = th.edge;
  ctx.lineWidth = 44;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  // Scenery on the grass (the 3D view stands the big pieces up as billboards)
  for (const it of sceneryItems()) {
    if (flat && it.big) continue;
    ctx.font = `${it.size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.e, it.x, it.y);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Shadow, curbs, asphalt, centre line
  traceTrack(ctx);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = HALF_W * 2 + 44;
  ctx.stroke();
  ctx.strokeStyle = th.curbA;
  ctx.lineWidth = HALF_W * 2 + 24;
  ctx.stroke();
  ctx.setLineDash([30, 30]);
  ctx.strokeStyle = th.curbB;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = th.road;
  ctx.lineWidth = HALF_W * 2;
  ctx.stroke();
  ctx.strokeStyle = th.roadInner;
  ctx.lineWidth = HALF_W * 1.3;
  ctx.stroke();
  ctx.setLineDash([40, 40]);
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.setLineDash([]);
  // Boost pads: glowing chevrons
  for (const p of FEATURES.pads) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    const g = ctx.createLinearGradient(-PAD_LEN / 2, 0, PAD_LEN / 2, 0);
    g.addColorStop(0, '#0ea5e9');
    g.addColorStop(1, '#a5f3fc');
    ctx.fillStyle = g;
    roundRectPath(ctx, -PAD_LEN / 2, -PAD_W / 2, PAD_LEN, PAD_W, 10);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    for (let c = 0; c < 3; c++) {
      const cx = -PAD_LEN / 2 + 14 + c * 20;
      ctx.beginPath();
      ctx.moveTo(cx, -20);
      ctx.lineTo(cx + 14, 0);
      ctx.lineTo(cx, 20);
      ctx.lineTo(cx + 6, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // Ramps: orange and white stripes across the road
  for (const r of FEATURES.ramps) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.a);
    const w = HALF_W * 2 - 10;
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#ffffff' : '#f97316';
      ctx.fillRect(-RAMP_LEN / 2, -w / 2 + (k * w) / 8, RAMP_LEN, w / 8 + 0.5);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-RAMP_LEN / 2, -w / 2, RAMP_LEN, w);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(RAMP_LEN / 2, -w / 2, 10, w);
    ctx.restore();
  }
  for (const hz of FEATURES.hazards) drawHazard(ctx, hz);
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
  trackCanvasCache.set(cacheKey, c);
  return c;
}

// ---------- Game state types ----------
type RaceStats = { drifts: number; coins: number; hits: number; bananas: number; boost: number; tricks: number; hitBy: number };
const newStats = (): RaceStats => ({ drifts: 0, coins: 0, hits: 0, bananas: 0, boost: 0, tricks: 0, hitBy: 0 });

type Kart = {
  id: string;
  name: string;
  kartIdx: number;
  paint: number;
  body: number;
  stats: Stats;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  steer: number;
  w: number; // turn rate, rad/s (sent to other screens)
  idx: number;
  lap: number;
  progress: number;
  offroad: boolean;
  item: ItemKind | null;
  charges: number;
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
  drifting: boolean;
  driftDir: number;
  charge: number;
  tier: number;
  miniT: number;
  stallT: number;
  invT: number;
  offT: number;
  wrongT: number;
  steerHeldT: number;
  assist: number; // steering help: 0 off, 1 a little, 2 lots
  coins: number;
  coinT: number;
  padT: number;
  airT: number;
  airMax: number;
  rampCool: number;
  trickDone: boolean;
  trickT: number;
  trickA: number;
  shieldT: number;
  snoozeT: number;
  draftC: number;
  draftT: number;
  epoch: number;
  react: { e: string; until: number } | null;
  st: RaceStats;
  snoozeUsed: boolean;
  // Driving feel (3.0)
  help: number; // 0..1, how much the steering help does right now (section 1 of the v3 spec)
  rescue: number; // extra help after a struggle, fades on the road
  curb: boolean; // on the rumble strip
  dist: number; // distance from the centerline
  curbT: number; // rumble buzz timer
  grassT: number; // how long this grass trip has lasted
  hopT: number; // drift-start hop
  slip: number; // drawn body angle relative to the heading
  bumpT: number; // wobble after a kart bump
  landT: number; // landing squash
  accelS: number; // smoothed forward acceleration
  prevFwd: number;
  boostLvl: number; // last frame's boost multiplier, to detect a new boost
  kicks: number; // counts boost starts (camera FOV kick)
  steerIn: number; // my own steering input this frame (-1..1)
  autoSteer: number; // what the autopilot would steer this frame
  lapClean: boolean;
  lapGrass: number;
  sc: { bendT: number; goodT: number; roadT: number; grassT: number };
  // Items, hazards and robots (4.0)
  slot: number; // grid slot
  rushT: number; // Rainbow Rush: fast and can't be hit
  magnetT: number; // Coin Magnet
  mudT: number; // in (or just out of) a hazard patch
  honkT: number; // dazed by a Mega Honk
  heldT: number; // how long the current item has been held
  home: number; // a robot's favourite side of the road
  tail: number; // catch-up tailwind for the players at the back (0..1)
  hitAt: number; // performance.now() of the last spin-out or honk (robots give you a break after one)
  coinClock: number; // robots earn coins over time
};

type Remote = {
  id: string;
  name: string;
  kartIdx: number;
  paint: number;
  body: number;
  toddler: boolean;
  net: RemoteKart;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  speed: number;
  spinA: number;
  flags: number;
  lap: number;
  idx: number;
  progress: number;
  finished: boolean;
  finishTime: number;
  coins: number;
  leftAt: number; // performance.now() when it left presence, 0 while here
  alpha: number;
  react: { e: string; until: number } | null;
  stats: RaceStats | null;
  slot: number;
  bot: boolean; // a robot simulated on another device
  owner: string; // the device that simulates this robot ('' for players)
  pkProg: number; // progress in the newest message
  hitAt: number;
};
type Box = { id: string; x: number; y: number; hiddenUntil: number; idx: number; lat: number };
type Banana = { id: string; x: number; y: number; owner: string; safeUntil: number; ti?: number; tl?: number };
type Blast = { id: string; x: number; y: number; angle: number; owner: string; target: string | null; life: number };
type Coin = { x: number; y: number; hiddenUntil: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Input = { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean; drift: boolean; lookBack: boolean; ax: number };
type InputKey = Exclude<keyof Input, 'ax'>;

type Game = {
  mode: 'solo' | 'multi';
  meId: string;
  raceId: string;
  laps: number;
  goAt: number; // performance.now() of GO, on the shared race clock
  phase: 'countdown' | 'racing';
  karts: Kart[]; // karts simulated on this device (me first, then bots in solo)
  remotes: Map<string, Remote>;
  boxes: Box[];
  bananas: Banana[];
  blasts: Blast[];
  coins: Coin[];
  particles: Particle[];
  camX: number;
  camY: number;
  lastBeep: number;
  shake: number;
  zoomK: number;
  banner: { text: string; color: string; until: number } | null;
  gasAt: number | null;
  autoDrift: boolean;
  lastBump: number;
  finishedAt: number; // performance.now() when I finished, 0 before
  firstFinishAt: number; // when the first human finished (starts the hurry timer)
  closedAt: number; // when the race closed (everyone done or time up)
  nextTick: number;
  renderAt: number;
  cleanLaps: number;
  skill: Skill;
  scored: boolean;
  improved: boolean;
  raceScore: number;
  lapAt: number[]; // race ms of each lap line crossing (for tests)
  tip: string | null; // the one coaching tip shown this race, if any
  emit: (ev: NetEvent, lazy?: boolean) => void; // send an event to the other screens (lazy: with the next state message)
  botLevel: number; // 0 chill, 1 fair, 2 fast
  botOwner: string; // the device that simulates the robots ('' when there are none)
  botEase: number; // robots go easier when the players have steering help on
  packRef: number; // the progress robots pace themselves against
  hitLog: string[]; // what hit me and when (for tests)
  lagMs: number; // rough one-way network delay, from the clock pings
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
  human: boolean;
  speed: number;
  safe: boolean; // Toddler Assist: nothing can hit this kart
  rush: boolean; // Rainbow Rush: touching it spins you out
  hitAt: number;
};

const AIR_TIME = 0.75;
const AIR_HEIGHT = 46;
const HURRY_MS = 30000;

function makeKart(id: string, name: string, kartIdx: number, slot: number, toddler: boolean, bot: boolean, paint = -1, body = 0): Kart {
  const p = gridPose(slot);
  return {
    id, name, kartIdx, paint, body, stats: kartStats(kartIdx, body),
    x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, steer: 0, w: 0,
    idx: p.idx, lap: 0, progress: p.idx,
    offroad: false, item: null, charges: 0, rollT: 0, boostT: 0, spinT: 0, spinA: 0,
    toddler, bot, finished: false, finishTime: 0,
    botTimer: 1 + Math.random() * 2,
    lane: bot ? [-78, 78, -26, 26][slot % 4] : 0, // each robot starts in its own lane
    skill: bot ? 0.87 : 1,
    drifting: false, driftDir: 0, charge: 0, tier: 0, miniT: 0, stallT: 0,
    invT: 0, offT: 0, wrongT: 0, steerHeldT: 0, assist: 0,
    coins: 0, coinT: 0, padT: 0, airT: 0, airMax: AIR_TIME, rampCool: 0, trickDone: false, trickT: 0, trickA: 0,
    shieldT: 0, snoozeT: 0, draftC: 0, draftT: 0, epoch: 0, react: null, st: newStats(), snoozeUsed: false,
    help: 0, rescue: 0, curb: false, dist: 0, curbT: 0, grassT: 0, hopT: 0, slip: 0, bumpT: 0, landT: 0, accelS: 0, prevFwd: 0,
    boostLvl: 0, kicks: 0, steerIn: 0, autoSteer: 0, lapClean: true, lapGrass: 0, sc: { bendT: 0, goodT: 0, roadT: 0, grassT: 0 },
    slot, rushT: 0, magnetT: 0, mudT: 0, honkT: 0, heldT: 0, home: bot ? [-78, 78, -26, 26][slot % 4] : 0, tail: 0, hitAt: -1e9, coinClock: 0,
  };
}

/** A small stable hash, so every device gives a robot the same personality. */
function hashStr(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const BOT_LEVELS = [
  // speed: top speed factor · turbo: mini-turbo strength · wait: item reaction time
  // mercy: ms a player is left alone after a hit · chase / wait4 / lead: how hard
  // robots catch up when behind, and how much and how soon they ease off when ahead
  { label: 'Chill', icon: '🐢', blurb: 'Slow and gentle robots', speed: 0.93, turbo: 0, wait: 1.6, mercy: 20000, chase: 0.07, wait4: 0.16, lead: 0 },
  { label: 'Fair', icon: '🙂', blurb: 'A friendly race', speed: 0.95, turbo: 0.3, wait: 1.2, mercy: 20000, chase: 0.12, wait4: 0.16, lead: 0 },
  { label: 'Fast', icon: '🔥', blurb: 'Robots that drift and fight back', speed: 1.06, turbo: 1, wait: 0.6, mercy: 8000, chase: 0.12, wait4: 0.05, lead: 150 },
];
/** Give a robot its skill and favourite lane (the same on every device). */
function tuneBot(k: Kart, raceId: string, level: number, ease: number) {
  const rnd = mulberry32(hashStr(raceId + k.id));
  k.skill = (0.84 + rnd() * 0.06) * (BOT_LEVELS[level] ?? BOT_LEVELS[1]).speed * ease;
  k.home = [-78, 78, -26, 26][k.slot % 4] + (rnd() - 0.5) * 24;
  k.botTimer = 1 + rnd() * 2;
}

// Robot line-up: [racer, kart body] for each robot, picked by the host
type BotSpec = [number, number];
function pickBots(count: number, taken: number[], prev: BotSpec[] | null): BotSpec[] {
  if (count <= 0) return [];
  // Keep the same robots from race to race (cup points follow them)
  if (prev && prev.length === count && prev.every((b) => !taken.includes(b[0]))) return prev;
  const pool = KARTS.map((_, i) => i).filter((i) => !taken.includes(i));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((k) => [k, Math.floor(Math.random() * BODIES.length)] as BotSpec);
}

function makeRemote(id: string, name: string, kartIdx: number, paint: number, body: number, toddler: boolean, slot: number): Remote {
  const p = gridPose(slot);
  return {
    id, name, kartIdx, paint, body, toddler, net: new RemoteKart(),
    x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, speed: 0, spinA: 0, flags: 0,
    lap: 0, idx: p.idx, progress: p.idx, finished: false, finishTime: 0, coins: 0,
    leftAt: 0, alpha: 1, react: null, stats: null, slot, bot: false, owner: '', pkProg: p.idx, hitAt: -1e9,
  };
}

function makeBoxes(): Box[] {
  const { xs, ys, tx, ty, n } = TRACK;
  const out: Box[] = [];
  BOX_FRACS.forEach((f, i) => {
    const idx = Math.floor(f * n);
    const nx = -ty[idx];
    const ny = tx[idx];
    [-108, -36, 36, 108].forEach((lane, j) => {
      out.push({ id: `b${i}_${j}`, x: xs[idx] + nx * lane, y: ys[idx] + ny * lane, hiddenUntil: 0, idx, lat: lane });
    });
  });
  return out;
}

// ---------- Support ladder: help that eases off as you get better ----------
type Skill = { s: number; n: number };
const SKILL_KEY = 'bendana-kart-skill';
const TIPS_KEY = 'bendana-kart-tips';
// Each saved racer has their own driving score, so a parent's skill never takes help away from a child
let skillOwner = '';
const skillKey = () => (skillOwner ? `${SKILL_KEY}:${skillOwner}` : SKILL_KEY);
function loadSkill(): Skill {
  try {
    const v = JSON.parse(window.localStorage.getItem(skillKey()) || 'null');
    if (v && typeof v.s === 'number' && typeof v.n === 'number') return { s: clamp(v.s, 0, 1), n: Math.max(0, v.n | 0) };
  } catch {
    /* storage blocked */
  }
  return { s: 0, n: 0 };
}
function saveSkill(sk: Skill) {
  try {
    window.localStorage.setItem(skillKey(), JSON.stringify({ s: +sk.s.toFixed(3), n: sk.n }));
  } catch {
    /* storage blocked */
  }
}
const HELP_BASE = [0, 0.55, 1];
const HELP_FLOOR = [0, 0.35, 0.7];
/** How much steering help a level gives right now, before rescue help. */
function helpFor(assist: number, sk: Skill): number {
  const base = HELP_BASE[assist] ?? 0;
  const floor = HELP_FLOOR[assist] ?? 0;
  const fade = sk.n >= 2 ? clamp((sk.s - 0.55) / 0.35, 0, 1) : 0;
  return base - (base - floor) * fade;
}
let tipCache: Record<string, number> | null = null;
function tips(): Record<string, number> {
  if (tipCache) return tipCache;
  try {
    const v = JSON.parse(window.localStorage.getItem(TIPS_KEY) || '{}');
    tipCache = v && typeof v === 'object' ? v : {};
  } catch {
    tipCache = { drift: 99, grass: 99, unlock: 99 }; // can't remember tips: don't nag
  }
  return tipCache!;
}
function tipCount(name: string): number {
  const v = tips()[name];
  return typeof v === 'number' ? v : 0;
}
function bumpTip(name: string) {
  const t = tips();
  t[name] = tipCount(name) + 1;
  try {
    window.localStorage.setItem(TIPS_KEY, JSON.stringify(t));
  } catch {
    /* storage blocked */
  }
}
function showTip(G: Game, name: string, text: string, max: number) {
  if (G.tip || tipCount(name) >= max) return;
  G.tip = name;
  bumpTip(name);
  setBanner(G, text, '#fdba74', 3200);
}
/** At the finish: score this race and fold it into the stored driving score. */
function scoreRace(G: Game, k: Kart) {
  if (k.toddler || G.scored) return;
  G.scored = true;
  const sc = k.sc;
  if (sc.roadT + sc.grassT < 10) return; // too short to judge
  const steerScore = sc.bendT > 3 ? sc.goodT / sc.bendT : 0.5;
  const roadScore = sc.roadT / (sc.roadT + sc.grassT);
  const driftScore = Math.min(1, k.st.drifts / (G.laps * 2));
  const race = 0.45 * steerScore + 0.4 * roadScore + 0.15 * driftScore;
  const sk = G.skill;
  G.improved = sk.n > 0 && race >= sk.s + 0.05;
  sk.s = sk.n === 0 ? race : sk.s + (race - sk.s) * 0.3;
  sk.n++;
  G.raceScore = race;
  saveSkill(sk);
}

type RaceCfg = {
  mode: 'solo' | 'multi';
  id: string;
  order: string[];
  track: number;
  laps: number;
  goWall: number; // local wall() time of GO
  cup: number; // -1 single race
  round: number;
  nonce: number;
  bots: BotSpec[]; // the robots in this race
  botLevel: number;
  botOwner: string; // the device that simulates them (the host)
};

function createGame(cfg: RaceCfg, meId: string, profile: Profile, roster: Map<string, Meta>): Game {
  const karts: Kart[] = [];
  const remotes = new Map<string, Remote>();
  // Robots go easier when the players have steering help on
  const easeOf = (toddler: boolean, assist: number) => (toddler ? 0.86 : [1, 0.94, 0.87][assist] ?? 1);
  let botEase = 1;
  let botOwner = '';
  if (cfg.mode === 'solo') {
    karts.push(makeKart(meId, profile.name || 'You', profile.kartIdx, 4, profile.toddler, false, profile.paint, profile.body));
    botEase = easeOf(profile.toddler, profile.assist);
    cfg.bots.forEach(([k, body], i) => {
      const b = makeKart(`bot${i}`, `${(KARTS[k] || KARTS[0]).name}`, k, i, false, true, -1, body);
      tuneBot(b, cfg.id, cfg.botLevel, botEase);
      karts.push(b);
    });
    botOwner = meId;
  } else {
    const slot = Math.max(0, cfg.order.indexOf(meId));
    karts.push(makeKart(meId, profile.name || 'Racer', profile.kartIdx, slot, profile.toddler, false, profile.paint, profile.body));
    // Everyone else appears on the grid right away, before their first message
    let easeSum = easeOf(profile.toddler, profile.assist);
    cfg.order.forEach((id, i) => {
      if (id === meId) return;
      const m = parseMeta(id, roster.get(id));
      easeSum += easeOf(m.toddler, m.assist);
      remotes.set(id, makeRemote(id, m.name, m.kartIdx, m.paint, m.body, m.toddler, i));
    });
    botEase = easeSum / Math.max(1, cfg.order.length);
    // Robots fill the empty seats. The host's device drives them and sends
    // their motion inside its own messages; everyone else just draws them.
    // A device that joins late never starts its own set.
    const mine = cfg.botOwner === meId && wall() < cfg.goWall + 1500;
    botOwner = cfg.bots.length ? cfg.botOwner : '';
    cfg.bots.forEach(([k, body], i) => {
      const id = `bot${i}`;
      const s = cfg.order.length + i;
      const name = (KARTS[k] || KARTS[0]).name;
      if (mine) {
        const b = makeKart(id, name, k, s, false, true, -1, body);
        tuneBot(b, cfg.id, cfg.botLevel, botEase);
        karts.push(b);
      } else {
        const r = makeRemote(id, name, k, -1, body, false, s);
        r.bot = true;
        r.owner = cfg.botOwner;
        remotes.set(id, r);
      }
    });
  }
  karts[0].assist = profile.toddler ? 2 : profile.assist;
  const goAt = cfg.goWall - performance.timeOrigin;
  return {
    mode: cfg.mode, meId, raceId: cfg.id, laps: cfg.laps,
    goAt,
    phase: 'countdown',
    karts,
    remotes,
    boxes: makeBoxes(),
    bananas: [],
    blasts: [],
    coins: FEATURES.coins.map((c) => ({ x: c.x, y: c.y, hiddenUntil: 0 })),
    particles: [],
    camX: karts[0].x,
    camY: karts[0].y,
    lastBeep: 4,
    shake: 0,
    zoomK: 1,
    banner: null,
    gasAt: null,
    autoDrift: false,
    lastBump: 0,
    finishedAt: 0,
    firstFinishAt: 0,
    closedAt: 0,
    nextTick: 0,
    renderAt: 0,
    cleanLaps: 0,
    skill: loadSkill(),
    scored: false,
    improved: false,
    raceScore: -1,
    lapAt: [],
    tip: null,
    emit: () => undefined,
    botLevel: clamp(cfg.botLevel | 0, 0, 2),
    botOwner,
    botEase,
    packRef: 0,
    hitLog: [],
    lagMs: 60,
  };
}

/** Take over robots another device was driving (it left or went quiet). */
function adoptBots(G: Game) {
  const n = TRACK.n;
  for (const r of [...G.remotes.values()]) {
    if (!r.bot) continue;
    const k = makeKart(r.id, r.name, r.kartIdx, r.slot, false, true, r.paint, r.body);
    tuneBot(k, G.raceId, G.botLevel, G.botEase);
    if (r.net.ready()) {
      k.x = r.x;
      k.y = r.y;
      k.angle = r.angle;
      k.vx = r.vx;
      k.vy = r.vy;
      k.idx = nearestOnTrack(r.x, r.y, -1).idx;
      k.lap = Math.round((r.progress - k.idx) / n);
      k.progress = k.lap * n + k.idx;
      k.lane = clamp(lateralOf(k.x, k.y, k.idx), -100, 100);
    }
    k.finished = r.finished;
    k.finishTime = r.finishTime;
    k.coins = r.coins;
    k.epoch = r.net.epoch + 1 + Math.floor(Math.random() * 1000) * 2;
    G.karts.push(k);
    G.remotes.delete(r.id);
  }
  G.botOwner = G.meId;
}

/** Another device is already driving the robots: hand mine over to it. */
function yieldBots(G: Game, owner: string) {
  for (const k of G.karts) {
    if (!k.bot) continue;
    const r = makeRemote(k.id, k.name, k.kartIdx, k.paint, k.body, false, k.slot);
    r.bot = true;
    r.owner = owner;
    r.x = k.x;
    r.y = k.y;
    r.angle = k.angle;
    r.lap = k.lap;
    r.idx = k.idx;
    r.progress = r.pkProg = k.progress;
    r.finished = k.finished;
    r.finishTime = k.finishTime;
    r.coins = k.coins;
    G.remotes.set(k.id, r);
  }
  G.karts = G.karts.filter((k) => !k.bot);
  G.botOwner = owner;
}

function racers(G: Game): Racer[] {
  const list: Racer[] = G.karts.map((k) => ({
    id: k.id, name: k.name, kartIdx: k.kartIdx, x: k.x, y: k.y,
    progress: k.progress, finished: k.finished, finishTime: k.finishTime, isMe: k.id === G.meId, human: !k.bot,
    speed: Math.hypot(k.vx, k.vy), safe: k.toddler, rush: k.rushT > 0, hitAt: k.hitAt,
  }));
  G.remotes.forEach((r) => {
    list.push({
      id: r.id, name: r.name, kartIdx: r.kartIdx, x: r.x, y: r.y,
      progress: r.progress, finished: r.finished, finishTime: r.finishTime, isMe: false, human: !r.bot,
      speed: r.speed, safe: r.toddler, rush: !!(r.flags & F_RUSH), hitAt: r.hitAt,
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

function setBanner(G: Game, text: string, color: string, ms: number) {
  G.banner = { text, color, until: performance.now() + ms };
}

function react(k: { react: { e: string; until: number } | null }, e: string, ms = 1200) {
  k.react = { e, until: performance.now() + ms };
}

/** A kart on this device got hit. Returns true if it actually spun out. */
function spinOut(G: Game, k: Kart): boolean {
  if (k.toddler || k.invT > 0 || k.spinT > 0 || k.rushT > 0) return false; // Toddler Assist and Rainbow Rush karts are invincible
  const isMe = k.id === G.meId;
  if (k.shieldT > 0) {
    k.shieldT = 0;
    k.invT = 0.5;
    spawnParticles(G, k.x, k.y, 18, () => '#bae6fd', 240, 0.5, 7);
    if (isMe) {
      sfx('shieldPop');
      vibrate(30);
    }
    return false;
  }
  k.spinT = 1;
  k.hitAt = performance.now();
  k.boostT = 0;
  k.miniT = 0;
  k.padT = 0;
  k.trickT = 0;
  k.drifting = false;
  k.charge = 0;
  k.tier = 0;
  k.st.hitBy++;
  k.lapClean = false;
  react(k, '💫', 1300);
  // Drop a few coins
  const drop = Math.min(3, k.coins);
  k.coins -= drop;
  if (drop > 0) spawnParticles(G, k.x, k.y, drop * 3, () => '#facc15', 200, 0.6, 7);
  if (isMe) {
    G.shake = 12;
    sfx('hit');
    vibrate([60, 40, 60]);
  }
  spawnParticles(G, k.x, k.y, 14, () => '#fde047', 220, 0.6, 7);
  return true;
}

// ---------- Racing line ----------
// A smooth out-in-out line: curvature, blurred so it starts turning in before
// each bend, turned into a sideways offset toward the inside.
const raceLineCache = new WeakMap<Track, Float32Array>();
function raceLine(): Float32Array {
  const hit = raceLineCache.get(TRACK);
  if (hit) return hit;
  const n = TRACK.n;
  let k = new Float32Array(n);
  for (let i = 0; i < n; i++) k[i] = wrapAngle(trackAngle(i + 6) - trackAngle(i - 6)) / (12 * SAMPLE_SPACING);
  const blur = (src: Float32Array, r: number) => {
    const out = new Float32Array(n);
    let sum = 0;
    for (let o = -r; o <= r; o++) sum += src[((o % n) + n) % n];
    for (let i = 0; i < n; i++) {
      out[i] = sum / (2 * r + 1);
      sum += src[(i + r + 1) % n] - src[((i - r) % n + n) % n];
    }
    return out;
  };
  k = blur(blur(k, 20), 20);
  const lat = new Float32Array(n);
  for (let i = 0; i < n; i++) lat[i] = clamp(k[i] * 5400 * TRACK_SCALE * LANE_K, -36 * LANE_K, 36 * LANE_K);
  const out = blur(lat, 10);
  raceLineCache.set(TRACK, out);
  return out;
}

/** How fast it is safe to go at track sample i (the autopilot brakes by this). */
function safeSpeed(i: number, maxS: number) {
  const bend = Math.abs(wrapAngle(trackAngle(i + 26) - trackAngle(i)));
  return maxS * clamp(1.2 - bend * 0.6, 0.45, 1);
}

function autopilot(k: Kart): { steer: number; throttle: number; brake: number } {
  const { xs, ys, tx, ty, n } = TRACK;
  const speed = Math.hypot(k.vx, k.vy);
  const look = Math.round(9 + speed / 45);
  const j = (k.idx + look) % n;
  const px = xs[j] - ty[j] * k.lane;
  const py = ys[j] + tx[j] * k.lane;
  const diff = wrapAngle(Math.atan2(py - k.y, px - k.x) - k.angle);
  const steer = clamp(diff * 2.8, -1, 1);
  const ad = Math.abs(diff);
  // Slow down before sharp bends
  const target = safeSpeed(k.idx, k.stats.maxSpeed);
  if (speed > target + 40 && k.boostT <= 0 && k.padT <= 0) return { steer, throttle: 0, brake: 0.5 };
  const throttle = ad > 0.9 ? 0.25 : ad > 0.5 && speed > 320 ? 0.55 : 1;
  return { steer, throttle, brake: 0 };
}

// ---------- Robot drivers ----------
// A robot picks a lane a little way ahead, then the autopilot above drives to
// it. The lane starts from the racing line and the robot's favourite side,
// goes for item boxes and boost pads, and swerves around bananas, hazards and
// slower karts. All of it is plain steering, so robots make the same kinds of
// moves a person does.
function bananaTrackPos(b: Banana) {
  if (b.ti === undefined) {
    b.ti = nearestOnTrack(b.x, b.y, -1).idx;
    b.tl = lateralOf(b.x, b.y, b.ti);
  }
  return { idx: b.ti, lat: b.tl ?? 0 };
}

function botPlan(G: Game, k: Kart, all: Racer[], dt: number, now: number) {
  const n = TRACK.n;
  const line = raceLine();
  const myLat = lateralOf(k.x, k.y, k.idx);
  const speed = Math.hypot(k.vx, k.vy);
  const edge = 102;
  let want = clamp(line[(k.idx + 14) % n] * 1.1 + k.home * 0.45, -edge, edge);
  // Something to grab: the nearest item box when the hands are empty, or a boost pad
  if (!k.item) {
    let best = 0;
    let bestD = Infinity;
    for (const b of G.boxes) {
      if (now < b.hiddenUntil) continue;
      const d = idxDelta(b.idx, k.idx);
      if (d < 3 || d > 48) continue;
      const off = Math.abs(b.lat - myLat) + d * 0.5;
      if (off < bestD) {
        bestD = off;
        best = b.lat;
      }
    }
    if (bestD < Infinity) want = best;
  }
  if (k.padT <= 0) {
    for (const p of FEATURES.pads) {
      const d = idxDelta(p.idx, k.idx);
      if (d > 3 && d < 36 && Math.abs(p.lat - myLat) < 95) want = p.lat;
    }
  }
  // Things to miss
  const dodge = (oLat: number, d: number, clear: number) => {
    if (d < 1 || d > 36 || Math.abs(want - oLat) >= clear) return;
    let side = want !== oLat ? Math.sign(want - oLat) : myLat >= oLat ? 1 : -1;
    if (Math.abs(oLat + side * clear) > edge) side = -side;
    want = oLat + side * clear;
  };
  for (const o of all) {
    if (o.id === k.id || o.finished) continue;
    const oi = ((Math.round(o.progress) % n) + n) % n;
    const d = idxDelta(oi, k.idx);
    if (d < 1 || d > 30) continue;
    // Only go around karts I am catching (or anything rushing at me)
    if (speed > o.speed + 15 || d < 7) dodge(lateralOf(o.x, o.y, oi), d, 62);
  }
  for (const b of G.bananas) {
    const t = bananaTrackPos(b);
    dodge(t.lat, idxDelta(t.idx, k.idx), 52);
  }
  if (k.rushT <= 0) for (const hz of FEATURES.hazards) dodge(hz.lat, idxDelta(hz.idx, k.idx), hz.r + 34);
  want = clamp(want, -edge, edge);
  k.lane += clamp(want - k.lane, -dt * 190, dt * 190);
}

/** Should this robot use its item right now? */
function botWantsFire(G: Game, k: Kart, all: Racer[], now: number): boolean {
  const n = TRACK.n;
  const lvl = G.botLevel;
  // Fair play: robots leave alone anyone who was just hit, chill robots never
  // go after a player, and fair robots give players room to dodge.
  const mercy = (BOT_LEVELS[lvl] ?? BOT_LEVELS[1]).mercy;
  const spare = (o: Racer) => o.safe || (lvl === 0 && o.human) || now - o.hitAt < (o.human ? mercy : 5000);
  const straight = safeSpeed((k.idx + 8) % n, 1) > 0.95;
  const boosting = k.boostT > 0 || k.padT > 0 || k.miniT > 0 || k.rushT > 0;
  const incoming = G.blasts.some((b) => b.target === k.id);
  switch (k.item) {
    case 'rocket':
    case 'rocket3':
      return (straight && !boosting && !k.offroad) || k.heldT > 6;
    case 'banana':
    case 'banana3': {
      // Drop it when someone is right on my tail
      // Drop it when a robot is right on my tail. Only fast robots do that to
      // a player; otherwise peels just get left around the track.
      for (const o of all) {
        if (o.id === k.id || o.finished || spare(o) || (o.human && lvl < 2)) continue;
        const d = k.progress - o.progress;
        if (d > (o.human ? 22 : 5) && d < (o.human ? 60 : 42)) return true;
      }
      // Chill and fair robots leave peels off to the side, never in the
      // middle of the road where the steering help drives
      if (lvl < 2 && Math.abs(lateralOf(k.x, k.y, k.idx)) < 50 && k.heldT < 20) return false;
      return k.heldT > 3 + (hashStr(k.id) % 5);
    }
    case 'blast': {
      const t = findTargetAhead(G, k);
      if (!t) return false;
      const tr = all.find((o) => o.id === t);
      if (!tr || tr.progress - k.progress > 190) return k.heldT > 12;
      // Chill robots only blast other robots, or a player who is leading
      if (lvl === 0 && tr.human) return !all.some((o) => !o.finished && o.progress > tr.progress) && now - tr.hitAt > mercy;
      return !spare(tr);
    }
    case 'shield':
      return incoming || k.heldT > 4;
    case 'honk': {
      if (incoming) return true;
      for (const o of all) {
        if (o.id === k.id || o.finished || spare(o)) continue;
        if ((o.x - k.x) ** 2 + (o.y - k.y) ** 2 < 170 * 170) return true;
      }
      return k.heldT > 15;
    }
    case 'rush':
      return straight || k.heldT > 3;
    default:
      return true; // snooze, magnet
  }
}

const CURB_W = 18; // rumble strip past the road edge: a warning, not a penalty
const GRASS_RAMP = 40; // grass slows you more the deeper you go, over this distance
const smoothK = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function drive(k: Kart, dt: number, throttleIn: number, brake: number, speedMul: number, edgeDist: number) {
  const st = k.stats;
  let throttle = throttleIn;
  let fx = Math.cos(k.angle);
  let fy = Math.sin(k.angle);
  let fwd = k.vx * fx + k.vy * fy;
  let lat0 = -k.vx * fy + k.vy * fx;
  const air = k.airT > 0;
  const help = k.toddler ? 1 : k.help;
  const sliding = k.drifting && !k.bot; // robots show a drift but keep their grip
  // Grass: no slowdown on the curb, then a smooth ramp down to the grass limit
  const depth = edgeDist - HALF_W - CURB_W;
  const grassP = k.toddler || air || k.rushT > 0 ? 0 : smoothstep(0, GRASS_RAMP, depth);
  let grassMul = Math.min(0.75, THEME.offroad * st.offroad);
  grassMul += (1 - grassMul) * help * 0.5;
  const offMul = 1 + (grassMul - 1) * grassP;
  const off = grassP > 0.5;
  // Coins add a little top speed; snooze slows you for a moment
  const coinMul = 1 + 0.01 * k.coins;
  const snoozeMul = (k.snoozeT > 0 ? 0.7 : 1) * (k.honkT > 0 ? 0.72 : 1);
  // A hazard patch: sticky going unless you are boosting (help softens it)
  const mud = k.mudT > 0 && !air;
  const mudMul = mud ? Math.min(0.95, 0.55 + 0.25 * help + (st.offroad > 1.2 ? 0.15 : 0)) : 1;
  let maxS = st.maxSpeed * speedMul * offMul * coinMul * snoozeMul * mudMul;
  let acc = st.accel;
  // The strongest active boost wins
  let boostMul = 0;
  let accMul = 1;
  if (k.boostT > 0) { boostMul = 1.6; accMul = 2.4; }
  if (k.rushT > 0 && 1.5 > boostMul) { boostMul = 1.5; accMul = 2.4; }
  if (k.padT > 0 && 1.35 > boostMul) { boostMul = 1.35; accMul = 2; }
  if (k.miniT > 0 && 1.3 > boostMul) { boostMul = 1.3; accMul = 2; }
  if (k.trickT > 0 && 1.25 > boostMul) { boostMul = 1.25; accMul = 1.8; }
  if (k.draftT > 0 && 1.15 > boostMul) { boostMul = 1.15; accMul = 1.5; }
  if (boostMul > 0) {
    maxS = st.maxSpeed * boostMul * speedMul * coinMul * snoozeMul;
    acc *= accMul;
    throttle = 1;
  } else if (k.coinT > 0) {
    maxS *= 1.08;
  }
  // Boost punch: a new (or stronger) boost shoves you forward right away
  if (boostMul > k.boostLvl + 0.01) {
    fwd = Math.min(maxS, Math.max(fwd, 0) + 25 + 75 * (boostMul - 1));
    k.kicks++;
  }
  k.boostLvl = boostMul;
  if (k.stallT > 0) throttle = 0;
  if (throttle > 0 && fwd < maxS) {
    // Strong launch, gentle approach to top speed
    const r = clamp(fwd / maxS, 0, 1);
    fwd = Math.min(maxS, fwd + acc * (1.45 - r * r) * throttle * dt);
  }
  if (brake > 0) {
    if (fwd > 20) fwd -= 950 * brake * dt;
    else if (fwd > -st.maxSpeed * 0.35) fwd -= acc * 0.7 * brake * dt;
  }
  if (throttle === 0 && brake === 0 && !air) {
    const f = Math.min(Math.abs(fwd), 240 * dt);
    fwd -= Math.sign(fwd) * f;
  }
  // Faster than allowed (a boost just ended, or the grass): ease down, don't chop
  if (fwd > maxS) fwd = Math.max(maxS, fwd - (mud && boostMul === 0 ? 1500 : off ? 900 : 380) * dt);
  fwd *= 1 - 0.12 * dt;
  // Edge cushion: with steering help, sliding away from the road is damped
  if (help > 0 && !k.toddler && edgeDist > HALF_W - 20) {
    const side = lateralOf(k.x, k.y, k.idx) >= 0 ? 1 : -1; // which edge
    const nx = -TRACK.ty[k.idx] * side;
    const ny = TRACK.tx[k.idx] * side;
    // Only the sideways slide is damped, never the kart's own forward drive,
    // so a kart pointing at the grass can still drive (and turn) back.
    const out = lat0 * (-fy * nx + fx * ny);
    if (out > 0) {
      const keep = Math.exp(-help * 6 * dt);
      lat0 -= Math.sign(-fy * nx + fx * ny) * out * (1 - keep);
    }
  }
  const sf = Math.min(1, Math.abs(fwd) / 110) ** 0.8; // can still turn when slow (e.g. on grass)
  const turnRate = st.turn * (sliding ? 1.15 : 1) * (air ? 0.35 : 1) * (1 - 0.25 * clamp(Math.abs(fwd) / st.maxSpeed, 0, 1.4));
  const a0 = k.angle;
  k.angle = wrapAngle(k.angle + k.steer * turnRate * sf * (fwd >= 0 ? 1 : -1) * dt);
  k.w = dt > 0 ? wrapAngle(k.angle - a0) / dt : 0;
  const roadGrip = THEME.grip + Math.max(0, 0.9 - THEME.grip) * help;
  const lat = lat0 * Math.exp(-st.grip * roadGrip * (sliding ? 0.55 : 1) * (air ? 0.2 : 1) * dt);
  fx = Math.cos(k.angle);
  fy = Math.sin(k.angle);
  k.vx = fx * fwd - fy * lat;
  k.vy = fy * fwd + fx * lat;
  k.x += k.vx * dt;
  k.y += k.vy * dt;
  // Body motion for the 3D view: smoothed acceleration and the slide angle
  if (dt > 0) k.accelS += ((fwd - k.prevFwd) / dt - k.accelS) * smoothK(8, dt);
  k.prevFwd = fwd;
  const into = k.drifting ? clamp(k.steer * k.driftDir, -1, 1) : 0;
  const slipT = k.drifting
    ? k.driftDir * (0.28 + 0.2 * into)
    : Math.abs(fwd) > 60 ? clamp(-Math.atan2(lat, Math.abs(fwd)) * 0.3, -0.25, 0.25) : 0; // exaggerate a slide a little
  k.slip += (slipT - k.slip) * smoothK(10, dt);
  const m = 34;
  if (k.x < m) { k.x = m; k.vx = Math.abs(k.vx) * 0.3; }
  if (k.x > WORLD_W - m) { k.x = WORLD_W - m; k.vx = -Math.abs(k.vx) * 0.3; }
  if (k.y < m) { k.y = m; k.vy = Math.abs(k.vy) * 0.3; }
  if (k.y > WORLD_H - m) { k.y = WORLD_H - m; k.vy = -Math.abs(k.vy) * 0.3; }
}

function rollItem(place: number, total: number, snoozeOk: boolean, magnetOk: boolean): ItemKind {
  // Leaders mostly get bananas and shields to defend with; karts at the back
  // get boosts, blasts and the Snooze Cloud to catch up.
  const b = total > 1 ? (place - 1) / (total - 1) : 0.5; // 0 = leader, 1 = last
  let sum = 0;
  const weights = ITEM_KINDS.map((kind) => {
    const [lead, mid, last] = ITEM_ODDS[kind];
    let w = b < 0.5 ? lead + (mid - lead) * (b / 0.5) : mid + (last - mid) * ((b - 0.5) / 0.5);
    if (kind === 'snooze' && (!snoozeOk || total < 3)) w = 0;
    if (kind === 'magnet' && !magnetOk) w = 0;
    if ((kind === 'rush' || kind === 'honk') && total < 2) w = 0;
    sum += w;
    return w;
  });
  let r = Math.random() * sum;
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    r -= weights[i];
    if (r <= 0) return ITEM_KINDS[i];
  }
  return 'rocket';
}

function findTargetAhead(G: Game, k: Kart): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  for (const r of racers(G)) {
    if (r.id === k.id || r.finished || r.safe) continue; // a blast would bounce off a Toddler Assist bubble
    const gap = r.progress - k.progress;
    if (gap > 0 && gap < bestGap) {
      bestGap = gap;
      best = r.id;
    }
  }
  return best;
}

function fireItem(G: Game, k: Kart, now: number) {
  if (!k.item || G.phase !== 'racing') return;
  const isMe = k.id === G.meId;
  if (k.rollT > 0) {
    // Tapping during the roulette stops it early
    k.rollT = 0;
    if (isMe) sfx('itemGet');
    return;
  }
  const item = k.item;
  k.charges--;
  if (k.charges <= 0) {
    k.item = null;
    k.charges = 0;
  }
  const fx = Math.cos(k.angle);
  const fy = Math.sin(k.angle);
  if (item === 'rocket' || item === 'rocket3') {
    k.boostT = item === 'rocket' ? 2 : 1.2;
    react(k, '😎', 1000);
    if (isMe) {
      sfx('rocket');
      vibrate(120);
    }
  } else if (item === 'banana' || item === 'banana3') {
    const b: Banana = { id: randId(), x: k.x - fx * 46, y: k.y - fy * 46, owner: k.id, safeUntil: now + 700 };
    G.bananas.push(b);
    k.st.bananas++;
    G.emit({ i: b.id, k: 'drop', x: Math.round(b.x), y: Math.round(b.y), o: b.owner });
    if (isMe) sfx('banana');
  } else if (item === 'blast') {
    const target = findTargetAhead(G, k);
    const bl: Blast = { id: randId(), x: k.x + fx * 40, y: k.y + fy * 40, angle: k.angle, owner: k.id, target, life: target ? 4 : 2.5 };
    G.blasts.push(bl);
    G.emit({ i: bl.id, k: 'fire', x: Math.round(bl.x), y: Math.round(bl.y), a: +bl.angle.toFixed(3), o: bl.owner, tg: bl.target });
    if (isMe) sfx('blast');
  } else if (item === 'shield') {
    k.shieldT = 8;
    if (isMe) sfx('shieldUp');
  } else if (item === 'snooze') {
    k.snoozeUsed = true;
    k.boostT = 1.5;
    snoozeAhead(G, k.id, k.progress);
    G.emit({ i: randId(), k: 'snooze', o: k.id, p: k.progress });
    if (isMe) {
      sfx('snooze');
      setBanner(G, '💤 Snooze Cloud!', '#c4b5fd', 1400);
    }
  } else if (item === 'magnet') {
    k.magnetT = MAGNET_TIME;
    if (k.bot) k.coins = Math.min(10, k.coins + 3);
    react(k, '🧲', 1600);
    if (isMe) {
      sfx('shieldUp');
      setBanner(G, '🧲 Coin Magnet!', '#fde047', 1200);
    }
  } else if (item === 'rush') {
    // Fast, can't be hit, drives over grass and hazards, and spins out anyone it touches
    k.rushT = RUSH_TIME;
    k.shieldT = Math.max(k.shieldT, RUSH_TIME);
    k.snoozeT = 0;
    k.honkT = 0;
    react(k, '🌈', RUSH_TIME * 1000);
    if (isMe) {
      sfx('rocket');
      vibrate(160);
      setBanner(G, '🌈 Rainbow Rush!', '#f0abfc', 1400);
    }
  } else if (item === 'honk') {
    const victims = honkAt(G, k.id, k.x, k.y);
    k.st.hits += victims;
    if (isMe) setBanner(G, victims ? '📣 HONK! Got them!' : '📣 HONK!', '#fde047', 1200);
    G.emit({ i: randId(), k: 'honk', o: k.id, x: Math.round(k.x), y: Math.round(k.y) });
    if (isMe) vibrate([40, 30, 80]);
  }
}

/** A Mega Honk went off at (x, y): shove and daze the karts simulated here,
 *  and blow away nearby banana peels and blasts. Returns how many it hit. */
function honkAt(G: Game, from: string, x: number, y: number): number {
  const me = G.karts[0];
  for (let i = 0; i < 44; i++) {
    if (G.particles.length > 450) G.particles.shift();
    const a = (i / 44) * Math.PI * 2;
    G.particles.push({ x: x + Math.cos(a) * 30, y: y + Math.sin(a) * 30, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, life: 0.42, max: 0.42, color: i % 2 ? '#fde047' : '#ffffff', size: 8 });
  }
  if ((me.x - x) ** 2 + (me.y - y) ** 2 < 900 * 900) sfx('horn');
  const R2 = HONK_REACH * HONK_REACH;
  G.bananas = G.bananas.filter((b) => (b.x - x) ** 2 + (b.y - y) ** 2 > R2);
  G.blasts = G.blasts.filter((b) => b.owner === from || (b.x - x) ** 2 + (b.y - y) ** 2 > R2);
  let hits = 0;
  for (const k of G.karts) {
    if (k.id === from || k.finished || k.toddler || k.rushT > 0 || k.airT > 0 || k.invT > 0) continue;
    const dx = k.x - x;
    const dy = k.y - y;
    const d = Math.hypot(dx, dy);
    if (d > HONK_REACH) continue;
    hits++;
    G.emit({ i: randId(), k: 'xhit', b: '-', v: k.id, o: from });
    if (k.shieldT > 0) {
      spinOut(G, k); // pops the bubble instead
      continue;
    }
    const push = 300 * (1 - (d / HONK_REACH) * 0.5);
    k.vx += (dx / (d || 1)) * push;
    k.vy += (dy / (d || 1)) * push;
    k.honkT = 1.1;
    k.hitAt = performance.now();
    k.boostT = 0;
    k.miniT = 0;
    k.drifting = false;
    k.bumpT = 0.35;
    react(k, '😵', 1100);
    if (k.id === G.meId) {
      G.shake = 10;
      vibrate([50, 30, 50]);
      setBanner(G, `📣 ${nameOf(G, from)} honked!`, '#fde047', 1300);
    }
  }
  return hits;
}

function nameOf(G: Game, id: string): string {
  const k = G.karts.find((x) => x.id === id);
  return k ? k.name : G.remotes.get(id)?.name ?? 'Someone';
}

/** Everyone simulated here who is ahead of `progress` gets sleepy for 1.5 s. */
function snoozeAhead(G: Game, from: string, progress: number) {
  for (const k of G.karts) {
    if (k.id === from || k.finished || k.progress <= progress) continue;
    if (k.toddler) continue;
    k.snoozeT = 1.5;
    react(k, '💤', 1500);
    if (k.id === G.meId) {
      sfx('snooze');
      setBanner(G, '💤 Sleepy!', '#c4b5fd', 1300);
    }
  }
}

function racerPos(G: Game, id: string): Vec | null {
  for (const k of G.karts) if (k.id === id) return { x: k.x, y: k.y };
  const r = G.remotes.get(id);
  return r ? { x: r.x, y: r.y } : null;
}

function giveItem(G: Game, k: Kart, place: number, total: number) {
  const it = rollItem(place, total, !k.snoozeUsed, k.coins < 8);
  k.item = it;
  k.charges = ITEMS[it].charges;
  k.rollT = k.bot ? 0.6 : 1.2;
  k.heldT = 0;
  k.botTimer = (0.5 + Math.random() * 1.2) * (BOT_LEVELS[G.botLevel] ?? BOT_LEVELS[1]).wait;
  if (k.id === G.meId) {
    G.nextTick = 0;
    vibrate(20);
  }
}

/** Move every remote kart to where it should be drawn this frame (once per frame). */
function updateRemotes(G: Game, dt: number, now: number) {
  const me = G.karts[0];
  const w = wall();
  G.remotes.forEach((r, id) => {
    const silent = r.net.silentFor(w);
    if (!r.bot && r.leftAt && now - r.leftAt > 6000 && silent > 6) {
      G.remotes.delete(id);
      return;
    }
    if (!r.net.ready()) return; // still on the grid, waiting for data
    // Where it is in the race right now: the newest message, moved forward by
    // its age, so places do not lag behind or tick over in steps.
    const lt = r.net.latest();
    if (lt && !r.finished) {
      const j = clamp(r.idx, 0, TRACK.n - 1);
      const along = Math.max(0, lt.s.vx * TRACK.tx[j] + lt.s.vy * TRACK.ty[j]);
      r.progress = r.pkProg + (along * clamp(w - lt.at + G.lagMs, 0, 900)) / 1000 / SAMPLE_SPACING;
    }
    const near = Math.hypot(r.x - me.x, r.y - me.y) < 260;
    const p = r.net.pose(w, dt, followTrack, near);
    if (!p) return;
    if (r.net.snapped && w - r.net.snapped < 20) spawnParticles(G, p.x, p.y, 14, () => '#ffffff', 180, 0.5, 8);
    r.net.snapped = 0;
    r.x = p.x;
    r.y = p.y;
    r.angle = p.a;
    r.vx = p.vx;
    r.vy = p.vy;
    r.speed = Math.hypot(p.vx, p.vy);
    r.flags = p.f;
    if (p.f & F_SPIN) r.hitAt = now;
    const target = silent > 1.5 || r.leftAt ? 0.55 : 1;
    r.alpha += (target - r.alpha) * Math.min(1, dt * 4);
  });
}

function step(G: Game, dt: number, now: number, input: Input) {
  if (G.phase === 'countdown') {
    const left = Math.ceil((G.goAt - now) / 1000);
    if (left < G.lastBeep && left > 0) {
      G.lastBeep = left;
      if (left <= 3) sfx('countdown');
    }
    // Rocket start: hold gas during the last moment of the countdown
    if (input.up) {
      if (G.gasAt === null) G.gasAt = now;
    } else G.gasAt = null;
    if (now >= G.goAt) {
      G.phase = 'racing';
      const late = now - G.goAt > 600; // joined after GO: no start bonus
      if (!late) sfx('go');
      const meK = G.karts[0];
      if (!late && input.up && G.gasAt !== null) {
        const held = G.goAt - G.gasAt;
        if (meK.toddler || held <= 800) {
          meK.boostT = meK.toddler ? 0.8 : 1.1;
          setBanner(G, '🚀 ROCKET START!', '#facc15', 1400);
          vibrate(80);
        } else if (held > 1700) {
          meK.stallT = 0.6;
          setBanner(G, '💨 Too early!', '#94a3b8', 1200);
        }
      }
      for (const b of G.karts) if (b.bot && Math.random() < 0.4) b.boostT = 0.8;
    }
  }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 40);
  const racing = G.phase === 'racing';
  const all = racers(G);
  const ranked = rankRacers(all);
  const me = G.karts[0];
  const n = TRACK.n;
  me.help = me.toddler ? 1 : clamp(helpFor(me.assist, G.skill) + (me.assist > 0 ? me.rescue : 0), 0, 1);
  // Robots pace themselves against me in practice, and against the middle of
  // the players online. Online, players far behind the leader get a tailwind.
  let lead = me.progress;
  let packSum = 0;
  let packN = 0;
  for (const r of all) {
    if (!r.human) continue;
    if (r.progress > lead) lead = r.progress;
    if (!r.finished) {
      packSum += r.progress;
      packN++;
    }
  }
  G.packRef = G.mode === 'solo' || !packN ? me.progress : packSum / packN;
  me.tail = G.mode === 'multi' && racing && !me.finished ? smoothstep(120, 700, lead - me.progress) : 0;
  if (!me.toddler && !me.finished) {
    if (!racing && G.autoDrift && me.assist === 2 && me.help <= 0.85) showTip(G, 'unlock', '🔥 New! Hold a turn to drift!', 1);
    if (racing && me.lap === 2 && me.idx > n * 0.5 && me.st.drifts === 0 && !me.drifting && (!G.autoDrift || me.help <= 0.85)) {
      showTip(G, 'drift', G.autoDrift ? '🔥 Hold a turn to drift!' : '🔥 Hold Shift in turns to drift!', 3);
    }
    if (racing && me.lapGrass >= 3 && me.help < 1) showTip(G, 'grass', '🌱 Grass is slow: ease off in tight turns', 3);
  }

  for (const k of G.karts) {
    let throttle = 0;
    let brake = 0;
    let steerTarget = 0;
    let speedMul = 1;
    const isMe = k.id === G.meId;
    if (racing && k.spinT <= 0) {
      if (k.bot || k.finished) {
        if (k.bot && !k.finished) botPlan(G, k, all, dt, now);
        const a = autopilot(k);
        steerTarget = a.steer;
        throttle = k.finished ? 0.5 : a.throttle;
        brake = k.finished ? 0 : a.brake;
        if (G.closedAt && now - G.closedAt > 2500) {
          // The race is over: everyone rolls to a stop, so the devices can go quiet
          throttle = 0;
          brake = 0.6;
          if (Math.hypot(k.vx, k.vy) < 30) {
            brake = 0;
            k.vx = 0;
            k.vy = 0;
          }
        }
        if (k.bot) {
          // Robots only: a smooth pull toward the pack, so they stay in the race
          const gap = k.progress - G.packRef;
          const lv = BOT_LEVELS[G.botLevel] ?? BOT_LEVELS[1];
          const band = gap < 0 ? lv.chase * smoothstep(30, 260, -gap) : -lv.wait4 * smoothstep(lv.lead, lv.lead + 280, gap);
          speedMul = k.skill + band;
        }
      } else if (isMe) {
        speedMul = 1 + 0.08 * k.tail;
        throttle = input.up ? 1 : 0;
        brake = input.down ? 1 : 0;
        const a = autopilot(k);
        k.autoSteer = a.steer;
        if (k.toddler) {
          steerTarget = a.steer;
          if (throttle > 0) {
            throttle = a.throttle;
            brake = a.brake;
          } else brake = 0;
        } else {
          // Analog stick if there is one, otherwise the left/right buttons
          const manual = Math.abs(input.ax) > 0.01 ? input.ax : (input.right ? 1 : 0) - (input.left ? 1 : 0);
          k.steerIn = manual;
          const h = k.help;
          if (h > 0) {
            // Steering help: the kart follows the road by itself, and your
            // steering adds on top so you can still dodge or grab a box. Near
            // the edge it also pulls back toward the road. With lots of help
            // it eases off the gas before sharp bends.
            const edge = Math.abs(lateralOf(k.x, k.y, k.idx)) > HALF_W - 20 ? 0.5 * h : 0;
            const pull = a.steer * (0.7 * h + edge);
            steerTarget = manual === 0 ? a.steer * Math.min(1, h + edge) : clamp(manual + pull, -1, 1);
            if (h >= 0.7 && a.brake > 0 && throttle > 0 && k.boostT <= 0 && k.miniT <= 0 && k.padT <= 0 && !k.drifting) {
              throttle = 0.25;
              brake = Math.max(brake, a.brake * 0.6);
            }
          } else {
            steerTarget = manual;
          }
        }
      }
    }
    // Shaped steering: quick to turn in, quicker to let go, so a tap is a
    // small nudge and a hold is a full turn.
    if (k.bot || k.toddler || k.finished) k.steer = steerTarget; // the autopilot's output is already smooth
    else {
      const easing = Math.abs(steerTarget) < Math.abs(k.steer) || steerTarget * k.steer < 0;
      const rate = easing ? 12 : 5.5;
      k.steer += clamp(steerTarget - k.steer, -dt * rate, dt * rate);
    }

    // Drifting and mini-turbo (human drivers only). Keyboard: hold Shift while
    // turning. Touch: keep holding a turn at speed and the drift starts itself.
    if (isMe && !k.toddler && !k.finished && k.airT <= 0) {
      const st = k.stats;
      const fwdSpeed = k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
      k.steerHeldT = Math.abs(steerTarget) > 0.5 ? k.steerHeldT + dt : 0;
      const touchDrift = G.autoDrift && k.help <= 0.85; // Lots unlocks this as you get better
      const wantDrift = racing && k.spinT <= 0 && (input.drift || (touchDrift && k.steerHeldT > 0.3));
      if (!k.drifting) {
        if (wantDrift && fwdSpeed > st.maxSpeed * 0.4 && Math.abs(steerTarget) > 0.3) {
          k.drifting = true;
          k.driftDir = Math.sign(steerTarget);
          k.charge = 0;
          k.tier = 0;
          k.hopT = 0.18;
          // A little outward kick so the slide starts with a feel
          const nx = -Math.sin(k.angle);
          const ny = Math.cos(k.angle);
          k.vx -= nx * k.driftDir * 40;
          k.vy -= ny * k.driftDir * 40;
          beep(220, 0.08, 'triangle', 0.04);
        }
      } else if (!wantDrift || fwdSpeed < st.maxSpeed * 0.25 || (touchDrift && !input.drift && steerTarget * k.driftDir <= 0)) {
        if (k.tier > 0) {
          k.miniT = [0, 0.6, 0.9, 1.3][k.tier];
          k.st.drifts++;
          sfx('miniTurbo', { pitch: k.tier * 2 });
          react(k, '🔥', 900);
          vibrate(40 + k.tier * 20);
        }
        k.drifting = false;
        k.charge = 0;
        k.tier = 0;
      } else {
        const into = steerTarget * k.driftDir;
        k.charge += dt * (into > 0.2 ? 1 : into < -0.2 ? 0.3 : 0.55) * clamp(fwdSpeed / st.maxSpeed, 0.6, 1);
        // Kid-friendly tier timings: 0.6 s, 1.2 s, 2.0 s
        const tier = k.charge >= 2.0 ? 3 : k.charge >= 1.2 ? 2 : k.charge >= 0.6 ? 1 : 0;
        if (tier > k.tier) {
          sfx(tier === 1 ? 'driftTier1' : tier === 2 ? 'driftTier2' : 'driftTier3');
          vibrate(15);
        }
        k.tier = tier;
        k.steer = k.driftDir * clamp(0.6 + 0.35 * into, 0.25, 0.95);
      }
    } else if (k.bot && !k.finished && racing && k.spinT <= 0 && k.airT <= 0) {
      // Robots: a long hard turn charges a mini-turbo, like a player's drift
      const turbo = (BOT_LEVELS[G.botLevel] ?? BOT_LEVELS[1]).turbo;
      if (Math.abs(steerTarget) > 0.42 && Math.hypot(k.vx, k.vy) > k.stats.maxSpeed * 0.5) {
        k.charge += dt;
        k.driftDir = Math.sign(steerTarget);
        k.tier = k.charge >= 2.2 ? 3 : k.charge >= 1.4 ? 2 : k.charge >= 0.8 ? 1 : 0;
        k.drifting = turbo > 0 && k.charge > 0.35;
      } else {
        if (k.tier > 0 && turbo > 0) {
          k.miniT = [0, 0.6, 0.9, 1.3][k.tier] * turbo;
          k.st.drifts++;
          react(k, '🔥', 700);
        }
        k.charge = 0;
        k.tier = 0;
        k.drifting = false;
      }
    } else if (k.airT <= 0) {
      k.drifting = false;
    }

    if (k.spinT > 0) {
      k.spinT -= dt;
      k.spinA = (1 - Math.max(0, k.spinT)) * Math.PI * 2;
      k.vx *= Math.exp(-2.8 * dt);
      k.vy *= Math.exp(-2.8 * dt);
      k.steer = 0;
      if (k.spinT <= 0) {
        k.spinA = 0;
        k.invT = 1;
      }
    }
    const boosting = k.boostT > 0 || k.miniT > 0 || k.padT > 0 || k.trickT > 0 || k.rushT > 0;
    if (boosting) k.st.boost += dt;
    if (k.rushT > 0) k.rushT -= dt;
    if (k.magnetT > 0) k.magnetT -= dt;
    if (k.mudT > 0) k.mudT -= dt;
    if (k.honkT > 0) k.honkT -= dt;
    if (k.item && k.rollT <= 0) k.heldT += dt;
    if (k.boostT > 0) k.boostT -= dt;
    if (k.miniT > 0) k.miniT -= dt;
    if (k.padT > 0) k.padT -= dt;
    if (k.trickT > 0) k.trickT -= dt;
    if (k.coinT > 0) k.coinT -= dt;
    if (k.draftT > 0) k.draftT -= dt;
    if (k.shieldT > 0) k.shieldT -= dt;
    if (k.snoozeT > 0) k.snoozeT -= dt;
    if (k.rampCool > 0) k.rampCool -= dt;
    if (k.rollT > 0) k.rollT -= dt;
    if (k.stallT > 0) k.stallT -= dt;
    if (k.invT > 0 && k.spinT <= 0) k.invT -= dt;
    if (k.hopT > 0) k.hopT -= dt;
    if (k.bumpT > 0) k.bumpT -= dt;
    if (k.landT > 0) k.landT = Math.max(0, k.landT - dt * 4);

    // Jumps: a parabolic hop; a trick in the air pays off on landing
    if (k.airT > 0) {
      k.airT -= dt;
      const autoTrick = k.toddler || k.assist === 2 || (k.bot && Math.random() < 0.02);
      if (!k.trickDone && autoTrick && k.airT < k.airMax * 0.6) doTrick(G, k);
      if (k.trickDone) k.trickA = Math.min(Math.PI * 2, k.trickA + dt * 12);
      if (k.airT <= 0) {
        k.airT = 0;
        k.trickA = 0;
        if (k.trickDone) {
          k.trickT = 0.6;
          if (isMe) sfx('trick');
        }
        k.trickDone = false;
        k.landT = 1;
        spawnParticles(G, k.x, k.y, 10, () => THEME.dust, 160, 0.4, 7);
        if (isMe) {
          sfx('land');
          G.shake = Math.max(G.shake, k.toddler ? 1 : 4);
          vibrate(25);
        }
      }
    }

    drive(k, dt, k.spinT > 0 ? 0 : throttle, k.spinT > 0 ? 0 : brake, speedMul, k.dist);

    // Track position, laps and off-road check
    const prev = k.idx;
    const near = nearestOnTrack(k.x, k.y, k.idx);
    k.idx = near.idx;
    k.dist = near.dist;
    const wasGrass = k.offroad;
    k.offroad = near.dist > HALF_W + CURB_W && !k.toddler;
    k.curb = !k.offroad && near.dist > HALF_W && k.airT <= 0;
    if (isMe && racing && !k.finished) {
      // The rumble strip: you can feel it before anything slows you down
      if (k.curb && Math.hypot(k.vx, k.vy) > 120) {
        k.curbT -= dt;
        if (k.curbT <= 0) {
          k.curbT = 0.15;
          vibrate(6);
          G.shake = Math.max(G.shake, 1.5);
        }
      } else k.curbT = 0;
      // Grass trips, rescue help, and the driving score
      if (k.offroad && k.airT <= 0) {
        k.grassT += dt;
        if (!wasGrass) k.lapGrass++;
        if (k.grassT > 0.5 && k.grassT - dt <= 0.5) {
          k.lapClean = false;
          if (k.assist > 0) k.rescue = Math.min(0.3, k.rescue + 0.12);
        }
      } else {
        k.grassT = 0;
        k.rescue = Math.max(0, k.rescue - 0.015 * dt);
      }
      if (!k.toddler && k.spinT <= 0) {
        const sc = k.sc;
        if (k.offroad) sc.grassT += dt;
        else sc.roadT += dt;
        if (Math.abs(k.autoSteer) > 0.25 && Math.hypot(k.vx, k.vy) > 120) {
          sc.bendT += dt;
          const mine = k.drifting ? k.driftDir : k.steerIn;
          if (mine * k.autoSteer > 0) sc.goodT += dt;
        }
      }
    }
    if (prev > n * 0.75 && k.idx < n * 0.25) {
      k.lap++;
      if (isMe) G.lapAt.push(Math.round(now - G.goAt));
      if (isMe && k.lap >= 2 && k.lap <= G.laps + 1 && !k.toddler && k.lapClean) {
        G.cleanLaps++;
        sfx('clean');
        spawnParticles(G, k.x, k.y, 24, (i) => (i % 2 ? '#fde047' : '#ffffff'), 220, 0.6, 6);
      }
      const wasClean = k.lapClean;
      k.lapClean = true;
      k.lapGrass = 0;
      if (isMe && k.lap >= 2 && k.lap <= G.laps) {
        if (wasClean && !k.toddler) {
          setBanner(G, k.lap === G.laps ? '✨ Clean lap! 🏁 FINAL LAP!' : `✨ Clean lap! LAP ${k.lap}/${G.laps}`, '#fde047', 2000);
          if (k.lap === G.laps) {
            sfx('finalLap');
            setMusicIntensity(1);
          }
        } else if (k.lap === G.laps) {
          setBanner(G, '🏁 FINAL LAP!', '#f472b6', 2000);
          sfx('finalLap');
          setMusicIntensity(1);
        } else {
          setBanner(G, `LAP ${k.lap}/${G.laps}`, '#ffffff', 1500);
          sfx('lap');
        }
      }
    } else if (prev < n * 0.25 && k.idx > n * 0.75) k.lap--;
    k.progress = k.lap * n + k.idx;

    // Wrong-way warning and auto-respawn when stuck far off the road
    const speedNow = Math.hypot(k.vx, k.vy);
    const facing = Math.cos(k.angle) * TRACK.tx[k.idx] + Math.sin(k.angle) * TRACK.ty[k.idx];
    k.wrongT = racing && facing < -0.3 && speedNow > 40 ? k.wrongT + dt : 0;
    if (isMe && k.wrongT > 1 && k.wrongT - dt <= 1 && k.assist > 0 && !k.toddler) k.rescue = Math.min(0.3, k.rescue + 0.12);
    k.offT = racing && near.dist > HALF_W * 1.9 && k.airT <= 0 ? k.offT + dt : 0;
    if (k.offT > 2.5 - 1.0 * (k.toddler ? 1 : k.help)) {
      const j = near.idx;
      k.x = TRACK.xs[j];
      k.y = TRACK.ys[j];
      k.angle = Math.atan2(TRACK.ty[j], TRACK.tx[j]);
      k.vx = 0;
      k.vy = 0;
      k.offT = 0;
      k.invT = 1.5;
      k.drifting = false;
      k.epoch++;
      spawnParticles(G, k.x, k.y, 20, () => '#ffffff', 200, 0.6, 8);
      if (isMe) setBanner(G, '✨ Back on track!', '#a5f3fc', 1200);
    }
    if (!k.finished && k.lap > G.laps) {
      k.finished = true;
      k.finishTime = now - G.goAt;
      if (!G.firstFinishAt && !k.bot) G.firstFinishAt = now; // robots never start the hurry-up timer
      if (isMe) {
        scoreRace(G, k);
        G.emit({ i: randId(), k: 'fin', ft: Math.round(k.finishTime), st: k.st });
        const place = ranked.filter((r) => r.finished && r.id !== k.id).length + 1;
        // Photo finish: someone else crossed within 0.3 s
        const close = all.some((r) => r.id !== k.id && ((r.finished && Math.abs(r.finishTime - k.finishTime) < 300) || (!r.finished && Math.abs(r.progress - k.progress) < 20)));
        if (close) setBanner(G, '📸 Photo finish!', '#fde047', 2200);
        sfx('finish');
        playFanfare(place);
        setMusicIntensity(2);
        vibrate([80, 60, 80, 60, 160]);
        spawnParticles(G, k.x, k.y, 160, (i) => `hsl(${(i * 37) % 360},95%,60%)`, 520, 1.6, 7);
        k.drifting = false;
      }
    }

    // Particles for boost and grass
    const speed = Math.hypot(k.vx, k.vy);
    if (k.boostT > 0 || k.padT > 0 || k.rushT > 0) {
      for (let i = 0; i < 3; i++) {
        if (G.particles.length > 450) G.particles.shift();
        const back = k.angle + Math.PI + (Math.random() - 0.5) * 0.6;
        G.particles.push({
          x: k.x - Math.cos(k.angle) * 28, y: k.y - Math.sin(k.angle) * 28,
          vx: Math.cos(back) * 160 + k.vx * 0.2, vy: Math.sin(back) * 160 + k.vy * 0.2,
          life: 0.5, max: 0.5, color: k.padT > 0 && k.boostT <= 0 && k.rushT <= 0 ? (i % 2 ? '#67e8f9' : '#fde047') : `hsl(${(now / 3 + i * 60) % 360},100%,60%)`, size: k.rushT > 0 ? 12 : 9,
        });
      }
    } else if (k.miniT > 0 || k.trickT > 0) {
      const c = k.trickT > 0 ? '#fde047' : k.miniT > 0.9 ? '#e879f9' : k.miniT > 0.6 ? '#fb923c' : '#60a5fa';
      for (let i = 0; i < 2; i++) {
        G.particles.push({ x: k.x - Math.cos(k.angle) * 28, y: k.y - Math.sin(k.angle) * 28, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, life: 0.35, max: 0.35, color: c, size: 7 });
      }
    } else if (k.offroad && !k.toddler && k.airT <= 0 && speed > 120 && Math.random() < 0.5) {
      G.particles.push({ x: k.x, y: k.y, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 0.5, max: 0.5, color: THEME.dust, size: 6 });
    }
    if ((k.draftC > 0.2 || k.draftT > 0) && Math.random() < 0.6) {
      // Wind lines while slipstreaming
      const side = (Math.random() - 0.5) * 50;
      G.particles.push({
        x: k.x + Math.cos(k.angle) * 30 - Math.sin(k.angle) * side, y: k.y + Math.sin(k.angle) * 30 + Math.cos(k.angle) * side,
        vx: -Math.cos(k.angle) * 420, vy: -Math.sin(k.angle) * 420, life: 0.18, max: 0.18, color: 'rgba(255,255,255,0.9)', size: 3,
      });
    }

    if (k.drifting && k.tier > 0) {
      const c = ['', '#60a5fa', '#fb923c', '#e879f9'][k.tier];
      for (const side of [-1, 1]) {
        if (G.particles.length > 450) G.particles.shift();
        const bx = k.x - Math.cos(k.angle) * 18 - Math.sin(k.angle) * 16 * side;
        const by = k.y - Math.sin(k.angle) * 18 + Math.cos(k.angle) * 16 * side;
        G.particles.push({ x: bx, y: by, vx: (Math.random() - 0.5) * 140, vy: (Math.random() - 0.5) * 140, life: 0.25, max: 0.25, color: c, size: 4 + k.tier });
      }
    } else if (k.stallT > 0 && Math.random() < 0.5) {
      G.particles.push({ x: k.x - Math.cos(k.angle) * 30, y: k.y - Math.sin(k.angle) * 30, vx: (Math.random() - 0.5) * 40, vy: -40, life: 0.6, max: 0.6, color: '#9ca3af', size: 9 });
    }

    if (!racing) continue;

    // Boost pads
    if (k.airT <= 0) {
      for (const p of FEATURES.pads) {
        if (Math.abs(idxDelta(k.idx, p.idx)) > PAD_LEN / 2 / SAMPLE_SPACING + 1) continue;
        if (Math.abs(lateralOf(k.x, k.y, k.idx) - p.lat) > PAD_W / 2 + 12) continue;
        if (k.padT < 0.85) {
          if (isMe) {
            sfx('boostPad');
            vibrate(50);
          }
          react(k, '🔥', 700);
        }
        k.padT = 1.0;
      }
      // Ramps
      const fwd = k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
      for (const r of FEATURES.ramps) {
        if (k.rampCool > 0 || fwd < 220) continue;
        if (Math.abs(idxDelta(k.idx, r.idx)) > RAMP_LEN / 2 / SAMPLE_SPACING + 1) continue;
        if (Math.abs(lateralOf(k.x, k.y, k.idx)) > HALF_W) continue;
        k.airT = k.airMax = AIR_TIME + clamp((fwd - 400) / 1500, 0, 0.15);
        k.rampCool = 1.2;
        k.trickDone = false;
        k.drifting = false;
        if (isMe) sfx('jump');
      }
    }

    // Hazard patches: a splash going in, then sticky going (see drive)
    if (k.airT <= 0 && !k.toddler && k.rushT <= 0) {
      for (const hz of FEATURES.hazards) {
        if (Math.abs(idxDelta(k.idx, hz.idx)) > 16) continue;
        if ((hz.x - k.x) ** 2 + (hz.y - k.y) ** 2 > hz.r * hz.r) continue;
        if (k.mudT <= 0) {
          const look = HAZARD_LOOK[hz.kind];
          spawnParticles(G, k.x, k.y, 14, () => look.splash, 230, 0.5, 8);
          react(k, look.emoji, 800);
          if (isMe) {
            sfx('land');
            vibrate(30);
            G.shake = Math.max(G.shake, 3);
          }
        }
        k.mudT = 0.3;
      }
    }

    // Slipstream: tuck in close behind someone to get pulled along
    if (!k.toddler && k.airT <= 0 && speed > 250) {
      let behind = false;
      const hx = Math.cos(k.angle);
      const hy = Math.sin(k.angle);
      for (const o of all) {
        if (o.id === k.id) continue;
        const dx = o.x - k.x;
        const dy = o.y - k.y;
        const d = Math.hypot(dx, dy);
        if (d < 45 || d > 230) continue;
        if ((dx * hx + dy * hy) / d > Math.cos(0.3)) {
          behind = true;
          break;
        }
      }
      if (behind && k.draftT <= 0) {
        k.draftC += dt;
        if (k.draftC >= 1) {
          k.draftC = 0;
          k.draftT = 1;
          if (isMe) sfx('whoosh');
        }
      } else if (!behind) k.draftC = Math.max(0, k.draftC - dt * 2);
    }

    // Coins (each device has its own coins). They belong to the player on
    // this device: robots never take one off the road. A robot's coin count
    // just ticks up over time instead, and a magnet gives it three at once.
    if (k.bot) {
      k.coinClock += dt;
      if (k.coinClock > 5) {
        k.coinClock = 0;
        if (k.coins < [4, 7, 10][G.botLevel]) k.coins++;
        k.st.coins++;
      }
    } else if (k.airT <= 0) {
      for (const c of G.coins) {
        if (now < c.hiddenUntil) continue;
        const cd = (c.x - k.x) ** 2 + (c.y - k.y) ** 2;
        if (cd < (k.magnetT > 0 ? MAGNET_REACH * MAGNET_REACH : 30 * 30)) {
          if (cd > 60 * 60) {
            // Pulled in by the magnet: a streak of gold from the coin to the kart
            for (let q = 0; q < 5; q++) {
              if (G.particles.length > 450) G.particles.shift();
              const f = q / 5;
              G.particles.push({ x: c.x + (k.x - c.x) * f, y: c.y + (k.y - c.y) * f, vx: (k.x - c.x) * 2 + k.vx * 0.6, vy: (k.y - c.y) * 2 + k.vy * 0.6, life: 0.3, max: 0.3, color: '#facc15', size: 7 });
            }
          }
          c.hiddenUntil = now + 8000;
          if (k.coins < 10) k.coins++;
          k.st.coins++;
          k.coinT = 0.25;
          if (isMe) sfx('coin', { pitch: Math.min(12, k.coins) });
        }
      }
    }

    // Item boxes
    for (const b of G.boxes) {
      if (now < b.hiddenUntil) continue;
      if ((b.x - k.x) ** 2 + (b.y - k.y) ** 2 < 36 * 36) {
        b.hiddenUntil = now + BOX_RESPAWN_MS;
        G.emit({ i: randId(), k: 'box', b: b.id, t: Math.round(now - G.goAt) }, k.bot); // a robot's pickup can ride with the next message
        spawnParticles(G, b.x, b.y, 16, (i) => `hsl(${i * 40},95%,65%)`, 260, 0.5, 6);
        if (!k.item) {
          const place = ranked.findIndex((r) => r.id === k.id) + 1;
          giveItem(G, k, place || 1, ranked.length);
        }
      }
    }

    // Banana peels
    for (let i = G.bananas.length - 1; i >= 0; i--) {
      const b = G.bananas[i];
      if (b.owner === k.id && now < b.safeUntil) continue;
      if (k.airT > 0) continue;
      if ((b.x - k.x) ** 2 + (b.y - k.y) ** 2 < 30 * 30) {
        if (k.toddler) continue; // the bubble rolls right over them
        G.bananas.splice(i, 1);
        G.emit({ i: randId(), k: 'bhit', b: b.id, v: k.id, o: b.owner });
        if (spinOut(G, k)) {
          creditHit(G, b.owner, k);
          ouch(G, k, b.owner, '🍌');
        }
      }
    }

    // Bot item use
    if (k.bot && !k.finished && k.item && k.rollT <= 0 && k.spinT <= 0) {
      k.botTimer -= dt;
      if (k.botTimer <= 0) {
        if (botWantsFire(G, k, all, now)) {
          fireItem(G, k, now);
          k.botTimer = 0.5 + Math.random() * 0.8;
        } else k.botTimer = 0.25; // look again in a moment
      }
    }
  }

  // Item roulette ticks for my kart: they slow down as it settles
  if (me.item && me.rollT > 0 && now >= G.nextTick) {
    sfx('itemRoll');
    G.nextTick = now + 60 + (1 - me.rollT / 1.2) * 140;
  } else if (me.item && me.rollT <= 0 && G.nextTick > 0) {
    G.nextTick = 0;
    sfx('itemGet');
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
        if (!eligible || k.airT > 0) continue;
        if ((bl.x - k.x) ** 2 + (bl.y - k.y) ** 2 < 38 * 38) {
          G.emit({ i: randId(), k: 'xhit', b: bl.id, v: k.id, o: bl.owner });
          if (spinOut(G, k)) {
            creditHit(G, bl.owner, k);
            ouch(G, k, bl.owner, '💥');
          }
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

  // Kart bumping (only the karts this device simulates get pushed). Karts
  // bounce apart and keep their speed along the bump instead of sticking.
  for (const k of G.karts) {
    if (k.airT > 0) continue;
    for (const o of all) {
      if (o.id === k.id) continue;
      const dx = k.x - o.x;
      const dy = k.y - o.y;
      const d = Math.hypot(dx, dy);
      const remote = G.remotes.get(o.id);
      const reach = KART_RADIUS * 2 * (remote ? 1.1 : 1);
      if (d > 0 && d < reach) {
        // Rainbow Rush: the rushing kart ploughs through and the other one spins
        if (o.rush && k.rushT <= 0 && spinOut(G, k)) {
          creditHit(G, o.id, k);
          ouch(G, k, o.id, '🌈');
          G.emit({ i: randId(), k: 'xhit', b: '-', v: k.id, o: o.id });
        }
        if (k.rushT > 0 && !o.rush) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (reach - d) * (remote ? 1 : 0.5);
        k.x += nx * push;
        k.y += ny * push;
        // The other kart's velocity: local karts we know, remote ones from their samples
        const ok = G.karts.find((x) => x.id === o.id);
        const ovx = ok ? ok.vx : remote ? remote.vx : 0;
        const ovy = ok ? ok.vy : remote ? remote.vy : 0;
        const closing = (ovx - k.vx) * nx + (ovy - k.vy) * ny; // > 0: coming together
        if (closing > 0) {
          // Each kart takes half the exchange (equal mass), plus a 35% bounce
          // Capped so a bump never costs much speed; the Toddler bubble barely slows
          const j = Math.min(70, closing * 0.5 * 1.25) * (k.toddler ? 0.35 : 1);
          k.vx += nx * j;
          k.vy += ny * j;
          // Sideways part keeps most of its speed
          const tx = -ny;
          const ty = nx;
          const side = k.vx * tx + k.vy * ty;
          k.vx -= tx * side * 0.08;
          k.vy -= ty * side * 0.08;
          k.bumpT = 0.35;
          if (k.id === G.meId && now - G.lastBump > 250) {
            G.lastBump = now;
            G.shake = Math.max(G.shake, Math.min(8, 2 + closing / 40));
            sfx('bump', { vol: clamp(closing / 200, 0.3, 1) });
            vibrate(Math.round(10 + closing / 10));
          }
        }
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

  // Race close: when every human is done, or 30 s after the first finish
  if (racing && !G.closedAt) {
    const humans = all.filter((r) => r.human);
    const allDone = G.mode === 'solo' ? me.finished && (all.every((r) => r.finished) || now - G.finishedAt > 12000) : humans.every((r) => r.finished);
    if ((me.finished && allDone) || (G.firstFinishAt && now - G.firstFinishAt > HURRY_MS && (G.mode === 'multi' || me.finished))) {
      G.closedAt = now;
      if (!me.finished) {
        me.finished = true;
        me.finishTime = 0; // did not finish: placed by progress
      }
      G.emit({ i: randId(), k: 'stats', st: me.st });
    } else if (G.mode === 'multi' && G.firstFinishAt && !me.finished && now - G.firstFinishAt > HURRY_MS - 10000 && (!G.banner || G.banner.text !== '⏰ Hurry!')) {
      if (now - G.firstFinishAt < HURRY_MS - 9900) setBanner(G, '⏰ Hurry!', '#fca5a5', 1800);
    }
  }
}

function doTrick(G: Game, k: Kart) {
  if (k.airT <= 0 || k.trickDone) return;
  k.trickDone = true;
  k.st.tricks++;
  react(k, '⭐', 900);
  spawnParticles(G, k.x, k.y, 10, () => '#fde047', 160, 0.4, 6);
  if (k.id === G.meId) vibrate(15);
}

/** An item of a kart simulated here hit someone (players on other devices report their own). */
function creditHit(G: Game, owner: string, victim: Kart) {
  const k = G.karts.find((x) => x.id === owner);
  if (!k || victim.id === owner) return;
  k.st.hits++;
  if (k.id === G.meId) setBanner(G, `🎯 You got ${victim.name}!`, '#86efac', 1300);
}

/** Another device reports that a kart there was hit: react, and credit my items. */
function gotOne(G: Game, ev: NetEvent) {
  const me = G.karts[0];
  const victim = G.remotes.get(String(ev.v ?? ''));
  if (victim) react(victim, '💫', 1300);
  if (ev.o === me.id && ev.v !== me.id) {
    me.st.hits++;
    if (victim) setBanner(G, `🎯 You got ${victim.name}!`, '#86efac', 1300);
  } else {
    const k = G.karts.find((x) => x.id === ev.o); // one of the robots I drive
    if (k && ev.v !== k.id) k.st.hits++;
  }
}

/** Tell me who got me. */
function ouch(G: Game, k: Kart, owner: string, icon: string) {
  if (k.id !== G.meId) return;
  G.hitLog.push(`${icon}${owner === k.id ? 'me' : owner}@${Math.round((performance.now() - G.goAt) / 1000)}`);
  setBanner(G, owner === k.id ? `${icon} Oops, that was yours!` : `${icon} ${nameOf(G, owner)} got you!`, '#fca5a5', 1300);
}

// ---------- Rendering ----------
function drawKart(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, spinA: number,
  kartIdx: number, paint: number, body: number, boost: boolean, toddler: boolean, t: number, driver = true,
  air = 0, shield = false,
) {
  const spec = KARTS[kartIdx] || KARTS[0];
  const col = kartColors(kartIdx, paint);
  const spinning = Math.abs(spinA) > 0.01;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = air > 0 ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 10, (body === 2 ? 38 : 32) * (1 - air / 160), (body === 2 ? 22 : 18) * (1 - air / 160), 0, 0, Math.PI * 2);
  ctx.fill();
  if (air > 0) {
    // In the air: lift and grow a little so the hop reads from above
    ctx.translate(0, -air * 0.6);
    ctx.scale(1 + air / 150, 1 + air / 150);
  }
  ctx.save();
  ctx.rotate(angle + spinA);
  // Body shape: [half length, half width, corner radius, wheel length, wheel width]
  const shapes = [
    [26, 14, 10, 14, 7],
    [32, 12, 8, 14, 6],
    [26, 16, 8, 20, 11],
    [30, 13, 12, 0, 0],
    [20, 14, 9, 13, 8],
    [22, 17, 17, 10, 6],
  ];
  const [hl, hw, cr, wl, ww] = shapes[body] || shapes[0];
  const roll = (t / 40) % 6;
  // Exhaust flames
  if (boost || body === 3) {
    const fl = (boost ? 18 : 7) + Math.sin(t / 30) * (boost ? 6 : 2);
    for (const s of body === 3 || body === 1 ? [-7, 7] : [-4, 4]) {
      ctx.fillStyle = boost ? '#f97316' : 'rgba(56,189,248,0.75)';
      ctx.beginPath();
      ctx.moveTo(-hl - 2, s - 4);
      ctx.lineTo(-hl - 2 - fl, s);
      ctx.lineTo(-hl - 2, s + 4);
      ctx.fill();
      ctx.fillStyle = boost ? '#fde047' : 'rgba(224,242,254,0.9)';
      ctx.beginPath();
      ctx.moveTo(-hl - 2, s - 2);
      ctx.lineTo(-hl - 2 - fl * 0.55, s);
      ctx.lineTo(-hl - 2, s + 2);
      ctx.fill();
    }
  }
  if (body === 3) {
    // Jet Racer: wings and glowing hover pads instead of wheels
    ctx.fillStyle = `rgba(103,232,249,${0.45 + Math.sin(t / 60) * 0.2})`;
    for (const [px, py] of [[-14, -8], [-14, 8], [14, -8], [14, 8]]) {
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col.dark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(4, s * hw);
      ctx.lineTo(-6, s * (hw + 13));
      ctx.lineTo(-15, s * (hw + 13));
      ctx.lineTo(-14, s * hw);
      ctx.fill();
    }
  } else {
    // Axles
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-hl * 0.62, -hw - ww + 3);
    ctx.lineTo(-hl * 0.62, hw + ww - 3);
    ctx.moveTo(hl * 0.55, -hw - ww + 3);
    ctx.lineTo(hl * 0.55, hw + ww - 3);
    ctx.stroke();
    // Tyres with rolling tread marks
    const wx1 = -hl * 0.62 - wl / 2;
    const wx2 = hl * 0.55 - wl / 2;
    for (const [wx, wy] of [[wx1, -hw - ww + 2], [wx2, -hw - ww + 2], [wx1, hw - 2], [wx2, hw - 2]]) {
      ctx.fillStyle = '#1f2430';
      roundRectPath(ctx, wx, wy, wl, ww, 2.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      for (let i = -1; i < wl / 6; i++) {
        const tx = wx + i * 6 + roll;
        if (tx > wx + 1 && tx < wx + wl - 2) ctx.fillRect(tx, wy + 1, 1.6, ww - 2);
      }
    }
  }
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  g.addColorStop(0, col.color);
  g.addColorStop(0.55, col.color);
  g.addColorStop(1, col.dark);
  ctx.fillStyle = g;
  if (body === 3 || body === 1) {
    // pointed nose
    ctx.beginPath();
    ctx.moveTo(hl + 8, 0);
    ctx.lineTo(hl - 10, -hw * 0.8);
    ctx.lineTo(hl - 18, -hw);
    ctx.lineTo(-hl, -hw);
    ctx.lineTo(-hl, hw);
    ctx.lineTo(hl - 18, hw);
    ctx.lineTo(hl - 10, hw * 0.8);
    ctx.closePath();
  } else if (body === 5) {
    ctx.beginPath();
    ctx.ellipse(0, 0, hl, hw, 0, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, -hl, -hw, hl * 2, hw * 2, cr);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Nose stripe and a shine along the top edge
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  roundRectPath(ctx, hl * 0.25, -2, hl * 0.6, 4, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRectPath(ctx, -hl * 0.8, -hw + 2, hl * 1.5, 3, 1.5);
  ctx.fill();
  // Side pods with a dark top stripe
  if (body === 0 || body === 1) {
    ctx.fillStyle = col.dark;
    roundRectPath(ctx, -hl * 0.3, -hw - 1, hl * 0.6, 3.5, 1.5);
    ctx.fill();
    roundRectPath(ctx, -hl * 0.3, hw - 2.5, hl * 0.6, 3.5, 1.5);
    ctx.fill();
  }
  // Cockpit: seat, dash and steering wheel
  ctx.fillStyle = '#1c2230';
  roundRectPath(ctx, -hl * 0.45, -8, 12, 16, 4);
  ctx.fill();
  ctx.fillStyle = '#111827';
  roundRectPath(ctx, hl * 0.3, -7, 4, 14, 2);
  ctx.fill();
  if (driver) {
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(hl * 0.2, 0, 2, 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Engine and exhaust pipes at the back
  if (body !== 5 && body !== 3) {
    ctx.fillStyle = '#374151';
    roundRectPath(ctx, -hl + 2, -6, 9, 12, 2);
    ctx.fill();
    ctx.fillStyle = '#e5e7eb';
    for (const s of [-4, 4]) {
      roundRectPath(ctx, -hl - 3, s - 1.3, 7, 2.6, 1.3);
      ctx.fill();
    }
  }
  if (body === 5) {
    // glass dome
    ctx.fillStyle = 'rgba(186,230,253,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, hl * 0.8, hw - 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Rear wing / roll bar
  ctx.fillStyle = col.dark;
  if (body === 0 || body === 1 || body === 3) {
    roundRectPath(ctx, -hl - 4, -hw - 2, 6, hw * 2 + 4, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-hl - 3, -hw - 1, 1.5, hw * 2 + 2);
  } else if (body === 4 || body === 2) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, -hl * 0.55, -hw + 2, hl * 0.9, hw * 2 - 4, 4);
    ctx.stroke();
  }
  // Driver: shoulders and arms reaching to the wheel, helmet on top
  if (driver) {
    const sw = spinning ? Math.sin(t / 60) * 3 : 0;
    ctx.fillStyle = col.dark;
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-hl * 0.25, -6);
    ctx.lineTo(hl * 0.2 - 1, -4.5 + sw);
    ctx.moveTo(-hl * 0.25, 6);
    ctx.lineTo(hl * 0.2 - 1, 4.5 - sw);
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hl * 0.2 - 0.5, s * 4.5 - s * sw, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col.dark;
    ctx.beginPath();
    ctx.ellipse(-hl * 0.27, 0, 5, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (driver) {
    // Helmet behind the character's face, then the face itself (kept upright)
    const c = Math.cos(angle + spinA);
    const sn = Math.sin(angle + spinA);
    const hx = -c * 7;
    const hy = -sn * 7 - 8;
    ctx.fillStyle = col.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hx, hy, 12.5, Math.PI * 1.1, Math.PI * 1.55);
    ctx.stroke();
    // Blink now and then; dizzy when spun out, grinning on boosts
    const blink = (t + kartIdx * 977) % 3400 < 130;
    const face = faceCanvas(spec.emoji, spinning ? 'dizzy' : boost ? 'happy' : blink ? 'blink' : 'idle');
    if (face) ctx.drawImage(face, hx + c * 2 - 21, hy + sn * 2 - 21, 42, 42);
    else drawEmoji(ctx, spec.emoji, hx + c * 2, hy + sn * 2, 32);
  }
  if (toddler || shield) {
    const r = 40 + Math.sin(t / 250) * 3;
    ctx.fillStyle = shield ? 'rgba(186,230,253,0.22)' : 'rgba(56,189,248,0.14)';
    ctx.strokeStyle = shield ? 'rgba(224,242,254,0.95)' : 'rgba(56,189,248,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** The little hop when a drift starts (visual only). */
function hopHeight(k: Kart) {
  return k.hopT > 0 ? Math.sin((1 - k.hopT / 0.18) * Math.PI) * 7 : 0;
}

function airHeight(airT: number, airMax: number) {
  const s = clamp(1 - airT / Math.max(0.01, airMax), 0, 1);
  return 4 * AIR_HEIGHT * s * (1 - s);
}

/** Reaction bubble (💫 🔥 ⭐ 💤 or an emote) floating over a kart. */
function drawReact(ctx: CanvasRenderingContext2D, r: { e: string; until: number } | null, x: number, y: number, now: number, snooze: boolean) {
  let e = r && now < r.until ? r.e : '';
  if (!e && snooze) e = '💤';
  if (!e) return;
  const left = r && now < r.until ? (r.until - now) / 1000 : 1;
  const bob = Math.sin(now / 120) * 3 - Math.min(1, 1.2 - left) * 6;
  drawEmoji(ctx, e, x + 30, y - 78 + bob, 34);
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

/** Smooth camera shake: three sine waves instead of random jitter (-1..1). */
function shakeNoise(now: number, seed: number) {
  const t = now / 1000;
  return (Math.sin(t * 23 + seed) * 0.5 + Math.sin(t * 31 + seed * 2.3) * 0.3 + Math.sin(t * 41 + seed * 3.1) * 0.2);
}

/** Points of the driving line ahead of my kart, coloured by how safe my speed is. */
type GuidePt = { x: number; y: number; c: number; a: number };
function showGuide(G: Game) {
  const me = G.karts[0];
  return G.phase === 'racing' && !me.toddler && !me.finished && me.help > 0;
}
function guideLine(k: Kart): GuidePt[] {
  const { xs, ys, tx, ty, n } = TRACK;
  const line = raceLine();
  const speed = Math.hypot(k.vx, k.vy);
  const out: GuidePt[] = [];
  const N = 56;
  for (let p = 0; p < N; p++) {
    const j = (k.idx + 6 + Math.round((p * 84) / (N - 1))) % n;
    const lat = line[j];
    const over = speed - safeSpeed(j, k.stats.maxSpeed);
    const c = over < 0 ? 0 : over < 60 ? 1 : 2;
    const a = Math.min(1, p / 8, (N - 1 - p) / 16);
    out.push({ x: xs[j] - ty[j] * lat, y: ys[j] + tx[j] * lat, c, a });
  }
  return out;
}
const GUIDE_COLORS = ['#4ade80', '#facc15', '#f87171'];

function render(ctx: CanvasRenderingContext2D, G: Game, track: HTMLCanvasElement, w: number, h: number, dpr: number, now: number, overlayOnly = false) {
  const me = G.karts[0];
  const fast = me.boostT > 0 || me.miniT > 0 || me.padT > 0 || me.trickT > 0;
  const rdt = G.renderAt ? clamp((now - G.renderAt) / 1000, 0, 0.1) : 1 / 60;
  G.renderAt = now;
  const speedR = clamp(Math.hypot(me.vx, me.vy) / me.stats.maxSpeed, 0, 1.4);
  // Frame-rate independent camera: zooms out a little with speed and more in boosts
  G.zoomK += ((fast ? 0.9 : 1 - 0.08 * Math.min(1, speedR)) - G.zoomK) * smoothK(3, rdt);
  const zoom = clamp(Math.min(w, h) / 720, 0.5, 1.35) * 0.92 * G.zoomK; // a touch wider to show the roomier roads
  const tx = me.x + me.vx * 0.35;
  const ty = me.y + me.vy * 0.35;
  G.camX += (tx - G.camX) * smoothK(7, rdt);
  G.camY += (ty - G.camY) * smoothK(7, rdt);
  const shx = G.shake > 0 ? shakeNoise(now, 0) * G.shake * 0.5 : 0;
  const shy = G.shake > 0 ? shakeNoise(now, 1.7) * G.shake * 0.5 : 0;
  if (overlayOnly) {
    // The 3D view draws the world; this canvas only adds speed lines and the minimap
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  } else {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME.outside;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (w / 2 - G.camX * zoom + shx), dpr * (h / 2 - G.camY * zoom + shy));
  ctx.drawImage(track, 0, 0);

  // Driving line (steering help only): fades away as help eases off
  const guideA = showGuide(G) ? 0.6 * me.help : 0;
  if (guideA > 0.02) {
    const pts = guideLine(me);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i];
      ctx.globalAlpha = guideA * p.a;
      ctx.fillStyle = GUIDE_COLORS[p.c];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

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

  // Coins
  for (const c of G.coins) {
    if (now < c.hiddenUntil) continue;
    const sx = Math.abs(Math.cos(now / 260 + c.x * 0.05));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(0.35 + 0.65 * sx, 1);
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
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
      draw: () => {
        if (k.invT > 0 && Math.floor(now / 90) % 2 === 0) return;
        const air = (k.airT > 0 ? airHeight(k.airT, k.airMax) : 0) + hopHeight(k);
        drawKart(ctx, k.x, k.y, k.angle + k.slip + k.trickA, k.spinA, k.kartIdx, k.paint, k.body, k.boostT > 0 || k.miniT > 0 || k.padT > 0 || k.trickT > 0, k.toddler, now, true, air, k.shieldT > 0);
      },
      tag: () => {
        drawTag(ctx, k.x, k.y - 52, isMe ? `⭐ ${k.name}` : k.name, kartColors(k.kartIdx, k.paint).color);
        drawReact(ctx, k.react, k.x, k.y, now, k.snoozeT > 0);
      },
    });
  }
  G.remotes.forEach((r) => {
    list.push({
      y: r.y,
      draw: () => {
        ctx.globalAlpha = r.alpha;
        const air = r.flags & F_AIR ? AIR_HEIGHT * 0.7 : 0;
        drawKart(ctx, r.x, r.y, r.angle, r.spinA, r.kartIdx, r.paint, r.body, !!(r.flags & F_BOOST), r.toddler, now, true, air, !!(r.flags & F_SHIELD));
        ctx.globalAlpha = 1;
      },
      tag: () => {
        const stale = r.net.ready() && r.net.silentFor(wall()) > 1.5;
        drawTag(ctx, r.x, r.y - 52, stale ? `📶 ${r.name}` : r.name, kartColors(r.kartIdx, r.paint).color);
        drawReact(ctx, r.react, r.x, r.y, now, !!(r.flags & F_SNOOZE));
      },
    });
  });
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.draw();
  for (const d of list) d.tag?.();
  }

  // Speed lines: wind streaks near top speed, stronger while boosting. Each
  // streak has a fixed direction and flies outward, so they never flicker.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lineA = fast ? 0.5 : clamp((speedR - 0.82) / 0.18, 0, 1) * 0.35;
  if (lineA > 0.01 && G.phase === 'racing' && !me.finished) {
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const cx = w / 2;
    const cy = overlayOnly ? h * 0.4 : h / 2;
    const R = Math.max(w, h);
    for (let i = 0; i < 22; i++) {
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const fr = seed - Math.floor(seed);
      const a = i * 2.39996 + fr * 0.5; // golden-angle spread
      const life = ((now / 350 + fr) % 1);
      const r0 = R * (0.18 + life * 0.5);
      const r1 = r0 + R * (0.06 + 0.06 * fr) * (fast ? 1.6 : 1);
      ctx.strokeStyle = `rgba(255,255,255,${(lineA * Math.sin(life * Math.PI)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  // Minimap
  const mw = Math.min(clamp(w * 0.22, 100, 190), (h * 0.26 * WORLD_W) / WORLD_H);
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
  G.remotes.forEach((r) => dots.push({ x: r.x, y: r.y, c: kartColors(r.kartIdx, r.paint).color, me: false }));
  for (const k of G.karts) dots.push({ x: k.x, y: k.y, c: kartColors(k.kartIdx, k.paint).color, me: k.id === G.meId });
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

/** A round speed dial on the race overlay. It sits where thumbs don't cover it. */
function drawSpeedGauge(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, speed: number, maxSpeed: number, boost: boolean, touch: boolean, now: number) {
  const small = Math.min(w, h) < 520;
  const r = small ? 34 : 46;
  // Touch screens: just above the steering buttons, clear of both thumbs
  const btn = w >= 640 ? 112 : 80;
  const cx = touch ? r + 18 : w - r - 22;
  const cy = touch ? h - btn - r - 34 : h - r - 22;
  const frac = clamp(speed / (maxSpeed * 1.25), 0, 1);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15,23,42,0.62)';
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = small ? 6 : 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 5, a0, a1);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.stroke();
  if (frac > 0.01) {
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0, '#4ade80');
    g.addColorStop(0.6, '#fde047');
    g.addColorStop(1, boost ? '#f472b6' : '#fb923c');
    ctx.beginPath();
    ctx.arc(cx, cy, r - 5, a0, a0 + (a1 - a0) * frac);
    ctx.strokeStyle = g;
    if (boost) {
      ctx.shadowColor = '#fb923c';
      ctx.shadowBlur = 10 + 6 * Math.sin(now / 60);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = boost ? '#fde047' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${small ? 20 : 26}px system-ui, sans-serif`;
  ctx.fillText(String(Math.round(speed * 0.22)), cx, cy - 1);
  ctx.font = `800 ${small ? 8 : 10}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(boost ? 'BOOST!' : 'km/h', cx, cy + (small ? 15 : 19));
  ctx.restore();
}

/** What to say out loud for a banner, or '' to stay quiet. */
function spokenFor(banner: string): string {
  // Strip emoji and symbols, keep the words
  const words = banner.replace(/(\d+)\/(\d+)/g, '$1 of $2').replace(/[^\p{L}\p{N}!?' ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!words || words.length > 40) return '';
  return words.charAt(0) + words.slice(1).toLowerCase();
}

const GFX_KEY = 'bendana-kart-gfx'; // { scale, detail } the 3D view settled on

// ---------- React UI ----------
type Profile = {
  name: string; kartIdx: number; toddler: boolean; trackIdx: number; muted: boolean; paint: number; body: number;
  cam: CamMode; assist: number; music: boolean; haptics: boolean; lite: boolean; laps: number; cup: number;
  bots: boolean; // robots fill the empty seats in online races
  botLevel: number; // 0 chill, 1 fair, 2 fast
};
// The host's current race: [id, track, order, go (host clock), laps, cup, round, robots]
// robots: [level, the device that drives them, [racer, body] for each one]
type BotTuple = [number, string, BotSpec[]];
type RaceTuple = [string, number, string[], number, number, number, number, BotTuple?];
type LobbyPlayer = {
  id: string; name: string; kartIdx: number; paint: number; body: number; toddler: boolean; assist: number;
  ready: boolean; host: boolean; joinedAt: number; trackIdx: number; laps: number; cup: number; race: RaceTuple | null;
  bots: boolean; botLevel: number;
};
type Standing = { id: string; name: string; kartIdx: number; place: number; time: string | null; isMe: boolean; frac: number; done: boolean };
type Award = { id: string; name: string; kartIdx: number; place: number; icon: string; title: string; isMe: boolean; time: string | null };
type Hud = {
  place: number;
  total: number;
  lap: number;
  laps: number;
  time: string;
  item: ItemKind | null;
  charges: number;
  rolling: boolean;
  countdown: number | null; // 4+ means "get ready", 1-3 the count, 0 GO
  finished: boolean;
  podium: boolean;
  boost: boolean;
  banner: string | null;
  bannerColor: string;
  wrongWay: boolean;
  tier: number;
  standings: Standing[];
  coins: number;
  air: boolean;
  hurry: number | null;
  draft: boolean;
  improved: boolean;
};
type Screen = 'menu' | 'lobby' | 'race';
type Panel = null | 'garage' | 'solo' | 'family' | 'settings' | 'help';
// Settings that live outside the profile (their own storage key)
type Prefs = { voice: boolean };

const CUPS = [
  { name: 'Sunshine Cup', emoji: '🌼', tracks: [0, 1, 3, 2], card: 'from-yellow-300 to-orange-500' },
  { name: 'Lava Cup', emoji: '🔥', tracks: [1, 2, 3, 4], card: 'from-orange-500 to-red-700' },
];
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
const EMOTES = ['👍', '😂', '😱', '🎉', '😜', '❤️'];
const MAX_PLAYERS = 5;

const EMPTY_HUD: Hud = {
  place: 1, total: 1, lap: 1, laps: 3, time: '0:00.0', item: null, charges: 0, rolling: false, countdown: 4, finished: false,
  podium: false, boost: false, banner: null, bannerColor: '#fff', wrongWay: false, tier: 0, standings: [], coins: 0, air: false,
  hurry: null, draft: false, improved: false,
};

function parseMeta(id: string, m: Meta | undefined): LobbyPlayer {
  const c = Array.isArray(m?.c) ? (m?.c as unknown[]) : [];
  const o = Array.isArray(m?.o) ? (m?.o as unknown[]) : [];
  const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
  let race: RaceTuple | null = null;
  const r = m?.race;
  if (Array.isArray(r) && r.length >= 7 && typeof r[0] === 'string' && Array.isArray(r[2])) {
    race = [r[0], clamp(num(r[1], 0), 0, TRACKS.length - 1), (r[2] as unknown[]).map(String).slice(0, MAX_PLAYERS), num(r[3], 0), clamp(num(r[4], 3), 1, 5), num(r[5], -1), num(r[6], 0)];
    const b = r[7];
    if (Array.isArray(b) && Array.isArray(b[2])) {
      const specs = (b[2] as unknown[])
        .filter((x): x is unknown[] => Array.isArray(x))
        .slice(0, Math.max(0, MAX_PLAYERS - race[2].length))
        .map((x) => [clamp(Math.floor(num(x[0], 0)), 0, KARTS.length - 1), clamp(Math.floor(num(x[1], 0)), 0, BODIES.length - 1)] as BotSpec);
      race[7] = [clamp(Math.floor(num(b[0], 1)), 0, 2), String(b[1] ?? ''), specs];
    }
  }
  return {
    id,
    name: String(m?.n ?? 'Racer').slice(0, 14) || 'Racer',
    kartIdx: clamp(Math.floor(num(c[0], 0)), 0, KARTS.length - 1),
    paint: clamp(Math.floor(num(c[1], -1)), -1, PAINTS.length - 1),
    body: clamp(Math.floor(num(c[2], 0)), 0, BODIES.length - 1),
    toddler: !!c[3],
    assist: clamp(Math.floor(num(c[4], 2)), 0, 2),
    ready: !!m?.r,
    host: !!m?.h,
    joinedAt: num(m?.j, 0),
    trackIdx: clamp(Math.floor(num(o[0], 0)), 0, TRACKS.length - 1),
    laps: clamp(Math.floor(num(o[1], 3)), 1, 5),
    cup: clamp(Math.floor(num(o[2], -1)), -1, CUPS.length - 1),
    bots: num(o[3], 1) !== 0,
    botLevel: clamp(Math.floor(num(o[4], 1)), 0, 2),
    race,
  };
}

/** The same rule on every device: the room creator, else the earliest joiner. */
function pickHost(list: LobbyPlayer[]): LobbyPlayer | null {
  if (!list.length) return null;
  const byJoin = (a: LobbyPlayer, b: LobbyPlayer) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id);
  const claim = list.filter((p) => p.host).sort(byJoin);
  return claim[0] ?? [...list].sort(byJoin)[0];
}

function computeHud(G: Game, now: number): Hud {
  const me = G.karts[0];
  const ranked = rankRacers(racers(G));
  const total = Math.max(1, G.laps * TRACK.n);
  const standings: Standing[] = ranked.map((r, i) => ({
    id: r.id, name: r.name, kartIdx: r.kartIdx, place: i + 1,
    time: r.finished && r.finishTime > 0 ? fmtTime(r.finishTime) : null, isMe: r.isMe,
    frac: r.finished ? 1 : clamp((r.progress - TRACK.n) / total, 0, 1), done: r.finished,
  }));
  let countdown: number | null = null;
  if (G.phase === 'countdown') countdown = Math.max(1, Math.ceil((G.goAt - now) / 1000));
  else if (now - G.goAt < 800) countdown = 0;
  let rollingItem = me.item;
  if (me.item && me.rollT > 0) rollingItem = ITEM_KINDS[Math.floor(now / 90) % ITEM_KINDS.length];
  const hurry = G.firstFinishAt && !G.closedAt && !me.finished ? Math.max(0, Math.ceil((HURRY_MS - (now - G.firstFinishAt)) / 1000)) : null;
  return {
    place: standings.findIndex((s) => s.isMe) + 1,
    total: standings.length,
    lap: clamp(me.lap, 1, G.laps),
    laps: G.laps,
    time: fmtTime(me.finished ? me.finishTime : G.phase === 'racing' ? now - G.goAt : 0),
    item: rollingItem,
    charges: me.item && me.rollT <= 0 ? me.charges : 0,
    rolling: !!me.item && me.rollT > 0,
    countdown,
    finished: me.finished && G.finishedAt > 0 && now - G.finishedAt > 2600,
    podium: G.closedAt > 0 && now - G.closedAt > 1800,
    boost: me.boostT > 0 || me.miniT > 0 || me.padT > 0 || me.trickT > 0,
    banner: G.banner && now < G.banner.until ? G.banner.text : null,
    bannerColor: G.banner ? G.banner.color : '#fff',
    wrongWay: me.wrongT > 1 && !me.finished,
    tier: me.drifting ? me.tier : 0,
    standings,
    coins: me.coins,
    air: me.airT > 0 && !me.trickDone && !me.toddler,
    hurry: hurry !== null && hurry <= 20 ? hurry : null,
    draft: me.draftC > 0.2 || me.draftT > 0,
    improved: G.improved,
  };
}

/** Every racer gets one award, so every kid wins something. */
function computeAwards(G: Game): Award[] {
  const ranked = rankRacers(racers(G));
  type Row = { id: string; name: string; kartIdx: number; place: number; isMe: boolean; time: string | null; st: RaceStats | null };
  const rows: Row[] = ranked.map((r, i) => {
    const local = G.karts.find((k) => k.id === r.id);
    const st = local ? local.st : G.remotes.get(r.id)?.stats ?? null;
    return { id: r.id, name: r.name, kartIdx: r.kartIdx, place: i + 1, isMe: r.isMe, time: r.finished && r.finishTime > 0 ? fmtTime(r.finishTime) : null, st };
  });
  const cats: { icon: string; title: string; score: (s: RaceStats) => number; min: number }[] = [
    { icon: '🔥', title: 'Drift Master', score: (s) => s.drifts, min: 1 },
    { icon: '🪙', title: 'Coin Collector', score: (s) => s.coins, min: 3 },
    { icon: '🎯', title: 'Sharp Shooter', score: (s) => s.hits, min: 1 },
    { icon: '🍌', title: 'Banana Boss', score: (s) => s.bananas, min: 1 },
    { icon: '🦘', title: 'Air Ace', score: (s) => s.tricks, min: 1 },
    { icon: '🚀', title: 'Speed Demon', score: (s) => s.boost, min: 2 },
    { icon: '🛡️', title: 'Safe Driver', score: (s) => 10 - s.hitBy, min: 10 },
  ];
  const got = new Map<string, { icon: string; title: string }>();
  if (rows[0]) got.set(rows[0].id, { icon: '🏆', title: 'Race Winner' });
  for (const c of cats) {
    let best: Row | null = null;
    let bestV = -Infinity;
    for (const r of rows) {
      if (got.has(r.id) || !r.st) continue;
      const v = c.score(r.st);
      if (v >= c.min && v > bestV) {
        bestV = v;
        best = r;
      }
    }
    if (best) got.set(best.id, { icon: c.icon, title: c.title });
  }
  const fallback = [
    { icon: '💪', title: 'Never Give Up' },
    { icon: '🤝', title: 'Good Sport' },
    { icon: '😄', title: 'Big Smiles' },
    { icon: '🌈', title: 'Rainbow Racer' },
    { icon: '⭐', title: 'Rising Star' },
  ];
  let fi = 0;
  return rows.map((r) => {
    const a = got.get(r.id) ?? fallback[fi++ % fallback.length];
    return { id: r.id, name: r.name, kartIdx: r.kartIdx, place: r.place, icon: a.icon, title: a.title, isMe: r.isMe, time: r.time };
  });
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

function KartPreview({ kartIdx, paint, body, size, driver = true }: { kartIdx: number; paint: number; body: number; size: number; driver?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * 0.75 * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    const scale = (size / 110) * dpr;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, 110, 83);
    drawKart(g, 55, 48, -0.35, 0, kartIdx, paint, body, false, false, 0, driver);
  }, [kartIdx, paint, body, size, driver]);
  return <canvas ref={ref} style={{ width: size, height: size * 0.75 }} aria-hidden />;
}

/** A spinning 3D model of the chosen kart and driver, with a 2D fallback. */
function KartTurntable({ kartIdx, paint, body, size }: { kartIdx: number; paint: number; body: number; size: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const show = useRef<KartShowcase | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let sc: KartShowcase;
    try {
      sc = new KartShowcase(c);
    } catch {
      setFailed(true);
      return;
    }
    show.current = sc;
    sc.setSize(size, Math.round(size * 0.75), window.devicePixelRatio || 1);
    // Only animate while the preview is on screen
    const io = new IntersectionObserver((es) => (es[0]?.isIntersecting ? sc.start() : sc.stop()));
    io.observe(c);
    return () => {
      io.disconnect();
      sc.dispose();
      show.current = null;
    };
  }, [size]);
  useEffect(() => {
    const k = KARTS[kartIdx] || KARTS[0];
    const col = kartColors(kartIdx, paint);
    show.current?.set({ body, color: col.color, dark: col.dark, emoji: k.emoji, name: k.name, isMe: true });
  }, [kartIdx, paint, body, size, failed]);
  if (failed) return <KartPreview kartIdx={kartIdx} paint={paint} body={body} size={size} />;
  return <canvas ref={ref} style={{ width: size, height: size * 0.75 }} aria-hidden />;
}

/** A racer's drawn face (falls back to the emoji). Grins when picked. */
function FaceIcon({ emoji, size, happy }: { emoji: string; size: number; happy?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const c = ref.current;
    const f = faceCanvas(emoji, happy ? 'happy' : 'idle');
    if (!c || !f) {
      setOk(false);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(f, 0, 0, c.width, c.height);
  }, [emoji, size, happy]);
  if (!ok) return <span className="text-4xl drop-shadow">{emoji}</span>;
  return <canvas ref={ref} style={{ width: size, height: size }} className="drop-shadow" aria-hidden />;
}

function KartPicker({ value, paint, body, onPick, onPaint, onBody, compact }: {
  value: number;
  paint: number;
  body: number;
  onPick: (i: number) => void;
  onPaint: (i: number) => void;
  onBody: (i: number) => void;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<'racer' | 'kart' | 'paint'>('racer');
  const sel = KARTS[value] || KARTS[0];
  const col = kartColors(value, paint);
  const st = kartStats(value, body);
  const tabs = [
    { id: 'racer' as const, label: '😀 Racer' },
    { id: 'kart' as const, label: '🏎️ Kart' },
    { id: 'paint' as const, label: '🎨 Paint' },
  ];
  return (
    <div className="flex flex-col gap-3">
      {/* The chosen racer, always in view while you try things on */}
      <div className="flex flex-col gap-3 rounded-3xl p-3 shadow-xl ring-2 ring-white/30 sm:flex-row sm:items-center" style={{ background: `linear-gradient(135deg, ${col.color}, ${col.dark})` }}>
        <div className="flex items-center gap-3 sm:w-80">
          <span className="rounded-2xl bg-white/25 p-1">
            <KartTurntable kartIdx={value} paint={paint} body={body} size={compact ? 124 : 168} />
          </span>
          <span>
            <span className="block text-2xl font-black leading-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{sel.name}</span>
            <span className="block text-sm font-bold text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{sel.blurb}</span>
            <span className="mt-1 inline-block rounded-full bg-black/25 px-2 py-0.5 text-xs font-black text-white">{BODIES[body]?.icon} {BODIES[body]?.name ?? 'Classic'} kart</span>
          </span>
        </div>
        <div className="flex-1 space-y-1 rounded-xl bg-black/25 p-2">
          <StatBar label="Speed" value={(st.maxSpeed - 470) / 160} />
          <StatBar label="Accel" value={(st.accel - 280) / 330} />
          <StatBar label="Steering" value={(st.turn - 2.1) / 1.8} />
          <StatBar label="Grip" value={(st.grip - 5) / 8} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-black/25 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              sfx('uiTap');
              setTab(t.id);
            }}
            className={`rounded-xl py-2.5 text-base font-black transition active:scale-95 ${tab === t.id ? 'bg-white text-slate-900 shadow' : 'text-white/90'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'racer' && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {KARTS.map((k, i) => {
            const active = i === value;
            return (
              <button
                key={k.name}
                type="button"
                onClick={() => {
                  sfx('uiTap', { pitch: 1 + (i % 8) * 0.04 });
                  onPick(i);
                }}
                aria-label={k.name}
                aria-pressed={active}
                className={`flex flex-col items-center rounded-2xl px-1 py-2 transition active:scale-95 ${active ? 'scale-105 shadow-xl ring-4 ring-white' : 'opacity-85 ring-2 ring-white/20 hover:opacity-100'}`}
                style={{ background: `linear-gradient(145deg, ${k.color}, ${k.dark})` }}
              >
                <FaceIcon emoji={k.emoji} size={compact ? 42 : 50} happy={active} />
                <span className="mt-1 text-center text-[10px] font-black leading-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)] sm:text-[11px]">{k.name}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'kart' && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {BODIES.map((b, i) => (
            <button
              key={b.name}
              type="button"
              onClick={() => {
                sfx('uiTap');
                onBody(i);
              }}
              aria-label={`${b.name} kart`}
              aria-pressed={body === i}
              className={`flex flex-col items-center rounded-2xl bg-white/15 px-1 py-2 transition active:scale-95 ${body === i ? 'scale-105 bg-white/35 ring-4 ring-white' : 'ring-2 ring-white/20 hover:bg-white/25'}`}
            >
              <KartPreview kartIdx={value} paint={paint} body={i} size={compact ? 64 : 78} driver={false} />
              <span className="text-xs font-black text-white drop-shadow">{b.icon} {b.name}</span>
              <span className="text-[10px] font-bold leading-tight text-white/80">{b.blurb}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'paint' && (
        <div className="grid grid-cols-5 gap-3 sm:grid-cols-9">
          <button
            type="button"
            onClick={() => {
              sfx('uiTap');
              onPaint(-1);
            }}
            aria-pressed={paint < 0}
            className={`flex aspect-square items-center justify-center rounded-full text-[11px] font-black text-white ring-2 transition active:scale-90 ${paint < 0 ? 'scale-110 ring-4 ring-white' : 'ring-white/40'}`}
            style={{ background: `linear-gradient(135deg, ${sel.color}, ${sel.dark})` }}
          >
            Classic
          </button>
          {PAINTS.map((pt, i) => (
            <button
              key={pt.name}
              type="button"
              aria-label={`${pt.name} paint`}
              aria-pressed={paint === i}
              onClick={() => {
                sfx('uiTap', { pitch: 0.9 + i * 0.05 });
                onPaint(i);
              }}
              className={`aspect-square rounded-full ring-2 transition active:scale-90 ${paint === i ? 'scale-110 ring-4 ring-white' : 'ring-white/40'}`}
              style={{ background: `linear-gradient(135deg, ${pt.color}, ${pt.dark})` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Track thumbnails: the real shape of each track, worked out once
const OUTLINES: (Float32Array | undefined)[] = [];
const THUMB_LOOKS: (ThumbLook | undefined)[] = [];
function trackOutline(i: number): Float32Array {
  let o = OUTLINES[i];
  if (!o) {
    const t = buildTrack(TRACKS[i]);
    const stride = 5;
    const n = Math.floor(t.n / stride);
    o = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      o[k * 2] = t.xs[k * stride] / WORLD_W;
      o[k * 2 + 1] = t.ys[k * stride] / WORLD_H;
    }
    OUTLINES[i] = o;
  }
  return o;
}
function TrackMap({ idx, width }: { idx: number; width: number }) {
  const t = TRACKS[idx] || TRACKS[0];
  let look = THUMB_LOOKS[idx];
  if (!look) {
    look = { grass: t.grassA, grass2: t.grassB, edge: t.edge, road: t.road, curb: t.curbB, line: t.line };
    THUMB_LOOKS[idx] = look;
  }
  return <TrackThumb pts={trackOutline(idx)} look={look} width={width} height={Math.round(width * 0.66)} />;
}

function TrackPicker({ value, onPick, disabled, best, laps }: { value: number; onPick: (i: number) => void; disabled?: boolean; best?: Record<string, number>; laps?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TRACKS.map((t, i) => {
        const active = i === value;
        const bt = best?.[`${i}:${laps ?? 3}`];
        return (
          <button
            key={t.name}
            type="button"
            disabled={disabled && !active}
            aria-pressed={active}
            onClick={() => {
              sfx('uiTap', { pitch: 0.9 + i * 0.06 });
              onPick(i);
            }}
            className={`flex flex-col items-center rounded-2xl bg-gradient-to-br ${t.card} p-2 text-center transition active:scale-95 disabled:opacity-40 ${active ? 'scale-[1.03] shadow-xl ring-4 ring-white' : 'opacity-90 ring-2 ring-white/20 hover:opacity-100'}`}
          >
            <span className="relative">
              <TrackMap idx={i} width={132} />
              <span className="absolute -left-1 -top-2 text-3xl drop-shadow">{t.emoji}</span>
            </span>
            <span className="mt-1 text-sm font-black text-white drop-shadow">{t.name}</span>
            <span className="text-[11px] font-bold leading-tight text-white/85">{t.blurb}</span>
            {bt ? <span className="mt-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-black text-yellow-200">⏱️ Best {fmtTime(bt)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** How to play, in pictures and few words. */
function HelpCards({ touch }: { touch: boolean }) {
  const cards = [
    { icon: '🟢', title: 'Go!', text: touch ? 'Hold the big green GAS button.' : 'Hold W or the up arrow.' },
    { icon: '↔️', title: 'Steer', text: touch ? 'Press ◀ and ▶ to turn.' : 'A and D, or the left and right arrows.' },
    { icon: '🔥', title: 'Drift', text: touch ? 'Hold a turn to slide. Let go for a speed boost!' : 'Hold Shift in a turn to slide. Let go for a speed boost!' },
    { icon: '🎁', title: 'Items', text: touch ? 'Drive through a ? box, then tap the item button.' : 'Drive through a ? box, then press Space.' },
    { icon: '⭐', title: 'Tricks', text: touch ? 'Tap ⭐ while you are in the air.' : 'Press Space while you are in the air.' },
    { icon: '🚀', title: 'Rocket start', text: 'Press GAS just before GO!' },
    { icon: '💨', title: 'Slipstream', text: 'Follow close behind a kart to get pulled along.' },
    { icon: '🪙', title: 'Coins', text: 'Each coin makes you a tiny bit faster. Collect 10!' },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.title} className="flex items-center gap-3 rounded-3xl bg-black/25 p-3 text-white ring-1 ring-white/20">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-3xl">{c.icon}</span>
            <span>
              <span className="block text-lg font-black leading-tight">{c.title}</span>
              <span className="block text-sm font-bold text-white/85">{c.text}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="rounded-3xl bg-black/25 p-4 text-sm font-bold text-white/90 ring-1 ring-white/20">
        Keyboard: W A S D or arrow keys to drive, Shift to drift, Space for items and tricks, C to switch camera, Q to look back, H to honk, Esc for the menu. Game controllers work too.
        Little racers can turn on Toddler Assist in Settings: the kart steers by itself and nothing can spin it out.
      </p>
    </>
  );
}

const ASSISTS = [
  { label: 'Off', blurb: 'You steer everything' },
  { label: 'A little', blurb: 'Nudges you back toward the road' },
  { label: 'Lots', blurb: 'Follows the road by itself, you just nudge' },
];
function AssistPicker({ value, onPick }: { value: number; onPick: (v: number) => void }) {
  // The driving score lives in this browser only; read it after mount
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sk = loadSkill();
    setReady(sk.n >= 3 && sk.s >= 0.8);
  }, []);
  return (
    <div className="mt-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20">
      <div className="flex items-center gap-2 text-white">
        <span className="text-2xl">🎯</span>
        <span className="text-base font-black">Steering help</span>
        <span className="ml-auto text-xs font-semibold text-white/75">{ASSISTS[value].blurb}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[2, 1, 0].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            className={`rounded-xl px-2 py-2 text-sm font-black transition active:scale-95 ${value === v ? 'bg-yellow-300 text-slate-900 shadow' : 'bg-black/25 text-white ring-1 ring-white/25'}`}
          >
            {ASSISTS[v].label}
          </button>
        ))}
      </div>
      {ready && value > 0 && <div className="mt-2 text-center text-sm font-black text-yellow-200">🌟 You&apos;re driving great! Ready to try less help?</div>}
    </div>
  );
}

/** Robot racers: how fast they are, and whether they fill empty seats online. */
function RobotPicker({ level, fill, disabled, showFill, onLevel, onFill }: {
  level: number; fill: boolean; disabled?: boolean; showFill: boolean; onLevel: (v: number) => void; onFill: (v: boolean) => void;
}) {
  const lv = BOT_LEVELS[level] ?? BOT_LEVELS[1];
  return (
    <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/20">
      <div className="flex items-center gap-2 text-white">
        <span className="text-2xl">🤖</span>
        <span className="text-base font-black">Robot racers</span>
        <span className="ml-auto text-xs font-semibold text-white/75">{lv.blurb}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {BOT_LEVELS.map((b, v) => (
          <button
            key={b.label}
            type="button"
            disabled={disabled}
            onClick={() => onLevel(v)}
            className={`rounded-xl px-2 py-2 text-sm font-black transition active:scale-95 disabled:opacity-60 ${level === v ? 'bg-yellow-300 text-slate-900 shadow' : 'bg-black/25 text-white ring-1 ring-white/25'}`}
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>
      {showFill && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFill(!fill)}
          className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-black transition active:scale-[0.98] disabled:opacity-60 ${fill ? 'bg-lime-300 text-lime-950' : 'bg-black/25 text-white ring-1 ring-white/25'}`}
        >
          <span className="flex-1">{fill ? `Robots fill the empty seats (always ${MAX_PLAYERS} racers)` : 'No robots online: players only'}</span>
          <span className={`flex h-6 w-11 items-center rounded-full p-0.5 ${fill ? 'justify-end bg-slate-900/80' : 'justify-start bg-black/30'}`}>
            <span className="h-5 w-5 rounded-full bg-white" />
          </span>
        </button>
      )}
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

/** Keep ?room=CODE in the address bar so a refresh rejoins the same room. */
function setRoomInUrl(code: string | null) {
  try {
    const u = new URL(window.location.href);
    if (code) u.searchParams.set('room', code);
    else u.searchParams.delete('room');
    window.history.replaceState(null, '', u.toString());
  } catch {
    /* ignore */
  }
}

function sessionId(): string {
  try {
    const k = 'bendana-kart-id';
    const v = window.sessionStorage.getItem(k);
    if (v && /^[a-z0-9]{8,16}$/.test(v)) return v;
    const id = randId();
    window.sessionStorage.setItem(k, id);
    return id;
  } catch {
    return randId();
  }
}

const FAMILY_KIT: Kit = {
  karts: KARTS,
  tracks: TRACKS,
  colors: kartColors,
  face: (i, size) => <FaceIcon emoji={(KARTS[i] || KARTS[0]).emoji} size={size} happy />,
  fmtTime,
};

/** The profile for the racer who is active on this device: their name and kart, plus this device's settings. */
function playerProfile(st: Store, base: Profile): Profile {
  const loc = activeLocal(st);
  const p = loc.prefs;
  return {
    ...base,
    name: st.board[loc.pid]?.n ?? '',
    kartIdx: p.kartIdx < KARTS.length ? p.kartIdx : 0,
    paint: p.paint < PAINTS.length ? p.paint : -1,
    body: p.body < BODIES.length ? p.body : 0,
    toddler: p.toddler,
    assist: p.assist,
    cam: CAM_MODES.some((m) => m.id === p.cam) ? (p.cam as CamMode) : 'chase',
  };
}

type CupState = { cup: number; round: number; totals: Record<string, { name: string; kartIdx: number; pts: number }>; scored: string[] };

export default function BendanaKartPage() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [profile, setProfile] = useState<Profile>({
    name: '', kartIdx: 0, toddler: false, trackIdx: 0, muted: false, paint: -1, body: 0, cam: 'chase', assist: 2,
    music: true, haptics: true, lite: false, laps: 3, cup: -1, bots: true, botLevel: 1,
  });
  const [joinCode, setJoinCode] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [netStatus, setNetStatus] = useState<NetStatus | 'idle'>('idle');
  const [netError, setNetError] = useState('');
  const [race, setRace] = useState<RaceCfg | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [isTouch, setIsTouch] = useState(false);
  const [myId, setMyId] = useState('');
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [rtt, setRtt] = useState(-1);
  const [emotes, setEmotes] = useState<Record<string, { e: string; key: number }>>({});
  const [awards, setAwards] = useState<Award[]>([]);
  const [cupView, setCupView] = useState<CupState | null>(null);
  const [autoStartAt, setAutoStartAt] = useState(0);
  const [netDebug, setNetDebug] = useState('');
  const [posFx, setPosFx] = useState<{ dir: number; key: number }>({ dir: 0, key: 0 });
  const [autoJoin, setAutoJoin] = useState<string | null>(null);
  // Saved racers, their stats and the family leaderboard (see players.ts)
  const [family, setFamily] = useState<Store | null>(null);
  const [famPanel, setFamPanel] = useState<FamilyPanel>(null);
  const [gain, setGain] = useState<Gain | null>(null);
  const familyRef = useRef<Store | null>(null);
  const boardTimerRef = useRef(0);
  const peersRef = useRef<Set<string>>(new Set());
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [raceMenu, setRaceMenu] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [prefs, setPrefs] = useState<Prefs>({ voice: true });
  const [canFullscreen, setCanFullscreen] = useState(false);


  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);
  // 360 cam angles, relative to the kart: yaw 0 is behind, PI is in front
  const orbitRef = useRef({ yaw: 2.3, pitch: 0.35, dist: 160 });
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const cycleCamRef = useRef<() => void>(() => undefined);
  const [camToast, setCamToast] = useState<{ text: string; key: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const roomRef = useRef<Room | null>(null);
  const supaRef = useRef<SupabaseClient | null>(null);
  const clockRef = useRef(new HostClock());
  const eventsRef = useRef(new EventLog());
  const samplerRef = useRef(new Sampler());
  const wakeRef = useRef<WakeLock | null>(null);
  const inputRef = useRef<Input>({ up: false, down: false, left: false, right: false, fire: false, drift: false, lookBack: false, ax: 0 });
  const isTouchRef = useRef(false);
  const profileRef = useRef<Profile>(profile);
  const firstProfileRef = useRef<Profile>(profile);
  const playersRef = useRef<LobbyPlayer[]>([]);
  const rosterRef = useRef<Map<string, Meta>>(new Map());
  const myIdRef = useRef('');
  const joinedAtRef = useRef(0);
  const hostClaimRef = useRef(false);
  const readyRef = useRef(false);
  const raceRef = useRef<RaceCfg | null>(null);
  const hostRaceRef = useRef<RaceTuple | null>(null);
  const playedRef = useRef<Set<string>>(new Set());
  const cupRef = useRef<CupState | null>(null);
  const lastTouchRef = useRef(0);
  const emoteAtRef = useRef(0);
  const debugRef = useRef(false);
  const autodriveRef = useRef(false);
  const testdriveRef = useRef<string | null>(null); // ?testdrive=0|1|2|t: a scripted driver for testing
  const botRosterRef = useRef<BotSpec[] | null>(null); // the robots stay the same from race to race

  const multiplayerReady = Boolean(SUPABASE_URL && SUPABASE_KEY);

  // One-time setup: player id, saved profile, touch detection, ?room= link
  useEffect(() => {
    const id = sessionId();
    myIdRef.current = id;
    setMyId(id);
    wakeRef.current = new WakeLock();
    let base = firstProfileRef.current;
    try {
      const saved = window.localStorage.getItem('bendana-kart-profile');
      if (saved) {
        const p = JSON.parse(saved) as Partial<Profile>;
        base = {
          name: typeof p.name === 'string' ? p.name.slice(0, 14) : '',
          kartIdx: typeof p.kartIdx === 'number' && p.kartIdx >= 0 && p.kartIdx < KARTS.length ? p.kartIdx : 0,
          toddler: !!p.toddler,
          trackIdx: typeof p.trackIdx === 'number' && p.trackIdx >= 0 && p.trackIdx < TRACKS.length ? p.trackIdx : 0,
          muted: !!p.muted,
          paint: typeof p.paint === 'number' && p.paint >= -1 && p.paint < PAINTS.length ? p.paint : -1,
          body: typeof p.body === 'number' && p.body >= 0 && p.body < BODIES.length ? p.body : 0,
          cam: CAM_MODES.some((m) => m.id === p.cam) ? (p.cam as CamMode) : 'chase',
          assist: typeof p.assist === 'number' && p.assist >= 0 && p.assist <= 2 ? p.assist : 2,
          music: p.music !== false,
          haptics: p.haptics !== false,
          lite: p.lite === true,
          laps: p.laps === 2 ? 2 : 3,
          cup: typeof p.cup === 'number' && p.cup >= -1 && p.cup < CUPS.length ? p.cup : -1,
          bots: p.bots !== false,
          botLevel: p.botLevel === 0 || p.botLevel === 2 ? p.botLevel : 1,
        };
      }
    } catch {
      /* storage unavailable */
    }
    try {
      const pr = JSON.parse(window.localStorage.getItem('bendana-kart-prefs') || 'null') as Partial<Prefs> | null;
      if (pr && typeof pr === 'object') setPrefs({ voice: pr.voice !== false });
    } catch {
      /* storage unavailable */
    }
    setCanFullscreen(typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    // Saved racers: the racer who played last on this device is ready to go
    const st = loadStore(base.name, base);
    familyRef.current = st;
    setFamily(st);
    skillOwner = st.active;
    setProfile(playerProfile(st, base));
    setProfileLoaded(true);
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    isTouchRef.current = touch;
    setIsTouch(touch);
    try {
      const q = new URLSearchParams(window.location.search);
      const code = q.get('room');
      if (code && /^[A-Za-z]{4}$/.test(code)) {
        const c = code.toUpperCase();
        setJoinCode(c);
        // Refreshed while in this room: go straight back in
        if (window.sessionStorage.getItem(`bendana-kart-joined-${c}`)) setAutoJoin(c);
        else setPanel('family'); // came from an invite link or the QR square: show the join button

      }
      debugRef.current = q.has('netdebug');
      autodriveRef.current = q.has('autodrive');
      testdriveRef.current = q.get('testdrive');
    } catch {
      /* ignore */
    }
    return () => wakeRef.current?.dispose();
  }, []);

  // Switch to the next camera (button, C key or controller Select)
  const cycleCam = useCallback(() => {
    const cur = profileRef.current.cam;
    const i = CAM_MODES.findIndex((m) => m.id === cur);
    const next = CAM_MODES[(i + 1) % CAM_MODES.length];
    profileRef.current = { ...profileRef.current, cam: next.id };
    setProfile((p) => ({ ...p, cam: next.id }));
    setCamToast({ text: `${next.icon} ${next.label}${next.id === 'orbit' ? ': drag to spin around' : ''}`, key: Date.now() });
  }, []);
  cycleCamRef.current = cycleCam;
  useEffect(() => {
    if (!camToast) return;
    const t = window.setTimeout(() => setCamToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [camToast]);

  // 360 cam: drag on the screen to swing around the kart, scroll to zoom
  const orbitHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (profileRef.current.cam !== 'orbit' || dragRef.current) return;
      dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== e.pointerId) return;
      const o = orbitRef.current;
      o.yaw -= (e.clientX - d.x) * 0.009;
      o.pitch = clamp(o.pitch + (e.clientY - d.y) * 0.006, 0.06, 1.35);
      d.x = e.clientX;
      d.y = e.clientY;
    },
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    },
    onPointerCancel: () => {
      dragRef.current = null;
    },
    onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (profileRef.current.cam !== 'orbit') return;
      const o = orbitRef.current;
      o.dist = clamp(o.dist * (1 + e.deltaY * 0.001), 70, 420);
    },
  };

  useEffect(() => {
    profileRef.current = profile;
    setMuted(profile.muted);
    setMusicOn(profile.music);
    setHaptics(profile.haptics);
    if (profile === firstProfileRef.current) return; // nothing loaded yet
    if (!profileLoaded) return; // never overwrite the saved profile before it has been read
    try {
      window.localStorage.setItem('bendana-kart-profile', JSON.stringify(profile));
    } catch {
      /* storage unavailable */
    }
    // Name and kart changes belong to the active racer
    const st = familyRef.current;
    if (st) {
      const next = syncActive(st, profile.name, profile);
      if (next !== st) {
        familyRef.current = next;
        setFamily(next);
        saveStore(next);
      }
    }
  }, [profile, profileLoaded]);

  // Settings kept outside the profile
  useEffect(() => {
    setVoiceOn(prefs.voice);
    if (!profileLoaded) return;
    try {
      window.localStorage.setItem('bendana-kart-prefs', JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs, profileLoaded]);
  useEffect(() => {
    setVoiceMuted(profile.muted);
  }, [profile.muted]);

  // Screen size, for sizing the big kart on the home screen
  const [vp, setVp] = useState({ w: 1024, h: 768 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /** Every tap on a menu wakes up sound and speech (browsers need a touch first). */
  const wake = useCallback(() => {
    unlockAudio();
    unlockVoice();
  }, []);
  const openPanel = useCallback((pn: Panel) => {
    unlockAudio();
    unlockVoice();
    sfx(pn ? 'uiOpen' : 'uiBack');
    setPanel(pn);
  }, []);
  const closePanel = useCallback(() => {
    sfx('uiBack');
    setPanel(null);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* not allowed here */
    }
  };

  // A fanfare when the results bring a new best time, a new level or a badge
  useEffect(() => {
    if (!gain) return;
    if (gain.bestTime || gain.bestLap || gain.levelUp) sfx('record');
    else if (gain.badges.length) sfx('sticker');
  }, [gain]);

  // Changing screens closes any open panel
  const prevScreenRef = useRef<Screen>('menu');
  useEffect(() => {
    if (prevScreenRef.current === screen) return;
    prevScreenRef.current = screen;
    setPanel(null);
  }, [screen]);

  // Esc opens and closes the race menu
  useEffect(() => {
    if (screen !== 'race') {
      setRaceMenu(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      setLeaveArmed(false);
      setRaceMenu((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const commitFamily = useCallback((st: Store) => {
    familyRef.current = st;
    skillOwner = st.active;
    setFamily(st);
    saveStore(st);
  }, []);

  /** Switch to a saved racer (or one just made): their name, kart and settings come back. */
  const switchTo = useCallback((st: Store) => {
    commitFamily(st);
    const next = playerProfile(st, profileRef.current);
    profileRef.current = next;
    setProfile(next);
    setFamPanel(null);
  }, [commitFamily]);
  const pickPlayer = (pid: string) => {
    const st = familyRef.current;
    if (!st || st.active === pid) return;
    unlockAudio();
    sfx('ready');
    switchTo(setActive(st, pid));
  };
  const createPlayer = (name: string) => {
    const st = familyRef.current;
    if (st) switchTo(addPlayer(st, name, KARTS.length));
  };
  const adoptBoardPlayer = (pid: string) => {
    const st = familyRef.current;
    if (st) switchTo(adoptPlayer(st, pid));
  };
  const removePlayer = (pid: string) => {
    const st = familyRef.current;
    if (st) switchTo(removeLocal(st, pid, KARTS.length));
  };

  /** Send what this device knows of the leaderboard to the others in the room. */
  const sendBoard = useCallback((only?: string) => {
    const st = familyRef.current;
    const rm = roomRef.current;
    if (!st || !rm) return;
    const recs = wireBoard(st, only);
    if (recs.length) rm.send('lb', { id: myIdRef.current, recs }, { force: true });
  }, []);
  /** A moment after someone joins, share the board (spread out so devices do not all talk at once). */
  const scheduleBoard = useCallback(() => {
    if (boardTimerRef.current) return;
    boardTimerRef.current = window.setTimeout(() => {
      boardTimerRef.current = 0;
      if (!gameRef.current || gameRef.current.closedAt) sendBoard();
      else scheduleBoard(); // mid-race: wait for the finish
    }, 1200 + Math.random() * 1800);
  }, [sendBoard]);
  useEffect(() => () => window.clearTimeout(boardTimerRef.current), []);

  // Menu music, and keep the screen awake while in a room or a race
  useEffect(() => {
    if (screen !== 'race') startMusic(-1);
    wakeRef.current?.set(screen !== 'menu');
  }, [screen]);

  const getSupabase = useCallback((): SupabaseClient | null => {
    if (supaRef.current) return supaRef.current;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    let client: SupabaseClient | null = null;
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: {
        // Heartbeats from a worker keep the socket alive when the browser
        // throttles timers; a failed heartbeat reconnects straight away.
        worker: true,
        heartbeatIntervalMs: 15000,
        heartbeatCallback: (status: string) => {
          if (status === 'disconnected' || status === 'timeout') {
            try {
              client?.realtime.connect();
            } catch {
              /* ignore */
            }
          }
        },
      },
    });
    supaRef.current = client;
    return client;
  }, []);

  // ---------- Starting races ----------
  const startRace = useCallback((cfg: RaceCfg) => {
    setHud(EMPTY_HUD);
    setAwards([]);
    setGain(null);
    setRaceMenu(false);
    setPanel(null);
    setFamPanel(null);
    raceRef.current = cfg;
    playedRef.current.add(cfg.id);
    readyRef.current = false;
    setReady(false);
    setAutoStartAt(0);
    setRace(cfg);
    setScreen('race');
  }, []);

  const startSolo = useCallback((track: number, cup: number, round: number) => {
    unlockAudio();
    const p = profileRef.current;
    if (cup >= 0 && round === 0) cupRef.current = { cup, round: 0, totals: {}, scored: [] };
    if (cup < 0) cupRef.current = null;
    if (cupRef.current) cupRef.current.round = round;
    setCupView(cupRef.current ? { ...cupRef.current } : null);
    const t = cup >= 0 ? CUPS[cup].tracks[round] : track;
    const bots = pickBots(4, [p.kartIdx], cup >= 0 && round > 0 ? botRosterRef.current : null);
    botRosterRef.current = bots;
    startRace({
      mode: 'solo', id: randId(), order: [], track: t, laps: p.toddler ? 2 : p.laps, goWall: wall() + 3800, cup, round, nonce: Math.random(),
      bots, botLevel: p.botLevel, botOwner: myIdRef.current,
    });
  }, [startRace]);

  // ---------- The room ----------
  const myMeta = useCallback((): Meta => {
    const p = profileRef.current;
    const m: Meta = {
      v: 2, n: p.name || 'Racer', c: [p.kartIdx, p.paint, p.body, p.toddler ? 1 : 0, p.assist],
      r: readyRef.current ? 1 : 0, h: hostClaimRef.current ? 1 : 0, j: joinedAtRef.current, o: [p.trackIdx, p.laps, p.cup, p.bots ? 1 : 0, p.botLevel],
    };
    if (hostRaceRef.current) m.race = hostRaceRef.current;
    return m;
  }, []);

  const pushMeta = useCallback((urgent = false) => {
    roomRef.current?.setMeta(myMeta(), urgent);
  }, [myMeta]);

  const leaveRoom = useCallback(() => {
    const r = roomRef.current;
    roomRef.current = null;
    if (r) void r.close();
    hostRaceRef.current = null;
    rosterRef.current = new Map();
    peersRef.current = new Set();
    setRoom(null);
    setPlayers([]);
    playersRef.current = [];
    setNetStatus('idle');
    setReady(false);
    readyRef.current = false;
    setRoomInUrl(null);
  }, []);

  useEffect(() => () => {
    const r = roomRef.current;
    roomRef.current = null;
    if (r) void r.close();
  }, []);

  /** Start (or join late) the host's race, converting GO to my clock. */
  const joinHostRace = useCallback((t: RaceTuple, hintTs?: number, recv?: number) => {
    const [id, track, order, go, laps, cup, round, bt] = t;
    if (playedRef.current.has(id) || raceRef.current?.id === id) return;
    if (!order.includes(myIdRef.current)) return; // not in this race: wait in the lobby
    const clock = clockRef.current;
    let off = clock.offset;
    if (!clock.synced() && hintTs && recv) off = hintTs - recv + 40; // rough guess until pings return
    const goWall = go - off;
    if (goWall < wall() - 180000) return; // an old race
    if (cup >= 0) {
      if (!cupRef.current || cupRef.current.cup !== cup || round === 0) cupRef.current = { cup, round, totals: {}, scored: [] };
      cupRef.current.round = round;
    } else cupRef.current = null;
    setCupView(cupRef.current ? { ...cupRef.current } : null);
    startRace({
      mode: 'multi', id, order, track, laps, goWall, cup, round, nonce: Math.random(),
      bots: bt ? bt[2] : [], botLevel: bt ? bt[0] : 1, botOwner: bt ? bt[1] : '',
    });
  }, [startRace]);

  const applyEvent = useCallback((from: string, raceId: unknown, ev: NetEvent) => {
    if (!ev || typeof ev.i !== 'string' || !eventsRef.current.fresh(ev.i)) return;
    const G = gameRef.current;
    if (ev.k === 'emote') {
      const e = String(ev.e ?? '');
      if (!EMOTES.includes(e)) return;
      setEmotes((m) => ({ ...m, [from]: { e, key: Math.random() } }));
      const r = G?.remotes.get(from);
      if (r) react(r, e, 2000);
      sfx('emote');
      return;
    }
    if (!G || G.mode !== 'multi' || raceId !== G.raceId) return;
    const now = performance.now();
    const r = G.remotes.get(from);
    switch (ev.k) {
      case 'box': {
        const b = G.boxes.find((x) => x.id === ev.b);
        if (b) b.hiddenUntil = G.goAt + Number(ev.t || 0) + BOX_RESPAWN_MS;
        break;
      }
      case 'drop':
        if (!G.bananas.some((b) => b.id === ev.i)) G.bananas.push({ id: ev.i, x: Number(ev.x), y: Number(ev.y), owner: String(ev.o), safeUntil: 0 });
        break;
      case 'bhit': {
        const b = G.bananas.find((x) => x.id === ev.b);
        if (b) spawnParticles(G, b.x, b.y, 12, () => '#fde047', 200, 0.5, 6);
        G.bananas = G.bananas.filter((x) => x.id !== ev.b);
        gotOne(G, ev);
        break;
      }
      case 'fire': {
        if (G.blasts.some((b) => b.id === ev.i)) break;
        const target = ev.tg ? String(ev.tg) : null;
        G.blasts.push({ id: ev.i, x: Number(ev.x), y: Number(ev.y), angle: Number(ev.a), owner: String(ev.o), target, life: target ? 4 : 2.5 });
        break;
      }
      case 'xhit': {
        const bl = G.blasts.find((b) => b.id === ev.b);
        if (bl) spawnParticles(G, bl.x, bl.y, 18, (j) => (j % 2 ? '#f97316' : '#fde047'), 280, 0.5, 8);
        G.blasts = G.blasts.filter((b) => b.id !== ev.b);
        gotOne(G, ev);
        break;
      }
      case 'snooze':
        snoozeAhead(G, String(ev.o), Number(ev.p) || 0);
        break;
      case 'honk':
        honkAt(G, String(ev.o), Number(ev.x) || 0, Number(ev.y) || 0);
        break;
      case 'fin':
        if (r) {
          r.finished = true;
          r.finishTime = Number(ev.ft) || 0;
          if (ev.st && typeof ev.st === 'object') r.stats = ev.st as RaceStats;
          if (!G.firstFinishAt) G.firstFinishAt = now;
        }
        break;
      case 'stats':
        if (r && ev.st && typeof ev.st === 'object') r.stats = ev.st as RaceStats;
        if (r && !r.finished) {
          r.finished = true;
          r.finishTime = 0;
        }
        break;
    }
  }, []);

  const refreshPlayers = useCallback(() => {
    const rm = roomRef.current;
    if (!rm) return;
    const pres = rm.presence();
    rosterRef.current = pres;
    const list: LobbyPlayer[] = [];
    pres.forEach((m, id) => list.push(parseMeta(id, m)));
    list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    playersRef.current = list;
    setPlayers(list);
    rm.setPlayers(Math.min(MAX_PLAYERS, list.length));
    // Someone new in the room: swap leaderboards
    const seen = peersRef.current;
    let fresh = false;
    for (const p of list) {
      if (p.id !== myIdRef.current && !seen.has(p.id)) {
        seen.add(p.id);
        fresh = true;
      }
    }
    if (fresh) scheduleBoard();
    const host = pickHost(list);
    const meHost = !!host && host.id === myIdRef.current;
    clockRef.current.setHost(host?.id ?? '', meHost);
    // A sixth device politely leaves
    const idx = list.findIndex((p) => p.id === myIdRef.current);
    if (idx >= MAX_PLAYERS) {
      setNetError(`This room is full (${MAX_PLAYERS} racers). Try another code.`);
      leaveRoom();
      setScreen('menu');
      return;
    }
    // Missed the start message? The host's presence still has the race.
    if (host && !meHost && host.race) joinHostRace(host.race);
    // Karts that left fade out; karts that came back stay
    const G = gameRef.current;
    if (G) {
      const now = performance.now();
      G.remotes.forEach((r, id) => {
        if (r.bot || pres.has(id)) r.leftAt = 0;
        else if (!r.leftAt) r.leftAt = now;
      });
    }
  }, [joinHostRace, leaveRoom, scheduleBoard]);

  const joinRoom = useCallback((code: string, asHost: boolean) => {
    unlockAudio();
    setNetError('');
    leaveRoom();
    const sim = readSimOpts();
    let rm: Room;
    const topic = CHANNEL_PREFIX + code;
    if (sim) rm = new LocalRoom(topic, myIdRef.current, sim);
    else {
      const sb = getSupabase();
      if (!sb) {
        setNetError('Multiplayer is not set up yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        return;
      }
      rm = new SupabaseRoom(sb, topic, myIdRef.current);
    }
    try {
      const key = `bendana-kart-host-${code}`;
      if (asHost) window.sessionStorage.setItem(key, '1');
      hostClaimRef.current = asHost || window.sessionStorage.getItem(key) === '1';
      const jk = `bendana-kart-joined-${code}`;
      const prevJ = Number(window.sessionStorage.getItem(jk));
      joinedAtRef.current = prevJ > 0 ? prevJ : Date.now();
      window.sessionStorage.setItem(jk, String(joinedAtRef.current));
    } catch {
      hostClaimRef.current = asHost;
      joinedAtRef.current = Date.now();
    }
    clockRef.current.reset();
    roomRef.current = rm;
    rm.onStatus((s) => setNetStatus(s));
    rm.onPresence(() => {
      if (roomRef.current === rm) refreshPlayers();
    });
    rm.on('_joined', () => {
      const G = gameRef.current;
      if (G) samplerRef.current.reset();
      refreshPlayers();
    });
    rm.on('st', (p, recv) => {
      const G = gameRef.current;
      if (!G || G.mode !== 'multi' || p.r !== G.raceId) return;
      const id = String(p.id ?? '');
      if (!id || id === G.meId) return;
      let r = G.remotes.get(id);
      if (!r) {
        const m = parseMeta(id, rosterRef.current.get(id));
        const slot = raceRef.current ? Math.max(0, raceRef.current.order.indexOf(id)) : G.remotes.size + 1;
        r = makeRemote(id, m.name, m.kartIdx, m.paint, m.body, m.toddler, slot);
        G.remotes.set(id, r);
      }
      const epoch = Number(p.e) || 0;
      r.net.ingest(parseSamples(p.s, epoch), Number(p.q) || 0, Number(p.ts) || recv, Number(p.iv) || 0, recv);
      r.lap = Number(p.l) || 0;
      r.idx = clamp(Number(p.i) || 0, 0, TRACK.n - 1);
      r.progress = r.lap * TRACK.n + r.idx;
      r.coins = Number(p.c) || 0;
      r.spinA = Number(p.sp) || 0;
      r.leftAt = 0;
      const last = r.net.samples[r.net.samples.length - 1];
      if (last && last.f & F_DONE && !r.finished) {
        r.finished = true;
        r.finishTime = Number(p.ft) || 0;
        if (!G.firstFinishAt) G.firstFinishAt = performance.now();
      }
      r.pkProg = r.progress;
      // Robots this player's device is driving ride along in the same message
      if (Array.isArray(p.b) && p.b.length) {
        // Two devices driving the robots: the lower id keeps them
        const mine = G.karts.some((k) => k.bot);
        if (mine && id < G.meId) yieldBots(G, id);
        if (!mine || id < G.meId) G.botOwner = id;
        for (const raw of mine && id > G.meId ? [] : (p.b as unknown[]).slice(0, MAX_PLAYERS)) {
          if (!Array.isArray(raw) || typeof raw[0] !== 'string') continue;
          const [bid, lap, bi, coins, spinA, ft, be, bs, bk, bb] = raw as [string, number, number, number, number, number, number, unknown, number, number];
          let br = G.remotes.get(bid);
          if (!br) {
            const kIdx = clamp(Math.floor(Number(bk) || 0), 0, KARTS.length - 1);
            br = makeRemote(bid, KARTS[kIdx].name, kIdx, -1, clamp(Math.floor(Number(bb) || 0), 0, BODIES.length - 1), false, G.remotes.size + 1);
            br.bot = true;
            G.remotes.set(bid, br);
          }
          if (!br.bot) continue;
          if (br.owner !== id) {
            // A new device took these robots over: its clock is different, so start a fresh timeline
            br.owner = id;
            br.net = new RemoteKart();
          }
          br.net.ingest(parseSamples(bs, Number(be) || 0), Number(p.q) || 0, Number(p.ts) || recv, Number(p.iv) || 0, recv);
          br.lap = Number(lap) || 0;
          br.idx = clamp(Number(bi) || 0, 0, TRACK.n - 1);
          br.progress = br.pkProg = br.lap * TRACK.n + br.idx;
          br.coins = Number(coins) || 0;
          br.spinA = Number(spinA) || 0;
          const bl = br.net.samples[br.net.samples.length - 1];
          if (bl && bl.f & F_DONE && !br.finished) {
            br.finished = true;
            br.finishTime = Number(ft) || 0;
          }
        }
      }
      if (Array.isArray(p.ev)) for (const ev of p.ev as NetEvent[]) applyEvent(id, p.r, ev);
    });
    rm.on('ev', (p) => {
      if (!Array.isArray(p.l)) return;
      for (const ev of p.l as NetEvent[]) applyEvent(String(p.id ?? ''), p.r, ev);
    });
    rm.on('ping', (p, recv) => {
      if (p.h !== myIdRef.current) return;
      rm.send('pong', { to: p.f, t0: p.t0, t1: recv }, { force: true });
    });
    rm.on('pong', (p, recv) => {
      clockRef.current.onPong(p, recv, myIdRef.current);
      if (clockRef.current.rtt >= 0) setRtt(Math.round(clockRef.current.rtt));
    });
    rm.on('start', (p, recv) => {
      const host = pickHost(playersRef.current);
      const t = p.race as RaceTuple | undefined;
      if (!t || !Array.isArray(t) || (host && p.from !== host.id)) return;
      joinHostRace(parseMeta('x', { race: t }).race ?? t, Number(p.ts), recv);
    });
    rm.on('lb', (p) => {
      const st = familyRef.current;
      if (!st) return;
      const res = mergeBoard(st, p.recs);
      if (res.changed) commitFamily(res.store);
    });
    rm.on('lobby', (p) => {
      if (raceRef.current && p.r === raceRef.current.id) {
        raceRef.current = null;
        setRace(null);
        setScreen('lobby');
      }
    });
    rm.start();
    setNetStatus('connecting');
    setRoom(code);
    setRoomInUrl(code);
    setScreen('lobby');
    // First presence after a short moment (meta must be set before track)
    rm.setMeta(myMeta(), true);
  }, [applyEvent, commitFamily, getSupabase, joinHostRace, leaveRoom, myMeta, refreshPlayers]);

  useEffect(() => {
    if (!autoJoin || !myId) return;
    setAutoJoin(null);
    joinRoom(autoJoin, false);
  }, [autoJoin, myId, joinRoom]);

  const hostRace = () => joinRoom(roomCode(), true);
  const joinRace = () => {
    const code = joinCode.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code)) joinRoom(code, false);
    else setNetError('Room codes are 4 letters.');
  };

  const host = pickHost(players);
  const isHost = !!host && host.id === myId;

  // Pings to the host for the shared race clock
  useEffect(() => {
    if (!room) return;
    const t = window.setInterval(() => {
      const rm = roomRef.current;
      if (!rm) return;
      const h = pickHost(playersRef.current);
      clockRef.current.tick(rm, !!h && h.id === myIdRef.current, !!gameRef.current && !gameRef.current.closedAt);
    }, 500);
    return () => window.clearInterval(t);
  }, [room]);

  /** Host: start a race for everyone in the room. */
  const hostStart = useCallback((opts?: { track?: number; nextRound?: boolean }) => {
    unlockAudio();
    const rm = roomRef.current;
    if (!rm) return;
    const p = profileRef.current;
    const order = playersRef.current.slice(0, MAX_PLAYERS).map((x) => x.id);
    if (!order.includes(myIdRef.current)) order.unshift(myIdRef.current);
    let cup = p.cup;
    let round = 0;
    if (opts?.nextRound && cupRef.current) {
      cup = cupRef.current.cup;
      round = cupRef.current.round + 1;
      if (round >= CUPS[cup].tracks.length) round = 0;
    }
    const track = cup >= 0 ? CUPS[cup].tracks[round] : opts?.track ?? p.trackIdx;
    const anyToddler = playersRef.current.some((x) => x.toddler);
    const laps = anyToddler && p.laps > 2 ? p.laps : p.laps;
    // Robots take the empty seats; they keep their line-up from race to race
    const humans = order.slice(0, MAX_PLAYERS);
    const taken = playersRef.current.filter((x) => humans.includes(x.id)).map((x) => x.kartIdx);
    if (!taken.includes(p.kartIdx)) taken.push(p.kartIdx);
    const bots = pickBots(p.bots ? MAX_PLAYERS - humans.length : 0, taken, botRosterRef.current);
    botRosterRef.current = bots;
    const t: RaceTuple = [randId(), track, humans, wall() + 4500, laps, cup, round, [p.botLevel, myIdRef.current, bots]];
    hostRaceRef.current = t;
    rm.setMeta(myMeta(), true);
    rm.send('start', { race: t, from: myIdRef.current, ts: wall() }, { force: true });
    if (cup >= 0) {
      if (!cupRef.current || cupRef.current.cup !== cup || round === 0) cupRef.current = { cup, round, totals: {}, scored: [] };
      cupRef.current.round = round;
    } else cupRef.current = null;
    setCupView(cupRef.current ? { ...cupRef.current } : null);
    startRace({
      mode: 'multi', id: t[0], order: t[2], track, laps, goWall: t[3], cup, round, nonce: Math.random(),
      bots, botLevel: p.botLevel, botOwner: myIdRef.current,
    });
  }, [myMeta, startRace]);

  const backToLobby = () => {
    const cur = raceRef.current;
    if (cur?.mode === 'multi' && isHost) {
      roomRef.current?.send('lobby', { r: cur.id }, { force: true });
      hostRaceRef.current = null;
      pushMeta(true);
    }
    raceRef.current = null;
    setRace(null);
    setScreen(cur?.mode === 'multi' && roomRef.current ? 'lobby' : 'menu');
  };

  const quitToMenu = () => {
    leaveRoom();
    raceRef.current = null;
    cupRef.current = null;
    setCupView(null);
    setRace(null);
    setScreen('menu');
  };

  const toggleReady = () => {
    unlockAudio();
    readyRef.current = !readyRef.current;
    setReady(readyRef.current);
    if (readyRef.current) sfx('ready');
    pushMeta(true);
  };

  const sendEmote = (e: string) => {
    const now = Date.now();
    if (now - emoteAtRef.current < 2000) return;
    emoteAtRef.current = now;
    unlockAudio();
    sfx('emote');
    setEmotes((m) => ({ ...m, [myIdRef.current]: { e, key: Math.random() } }));
    const G = gameRef.current;
    if (G) react(G.karts[0], e, 2000);
    const ev: NetEvent = { i: randId(), k: 'emote', e };
    eventsRef.current.fresh(ev.i);
    roomRef.current?.send('ev', { id: myIdRef.current, r: G?.raceId ?? '', l: [ev] }, { force: true });
  };

  // Re-announce my kart when I change it in the lobby
  useEffect(() => {
    if (screen === 'lobby' && netStatus === 'joined') pushMeta(false);
  }, [profile, screen, netStatus, pushMeta]);

  // Host: when everyone is ready, start in 3 seconds
  useEffect(() => {
    if (screen !== 'lobby' || !isHost) {
      if (autoStartAt) setAutoStartAt(0);
      return;
    }
    const allReady = players.length >= 2 && players.slice(0, MAX_PLAYERS).every((p) => p.ready || p.id === myId);
    if (allReady && !autoStartAt) setAutoStartAt(Date.now() + 3000);
    if (!allReady && autoStartAt) setAutoStartAt(0);
  }, [players, screen, isHost, myId, autoStartAt]);
  useEffect(() => {
    if (!autoStartAt) return;
    const t = window.setTimeout(() => {
      setAutoStartAt(0);
      hostStart();
    }, Math.max(0, autoStartAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [autoStartAt, hostStart]);

  // A little sound when someone comes into the room or leaves it
  const seatCountRef = useRef(0);
  useEffect(() => {
    if (screen !== 'lobby') {
      seatCountRef.current = 0;
      return;
    }
    const n = Math.min(players.length, MAX_PLAYERS);
    if (seatCountRef.current && n > seatCountRef.current) sfx('join');
    else if (n < seatCountRef.current) sfx('leave');
    seatCountRef.current = n;
  }, [players.length, screen]);

  // Emote bubbles fade after 2 s
  useEffect(() => {
    const ids = Object.keys(emotes);
    if (!ids.length) return;
    const t = window.setTimeout(() => setEmotes({}), 2200);
    return () => window.clearTimeout(t);
  }, [emotes]);

  // ---------- The race loop ----------
  useEffect(() => {
    if (screen !== 'race' || !race) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setTrack(race.track);
    // The painted top-down track is only made when the top-down view is used
    // (it is a big canvas, and the 3D view has its own copy of the ground).
    let track: HTMLCanvasElement = document.createElement('canvas');
    let trackReady = false;
    const G = createGame(race, myIdRef.current, profileRef.current, rosterRef.current);
    G.autoDrift = isTouchRef.current;
    const testdrive = testdriveRef.current;
    if (testdrive) {
      const me0 = G.karts[0];
      me0.toddler = testdrive === 't';
      me0.assist = me0.toddler ? 2 : clamp(parseInt(testdrive, 10) || 0, 0, 2);
    }
    const events = eventsRef.current;
    events.clear();
    const sampler = samplerRef.current;
    sampler.reset();
    G.emit = (ev, lazy) => {
      if (G.mode !== 'multi') return;
      events.add(ev);
      if (!lazy) roomRef.current?.send('ev', { id: G.meId, r: G.raceId, l: [ev] }, { force: true });
    };
    gameRef.current = G;
    startMusic(race.track);
    const input = inputRef.current;
    input.up = input.down = input.left = input.right = input.fire = input.drift = input.lookBack = false;
    // Merged input from keyboard/touch plus any connected gamepad
    const merged: Input = { up: false, down: false, left: false, right: false, fire: false, drift: false, lookBack: false, ax: 0 };
    let padFirePrev = false;
    let padCamPrev = false;
    let driftPrev = false;
    const readInput = () => {
      merged.up = input.up || autodriveRef.current;
      merged.down = input.down;
      merged.left = input.left;
      merged.right = input.right;
      merged.drift = input.drift;
      merged.lookBack = input.lookBack;
      merged.ax = 0;
      if (testdrive) merged.up = true; // hold gas through the countdown, like ?autodrive
      if (testdrive && G.phase === 'racing') {
        // Press keys like a person would: on/off steering, brake for bends, drift long turns
        const me0 = G.karts[0];
        const a = autopilot(me0);
        merged.up = true;
        merged.left = a.steer < -0.15;
        merged.right = a.steer > 0.15;
        merged.down = a.brake > 0 && me0.assist === 0;
        merged.drift = Math.abs(a.steer) > 0.6 && me0.assist < 2;
      }
      try {
        const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
        for (const pad of pads) {
          if (!pad) continue;
          const b = (i: number) => !!pad.buttons[i]?.pressed;
          const ax = pad.axes[0] ?? 0;
          merged.up = merged.up || b(0) || b(7) || b(12);
          merged.down = merged.down || b(1) || b(6) || b(13);
          merged.left = merged.left || b(14);
          merged.right = merged.right || b(15);
          // Analog stick: a dead zone, then a gentle curve for fine control
          if (Math.abs(ax) > 0.15 && Math.abs(ax) > Math.abs(merged.ax)) merged.ax = Math.sign(ax) * ((Math.abs(ax) - 0.15) / 0.85) ** 1.5;
          merged.drift = merged.drift || b(4) || b(5);
          const f = b(2);
          if (f && !padFirePrev) input.fire = true;
          padFirePrev = f;
          merged.lookBack = merged.lookBack || b(3);
          const c = b(8) || b(9);
          if (c && !padCamPrev) cycleCamRef.current();
          padCamPrev = c;
        }
      } catch {
        /* gamepads unavailable */
      }
      return merged;
    };

    engineStart();
    let engineOn = isAudioRunning();

    let w = 1;
    let h = 1;
    let dpr = 1;
    // 3D view, made the first time a 3D camera is used. If WebGL is not
    // available the game stays in the top-down view.
    const canvas3d = canvas3dRef.current;
    let view: View3D | null = null;
    let failed3d = !canvas3d;
    const view3dRatio = () => Math.min(dpr, isTouchRef.current ? 1.5 : 2);
    const getView = (): View3D | null => {
      if (view || failed3d || !canvas3d) return view;
      try {
        view = new View3D(canvas3d, isTouchRef.current);
        view.setSize(w, h, view3dRatio());
        view.setLite(profileRef.current.lite);
        // Start at the picture quality this device settled on in its last race
        try {
          const q = JSON.parse(localStorage.getItem(GFX_KEY) || 'null') as { scale: number; detail: number } | null;
          if (q && typeof q.scale === 'number') view.setQuality(q);
        } catch {
          /* first race on this device */
        }
        const sky = SKIES[TRACK_IDX] || SKIES[0];
        const scene: SceneTrack = {
          xs: TRACK.xs, ys: TRACK.ys, tx: TRACK.tx, ty: TRACK.ty, n: TRACK.n, halfW: HALF_W,
          worldW: WORLD_W, worldH: WORLD_H, theme: TRACK_IDX, name: THEME.name,
          colors: {
            grassA: THEME.grassA, grassB: THEME.grassB, edge: THEME.edge, outside: THEME.outside, road: THEME.road,
            roadInner: THEME.roadInner, curbA: THEME.curbA, curbB: THEME.curbB, line: THEME.line, dust: THEME.dust,
          },
          scenery: sceneryItems(),
          sky: sky.sky, horizon: sky.horizon, hills: sky.hills, night: sky.night,
          ramps: FEATURES.ramps.map((r) => ({ x: r.x, y: r.y, a: r.a, len: RAMP_LEN, width: HALF_W * 2 - 10 })),
          pads: FEATURES.pads.map((p) => ({ x: p.x, y: p.y, a: p.a, len: PAD_LEN, width: PAD_W })),
          // Road hazards are added by the gameplay code; draw them if they exist
          hazards: (FEATURES as { hazards?: SceneTrack['hazards'] }).hazards ?? [],
        };
        view.setTrack(scene);
      } catch {
        view = null;
        failed3d = true;
      }
      return view;
    };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      view?.setSize(w, h, view3dRatio());
    };
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    const keyMap: Record<string, InputKey> = {
      KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'drift', ShiftRight: 'drift', KeyK: 'drift',
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyC') {
        if (!e.repeat) cycleCamRef.current();
        return;
      }
      if (e.code === 'KeyQ' || e.code === 'KeyB') {
        input.lookBack = true;
        return;
      }
      if (e.code === 'KeyH' && !e.repeat) {
        sfx('horn');
        return;
      }
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
      if (e.code === 'KeyQ' || e.code === 'KeyB') input.lookBack = false;
      const k = keyMap[e.code];
      if (k) input[k] = false;
    };
    const onBlur = () => {
      input.up = input.down = input.left = input.right = input.drift = input.lookBack = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    let hudKey = '';
    let lastSend = 0;
    let stillSince = 0;
    let sentEpoch = -1;
    let lastPlace = 0;
    let scored = false;
    let debugAt = 0;
    let podiumIds: string[] | null = null;
    let fireworkAt = 0;
    let saidBanner = '';
    let saidItem: ItemKind | null = null;
    let saidLap = 0;
    let gaugeV = 0;
    // Save this race to the racer's stats, once
    const racerPid = familyRef.current ? activeLocal(familyRef.current).pid : '';
    let recorded = false;
    const recordRace = (award: string | null, cupWon: boolean, quiet = false) => {
      const st = familyRef.current;
      const me = G.karts[0];
      if (recorded || !st || !racerPid || !me.finished) return;
      recorded = true;
      const ranked = rankRacers(racers(G));
      const lapsMs = G.lapAt.length === G.laps + 1 ? G.lapAt.slice(1).map((t, i) => t - G.lapAt[i]) : [];
      const res = applyRace(st, racerPid, {
        track: race.track, laps: G.laps, place: ranked.findIndex((r) => r.isMe) + 1, total: ranked.length,
        family: G.mode === 'multi' && ranked.filter((r) => r.human).length >= 2,
        timeMs: me.finishTime, lapsMs, stats: me.st, cleanLaps: G.cleanLaps, award, cupWon,
      }, TRACKS.length);
      if (!res) return;
      commitFamily(res.store);
      if (!quiet) setGain(res.gain);
      if (G.mode === 'multi') window.setTimeout(() => sendBoard(racerPid), 300 + Math.random() * 900);
    };
    let botCheckAt = 0;
    let testItemAt = 0;
    const testItem = (() => {
      try {
        const v = new URLSearchParams(window.location.search).get('item') as ItemKind | null;
        return v && ITEM_KINDS.includes(v) ? v : null;
      } catch {
        return null;
      }
    })();
    const botSamplers = new Map<string, Sampler>();
    const botEpochs = new Map<string, number>();
    const flagsOf = (k: Kart) =>
      (k.spinT > 0 ? F_SPIN : 0) | (k.boostT > 0 || k.miniT > 0 || k.padT > 0 || k.trickT > 0 || k.rushT > 0 ? F_BOOST : 0) |
      (k.drifting ? F_DRIFT : 0) | (k.airT > 0 ? F_AIR : 0) | (k.shieldT > 0 || k.toddler ? F_SHIELD : 0) |
      (k.finished ? F_DONE : 0) | (k.snoozeT > 0 ? F_SNOOZE : 0) | (k.draftT > 0 ? F_DRAFT : 0) |
      (k.rushT > 0 ? F_RUSH : 0) | (k.magnetT > 0 ? F_MAGNET : 0);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!trackReady && (profileRef.current.cam === 'top' || failed3d)) {
        track = getTrackCanvas();
        trackReady = true;
      }
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      if (dt < 0) dt = 0;
      const inp = readInput();
      // Messages take about half my round trip to the host to reach me
      if (clockRef.current.rtt > 0) G.lagMs = clamp(clockRef.current.rtt / 2, 0, 300);
      updateRemotes(G, dt, now);
      let rem = dt;
      while (rem > 1e-6) {
        const s = Math.min(rem, 1 / 60);
        step(G, s, now - rem + s, inp);
        rem -= s;
      }
      const me = G.karts[0];
      if (!engineOn && isAudioRunning()) {
        engineStart();
        engineOn = true;
      }
      engineUpdate(me.finished ? 0 : Math.hypot(me.vx, me.vy) / me.stats.maxSpeed, me.boostT > 0 || me.padT > 0 || me.miniT > 0, {
        drift: me.drifting ? 1 : 0, tier: me.tier, grass: me.offroad && me.airT <= 0, curb: me.curb && G.phase === 'racing',
      });
      // Item button: a trick while in the air, otherwise use the item
      const driftEdge = inp.drift && !driftPrev;
      driftPrev = inp.drift;
      if (input.fire) {
        input.fire = false;
        unlockAudio();
        if (me.airT > 0 && !me.trickDone) doTrick(G, me);
        else fireItem(G, me, now);
      } else if (driftEdge && me.airT > 0 && !me.trickDone) doTrick(G, me);

      // ----- Send my kart -----
      const rm = roomRef.current;
      if (G.mode === 'multi' && rm) {
        const flags = flagsOf(me);
        const tw = wall();
        // The robots I drive: sampled a little more coarsely than my own kart
        for (const k of G.karts) {
          if (!k.bot) continue;
          let bs = botSamplers.get(k.id);
          if (!bs) {
            bs = new Sampler(100);
            botSamplers.set(k.id, bs);
          }
          if (botEpochs.get(k.id) !== k.epoch) {
            // Respawned: a fresh motion history, so nobody glides it across the map
            botEpochs.set(k.id, k.epoch);
            bs.reset();
            bs.force(tw, k.x, k.y, k.angle + k.slip, k.vx, k.vy, k.w, flagsOf(k));
          } else bs.sample(tw, k.x, k.y, k.angle + k.slip, k.vx, k.vy, k.w, flagsOf(k));
        }
        // Robots nobody is driving (their device left or went quiet): the
        // players take them over in a fixed order, so only one device does.
        if (now - botCheckAt > 1000 && G.phase === 'racing') {
          botCheckAt = now;
          let quiet = 0;
          let any = false;
          G.remotes.forEach((r) => {
            if (!r.bot) return;
            any = true;
            quiet = Math.max(quiet, r.net.ready() ? r.net.silentFor(tw) : (now - G.goAt) / 1000);
          });
          if (any && quiet > 4) {
            const here = [G.meId, ...playersRef.current.map((x) => x.id).filter((id) => id !== G.meId && G.remotes.has(id))].sort();
            if (quiet > 4 + 3 * here.indexOf(G.meId)) adoptBots(G);
          }
        }
        if (me.epoch !== sentEpoch) {
          // Respawned: start a fresh motion history so nobody interpolates across it
          sampler.reset();
          sampler.force(tw, me.x, me.y, me.angle, me.vx, me.vy, me.w, flags);
        } else sampler.sample(tw, me.x, me.y, me.angle, me.vx, me.vy, me.w, flags);
        const moving = Math.hypot(me.vx, me.vy) > 8 || me.spinT > 0;
        if (moving) stillSince = 0;
        else if (!stillSince) stillSince = now;
        let humans = 1;
        G.remotes.forEach((r) => {
          if (!r.bot) humans++;
        });
        const nPlayers = Math.max(1, Math.min(MAX_PLAYERS, humans));
        const iv = sendIntervalFor(nPlayers);
        const myBots = G.karts.length > 1;
        // Once the race is over the karts only cruise, so messages slow right
        // down: a results screen left open must not eat the monthly allowance.
        const over = G.closedAt > 0 && now - G.closedAt > 4000;
        const interval = over ? 5000
          : stillSince && now - stillSince > 1000 && G.phase === 'racing' && !myBots ? 1500
            : G.phase === 'countdown' ? Math.max(iv, 600) : iv;
        if (now - lastSend >= interval && rm.canSend()) {
          sampler.force(tw, me.x, me.y, me.angle, me.vx, me.vy, me.w, flags);
          const samples = sampler.take();
          const b: unknown[] = [];
          for (const k of G.karts) {
            const bs = botSamplers.get(k.id);
            if (!k.bot || !bs) continue;
            bs.force(tw, k.x, k.y, k.angle + k.slip, k.vx, k.vy, k.w, flagsOf(k));
            b.push([k.id, k.lap, k.idx, k.coins, +k.spinA.toFixed(2), Math.round(k.finishTime), k.epoch, bs.take(), k.kartIdx, k.body]);
          }
          const ok = rm.send('st', {
            id: me.id, r: G.raceId, q: sampler.seq, iv, ts: Math.round(tw), s: samples, e: me.epoch,
            l: me.lap, i: me.idx, c: me.coins, sp: +me.spinA.toFixed(2), ft: Math.round(me.finishTime),
            ev: events.piggyback(), ...(b.length ? { b } : {}),
          });
          if (ok) {
            lastSend = now;
            sentEpoch = me.epoch;
          }
        }
      }

      if (testItem && G.phase === 'racing' && !me.item && !me.finished && now - testItemAt > 4000) {
        // ?item=honk: keep handing my kart one item and using it (testing only)
        testItemAt = now;
        me.item = testItem;
        me.charges = 1;
        me.rollT = 0;
        input.fire = true;
      }
      if (debugRef.current) {
        // ?netdebug: numbers for the multiplayer tests
        (window as unknown as { __bkNet: unknown }).__bkNet = {
          t: wall(), phase: G.phase, raceId: G.raceId, botOwner: G.botOwner, closed: G.closedAt > 0,
          me: { id: me.id, x: me.x, y: me.y, p: me.progress, fin: me.finished, ft: me.finishTime },
          local: G.karts.map((k) => ({ id: k.id, x: k.x, y: k.y, p: k.progress, fin: k.finished, bot: k.bot })),
          remotes: [...G.remotes.values()].map((r) => ({
            id: r.id, bot: r.bot, owner: r.owner, x: r.x, y: r.y, p: r.progress, fin: r.finished, ready: r.net.ready(),
            quiet: r.net.silentFor(wall()), extrap: r.net.extrapMs, delay: r.net.delay,
          })),
          rank: rankRacers(racers(G)).map((r) => r.id),
          sent: roomRef.current?.stats().sentPerSec ?? 0, room: roomRef.current?.stats().roomPerSec ?? 0,
        };
      }
      if (me.finished && !G.finishedAt) G.finishedAt = now;
      // Race over: score the cup once and work out the awards
      if (G.closedAt && !scored && now - G.closedAt > 1500) {
        scored = true;
        const ranked = rankRacers(racers(G));
        const cup = cupRef.current;
        if (cup && !cup.scored.includes(G.raceId)) {
          cup.scored.push(G.raceId);
          ranked.forEach((r, i) => {
            const t = cup.totals[r.id] ?? { name: r.name, kartIdx: r.kartIdx, pts: 0 };
            t.pts += POINTS[i] ?? 1;
            t.name = r.name;
            t.kartIdx = r.kartIdx;
            cup.totals[r.id] = t;
          });
          setCupView({ ...cup, totals: { ...cup.totals } });
        }
        const aw = computeAwards(G);
        setAwards(aw);
        const mine = aw.find((a) => a.isMe);
        let cupWon = false;
        if (cup && race.cup >= 0 && race.round === CUPS[race.cup].tracks.length - 1) {
          const top = Object.entries(cup.totals).sort((a, b) => b[1].pts - a[1].pts)[0];
          cupWon = !!top && top[0] === G.meId;
        }
        recordRace(mine ? `${mine.icon} ${mine.title}` : null, cupWon);
        sfx('cheer');
      }

      const mode = profileRef.current.cam;
      // The podium is a 3D stage, so it uses the 3D view even for top-down players
      const podiumOn = G.closedAt > 0 && now - G.closedAt > 1800;
      if (podiumOn && !podiumIds) {
        podiumIds = rankRacers(racers(G)).slice(0, 3).map((r) => r.id);
        startMusic(-2);
        fireworkAt = now + 500;
        const mine = podiumIds.indexOf(G.meId);
        say(mine === 0 ? 'You win! Hooray!' : mine > 0 ? 'Great race! You are on the podium!' : 'Great racing, everyone!');
      }
      const v = mode !== 'top' || podiumOn ? getView() : null;
      const show3d = !!v;
      if (podiumOn && show3d && now > fireworkAt && now - G.closedAt < 30000) {
        fireworkAt = now + 500 + Math.random() * 1100;
        sfx('firework', { pitch: 0.8 + Math.random() * 0.5, vol: 0.5 });
      }
      if (canvas3d && canvas3d.style.visibility !== (show3d ? 'visible' : 'hidden')) canvas3d.style.visibility = show3d ? 'visible' : 'hidden';
      if (v) {
        const karts: KartView[] = [];
        for (const k of G.karts) {
          const col = kartColors(k.kartIdx, k.paint);
          karts.push({
            id: k.id, name: k.name, isMe: k.id === G.meId, x: k.x, y: k.y,
            yaw: k.angle + k.slip + k.spinA + k.trickA, heading: k.angle,
            speed: Math.hypot(k.vx, k.vy), maxSpeed: k.stats.maxSpeed,
            emoji: KARTS[k.kartIdx].emoji, color: col.color, dark: col.dark, body: k.body,
            boost: k.boostT > 0 || k.miniT > 0 || k.padT > 0 || k.trickT > 0, toddler: k.toddler,
            blink: k.invT > 0 && Math.floor(now / 90) % 2 === 0,
            drifting: k.drifting, driftDir: k.driftDir, spinning: k.spinT > 0, finished: k.finished,
            air: (k.airT > 0 ? airHeight(k.airT, k.airMax) : 0) + hopHeight(k), shield: k.shieldT > 0, alpha: 1,
            steer: k.steer, slip: k.slip, hop: k.hopT > 0 ? hopHeight(k) / 7 : 0, bump: clamp(k.bumpT / 0.35, 0, 1),
            land: k.landT, accel: k.accelS,
            bubble: k.react && now < k.react.until ? k.react.e : k.snoozeT > 0 ? '💤' : '',
          });
        }
        G.remotes.forEach((r) => {
          const col = kartColors(r.kartIdx, r.paint);
          karts.push({
            id: r.id, name: r.name, isMe: false, x: r.x, y: r.y, yaw: r.angle + r.spinA, heading: r.angle,
            speed: r.speed, maxSpeed: 1, emoji: KARTS[r.kartIdx]?.emoji ?? '🏎️', color: col.color, dark: col.dark,
            body: r.body, boost: !!(r.flags & F_BOOST), toddler: r.toddler, blink: false, drifting: !!(r.flags & F_DRIFT), driftDir: 0,
            spinning: !!(r.flags & F_SPIN), finished: r.finished,
            air: r.flags & F_AIR ? AIR_HEIGHT * 0.7 : 0, shield: !!(r.flags & F_SHIELD) && !r.toddler, alpha: r.alpha,
            bubble: r.react && now < r.react.until ? r.react.e : r.flags & F_SNOOZE ? '💤' : '',
          });
        });
        const orbit = orbitRef.current;
        v.setLite(profileRef.current.lite);
        v.render({
          now, dt, karts,
          boxes: G.boxes.map((b) => ({ x: b.x, y: b.y, visible: now >= b.hiddenUntil, ghost: now < b.hiddenUntil && b.hiddenUntil - now <= 500 })),
          coins: G.coins.map((c) => ({ x: c.x, y: c.y, visible: now >= c.hiddenUntil })),
          bananas: G.bananas, blasts: G.blasts, particles: G.particles,
          countdownLeft: G.phase === 'countdown' ? G.goAt - now : null,
          introMs: 2300, shake: G.shake, mode, lookBack: inp.lookBack, kicks: me.kicks,
          guide: showGuide(G) && me.help * 0.6 > 0.02 ? guideLine(me).map((p) => ({ x: p.x, y: p.y, c: p.c, a: p.a * me.help * 0.75 })) : null,
          orbitYaw: orbit.yaw, orbitPitch: orbit.pitch, orbitDist: orbit.dist,
          finishedFor: G.finishedAt ? now - G.finishedAt : -1,
          podium: podiumOn ? podiumIds : null,
        });
      }
      if (podiumOn && show3d) {
        // Nothing from the race overlay on the podium: the stage is the show
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        render(ctx, G, track, w, h, dpr, now, show3d);
        if (!me.finished && G.phase === 'racing') {
          gaugeV += (Math.hypot(me.vx, me.vy) - gaugeV) * Math.min(1, dt * 8);
          drawSpeedGauge(ctx, w, h, dpr, gaugeV, me.stats.maxSpeed, me.boostT > 0 || me.miniT > 0 || me.padT > 0 || me.trickT > 0, isTouchRef.current, now);
        }
      }
      if (now - hudAt > 100) {
        hudAt = now;
        const next = computeHud(G, now);
        if (lastPlace && next.place !== lastPlace && G.phase === 'racing' && !me.finished) {
          const up = next.place < lastPlace;
          setPosFx({ dir: up ? 1 : -1, key: now });
          sfx(up ? 'posUp' : 'posDown');
          if (up) vibrate([15, 30, 15]);
        }
        lastPlace = next.place;
        // Spoken callouts for racers who can't read yet
        if (next.banner && next.banner !== saidBanner) {
          const line = spokenFor(next.banner);
          if (line) say(line);
        }
        saidBanner = next.banner ?? '';
        if (next.item && !next.rolling && next.item !== saidItem) say(`${ITEMS[next.item].label}!`);
        saidItem = next.rolling ? saidItem : next.item;
        if (next.lap !== saidLap && G.phase === 'racing') {
          if (saidLap && next.lap === next.laps && !me.finished) say('Final lap!');
          saidLap = next.lap;
        }
        const key = JSON.stringify(next);
        if (key !== hudKey) {
          hudKey = key;
          setHud(next);
        }
      }
      if (testdrive && now - debugAt > 500) {
        debugAt = now;
        const me0 = G.karts[0];
        (window as unknown as { __bk: unknown }).__bk = {
          phase: G.phase, lap: me0.lap, laps: G.laps, lapAt: G.lapAt, finished: me0.finished, finishTime: me0.finishTime,
          help: me0.help, sc: me0.sc, drifts: me0.st.drifts, cleanLaps: G.cleanLaps, raceScore: G.raceScore,
          place: rankRacers(racers(G)).findIndex((r) => r.isMe) + 1,
          x: Math.round(me0.x), y: Math.round(me0.y), a: +me0.angle.toFixed(2), d: Math.round(me0.dist), v: Math.round(Math.hypot(me0.vx, me0.vy)),
          idx: me0.idx, steer: +me0.steer.toFixed(2), auto: +me0.autoSteer.toFixed(2), spin: me0.spinT > 0, wrong: +me0.wrongT.toFixed(1),
          bots: G.karts.slice(1).map((b) => ({ lap: b.lap, ft: b.finishTime, done: b.finished, drifts: b.st.drifts, hits: b.st.hits, lane: Math.round(b.lane) })),
          extra: { hazards: FEATURES.hazards.length, pads: FEATURES.pads.length, hits: G.hitLog.join(' '), hitBy: me0.st.hitBy, coins: me0.st.coins },
          gfx: view ? view.stats() : null, music: musicDebug(), closedAt: G.closedAt, podium: podiumOn,
        };
      }
      if (debugRef.current && now - debugAt > 500) {
        debugAt = now;
        const lines: string[] = [];
        const st = roomRef.current?.stats();
        if (st) lines.push(`room ${st.roomPerSec.toFixed(0)} msg/s · me ${st.sentPerSec.toFixed(1)}/s · in ${st.recvPerSec.toFixed(1)}/s`);
        lines.push(`clock ${clockRef.current.synced() ? `±${Math.round(clockRef.current.rtt / 2)}ms` : 'not synced'} · GO in ${Math.round(G.goAt - now)}ms`);
        G.remotes.forEach((r) => {
          const n = r.net;
          lines.push(`${r.name}: delay ${Math.round(n.delay)} jit ${Math.round(n.j95)} extrap ${Math.round(Math.max(0, n.extrapMs))} quiet ${n.silentFor(wall()).toFixed(1)}s`);
        });
        setNetDebug(lines.join('\n'));
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
      input.up = input.down = input.left = input.right = input.fire = input.drift = input.lookBack = false;
      engineStop();
      stopVoice();
      recordRace(null, false, true); // finished but left before the results: it still counts
      if (gameRef.current === G) gameRef.current = null;
      if (view) {
        try {
          localStorage.setItem(GFX_KEY, JSON.stringify(view.quality()));
        } catch {
          /* private mode */
        }
      }
      view?.dispose();
      view = null;
    };
  }, [screen, race, commitFamily, sendBoard]);

  // ---------- Touch controls ----------
  const press = (key: InputKey, on: boolean) => {
    inputRef.current[key] = on;
  };
  const holdHandlers = (key: InputKey) => ({
    onTouchStart: () => {
      lastTouchRef.current = Date.now();
      unlockAudio();
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

  const shareLink = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Bendana Kart', text: `Join my race! Room ${room}`, url: shareUrl });
        return;
      }
    } catch {
      return; // closed the share sheet
    }
    void copyLink();
  };

  const nameInput = (
    <input
      value={profile.name}
      onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value.slice(0, 14) }))}
      placeholder="Your name"
      aria-label="Your name"
      autoComplete="off"
      maxLength={14}
      className="w-full rounded-2xl border-0 bg-white/90 px-5 py-4 text-xl font-black text-slate-900 placeholder:text-slate-400 shadow-inner outline-none focus:ring-4 focus:ring-yellow-300"
    />
  );

  const raceChoice = (disabled: boolean, value: { track: number; cup: number; laps: number; bots: boolean; botLevel: number }, online = true) => (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {[-1, 0, 1].map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            onClick={() => setProfile((p) => ({ ...p, cup: c }))}
            className={`rounded-2xl px-2 py-3 text-sm font-black text-white transition active:scale-95 disabled:opacity-60 ${value.cup === c ? 'bg-white/35 ring-4 ring-white' : 'bg-black/25 ring-1 ring-white/25'} ${c >= 0 ? `bg-gradient-to-br ${CUPS[c].card}` : ''}`}
          >
            <span className="block text-2xl">{c < 0 ? '🏁' : CUPS[c].emoji}</span>
            {c < 0 ? 'One race' : CUPS[c].name}
            {c >= 0 && <span className="block text-[10px] font-bold opacity-85">{CUPS[c].tracks.map((t) => TRACKS[t].emoji).join(' ')}</span>}
          </button>
        ))}
      </div>
      {value.cup < 0 && (
        <TrackPicker value={value.track} disabled={disabled} best={myRec?.b} laps={value.laps} onPick={(i) => setProfile((p) => ({ ...p, trackIdx: i }))} />
      )}
      <div className="flex items-center gap-2 text-white">
        <span className="text-sm font-black">Laps:</span>
        {[2, 3].map((l) => (
          <button
            key={l}
            type="button"
            disabled={disabled}
            onClick={() => setProfile((p) => ({ ...p, laps: l }))}
            className={`rounded-xl px-4 py-2 text-sm font-black transition active:scale-95 disabled:opacity-60 ${value.laps === l ? 'bg-yellow-300 text-slate-900' : 'bg-black/25 text-white ring-1 ring-white/25'}`}
          >
            {l === 2 ? '⚡ 2 (short)' : '🏁 3'}
          </button>
        ))}
      </div>
      <RobotPicker level={value.botLevel} fill={value.bots} disabled={disabled} showFill={online} onLevel={(v) => setProfile((p) => ({ ...p, botLevel: v }))} onFill={(v) => setProfile((p) => ({ ...p, bots: v }))} />
    </div>
  );

  const toggles = (
    <div className="flex flex-wrap gap-2">
      {([
        ['music', profile.music ? '🎵 Music on' : '🎵 Music off', profile.music],
        ['muted', profile.muted ? '🔇 Sound off' : '🔊 Sound on', !profile.muted],
        ['haptics', profile.haptics ? '📳 Buzz on' : '📳 Buzz off', profile.haptics],
        ['lite', profile.lite ? '⚡ Fast graphics on' : '⚡ Fast graphics off', profile.lite],
      ] as const).map(([k, label, on]) => (
        <button
          key={k}
          type="button"
          aria-pressed={on}
          onClick={() => {
            unlockAudio();
            setProfile((p) => ({ ...p, [k]: !p[k] }));
            sfx('uiToggle');
          }}
          className={`rounded-full px-4 py-2 text-sm font-black ring-1 transition active:scale-95 ${on ? 'bg-white/90 text-slate-900 ring-white' : 'bg-black/25 text-white/80 ring-white/25'}`}
        >
          {label}
        </button>
      ))}
      {voiceAvailable() && (
        <button
          type="button"
          aria-pressed={prefs.voice}
          onClick={() => {
            unlockAudio();
            unlockVoice();
            const on = !prefs.voice;
            setPrefs((p) => ({ ...p, voice: on }));
            sfx('uiToggle');
            if (on) {
              setVoiceOn(true);
              say('Voice on!');
            }
          }}
          className={`rounded-full px-4 py-2 text-sm font-black ring-1 transition active:scale-95 ${prefs.voice ? 'bg-white/90 text-slate-900 ring-white' : 'bg-black/25 text-white/80 ring-white/25'}`}
        >
          {prefs.voice ? '🗣️ Voice on' : '🗣️ Voice off'}
        </button>
      )}
    </div>
  );

  const statusBadge = (s: NetStatus | 'idle') => (
    <span className={`rounded-full px-3 py-1 text-xs font-black ${s === 'joined' ? 'bg-green-400 text-green-950' : s === 'error' ? 'bg-red-500 text-white' : 'bg-yellow-300 text-yellow-950'}`}>
      {s === 'joined' ? 'Connected' : s === 'error' ? 'Offline' : s === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
    </span>
  );

  const myRec = family ? family.board[family.active] : undefined;
  const myTotals = myRec ? totals(myRec) : null;
  const familySheets = (
    <FamilySheets panel={famPanel} store={family} kit={FAMILY_KIT} setPanel={setFamPanel} onCreate={createPlayer} onAdopt={adoptBoardPlayer} onRemove={removePlayer} />
  );
  const whoRow = family && <WhoRow store={family} kit={FAMILY_KIT} onPick={pickPlayer} onAdd={() => setFamPanel({ kind: 'add' })} />;
  const familyButtons = (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => family && setFamPanel({ kind: 'stats', pid: family.active })}
        className="rounded-2xl bg-gradient-to-b from-sky-300 to-indigo-500 px-3 py-3 text-lg font-black text-white shadow-lg active:scale-95"
      >
        📊 My stats
      </button>
      <button
        type="button"
        onClick={() => setFamPanel({ kind: 'board' })}
        className="rounded-2xl bg-gradient-to-b from-yellow-200 to-orange-400 px-3 py-3 text-lg font-black text-slate-900 shadow-lg active:scale-95"
      >
        🏆 Leaderboard
      </button>
    </div>
  );
  // ---------- Panels (slide over the home screen and the lobby) ----------
  const pickers = (compact: boolean) => (
    <KartPicker compact={compact} value={profile.kartIdx} paint={profile.paint} onPick={(i) => setProfile((p) => ({ ...p, kartIdx: i }))} onPaint={(i) => setProfile((p) => ({ ...p, paint: i }))} body={profile.body} onBody={(i) => setProfile((p) => ({ ...p, body: i }))} />
  );
  const bigGo = 'bk-tile w-full bg-gradient-to-b from-lime-300 to-green-500 px-5 py-4 text-2xl font-black text-slate-900 disabled:opacity-50';
  let panelEl: React.ReactNode = null;
  if (panel === 'garage') {
    panelEl = (
      <Sheet title="🔧 Garage" onClose={closePanel} tone="from-sky-600 via-indigo-600 to-violet-700" footer={<button type="button" onClick={closePanel} className={bigGo}>👍 Looks great!</button>}>
        <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
          <h3 className="text-lg font-black text-white">Who&apos;s racing?</h3>
          {whoRow}
          {nameInput}
        </section>
        {pickers(vp.h < 560)}
      </Sheet>
    );
  } else if (panel === 'solo') {
    panelEl = (
      <Sheet
        title="🏁 Pick your race"
        onClose={closePanel}
        tone="from-emerald-600 via-teal-600 to-sky-700"
        footer={
          <button type="button" onClick={() => startSolo(profile.trackIdx, profile.cup, 0)} className={bigGo}>
            🏁 START! <span className="text-base font-bold opacity-75">{profile.cup >= 0 ? `${CUPS[profile.cup].emoji} ${CUPS[profile.cup].name}` : `${TRACKS[profile.trackIdx].emoji} ${TRACKS[profile.trackIdx].name}`}</span>
          </button>
        }
      >
        <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">{raceChoice(false, { track: profile.trackIdx, cup: profile.cup, laps: profile.laps, bots: profile.bots, botLevel: profile.botLevel }, false)}</section>
        <ToddlerToggle on={profile.toddler} onToggle={() => setProfile((p) => ({ ...p, toddler: !p.toddler }))} />
      </Sheet>
    );
  } else if (panel === 'family') {
    panelEl = (
      <Sheet title="👨‍👩‍👧‍👦 Family race" onClose={closePanel} tone="from-orange-500 via-rose-500 to-fuchsia-600">
        <p className="rounded-3xl bg-black/25 p-4 text-center text-base font-bold text-white ring-1 ring-white/20">
          Everyone races on their own phone, tablet or computer. One person starts a room, and up to {MAX_PLAYERS} racers can join it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
            <h3 className="text-xl font-black text-white">🔑 Join a room</h3>
            <p className="text-sm font-bold text-white/85">Type the 4 letters from the other screen.</p>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinRace()}
              placeholder="CODE"
              aria-label="Room code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              className="w-full rounded-2xl bg-white/95 px-3 py-3 text-center text-4xl font-black tracking-[0.4em] text-slate-900 outline-none placeholder:text-slate-300 focus:ring-4 focus:ring-yellow-300"
            />
            <button type="button" onClick={joinRace} disabled={!multiplayerReady || joinCode.length !== 4} className="bk-tile bg-gradient-to-b from-sky-300 to-indigo-500 px-4 py-4 text-2xl font-black text-white disabled:opacity-50">
              {joinCode.length === 4 ? `Join room ${joinCode}` : 'Join'}
            </button>
          </section>
          <section className="flex flex-col gap-3 rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
            <h3 className="text-xl font-black text-white">📡 Start a room</h3>
            <p className="text-sm font-bold text-white/85">You get a code and a square to scan. Share it with your family.</p>
            <button type="button" onClick={hostRace} disabled={!multiplayerReady} className="bk-tile mt-auto bg-gradient-to-b from-yellow-200 to-orange-400 px-4 py-4 text-2xl font-black text-slate-900 disabled:opacity-50">
              Start a room
            </button>
          </section>
        </div>
        {netError && <p className="rounded-2xl bg-red-600/85 p-3 text-center font-bold text-white">{netError}</p>}
      </Sheet>
    );
  } else if (panel === 'settings') {
    panelEl = (
      <Sheet title="⚙️ Settings" onClose={closePanel} tone="from-slate-700 via-slate-800 to-indigo-900">
        <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
          <ToddlerToggle on={profile.toddler} onToggle={() => setProfile((p) => ({ ...p, toddler: !p.toddler }))} />
          {!profile.toddler && <AssistPicker key={family?.active} value={profile.assist} onPick={(v) => setProfile((p) => ({ ...p, assist: v }))} />}
        </section>
        <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
          <h3 className="mb-2 text-lg font-black text-white">Sound</h3>
          {toggles}
        </section>
        <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
          <h3 className="mb-2 text-lg font-black text-white">Camera</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CAM_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={profile.cam === m.id}
                onClick={() => {
                  sfx('uiTap');
                  setProfile((p) => ({ ...p, cam: m.id }));
                }}
                className={`rounded-xl px-2 py-3 text-sm font-black transition active:scale-95 ${profile.cam === m.id ? 'bg-yellow-300 text-slate-900' : 'bg-white/10 text-white ring-1 ring-white/25'}`}
              >
                <span className="block text-2xl">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-3xl bg-black/25 p-4 text-white ring-1 ring-white/20">
          <h3 className="mb-2 text-lg font-black">Screen</h3>
          {canFullscreen && (
            <button type="button" onClick={toggleFullscreen} className="rounded-full bg-white/90 px-4 py-2 text-sm font-black text-slate-900 active:scale-95">
              ⛶ Full screen
            </button>
          )}
          <p className="mt-2 text-sm font-bold text-white/80">
            Tip: on a phone or tablet, use your browser&apos;s &quot;Add to Home Screen&quot; to get a Bendana Kart icon that opens full screen, like an app.
          </p>
        </section>
      </Sheet>
    );
  } else if (panel === 'help') {
    panelEl = (
      <Sheet title="❓ How to play" onClose={closePanel} tone="from-cyan-600 via-sky-700 to-indigo-800">
        <HelpCards touch={isTouch} />
      </Sheet>
    );
  }

  // ---------- Screens ----------
  if (screen === 'menu') {
    const wide = vp.w > vp.h;
    const heroSize = Math.round(wide ? clamp(Math.min(vp.w * 0.4, vp.h * 0.58), 150, 430) : clamp(Math.min(vp.w * 0.8, vp.h * 0.34), 160, 400));
    const meKart = KARTS[profile.kartIdx] || KARTS[0];
    const small = [
      { icon: '📊', label: 'My stats', go: () => family && setFamPanel({ kind: 'stats', pid: family.active }) },
      { icon: '🏆', label: 'Leaders', go: () => setFamPanel({ kind: 'board' }) },
      { icon: '🔧', label: 'Garage', go: () => setPanel('garage') },
      { icon: '⚙️', label: 'Settings', go: () => setPanel('settings') },
      { icon: '❓', label: 'Help', go: () => setPanel('help') },
    ];
    const lv = levelOf(myTotals?.st ?? 0);
    return (
      <main className="relative min-h-[100dvh] w-full overflow-x-hidden" onPointerDown={wake}>
        <HomeBackdrop />
        <div className={`relative mx-auto grid min-h-[100dvh] max-w-5xl content-center items-center gap-3 px-4 py-[max(1rem,env(safe-area-inset-top))] ${wide ? 'grid-cols-2 gap-6' : 'grid-cols-1'}`}>
          <div className="flex flex-col items-center">
            <Logo small={vp.h < 560 || vp.w < 380} />
            <button type="button" onClick={() => openPanel('garage')} className="group relative mt-1 flex flex-col items-center" aria-label="Change your racer">
              <span className="absolute bottom-9 h-[18%] w-[70%] rounded-[50%] bg-slate-900/25 blur-md" aria-hidden />
              <KartTurntable kartIdx={profile.kartIdx} paint={profile.paint} body={profile.body} size={heroSize} />
              <span className={`-mt-2 flex items-center gap-2 rounded-full bg-slate-900/85 py-1.5 pl-2 pr-4 text-white shadow-xl ring-2 ring-white/50 transition group-active:scale-95 ${profile.name ? '' : 'bk-wiggle'}`}>
                <FaceIcon emoji={meKart.emoji} size={34} happy />
                <span className="text-left leading-tight">
                  <span className="block text-lg font-black">{profile.name || 'Tap to pick your racer'}</span>
                  <span className="block text-xs font-bold text-white/75">{meKart.name} · {BODIES[profile.body]?.name ?? 'Classic'} kart ✏️</span>
                </span>
              </span>
            </button>
            {family && family.locals.length > 1 && <div className="mt-1 max-w-full">{whoRow}</div>}
          </div>

          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            <button type="button" onClick={() => openPanel('solo')} className="bk-tile flex items-center gap-4 bg-gradient-to-b from-lime-300 to-green-500 px-5 py-4 text-left text-slate-900 sm:py-5">
              <span className="text-5xl drop-shadow sm:text-6xl">🏁</span>
              <span>
                <span className="block text-3xl font-black leading-none sm:text-4xl">PLAY</span>
                <span className="block text-sm font-bold opacity-75 sm:text-base">Race the robot karts</span>
              </span>
            </button>
            <button type="button" onClick={() => openPanel('family')} className="bk-tile flex items-center gap-4 bg-gradient-to-b from-yellow-200 to-orange-400 px-5 py-4 text-left text-slate-900 sm:py-5">
              <span className="text-5xl drop-shadow sm:text-6xl">👨‍👩‍👧‍👦</span>
              <span>
                <span className="block text-3xl font-black leading-none sm:text-4xl">FAMILY RACE</span>
                <span className="block text-sm font-bold opacity-75 sm:text-base">Everyone on their own screen</span>
              </span>
            </button>
            <div className="grid grid-cols-5 gap-2">
              {small.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => {
                    wake();
                    sfx('uiOpen');
                    b.go();
                  }}
                  className="bk-tile flex flex-col items-center bg-white/90 px-0.5 py-2.5 text-slate-900"
                  style={{ borderRadius: '1.25rem' }}
                >
                  <span className="text-2xl sm:text-3xl">{b.icon}</span>
                  <span className="text-[11px] font-black sm:text-sm">{b.label}</span>
                </button>
              ))}
            </div>
            {myTotals && myTotals.r > 0 && (
              <div className="flex flex-wrap justify-center gap-2 text-sm font-black text-slate-900">
                <span className="rounded-full bg-white/80 px-3 py-1">{lv.icon} Level {lv.lvl} {lv.title}</span>
                <span className="rounded-full bg-white/80 px-3 py-1">⭐ {myTotals.st} stars</span>
                {myTotals.w > 0 && <span className="rounded-full bg-white/80 px-3 py-1">🥇 {myTotals.w} win{myTotals.w > 1 ? 's' : ''}</span>}
              </div>
            )}
            {netError && !panel && <p className="rounded-2xl bg-red-600/85 p-3 text-center font-bold text-white">{netError}</p>}
          </div>
        </div>
        {panelEl}
        {familySheets}
      </main>
    );
  }

  if (screen === 'lobby') {
    const hostName = host?.name ?? 'the host';
    const hp = host ? parseMeta(host.id, rosterRef.current.get(host.id)) : null;
    const shown = isHost
      ? { track: profile.trackIdx, cup: profile.cup, laps: profile.laps, bots: profile.bots, botLevel: profile.botLevel }
      : { track: hp?.trackIdx ?? 0, cup: hp?.cup ?? -1, laps: hp?.laps ?? 3, bots: hp?.bots ?? true, botLevel: hp?.botLevel ?? 1 };
    const conn = rtt < 0 ? null : rtt < 150 ? '🟢' : rtt < 350 ? '🟡' : '🔴';
    const seats = players.slice(0, MAX_PLAYERS);
    const meKart = KARTS[profile.kartIdx] || KARTS[0];
    const waiting = seats.filter((p) => !p.ready && !(host && p.id === host.id)).length;
    const shortScreen = vp.h < 520;
    return (
      <main className="min-h-[100dvh] w-full overflow-y-auto bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))]" onPointerDown={wake}>
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {/* How to get in: the code, the square to scan, and a link to send */}
          <header className={`flex flex-col items-center rounded-3xl bg-black/25 ring-1 ring-white/20 sm:flex-row sm:justify-center ${shortScreen ? 'gap-3 p-2 sm:gap-5' : 'gap-4 p-4 sm:gap-8'}`}>
            <div className="text-center">
              <p className="text-sm font-black uppercase tracking-widest text-white/80">Room code</p>
              <div className={`font-black tracking-[0.2em] text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.3)] ${shortScreen ? 'text-5xl' : 'text-7xl sm:text-8xl'}`}>{room}</div>
              <p className="mx-auto mt-1 max-w-xs text-sm font-bold text-white/90">
                {shortScreen ? 'Scan the square, or tap Family Race and type the code.' : 'On another device, point the camera at the square. Or open Bendana Kart, tap Family Race and type the code.'}
              </p>
              {shareUrl && (
                <div className={`flex flex-wrap justify-center gap-2 ${shortScreen ? 'mt-1' : 'mt-3'}`}>
                  <button type="button" onClick={shareLink} className="rounded-full bg-white/90 px-4 py-2 text-sm font-black text-slate-900 active:scale-95">📤 Send invite</button>
                  <button type="button" onClick={copyLink} className="rounded-full bg-white/20 px-4 py-2 text-sm font-black text-white ring-1 ring-white/40 active:scale-95">
                    {copied ? '✅ Link copied' : '🔗 Copy link'}
                  </button>
                </div>
              )}
            </div>
            {shareUrl && <QrCode text={shareUrl} size={shortScreen ? 116 : 168} />}
          </header>

          <section className="rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-black text-white">Racers {seats.length}/{MAX_PLAYERS}</h2>
              <div className="flex items-center gap-2">
                {!isHost && conn && <span className="rounded-full bg-black/30 px-2 py-1 text-xs font-black text-white">{conn} {rtt} ms</span>}
                {statusBadge(netStatus)}
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {Array.from({ length: MAX_PLAYERS }, (_, i) => {
                const p = seats[i];
                if (!p) {
                  return (
                    <li key={`empty-${i}`} className="flex min-h-[8.5rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/35 text-white/60">
                      <span className="text-3xl">＋</span>
                      <span className="text-xs font-black">{players.length === 0 ? 'Connecting…' : 'Open seat'}</span>
                    </li>
                  );
                }
                const col = kartColors(p.kartIdx, p.paint);
                const isH = !!host && p.id === host.id;
                return (
                  <li
                    key={p.id}
                    className={`relative flex min-h-[8.5rem] flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-white shadow-lg transition ${p.ready || isH ? 'ring-4 ring-lime-300' : 'ring-2 ring-white/25'}`}
                    style={{ background: `linear-gradient(160deg, ${col.color}, ${col.dark})`, animation: 'bk-pop 0.35s ease-out both' }}
                  >
                    {isH && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-2xl drop-shadow" title="Host">👑</span>}
                    {p.toddler && <span className="absolute right-1 top-1 text-lg" title="Toddler Assist">🛡️</span>}
                    {emotes[p.id] && <span key={emotes[p.id].key} className="absolute -right-1 -top-3 animate-bounce text-4xl">{emotes[p.id].e}</span>}
                    <FaceIcon emoji={KARTS[p.kartIdx].emoji} size={54} happy={p.ready || isH} />
                    <span className="mt-1 block max-w-full truncate text-base font-black leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">{p.name}</span>
                    <span className="block text-[11px] font-bold opacity-90">{p.id === myId ? 'That’s you!' : KARTS[p.kartIdx].name}</span>
                    <span className={`mt-1 rounded-full px-2 py-0.5 text-[11px] font-black ${isH ? 'bg-yellow-300 text-yellow-950' : p.ready ? 'bg-lime-300 text-lime-950' : 'bg-black/30'}`}>
                      {isH ? 'HOST' : p.ready ? '✅ READY' : 'Getting ready…'}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {EMOTES.map((e) => (
                <button key={e} type="button" onClick={() => sendEmote(e)} aria-label={`Send ${e}`} className="h-12 w-12 rounded-full bg-white/15 text-2xl ring-1 ring-white/25 active:scale-90">
                  {e}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
            <h2 className="text-lg font-black text-white">{isHost ? 'Pick the race' : `The race (👑 ${hostName} picks)`}</h2>
            {isHost ? (
              raceChoice(false, shown)
            ) : (
              <div className={`flex items-center gap-4 rounded-2xl bg-gradient-to-br p-3 text-white ${shown.cup >= 0 ? CUPS[shown.cup].card : TRACKS[shown.track].card}`}>
                {shown.cup >= 0 ? <span className="text-6xl drop-shadow">{CUPS[shown.cup].emoji}</span> : <TrackMap idx={shown.track} width={132} />}
                <span>
                  <span className="block text-2xl font-black leading-tight drop-shadow">{shown.cup >= 0 ? CUPS[shown.cup].name : `${TRACKS[shown.track].emoji} ${TRACKS[shown.track].name}`}</span>
                  <span className="block text-sm font-bold text-white/90">
                    {shown.cup >= 0 ? CUPS[shown.cup].tracks.map((t) => TRACKS[t].emoji).join(' ') : TRACKS[shown.track].blurb} · {shown.laps} laps
                  </span>
                </span>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-3xl bg-black/25 p-4 ring-1 ring-white/20">
            <div className="flex items-center gap-3 rounded-2xl p-3 text-white" style={{ background: `linear-gradient(135deg, ${kartColors(profile.kartIdx, profile.paint).color}, ${kartColors(profile.kartIdx, profile.paint).dark})` }}>
              <FaceIcon emoji={meKart.emoji} size={52} happy />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xl font-black leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">{profile.name || 'Racer'}</span>
                <span className="block text-sm font-bold opacity-90">{meKart.name} · {BODIES[profile.body]?.name ?? 'Classic'} kart</span>
              </span>
              <button type="button" onClick={() => openPanel('garage')} className="rounded-full bg-white/90 px-4 py-2 text-sm font-black text-slate-900 active:scale-95">✏️ Change</button>
              <button type="button" onClick={() => openPanel('settings')} aria-label="Settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-xl ring-1 ring-white/30 active:scale-95">⚙️</button>
            </div>
            {whoRow}
            {familyButtons}
            <ToddlerToggle on={profile.toddler} onToggle={() => setProfile((p) => ({ ...p, toddler: !p.toddler }))} />
          </section>

          {netError && <p className="rounded-2xl bg-red-600/80 p-3 text-center font-bold text-white">{netError}</p>}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-white/15 bg-slate-950/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl gap-3">
            <button type="button" onClick={quitToMenu} aria-label="Leave the room" className="rounded-2xl bg-white/20 px-4 py-4 text-lg font-black text-white ring-2 ring-white/30 active:scale-95">
              ←<span className="hidden sm:inline"> Leave</span>
            </button>
            {isHost ? (
              <button
                type="button"
                onClick={() => hostStart()}
                disabled={netStatus !== 'joined'}
                className="bk-tile flex-1 bg-gradient-to-b from-lime-300 to-green-500 px-4 py-4 text-xl font-black text-slate-900 disabled:opacity-50 sm:text-2xl"
              >
                {autoStartAt ? '🏁 Everyone is ready! Starting…' : seats.length > 1 && waiting > 0 ? `🏁 Start now (${waiting} still getting ready)` : '🏁 Start Race!'}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleReady}
                disabled={netStatus !== 'joined'}
                className={`bk-tile flex-1 px-4 py-4 text-xl font-black disabled:opacity-50 sm:text-2xl ${ready ? 'bg-lime-300 text-lime-950 ring-4 ring-white' : 'bg-gradient-to-b from-yellow-200 to-orange-400 text-slate-900'}`}
              >
                {ready ? `✅ Ready! Waiting for 👑 ${hostName}` : '👍 I’m Ready!'}
              </button>
            )}
          </div>
        </div>
        {panelEl}
        {familySheets}
      </main>
    );
  }

  // Race screen
  const meSpec = KARTS[profile.kartIdx];
  const btn = 'no-touch-ui pointer-events-auto flex select-none items-center justify-center rounded-full font-black text-white shadow-xl ring-4 ring-white/30 backdrop-blur active:scale-95';
  const placeColor = hud.place === 1 ? 'text-yellow-300' : hud.place === 2 ? 'text-slate-200' : hud.place === 3 ? 'text-orange-300' : 'text-white';
  const cupInfo = race && race.cup >= 0 ? CUPS[race.cup] : null;
  const lastRound = !!cupInfo && race!.round >= cupInfo.tracks.length - 1;
  const cupTable = cupView ? Object.entries(cupView.totals).sort((a, b) => b[1].pts - a[1].pts) : [];
  const itemIcon = hud.air ? '⭐' : hud.item ? ITEMS[hud.item].emoji : '❔';
  return (
    <main className="no-touch-ui fixed inset-0 overflow-hidden bg-slate-900" onContextMenu={(e) => e.preventDefault()}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvas3dRef} className="absolute inset-0 block h-full w-full" style={{ visibility: 'hidden' }} />
        <canvas ref={canvasRef} {...orbitHandlers} className="absolute inset-0 block h-full w-full touch-none" />
      </div>

      {/* Top HUD */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] ${hud.podium ? 'hidden' : 'flex'}`}>
        <div className="rounded-2xl bg-slate-900/70 px-4 py-2 text-white shadow-lg ring-1 ring-white/20">
          <div
            key={posFx.key}
            className={`text-4xl font-black leading-none sm:text-5xl ${placeColor}`}
            style={posFx.dir ? { textShadow: posFx.dir > 0 ? '0 0 18px #4ade80' : '0 0 18px #f87171', animation: 'bk-pop 0.4s ease-out both' } : undefined}
          >
            {ordinal(hud.place)}
            <span className="text-base font-bold text-white/70"> / {hud.total}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm font-bold text-white/85">
            {Array.from({ length: hud.laps }, (_, i) => (
              <span key={i} className={`inline-block h-3 w-3 rounded-full ${i < hud.lap ? 'bg-lime-300' : 'bg-white/25'}`} />
            ))}
            {hud.lap === hud.laps && <span>🏁</span>}
            <span className="ml-1">{hud.time}</span>
          </div>
          <div className="mt-1 text-sm font-black text-yellow-300">🪙 {hud.coins}{hud.coins >= 10 ? ' MAX' : ''}</div>
        </div>
        <button
          type="button"
          {...fireHandlers}
          className={`no-touch-ui pointer-events-auto relative flex h-20 w-20 flex-col items-center justify-center rounded-3xl bg-gradient-to-b from-white/90 to-white/60 shadow-xl ring-4 active:scale-95 sm:h-24 sm:w-24 ${hud.air ? 'animate-pulse ring-lime-300' : 'ring-yellow-300'}`}
          aria-label={hud.air ? 'Trick' : 'Use item'}
        >
          <span className={`text-4xl sm:text-5xl ${hud.rolling ? 'animate-bounce' : ''}`}>{itemIcon}</span>
          <span className="text-[10px] font-black uppercase text-slate-700">{hud.air ? 'Trick!' : hud.item && !hud.rolling ? ITEMS[hud.item].label : 'Item'}</span>
          {hud.charges > 1 && <span className="absolute -right-2 -top-2 rounded-full bg-orange-500 px-2 text-sm font-black text-white">×{hud.charges}</span>}
        </button>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={cycleCam}
            className="pointer-events-auto rounded-full bg-slate-900/70 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20 active:scale-95"
            aria-label="Switch camera"
            title="Switch camera (C)"
          >
            {(CAM_MODES.find((m) => m.id === profile.cam) || CAM_MODES[0]).icon}
            <span className="ml-1 hidden sm:inline">{(CAM_MODES.find((m) => m.id === profile.cam) || CAM_MODES[0]).label}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              sfx('uiOpen');
              setLeaveArmed(false);
              setRaceMenu(true);
            }}
            className="pointer-events-auto whitespace-nowrap rounded-full bg-slate-900/70 px-3 py-2 text-sm font-black text-white ring-1 ring-white/20 active:scale-95"
            aria-label="Menu"
            title="Menu (Esc)"
          >
            ☰<span className="ml-1 hidden sm:inline">Menu</span>
          </button>
        </div>
      </div>

      {/* Race strip: everyone's face along the race */}
      <div className={`pointer-events-none absolute left-1/2 top-[6.6rem] h-9 w-[min(70vw,520px)] -translate-x-1/2 sm:top-[7.4rem] ${hud.podium ? 'hidden' : ''}`}>
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-900/50 ring-1 ring-white/30" />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 text-lg">🏁</div>
        {hud.standings.map((s) => (
          <div
            key={s.id}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-100 ${s.isMe ? 'z-10 drop-shadow-[0_0_6px_#fde047]' : 'opacity-90'}`}
            style={{ left: `${Math.round(s.frac * 1000) / 10}%` }}
          >
            <FaceIcon emoji={KARTS[s.kartIdx].emoji} size={s.isMe ? 36 : 27} />
          </div>
        ))}
      </div>

      {race?.mode === 'multi' && netStatus !== 'joined' && (
        <div className="pointer-events-none absolute left-3 top-[9.5rem] rounded-full bg-yellow-300 px-3 py-1 text-sm font-black text-yellow-950 shadow">📶 Reconnecting…</div>
      )}
      {netDebug && (
        <pre className="pointer-events-none absolute bottom-40 left-2 max-w-[90vw] whitespace-pre-wrap rounded-xl bg-black/70 p-2 text-[11px] leading-tight text-lime-200">{netDebug}</pre>
      )}

      {profile.toddler && !hud.finished && hud.countdown === null && (
        <div className="pointer-events-none absolute left-1/2 top-[9.4rem] -translate-x-1/2 rounded-full bg-sky-400/90 px-4 py-1 text-sm font-black text-slate-900 shadow sm:top-40">
          🛡️ Toddler Assist on: just hold GAS!
        </div>
      )}

      {hud.banner && hud.countdown === null && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
          <div
            key={hud.banner}
            className="animate-[bounce_0.6s_ease-out_2] rounded-3xl bg-slate-900/70 px-6 py-3 text-4xl font-black drop-shadow-[0_4px_0_rgba(0,0,0,0.4)] sm:text-6xl"
            style={{ color: hud.bannerColor }}
          >
            {hud.banner}
          </div>
        </div>
      )}
      {hud.hurry !== null && (
        <div className="pointer-events-none absolute inset-x-0 top-[11.5rem] flex justify-center">
          <div className="rounded-full bg-red-500/90 px-5 py-1 text-xl font-black text-white shadow-lg">⏰ {hud.hurry}s left!</div>
        </div>
      )}
      {camToast && (
        <div key={camToast.key} className="pointer-events-none absolute inset-x-0 top-[13rem] flex justify-center">
          <div className="rounded-full bg-slate-900/80 px-5 py-2 text-lg font-black text-white shadow-xl ring-2 ring-white/30">{camToast.text}</div>
        </div>
      )}
      {hud.wrongWay && (
        <div className="pointer-events-none absolute inset-x-0 top-[45%] flex justify-center">
          <div className="animate-pulse rounded-3xl bg-red-600/90 px-6 py-3 text-4xl font-black text-white shadow-2xl">↻ WRONG WAY</div>
        </div>
      )}
      {(hud.tier > 0 || hud.draft) && !hud.finished && (
        <div className="pointer-events-none absolute inset-x-0 bottom-36 flex justify-center gap-2 sm:bottom-40">
          {hud.tier > 0 && (
            <div className="rounded-full px-5 py-1 text-xl font-black text-white shadow-lg" style={{ background: ['', '#3b82f6', '#f97316', '#d946ef'][hud.tier] }}>
              DRIFT {'🔥'.repeat(hud.tier)}
            </div>
          )}
          {hud.draft && <div className="rounded-full bg-white/80 px-4 py-1 text-lg font-black text-slate-900 shadow-lg">💨 Slipstream</div>}
        </div>
      )}

      {/* Countdown with start lights */}
      {hud.countdown !== null && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
          {race && (hud.countdown > 3 || (hud.countdown > 0 && vp.h >= 520)) && (
            <div className="mx-4 rounded-3xl bg-slate-900/75 px-7 py-4 text-center text-white shadow-2xl ring-2 ring-white/30" style={{ animation: 'bk-pop 0.5s ease-out both' }}>
              {cupInfo && <div className="text-sm font-black uppercase tracking-widest text-yellow-300">{cupInfo.emoji} {cupInfo.name} · Race {race.round + 1} of {cupInfo.tracks.length}</div>}
              <div className="text-4xl font-black drop-shadow sm:text-5xl">{TRACKS[race.track].emoji} {TRACKS[race.track].name}</div>
              <div className="mt-1 text-base font-bold text-white/85">{TRACKS[race.track].blurb} · {hud.laps} laps</div>
              {hud.countdown > 3 && <div className="mt-1 text-xl font-black text-lime-300">Get ready…</div>}
            </div>
          )}
          <div className="flex gap-3 rounded-full bg-slate-900/75 px-4 py-3 shadow-2xl ring-2 ring-white/30">
            {[3, 2, 1].map((n) => {
              const on = hud.countdown !== null && hud.countdown > 0 && hud.countdown <= n;
              const go = hud.countdown === 0;
              return <span key={n} className={`h-10 w-10 rounded-full sm:h-12 sm:w-12 ${go ? 'bg-lime-400 shadow-[0_0_24px_#a3e635]' : on ? 'bg-red-500 shadow-[0_0_24px_#ef4444]' : 'bg-slate-600'}`} />;
            })}
          </div>
          <div
            key={hud.countdown}
            className={`animate-[ping_1s_ease-out_1] text-[8rem] font-black leading-none drop-shadow-[0_6px_0_rgba(0,0,0,0.35)] ${hud.countdown === 0 ? 'text-lime-300' : 'text-white'}`}
          >
            {hud.countdown === 0 ? 'GO!' : hud.countdown > 3 ? '' : hud.countdown}
          </div>
        </div>
      )}
      {hud.countdown !== null && hud.countdown > 0 && !isTouch && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-lg font-bold text-white drop-shadow">
          W A S D or arrows to drive · Shift to drift · Space for items and tricks · C camera · Q look back · hold gas just before GO for a rocket start!
        </div>
      )}

      {hud.countdown !== null && hud.countdown > 0 && isTouch && (
        <div className="pointer-events-none absolute inset-x-0 top-[22%] px-4 text-center text-base font-black text-white drop-shadow">
          {profile.toddler ? 'Hold GAS to go!' : 'Tap GAS right before GO for a rocket start! Hold a turn to drift.'}
        </div>
      )}

      {/* Touch controls */}
      {isTouch && !hud.finished && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {profile.toddler ? (
            <div className="rounded-2xl bg-sky-400/80 px-4 py-3 text-base font-black text-slate-900 shadow">🛡️ Auto-steer</div>
          ) : (
            <div className="flex gap-2 sm:gap-3">
              <button type="button" aria-label="Steer left" {...holdHandlers('left')} className={`${btn} h-20 w-20 bg-slate-900/45 text-4xl sm:h-28 sm:w-28 sm:text-5xl`}>
                ◀
              </button>
              <button type="button" aria-label="Steer right" {...holdHandlers('right')} className={`${btn} h-20 w-20 bg-slate-900/45 text-4xl sm:h-28 sm:w-28 sm:text-5xl`}>
                ▶
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 sm:gap-3">
            <div className="flex flex-col items-center gap-2 sm:gap-3">
              {profile.cam !== 'top' && (
                <button type="button" aria-label="Look back" {...holdHandlers('lookBack')} className={`${btn} h-12 w-16 rounded-2xl bg-slate-900/45 text-2xl sm:h-14 sm:w-20`}>
                  👀
                </button>
              )}
              <button type="button" aria-label={hud.air ? 'Trick' : 'Use item'} {...fireHandlers} className={`${btn} h-16 w-16 sm:h-20 sm:w-20 ${hud.air ? 'animate-pulse bg-lime-400/90' : 'bg-gradient-to-b from-yellow-300/80 to-orange-500/80'} text-4xl`}>
                {hud.air ? '⭐' : hud.item ? ITEMS[hud.item].emoji : '🎁'}
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 sm:gap-3">
              {!profile.toddler && (
                <button type="button" aria-label="Brake" {...holdHandlers('down')} className={`${btn} h-14 w-20 rounded-2xl bg-red-500/70 text-base sm:h-16 sm:w-24 sm:text-lg`}>
                  BRAKE
                </button>
              )}
              <button
                type="button"
                aria-label="Gas"
                {...holdHandlers('up')}
                className={`${btn} ${profile.toddler ? 'h-32 w-32 text-3xl sm:h-36 sm:w-36' : 'h-24 w-24 text-2xl sm:h-28 sm:w-28'} bg-gradient-to-b from-lime-400/85 to-green-600/85`}
              >
                GAS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finished, waiting for the others: a small card, so the victory lap stays in view */}
      {hud.finished && !hud.podium && (
        <div className="pointer-events-none absolute inset-x-0 top-[8.5rem] flex justify-center px-3 sm:top-[9.5rem] landscape:justify-start">
          <div className="pointer-events-auto w-full max-w-[19rem] rounded-3xl bg-slate-900/80 p-3 text-white shadow-2xl ring-2 ring-white/25" style={{ animation: 'bk-pop 0.45s ease-out both' }}>
            <div className="flex items-center gap-2">
              <span className="text-4xl">{hud.place === 1 ? '🏆' : hud.place === 2 ? '🥈' : hud.place === 3 ? '🥉' : '🎉'}</span>
              <span>
                <span className="block text-xl font-black leading-tight">You finished {ordinal(hud.place)}!</span>
                <span className="block text-xs font-bold text-white/75">{hud.improved ? '🌟 Your driving is getting better!' : 'Waiting for everyone to finish…'}</span>
              </span>
            </div>
            <ol className="mt-2 flex flex-col gap-1">
              {hud.standings.map((s) => (
                <li key={s.id} className={`flex items-center gap-2 rounded-xl px-2 py-0.5 text-sm ${s.isMe ? 'bg-white/20 ring-1 ring-yellow-300' : 'bg-white/10'}`}>
                  <span className="w-8 font-black">{ordinal(s.place)}</span>
                  <FaceIcon emoji={KARTS[s.kartIdx].emoji} size={22} />
                  <span className="flex-1 truncate font-bold">{s.name}</span>
                  <span className="text-xs font-bold text-white/75">{s.time ?? (s.done ? '—' : 'racing…')}</span>
                </li>
              ))}
            </ol>
            {race?.mode === 'multi' && (
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {EMOTES.map((e) => (
                  <button key={e} type="button" onClick={() => sendEmote(e)} className="h-10 w-10 rounded-full bg-white/15 text-xl active:scale-90">{e}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Podium: the winners stand on the 3D stage, the results slide in below (or beside) it */}
      {hud.podium && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between landscape:flex-row">
          <Confetti />
          <div className="relative flex-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-center">
            <h2 className={`inline-block rounded-full bg-slate-900/70 px-5 py-2 font-black text-white shadow-xl ring-2 ring-white/25 ${vp.h < 520 ? 'text-lg' : 'text-2xl sm:text-3xl'}`} style={{ animation: 'bk-pop 0.5s ease-out both' }}>
              {cupInfo ? `${cupInfo.emoji} ${cupInfo.name} · Race ${race!.round + 1}/${cupInfo.tracks.length}` : `🏁 ${race ? TRACKS[race.track].name : 'Race'} results`}
            </h2>
          </div>
          <div
            className="pointer-events-auto relative max-h-[54%] overflow-y-auto rounded-t-[2rem] bg-slate-950/80 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/20 backdrop-blur-md landscape:h-full landscape:max-h-full landscape:w-[42%] landscape:max-w-md landscape:rounded-l-[2rem] landscape:rounded-tr-none landscape:pt-[max(0.75rem,env(safe-area-inset-top))]"
            style={{ animation: 'bk-rise 0.6s 0.2s ease-out both', touchAction: 'pan-y' }}
          >
            <div className="mx-auto flex max-w-lg flex-col gap-2.5">
              {gain && <GainStrip gain={gain} />}
              <div className="grid gap-1.5 sm:grid-cols-2 landscape:grid-cols-1">
                {awards.map((a, i) => (
                  <div
                    key={a.id}
                    className={`flex items-center gap-2.5 rounded-2xl px-3 py-1.5 text-white shadow ${a.isMe ? 'bg-white/25 ring-2 ring-yellow-300' : 'bg-white/10'}`}
                    style={{ animation: `bk-pop 0.4s ${0.6 + i * 0.2}s both` }}
                  >
                    <span className="w-8 text-center text-xl font-black">{['🥇', '🥈', '🥉'][a.place - 1] ?? ordinal(a.place)}</span>
                    <FaceIcon emoji={KARTS[a.kartIdx].emoji} size={34} happy />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black leading-tight">{a.name}</span>
                      <span className="block text-sm font-bold leading-tight text-yellow-200">{a.icon} {a.title}</span>
                    </span>
                    <span className="text-xs font-bold text-white/70">{a.time ?? ''}</span>
                  </div>
                ))}
              </div>
              {cupView && cupTable.length > 0 && (
                <div className="rounded-2xl bg-black/30 p-3 text-white">
                  <div className="mb-1 text-center text-base font-black">{lastRound ? '🏆 Final cup points' : '📊 Cup points'}</div>
                  {cupTable.map(([id, t], i) => (
                    <div key={id} className="flex items-center gap-2 py-0.5 text-sm font-bold">
                      <span className="w-6">{lastRound && i === 0 ? '🏆' : i + 1}</span>
                      <FaceIcon emoji={KARTS[t.kartIdx]?.emoji ?? '🏎️'} size={22} />
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="font-black text-yellow-300">{t.pts}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {race?.mode === 'solo' && (
                  <button
                    type="button"
                    onClick={() => (cupInfo && !lastRound ? startSolo(0, race.cup, race.round + 1) : startSolo(profile.trackIdx, cupInfo ? race.cup : -1, 0))}
                    className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 py-3 text-xl font-black text-slate-900 shadow-lg active:scale-95"
                  >
                    {cupInfo && !lastRound ? `▶ Next race: ${TRACKS[cupInfo.tracks[race.round + 1]].emoji} ${TRACKS[cupInfo.tracks[race.round + 1]].name}` : cupInfo ? '🔁 Play the cup again' : '🔁 Race again'}
                  </button>
                )}
                {race?.mode === 'multi' && isHost && (
                  <>
                    <button
                      type="button"
                      onClick={() => hostStart(cupInfo && !lastRound ? { nextRound: true } : { track: race.track })}
                      className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 py-3 text-xl font-black text-slate-900 shadow-lg active:scale-95"
                    >
                      {cupInfo && !lastRound ? `▶ Next race: ${TRACKS[cupInfo.tracks[race.round + 1]].emoji} ${TRACKS[cupInfo.tracks[race.round + 1]].name}` : '🔁 Race again (everyone)'}
                    </button>
                    {!cupInfo && (
                      <button
                        type="button"
                        onClick={() => {
                          const nt = (race.track + 1) % TRACKS.length;
                          setProfile((p) => ({ ...p, trackIdx: nt }));
                          hostStart({ track: nt });
                        }}
                        className="rounded-2xl bg-gradient-to-b from-sky-300 to-indigo-500 py-2.5 text-lg font-black text-white active:scale-95"
                      >
                        ➡️ Next track: {TRACKS[(race.track + 1) % TRACKS.length].emoji} {TRACKS[(race.track + 1) % TRACKS.length].name}
                      </button>
                    )}
                  </>
                )}
                {race?.mode === 'multi' && !isHost && (
                  <p className="text-center text-sm font-bold text-white/80">Waiting for 👑 {host?.name ?? 'the host'} to start the next race…</p>
                )}
                {race?.mode === 'multi' && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {EMOTES.map((e) => (
                      <button key={e} type="button" onClick={() => sendEmote(e)} className="h-11 w-11 rounded-full bg-white/15 text-2xl active:scale-90">{e}</button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setFamPanel({ kind: 'board' })} className="rounded-2xl bg-gradient-to-b from-yellow-200 to-orange-400 py-2.5 text-lg font-black text-slate-900 active:scale-95">
                  🏆 Family leaderboard
                </button>
                <button type="button" onClick={race?.mode === 'multi' ? backToLobby : quitToMenu} className="rounded-2xl bg-white/15 py-2.5 text-lg font-black text-white ring-1 ring-white/25 active:scale-95">
                  {race?.mode === 'multi' ? 'Back to lobby' : '🏠 Home'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Race menu: the race keeps going underneath, so it is quick to get in and out */}
      {raceMenu && !hud.podium && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && setRaceMenu(false)}>
          <div className="flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-3xl bg-slate-900/95 p-4 text-white shadow-2xl ring-2 ring-white/25" style={{ animation: 'bk-pop 0.25s ease-out both', touchAction: 'pan-y' }}>
            <div className="text-center text-2xl font-black">☰ Menu</div>
            <button
              type="button"
              onClick={() => {
                sfx('uiBack');
                setRaceMenu(false);
              }}
              className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 py-4 text-2xl font-black text-slate-900 shadow-lg active:scale-95"
            >
              ▶ Keep racing
            </button>
            <div>
              <div className="mb-1 text-sm font-black text-white/80">Camera</div>
              <div className="grid grid-cols-2 gap-2">
                {CAM_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      sfx('uiTap');
                      setProfile((p) => ({ ...p, cam: m.id }));
                    }}
                    className={`rounded-xl px-2 py-2 text-sm font-black transition active:scale-95 ${profile.cam === m.id ? 'bg-yellow-300 text-slate-900' : 'bg-white/10 ring-1 ring-white/25'}`}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
            {toggles}
            <button
              type="button"
              onClick={() => {
                if (!leaveArmed) {
                  sfx('uiTap');
                  setLeaveArmed(true);
                  return;
                }
                sfx('uiBack');
                setRaceMenu(false);
                (race?.mode === 'multi' ? backToLobby : quitToMenu)();
              }}
              className={`rounded-2xl py-3 text-lg font-black active:scale-95 ${leaveArmed ? 'bg-red-500 text-white' : 'bg-white/10 text-white ring-1 ring-white/25'}`}
            >
              {leaveArmed ? 'Tap again to leave' : race?.mode === 'multi' ? (isHost ? '🚪 End race for everyone' : '🚪 Back to the lobby') : '🚪 Quit race'}
            </button>
          </div>
        </div>
      )}

      {hud.boost && (
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(251,146,60,0.55)]" style={{ borderColor: kartColors(meSpec ? profile.kartIdx : 0, profile.paint).color }} />
      )}
      {familySheets}
    </main>
  );
}

/** Falling confetti for the podium (CSS only). */
function Confetti() {
  const bits = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((i) => (
        <span
          key={i}
          className="absolute top-[-5%] block h-3 w-2 rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            background: `hsl(${(i * 47) % 360},95%,60%)`,
            animation: `bk-fall ${3 + (i % 5) * 0.6}s ${(i % 10) * 0.3}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}
