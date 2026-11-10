// Bendana Kart audio: every sound is made live with WebAudio. No audio files.
//
// How it is built:
//  - One AudioContext, created on the first user tap (browsers need a gesture).
//  - Graph: sounds -> sfxBus / musicFilter -> musicGain -> master -> compressor -> speakers.
//  - Music uses a few long-lived oscillators (lead, bass, kick) and one looping
//    noise source (snare + hat). Notes are just changes to their pitch and volume,
//    so music creates almost no new nodes while it plays. That keeps phones happy.
//  - Notes are scheduled with the "Tale of Two Clocks" pattern: a 25 ms timer
//    looks 120 ms ahead and books notes on the audio clock, which never drifts.
//  - Sound effects make short-lived nodes, but a small "token bucket" limits how
//    many we create per second, so spammy events can never flood the CPU.
//  - Every public function is wrapped in try/catch and does nothing when there is
//    no running AudioContext. Audio problems must never break the game.

// ===== Shared state =====

const MASTER_VOL = 0.5; // overall loudness (kept low on purpose: kids + phones)
const MUSIC_VOL = 0.12; // music is quiet background under the sound effects
const LOOKAHEAD = 0.12; // seconds of music we book in advance
const TICK_MS = 25; // how often the scheduler wakes up

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicFilter: BiquadFilterNode | null = null;
let musicGain: GainNode | null = null;
let musicSend: GainNode | null = null; // melody voices also feed a soft echo
let noiseBuf: AudioBuffer | null = null;

let muted = false;
let musicOn = true;
let hapticsOn = true;
let suspendedByUs = false; // true when we paused audio because the tab was hidden

/** Returns the context only if it is actually running, else null. */
function live(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** MIDI note number to frequency in Hz. 69 = A4 = 440 Hz. */
function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Turns a note name like "C#5" or "Bb3" into a MIDI number. Returns -1 if unknown. */
function noteToMidi(name: string): number {
  const r = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!r) return -1;
  const pc: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const acc = r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0;
  return 12 * (parseInt(r[3], 10) + 1) + pc[r[1]] + acc;
}

// ===== Node budget: at most ~30 short-lived nodes per second for sound effects. =====

const BUDGET_MAX = 30;
let tokens = BUDGET_MAX;
let lastRefill = 0;
let forceBudget = false; // fanfares are rare and important, so they skip the limit

function spend(n: number): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  tokens = Math.min(BUDGET_MAX, tokens + (now - lastRefill) * (BUDGET_MAX / 1000));
  lastRefill = now;
  if (!forceBudget && tokens < n) return false;
  tokens -= n;
  return true;
}

// ===== Setup and unlock =====

function buildGraph(c: AudioContext): void {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.connect(c.destination);

  master = c.createGain();
  master.gain.value = muted ? 0 : MASTER_VOL;
  master.connect(comp);

  sfxBus = c.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(master);

  musicGain = c.createGain();
  musicGain.gain.value = MUSIC_VOL;
  musicGain.connect(master);

  // A soft lowpass on all music takes the edge off square and saw waves.
  musicFilter = c.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 2800;
  musicFilter.Q.value = 0.5;
  musicFilter.connect(musicGain);

  // A quiet echo on the melody gives the music some room. Three nodes, made once.
  musicSend = c.createGain();
  musicSend.gain.value = 0.3;
  const echo = c.createDelay(1);
  echo.delayTime.value = 0.27;
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const damp = c.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1800;
  musicSend.connect(echo);
  echo.connect(damp);
  damp.connect(fb);
  fb.connect(echo);
  damp.connect(musicGain);

  // One second of white noise, made once and reused by every noisy sound.
  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function onVisibility(): void {
  try {
    if (!ctx) return;
    if (document.hidden) {
      // Pause all sound while the tab is hidden. The audio clock stops too,
      // so music picks up exactly where it was when the tab comes back.
      if (ctx.state === 'running') {
        suspendedByUs = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else if (suspendedByUs) {
      suspendedByUs = false;
      void ctx.resume().catch(() => undefined);
    }
  } catch { /* ignore */ }
}

/** Create or resume the single AudioContext. Call this from a tap or key press. */
export function unlockAudio(): void {
  try {
    if (typeof window === 'undefined') return;
    if (!ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext || w.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      buildGraph(ctx);
      document.addEventListener('visibilitychange', onVisibility);
      // When the context starts running, begin any music the game asked for early.
      ctx.onstatechange = () => {
        try {
          if (live() && musicOn && wantedTrack !== null && !voices) beginTrack(wantedTrack);
        } catch { /* ignore */ }
      };
    }
    if (ctx.state !== 'running') {
      suspendedByUs = false;
      void ctx.resume().catch(() => undefined);
    }
    // Old iOS needs a sound to start inside the gesture: play one silent sample.
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(ctx.destination);
    s.start(0);
  } catch { /* ignore */ }
}

export function isAudioRunning(): boolean {
  try { return live() !== null; } catch { return false; }
}

/** Mute or unmute everything with a short fade (no clicks). */
export function setMuted(m: boolean): void {
  muted = m;
  try {
    if (ctx && master) master.gain.setTargetAtTime(m ? 0 : MASTER_VOL, ctx.currentTime, 0.05);
  } catch { /* ignore */ }
}

// ===== Little sound building blocks =====

/** One enveloped oscillator note. Optional slide to another pitch. Uses 2 nodes. */
function tone(
  f: number, t: number, dur: number, type: OscillatorType, vol: number,
  slideTo = 0, attack = 0.006, dest?: AudioNode,
): void {
  const c = ctx;
  if (!c || !sfxBus || !spend(2)) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.03);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* ignore */ } };
}

/** Filtered noise burst with a filter sweep from f0 to f1. Uses 3 nodes. */
function noise(
  t: number, dur: number, vol: number, ftype: BiquadFilterType,
  f0: number, f1: number, q = 1, attack = 0.01,
): void {
  const c = ctx;
  if (!c || !sfxBus || !noiseBuf || !spend(3)) return;
  const s = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = ftype;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(sfxBus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.03);
  s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch { /* ignore */ } };
}

/** A quick run of notes: [note name or Hz, start offset s, length s]. */
function seq(t: number, notes: Array<[string | number, number, number]>, type: OscillatorType, vol: number, ratio = 1): void {
  for (const [n, at, len] of notes) {
    const f = typeof n === 'number' ? n : mtof(noteToMidi(n));
    tone(f * ratio, t + at, len, type, vol);
  }
}

/** Simple tone for quick UI blips. vol is relative to master (default 0.04). */
export function beep(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.04): void {
  try {
    const c = live();
    if (!c || muted) return;
    tone(freq, c.currentTime + 0.005, Math.max(0.03, dur), type, vol);
  } catch { /* ignore */ }
}

// ===== Sound effects =====

export type Sfx = 'countdown' | 'go' | 'itemRoll' | 'itemGet' | 'rocket' | 'banana' | 'blast' | 'hit'
  | 'bump' | 'coin' | 'boostPad' | 'jump' | 'land' | 'trick' | 'driftTier1' | 'driftTier2' | 'driftTier3'
  | 'miniTurbo' | 'shieldUp' | 'shieldPop' | 'snooze' | 'lap' | 'finalLap' | 'finish' | 'posUp' | 'posDown'
  | 'ready' | 'emote' | 'horn' | 'win' | 'cheer' | 'whoosh' | 'clean'
  | 'uiTap' | 'uiBack' | 'uiToggle' | 'uiOpen' | 'join' | 'leave' | 'sticker' | 'tick' | 'firework' | 'record';

// Last time each effect played, so the same sound can't machine-gun.
const lastPlayed: Partial<Record<Sfx, number>> = {};
const MIN_GAP: Partial<Record<Sfx, number>> = { itemRoll: 0.045, bump: 0.12, coin: 0.04, land: 0.1, cheer: 0.8, horn: 0.3, emote: 0.25, firework: 0.22, uiTap: 0.05, tick: 0.2 };

/** Play a named sound effect. opts.pitch is a semitone offset, opts.vol a volume multiplier. */
export function sfx(name: Sfx, opts?: { pitch?: number; vol?: number }): void {
  try {
    const c = live();
    if (!c || muted) return;
    const now = c.currentTime;
    const gap = MIN_GAP[name] ?? 0.03;
    const prev = lastPlayed[name];
    if (prev !== undefined && now - prev < gap && now >= prev) return;
    lastPlayed[name] = now;

    const t = now + 0.01;
    const r = Math.pow(2, (opts?.pitch ?? 0) / 12); // pitch ratio
    const v = opts?.vol ?? 1; // volume multiplier
    switch (name) {
      case 'countdown': tone(440 * r, t, 0.18, 'triangle', 0.12 * v); break;
      case 'go':
        tone(880 * r, t, 0.5, 'triangle', 0.13 * v);
        tone(1320 * r, t, 0.35, 'sine', 0.05 * v);
        break;
      case 'ready': tone(660 * r, t, 0.12, 'sine', 0.07 * v); break;
      case 'itemRoll': tone((1300 + Math.random() * 300) * r, t, 0.035, 'square', 0.025 * v); break;
      case 'itemGet': seq(t, [['C6', 0, 0.1], ['E6', 0.07, 0.1], ['G6', 0.14, 0.22]], 'triangle', 0.09 * v, r); break;
      case 'rocket':
        noise(t, 0.5, 0.08 * v, 'bandpass', 300, 1500, 1.2, 0.03);
        tone(300 * r, t, 0.45, 'triangle', 0.06 * v, 900 * r);
        break;
      case 'banana': tone(300 * r, t, 0.14, 'sine', 0.1 * v, 700 * r); break; // cute "bloop"
      case 'blast':
        noise(t, 0.6, 0.16 * v, 'lowpass', 1400, 150, 0.7, 0.005);
        tone(120 * r, t, 0.4, 'sine', 0.16 * v, 40 * r);
        break;
      case 'hit':
        tone(420 * r, t, 0.28, 'sine', 0.12 * v, 150 * r); // soft "bonk"
        noise(t, 0.12, 0.05 * v, 'bandpass', 900, 500, 1);
        break;
      case 'bump': tone(180 * r, t, 0.12, 'sine', 0.1 * v, 90 * r); break;
      case 'coin':
        tone(988 * r, t, 0.07, 'square', 0.03 * v); // B5
        tone(1319 * r, t + 0.06, 0.18, 'square', 0.03 * v); // E6
        break;
      case 'whoosh': noise(t, 0.35, 0.09 * v, 'bandpass', 400, 2000, 1.4, 0.06); break;
      case 'boostPad':
        noise(t, 0.35, 0.08 * v, 'bandpass', 400, 2000, 1.4, 0.06);
        seq(t, [[660, 0, 0.1], [990, 0.08, 0.16]], 'triangle', 0.07 * v, r);
        break;
      case 'miniTurbo':
        noise(t, 0.25, 0.06 * v, 'bandpass', 500, 1800, 1.4, 0.03);
        tone(500 * r, t, 0.2, 'triangle', 0.07 * v, 1000 * r);
        break;
      case 'jump': tone(300 * r, t, 0.15, 'sine', 0.08 * v, 700 * r); break;
      case 'land':
        tone(140 * r, t, 0.1, 'sine', 0.08 * v, 80 * r);
        noise(t, 0.08, 0.03 * v, 'lowpass', 800, 300, 0.7, 0.003);
        break;
      case 'trick':
        tone(800 * r, t, 0.12, 'triangle', 0.07 * v, 1600 * r);
        tone(2000 * r, t + 0.08, 0.15, 'sine', 0.03 * v);
        break;
      case 'driftTier1': tone(900 * r, t, 0.09, 'sine', 0.04 * v); break;
      case 'driftTier2': seq(t, [[1100, 0, 0.08], [1400, 0.06, 0.1]], 'sine', 0.045 * v, r); break;
      case 'driftTier3': seq(t, [[1300, 0, 0.07], [1650, 0.05, 0.07], [2000, 0.1, 0.14]], 'sine', 0.05 * v, r); break;
      case 'shieldUp':
        tone(400 * r, t, 0.3, 'sine', 0.08 * v, 800 * r, 0.03);
        tone(1200 * r, t + 0.12, 0.3, 'triangle', 0.04 * v);
        break;
      case 'shieldPop':
        noise(t, 0.12, 0.07 * v, 'highpass', 2500, 4000, 0.7, 0.003);
        tone(1000 * r, t, 0.2, 'sine', 0.07 * v, 300 * r);
        break;
      case 'snooze': snooze(t, r, v); break;
      case 'clean': seq(t, [['E6', 0, 0.08], ['B6', 0.07, 0.16]], 'sine', 0.06 * v, r); break; // sparkly ding
      case 'lap': seq(t, [['C5', 0, 0.14], ['G5', 0.12, 0.26]], 'triangle', 0.1 * v, r); break;
      case 'finalLap': seq(t, [['C5', 0, 0.1], ['E5', 0.09, 0.1], ['G5', 0.18, 0.1], ['C6', 0.27, 0.3]], 'triangle', 0.1 * v, r); break;
      case 'finish': seq(t, [['C5', 0, 0.14], ['G5', 0.12, 0.14], ['C6', 0.24, 0.5]], 'triangle', 0.11 * v, r); break;
      case 'posUp': seq(t, [['A5', 0, 0.1], ['E6', 0.08, 0.18]], 'triangle', 0.07 * v, r); break; // up a fifth
      case 'posDown': tone(220 * r, t, 0.25, 'sine', 0.05 * v, 0, 0.03); break; // soft, not sad
      case 'emote':
        tone(900 * r, t, 0.08, 'sine', 0.06 * v, 1300 * r);
        tone(950 * r, t + 0.1, 0.1, 'sine', 0.06 * v, 1400 * r);
        break;
      case 'horn': // cute two-tone "meep meep"
        tone(523 * r, t, 0.13, 'square', 0.035 * v, 0, 0.01);
        tone(659 * r, t + 0.15, 0.16, 'square', 0.035 * v, 0, 0.01);
        break;
      case 'cheer':
        // Two noise bands that swell up and fade, like a happy crowd.
        noise(t, 1.4, 0.07 * v, 'bandpass', 900, 1200, 0.8, 0.4);
        noise(t + 0.08, 1.2, 0.05 * v, 'bandpass', 2200, 2600, 1.2, 0.35);
        break;
      case 'win': playFanfare(1); break;
      // ----- Menus -----
      case 'uiTap':
        tone(660 * r, t, 0.06, 'triangle', 0.07 * v);
        tone(990 * r, t + 0.035, 0.08, 'sine', 0.05 * v);
        break;
      case 'uiBack': tone(520 * r, t, 0.09, 'triangle', 0.06 * v, 390 * r); break;
      case 'uiToggle': tone(780 * r, t, 0.05, 'sine', 0.06 * v); break;
      case 'uiOpen': seq(t, [['G5', 0, 0.07], ['C6', 0.05, 0.07], ['E6', 0.1, 0.12]], 'sine', 0.05 * v, r); break;
      case 'join': seq(t, [['E5', 0, 0.1], ['A5', 0.09, 0.1], ['C#6', 0.18, 0.22]], 'triangle', 0.08 * v, r); break; // someone arrived
      case 'leave': seq(t, [['A5', 0, 0.1], ['E5', 0.1, 0.2]], 'triangle', 0.05 * v, r); break;
      case 'sticker': // a new sticker for the trophy shelf
        seq(t, [['C6', 0, 0.08], ['E6', 0.07, 0.08], ['G6', 0.14, 0.08], ['C7', 0.21, 0.3]], 'sine', 0.06 * v, r);
        noise(t + 0.2, 0.25, 0.02 * v, 'highpass', 5000, 8000, 0.7, 0.01);
        break;
      case 'record': seq(t, [['G5', 0, 0.1], ['G5', 0.12, 0.1], ['D6', 0.24, 0.1], ['G6', 0.36, 0.4]], 'triangle', 0.09 * v, r); break;
      case 'tick': tone(1000 * r, t, 0.04, 'square', 0.03 * v); break;
      case 'firework':
        noise(t, 0.5, 0.05 * v, 'lowpass', 2400, 300, 0.6, 0.004);
        noise(t + 0.06, 0.6, 0.025 * v, 'highpass', 4000, 7000, 0.8, 0.05);
        tone(160 * r, t, 0.25, 'sine', 0.07 * v, 60 * r);
        break;
    }
  } catch { /* ignore */ }
}

/** Sleepy descending wobble: one oscillator whose pitch zig-zags downward. */
function snooze(t: number, r: number, v: number): void {
  const c = ctx;
  if (!c || !sfxBus || !spend(2)) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  const dur = 0.7;
  o.frequency.setValueAtTime(600 * r, t);
  for (let i = 1; i <= 8; i++) {
    const wob = i % 2 ? 1.05 : 0.95;
    o.frequency.linearRampToValueAtTime(600 * r * (1 - i * 0.07) * wob, t + (dur * i) / 8);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07 * v, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.03);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* ignore */ } };
}

/** End-of-race jingle. 1st is triumphant, 2nd/3rd happy, everyone else cheerful and encouraging. */
export function playFanfare(place: number): void {
  try {
    const c = live();
    if (!c || muted) return;
    const t = c.currentTime + 0.03;
    forceBudget = true;
    if (place === 1) {
      seq(t, [['G4', 0, 0.12], ['C5', 0.12, 0.12], ['E5', 0.24, 0.12], ['G5', 0.36, 0.2],
        ['E5', 0.56, 0.12], ['G5', 0.68, 0.12]], 'square', 0.04);
      // Big final chord.
      seq(t + 0.82, [['C6', 0, 0.9], ['G5', 0, 0.9], ['E5', 0, 0.9]], 'triangle', 0.08);
      tone(130.8, t + 0.82, 0.9, 'triangle', 0.1);
      noise(t + 0.82, 1.2, 0.05, 'bandpass', 900, 1300, 0.8, 0.3);
    } else if (place <= 3) {
      seq(t, [['C5', 0, 0.12], ['E5', 0.12, 0.12], ['G5', 0.24, 0.12], ['E5', 0.36, 0.12]], 'triangle', 0.09);
      seq(t + 0.5, [['C6', 0, 0.6], ['G5', 0, 0.6]], 'triangle', 0.08);
    } else {
      // "You did it!" Rising and friendly.
      seq(t, [['E5', 0, 0.14], ['G5', 0.15, 0.14], ['A5', 0.3, 0.14], ['G5', 0.45, 0.14]], 'triangle', 0.08);
      seq(t + 0.62, [['C6', 0, 0.55], ['E5', 0, 0.55]], 'triangle', 0.07);
    }
  } catch { /* ignore */ } finally {
    forceBudget = false;
  }
}

// ===== Music tracks =====
// Each step is an eighth note. Each bar has 8 steps.
// lead: note names, "." = rest, "-" = hold the previous note one more step.
// chords: one bass root per bar. bass: 8-char pattern per bar,
//   R = root, F = fifth, O = octave, "." = rest, "-" = hold.
// drums: tokens per step (repeat every 8): k = kick, s = snare, h = hat.

interface TrackDef {
  bpm: number; swing: number; leadWave: OscillatorType; bell: boolean; leadVol: number;
  bassWave: OscillatorType; chords: string[]; bass: string; lead: string[]; drums: string[];
  // The second half of the tune (optional): its own chords and melody
  chordsB?: string[]; leadB?: string[];
  // Harmony: the 7 notes of the key (0 = C), and a plucked pattern over each chord.
  // Pattern digits: 0 root, 1 third, 2 fifth, 3 octave, "." rest.
  scale: number[]; arp: string; arpVol: number;
}

const TRACKS: Record<number, TrackDef> = {
  // Results / podium: a proud, bright C major march.
  [-2]: {
    bpm: 118, swing: 0, leadWave: 'square', bell: false, leadVol: 0.3, bassWave: 'triangle',
    chords: ['C3', 'F2', 'G2', 'C3', 'A2', 'F2', 'G2', 'C3'], bass: 'R.F.R.O.',
    lead: ['G5 . E5 G5 C6 - G5 .', 'A5 . F5 A5 C6 - A5 .', 'B5 . G5 B5 D6 - B5 .', 'C6 - G5 . E5 . G5 .',
      'E6 . C6 A5 E5 - A5 C6', 'F5 . A5 C6 F6 - C6 A5', 'G5 . B5 D6 G6 - F6 D6', 'C6 - - . G5 . C5 .'],
    drums: ['k', 'h', 's', 'h', 'k', 'k', 's', 'h'],
    scale: [0, 2, 4, 5, 7, 9, 11], arp: '02130213', arpVol: 0.13,
  },
  // Menu / lobby: gentle G major, ~100 bpm.
  [-1]: {
    bpm: 100, swing: 0, leadWave: 'triangle', bell: false, leadVol: 0.5, bassWave: 'triangle',
    chords: ['G2', 'E2', 'C3', 'D3', 'G2', 'E2', 'C3', 'D3'], bass: 'R---F---',
    lead: ['B4 - D5 . G5 - D5 .', 'E5 - - . B4 - . .', 'C5 - E5 . G5 - E5 .', 'D5 - - . F#5 - A5 .',
      'G5 - F#5 . E5 - D5 .', 'B4 - - . G4 - B4 .', 'C5 - E5 . A5 - G5 .', 'F#5 - D5 . G5 - - .'],
    chordsB: ['C3', 'G2', 'A2', 'D3', 'C3', 'G2', 'D3', 'G2'],
    leadB: ['E5 - G5 . C6 - G5 .', 'D5 - B4 . G4 - B4 D5', 'C5 - E5 . A5 - E5 .', 'F#5 - A5 . D5 - - .',
      'E5 - G5 . C6 - B5 A5', 'G5 - D5 . B4 - D5 .', 'A5 - F#5 . D5 - F#5 A5', 'G5 - - . . . D5 .'],
    drums: ['k', '.', 'h', '.', 's', '.', 'h', '.'],
    scale: [7, 9, 11, 0, 2, 4, 6], arp: '0.1.2.1.', arpVol: 0.16,
  },
  // 0 Sunny Meadow: bright C major, bouncy 128 bpm.
  0: {
    bpm: 128, swing: 0, leadWave: 'square', bell: false, leadVol: 0.32, bassWave: 'triangle',
    chords: ['C3', 'G2', 'A2', 'F2', 'C3', 'F2', 'G2', 'C3'], bass: 'R.F.O.F.',
    lead: ['E5 . G5 E5 C5 - D5 E5', 'D5 - B4 . G4 - . .', 'C5 . E5 C5 A4 - B4 C5', 'A4 - F4 . A4 - C5 .',
      'E5 . G5 E5 A5 - G5 E5', 'F5 - E5 D5 C5 - A4 .', 'B4 . D5 G5 F5 - D5 B4', 'C5 - - . G4 . C5 .'],
    chordsB: ['F2', 'C3', 'G2', 'A2', 'F2', 'C3', 'G2', 'G2'],
    leadB: ['A5 . F5 A5 C6 - A5 F5', 'G5 - E5 . C5 - E5 G5', 'D5 . G5 B5 D6 - B5 G5', 'C6 - A5 . E5 - . .',
      'A5 . C6 A5 F5 - A5 C6', 'G5 . E5 G5 C6 - G5 E5', 'D5 . E5 F5 G5 - A5 B5', 'D6 - B5 . G5 . G4 .'],
    drums: ['k', 'h', 's', 'h', 'k', 'kh', 's', 'h'],
    scale: [0, 2, 4, 5, 7, 9, 11], arp: '02120212', arpVol: 0.13,
  },
  // 1 Candy Canyon: playful F major with swing, 120 bpm.
  1: {
    bpm: 120, swing: 0.18, leadWave: 'triangle', bell: false, leadVol: 0.55, bassWave: 'triangle',
    chords: ['F2', 'D3', 'Bb2', 'C3', 'F2', 'D3', 'G2', 'C3'], bass: 'R-.FR-.F',
    lead: ['C5 A4 C5 F5 . E5 F5 .', 'D5 . A4 . D5 F5 A5 .', 'G5 F5 D5 Bb4 - . C5 D5', 'E5 - G5 - E5 . C5 .',
      'C5 A4 C5 F5 . G5 A5 .', 'F5 . D5 . A4 D5 F5 .', 'G5 . Bb5 G5 E5 . C5 E5', 'F5 - - . C5 . F4 .'],
    chordsB: ['Bb2', 'F2', 'G2', 'C3', 'Bb2', 'A2', 'D3', 'C3'],
    leadB: ['D5 F5 Bb5 . A5 G5 F5 .', 'C5 . F5 . A5 F5 C5 .', 'Bb4 D5 G5 . F5 D5 Bb4 .', 'C5 - E5 - G5 . Bb5 .',
      'D5 F5 Bb5 . D6 Bb5 F5 .', 'E5 . A5 . C6 A5 E5 .', 'F5 . A5 D6 . A5 F5 D5', 'E5 - G5 . C6 . C5 .'],
    drums: ['k', '.', 's', 'h', '.', 'k', 's', 'h'],
    scale: [5, 7, 9, 10, 0, 2, 4], arp: '0.21.021', arpVol: 0.15,
  },
  // 2 Frosty Peaks: sparkly bells in D lydian (the G# is the magic note), 112 bpm.
  2: {
    bpm: 112, swing: 0, leadWave: 'sine', bell: true, leadVol: 0.5, bassWave: 'triangle',
    chords: ['D3', 'E3', 'D3', 'E3', 'D3', 'E3', 'B2', 'A2'], bass: 'R---F---',
    lead: ['A5 F#5 D5 F#5 G#5 . A5 .', 'B5 . G#5 E5 B4 - . E5', 'F#5 A5 D6 A5 G#5 F#5 E5 .', 'G#5 - B5 - E5 . . .',
      'A5 F#5 D5 F#5 G#5 . A5 .', 'B5 . E6 . B5 G#5 E5 .', 'D5 F#5 B5 F#5 C#5 E5 A5 .', 'A5 - - . G#5 . A5 .'],
    chordsB: ['B2', 'A2', 'D3', 'E3', 'B2', 'A2', 'E3', 'D3'],
    leadB: ['F#5 . B5 . D6 . B5 F#5', 'E5 . A5 . C#6 - A5 .', 'F#5 A5 D6 . A5 F#5 D5 .', 'G#5 - B5 . E6 - . .',
      'D6 . B5 . F#5 . B5 D6', 'C#6 . A5 . E5 . A5 C#6', 'B5 G#5 E5 G#5 B5 . E6 .', 'D6 - - . A5 . F#5 .'],
    drums: ['k', 'h', '.', 'h', 's', 'h', '.', 'h'],
    scale: [2, 4, 6, 8, 9, 11, 1], arp: '01232123', arpVol: 0.11,
  },
  // 3 Dusty Dunes: E phrygian-dominant flavour (F and G# over E), 124 bpm.
  3: {
    bpm: 124, swing: 0, leadWave: 'square', bell: false, leadVol: 0.3, bassWave: 'square',
    chords: ['E2', 'E2', 'F2', 'E2', 'E2', 'D2', 'F2', 'E2'], bass: 'R.RF.RO.',
    lead: ['E5 F5 G#5 . F5 E5 . B4', 'C5 B4 G#4 . E4 - . .', 'A4 B4 C5 D5 C5 B4 G#4 .', 'B4 - - . E5 . B4 .',
      'E5 F5 G#5 . A5 G#5 F5 E5', 'D5 . F5 D5 A4 - . .', 'F5 E5 D5 C5 B4 C5 G#4 .', 'E4 - - . B4 . E5 .'],
    chordsB: ['A2', 'A2', 'E2', 'E2', 'F2', 'D2', 'E2', 'E2'],
    leadB: ['A5 . C6 A5 E5 . A5 .', 'C6 B5 A5 . E5 - . .', 'G#5 . B5 G#5 E5 . G#5 B5', 'E6 - D6 C6 B5 - . .',
      'A5 C6 F6 . E6 C6 A5 .', 'F5 A5 D6 . C6 A5 F5 .', 'E5 F5 G#5 A5 B5 C6 D6 .', 'E6 - - . B5 . E5 .'],
    drums: ['k', '.', 'h', 'k', 's', '.', 'h', 'h'],
    scale: [4, 5, 8, 9, 11, 0, 2], arp: '0.2.1.2.', arpVol: 0.12,
  },
  // 4 Volcano Loop: driving A minor, 136 bpm.
  4: {
    bpm: 136, swing: 0, leadWave: 'sawtooth', bell: false, leadVol: 0.28, bassWave: 'square',
    chords: ['A2', 'F2', 'G2', 'A2', 'A2', 'F2', 'G2', 'E2'], bass: 'RRORRFRO',
    lead: ['A4 . C5 E5 A5 . G5 E5', 'F5 . E5 C5 A4 - C5 .', 'D5 . B4 G4 D5 . G5 F5', 'E5 - C5 . A4 - . .',
      'A4 . C5 E5 A5 . B5 C6', 'A5 . F5 . C5 F5 A5 .', 'G5 . D5 . B4 D5 G5 B5', 'E5 - B4 . E5 . B5 .'],
    chordsB: ['D2', 'A2', 'F2', 'G2', 'D2', 'A2', 'E2', 'E2'],
    leadB: ['F5 . A5 D6 . A5 F5 D5', 'E5 . A5 C6 . A5 E5 .', 'F5 . A5 C6 F6 . C6 A5', 'G5 - B5 . D6 - . .',
      'D6 . A5 F5 D5 . F5 A5', 'C6 . A5 E5 C5 . E5 A5', 'B5 . G5 E5 B4 . E5 G5', 'B5 - - . E5 . E6 .'],
    drums: ['k', 'h', 's', 'h', 'k', 'kh', 's', 'kh'],
    scale: [9, 11, 0, 2, 4, 5, 7], arp: '02320232', arpVol: 0.1,
  },
};

interface NoteEv { m: number; len: number }
interface Parsed { def: TrackDef; n: number; lead: Array<NoteEv | null>; bass: Array<NoteEv | null>; arp: Array<number | null> }

/** Turn a list of tokens into note events with lengths (counting "-" holds). */
function toEvents(tokens: string[], toMidi: (tok: string, i: number) => number): Array<NoteEv | null> {
  const out: Array<NoteEv | null> = tokens.map(() => null);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '.' || tok === '-') continue;
    const m = toMidi(tok, i);
    if (m < 0) continue;
    let len = 1;
    while (tokens[i + len] === '-') len++;
    out[i] = { m, len };
  }
  return out;
}

/** The chord built on a bass note from the notes of the key: [root, third, fifth, octave]. */
function triad(root: number, scale: number[]): number[] {
  const pc = ((root % 12) + 12) % 12;
  const i = scale.indexOf(pc);
  if (i < 0) return [root, root + 4, root + 7, root + 12];
  const up = (deg: number) => {
    let d = scale[(i + deg) % 7] - pc;
    if (d <= 0) d += 12;
    return root + d;
  };
  return [root, up(2), up(4), root + 12];
}

function parseTrack(def: TrackDef): Parsed {
  const chords = def.chordsB ? [...def.chords, ...def.chordsB] : def.chords;
  const leadBars = def.leadB ? [...def.lead, ...def.leadB] : def.lead;
  const n = chords.length * 8;
  const leadTok = leadBars.join(' ').trim().split(/\s+/);
  while (leadTok.length < n) leadTok.push('.');
  leadTok.length = n;
  const bassTok: string[] = [];
  for (let b = 0; b < chords.length; b++) for (let i = 0; i < 8; i++) bassTok.push(def.bass[i] || '.');
  const off: Record<string, number> = { R: 0, F: 7, O: 12 };
  const arp: Array<number | null> = [];
  for (let b = 0; b < chords.length; b++) {
    const tr = triad(noteToMidi(chords[b]), def.scale);
    for (let i = 0; i < 8; i++) {
      const ch = def.arp[i] ?? '.';
      const d = ch >= '0' && ch <= '3' ? ch.charCodeAt(0) - 48 : -1;
      arp.push(d < 0 ? null : tr[d] + 24);
    }
  }
  return {
    def, n, arp,
    lead: toEvents(leadTok, (tok) => noteToMidi(tok)),
    bass: toEvents(bassTok, (tok, i) => noteToMidi(chords[Math.floor(i / 8)]) + (off[tok] ?? 0)),
  };
}

// ===== Music player =====

interface Voices {
  lead: OscillatorNode; lead2: OscillatorNode | null; leadG: GainNode;
  arp: OscillatorNode; arpG: GainNode;
  bass: OscillatorNode; bassG: GainNode; kick: OscillatorNode; kickG: GainNode;
  noise: AudioBufferSourceNode; hatG: GainNode; snG: GainNode; all: AudioNode[];
}

let voices: Voices | null = null;
let current: Parsed | null = null;
let playingIdx: number | null = null;
let wantedTrack: number | null = null; // what the game asked for, even if muted or not unlocked
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextTime = 0;
let intensity: 0 | 1 | 2 = 0;

function stepDur(): number {
  const bpm = current ? current.def.bpm : 120;
  return 60 / (bpm * (intensity === 1 ? 1.08 : 1)) / 2;
}

/** Build the few long-lived music voices for one track. */
function makeVoices(c: AudioContext, def: TrackDef): Voices {
  const dest = musicFilter as BiquadFilterNode;
  const all: AudioNode[] = [];
  const osc = (type: OscillatorType, g: GainNode): OscillatorNode => {
    const o = c.createOscillator();
    o.type = type;
    o.connect(g);
    o.start();
    all.push(o);
    return o;
  };
  const gain = (to: AudioNode): GainNode => {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(to);
    all.push(g);
    return g;
  };
  const leadG = gain(dest);
  if (musicSend) leadG.connect(musicSend);
  const lead = osc(def.leadWave, leadG);
  const arpG = gain(dest);
  if (musicSend) arpG.connect(musicSend);
  const arp = osc(def.bell ? 'sine' : 'triangle', arpG);
  let lead2: OscillatorNode | null = null;
  if (def.bell) {
    // A quiet octave-up partial makes the sine sound like a little bell.
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    g2.connect(leadG);
    all.push(g2);
    lead2 = osc('sine', g2);
  }
  const bassG = gain(dest);
  const bass = osc(def.bassWave, bassG);
  const kickG = gain(dest);
  const kick = osc('sine', kickG);
  // One looping noise source feeds both the hat (highpass) and snare (bandpass).
  const nz = c.createBufferSource();
  nz.buffer = noiseBuf;
  nz.loop = true;
  const hatF = c.createBiquadFilter();
  hatF.type = 'highpass';
  hatF.frequency.value = 7000;
  const snF = c.createBiquadFilter();
  snF.type = 'bandpass';
  snF.frequency.value = 1800;
  snF.Q.value = 0.8;
  const hatG = gain(dest);
  const snG = gain(dest);
  nz.connect(hatF); hatF.connect(hatG);
  nz.connect(snF); snF.connect(snG);
  nz.start();
  all.push(nz, hatF, snF);
  return { lead, lead2, leadG, arp, arpG, bass, bassG, kick, kickG, noise: nz, hatG, snG, all };
}

/** Book every sound for one step at audio time t. */
function scheduleStep(s: number, t: number): void {
  const v = voices;
  const p = current;
  if (!v || !p) return;
  const i = s % p.n;
  const sd = stepDur();
  const tr = intensity === 1 ? 1 : 0; // final lap: up one semitone

  const le = p.lead[i];
  if (le) {
    const f = mtof(le.m + tr);
    v.lead.frequency.setTargetAtTime(f, t, 0.004); // tiny glide = no clicks
    if (v.lead2) v.lead2.frequency.setTargetAtTime(f * 2, t, 0.004);
    const g = v.leadG.gain;
    const pk = p.def.leadVol;
    g.setTargetAtTime(pk, t, 0.005);
    if (p.def.bell) {
      g.setTargetAtTime(0, t + 0.02, 0.22); // bells ring out
    } else {
      g.setTargetAtTime(pk * 0.7, t + 0.04, 0.08);
      g.setTargetAtTime(0, t + Math.max(0.05, le.len * sd * 0.85), 0.03);
    }
  }
  const an = p.arp[i];
  if (an !== null && an !== undefined) {
    v.arp.frequency.setTargetAtTime(mtof(an + tr), t, 0.003);
    const g = v.arpG.gain;
    g.setTargetAtTime(p.def.arpVol, t, 0.004);
    g.setTargetAtTime(0, t + 0.03, p.def.bell ? 0.16 : 0.07); // plucked
  }
  const be = p.bass[i];
  if (be) {
    v.bass.frequency.setTargetAtTime(mtof(be.m + tr), t, 0.004);
    const g = v.bassG.gain;
    const pk = p.def.bassWave === 'square' ? 0.22 : 0.5;
    g.setTargetAtTime(pk, t, 0.006);
    g.setTargetAtTime(pk * 0.6, t + 0.05, 0.1);
    g.setTargetAtTime(0, t + Math.max(0.06, be.len * sd * 0.85), 0.03);
  }
  let d = p.def.drums[i % p.def.drums.length] || '.';
  // A little drum fill at the end of every fourth bar leads into the next phrase
  if (Math.floor(i / 8) % 4 === 3 && i % 8 >= 6) d += 's';
  if (d.includes('k')) {
    v.kick.frequency.setValueAtTime(150, t);
    v.kick.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    v.kickG.gain.setTargetAtTime(0.8, t, 0.002);
    v.kickG.gain.setTargetAtTime(0, t + 0.02, 0.06);
  }
  if (d.includes('s')) {
    v.snG.gain.setTargetAtTime(0.3, t, 0.002);
    v.snG.gain.setTargetAtTime(0, t + 0.015, 0.05);
  }
  const hat = d.includes('h') ? 0.12 : intensity === 1 ? 0.07 : 0; // extra hats on the final lap
  if (hat > 0) {
    v.hatG.gain.setTargetAtTime(hat, t, 0.001);
    v.hatG.gain.setTargetAtTime(0, t + 0.01, 0.02);
  }
}

/** The scheduler: wakes every 25 ms and books notes up to 120 ms ahead. */
function tick(): void {
  try {
    const c = live();
    if (!c || !voices || !current) return;
    const now = c.currentTime;
    const sd = stepDur();
    // If we fell far behind (timer throttled), skip the missed notes instead of
    // playing them all at once.
    if (nextTime < now - 0.05) {
      const missed = Math.ceil((now - nextTime) / sd);
      step += missed;
      nextTime += missed * sd;
    }
    let guard = 0;
    while (nextTime < now + LOOKAHEAD && guard++ < 16) {
      const swing = step % 2 === 1 ? current.def.swing * sd : 0;
      scheduleStep(step, nextTime + swing);
      step++;
      nextTime += stepDur();
    }
  } catch { /* ignore */ }
}

function stopVoices(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
  const v = voices;
  voices = null;
  current = null;
  playingIdx = null;
  if (!v || !ctx) return;
  try {
    const t = ctx.currentTime;
    for (const g of [v.leadG, v.arpG, v.bassG, v.kickG, v.hatG, v.snG]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.04);
    }
    for (const s of [v.lead, v.lead2, v.arp, v.bass, v.kick, v.noise]) if (s) s.stop(t + 0.3);
    v.noise.onended = () => { for (const n of v.all) { try { n.disconnect(); } catch { /* ignore */ } } };
  } catch { /* ignore */ }
}

function beginTrack(idx: number): void {
  const c = live();
  if (!c || !musicFilter || !noiseBuf) return;
  const def = TRACKS[idx] ?? TRACKS[0];
  stopVoices();
  current = parseTrack(def);
  voices = makeVoices(c, def);
  playingIdx = idx;
  step = 0;
  nextTime = c.currentTime + 0.08;
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Start a music loop. -2 = results, -1 = menu, 0..4 = race tracks. Safe to call before unlock. */
export function startMusic(trackIdx: number): void {
  try {
    wantedTrack = trackIdx;
    if (playingIdx === trackIdx && voices) { intensity = 0; return; }
    intensity = 0;
    if (!musicOn || !live()) return; // will start later on unlock / music on
    beginTrack(trackIdx);
  } catch { /* ignore */ }
}

export function stopMusic(): void {
  try {
    wantedTrack = null;
    intensity = 0;
    stopVoices();
  } catch { /* ignore */ }
}

/** Turn music on or off without touching sound effects. Remembers the last track. */
export function setMusicOn(on: boolean): void {
  try {
    musicOn = on;
    if (!on) stopVoices();
    else if (wantedTrack !== null && !voices) beginTrack(wantedTrack);
  } catch { /* ignore */ }
}

/** 0 normal, 1 final lap (faster, +1 semitone, extra hats), 2 victory fanfare then stop. */
export function setMusicIntensity(level: 0 | 1 | 2): void {
  try {
    if (level === 2) {
      stopMusic();
      playFanfare(1);
      return;
    }
    intensity = level;
  } catch { /* ignore */ }
}

// ===== Engine hum: two oscillators through a lowpass, very quiet. =====
// Plus one looping noise source split three ways for the road surface:
// drift screech, grass rumble and wind at high speed.

type Engine = {
  o: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode; last: number;
  n: AudioBufferSourceNode; skidF: BiquadFilterNode; skidG: GainNode; grassF: BiquadFilterNode; grassG: GainNode;
  windF: BiquadFilterNode; windG: GainNode;
};
let eng: Engine | null = null;

export function engineStart(): void {
  try {
    const c = live();
    if (!c || !sfxBus || eng || !noiseBuf) return;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 70;
    o2.type = 'square';
    o2.frequency.value = 105;
    g2.gain.value = 0.3;
    f.type = 'lowpass';
    f.frequency.value = 500;
    f.Q.value = 0.7;
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.015, c.currentTime, 0.2);
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(sfxBus);
    o.start();
    o2.start();
    // Surface sounds share one looping noise source
    const n = c.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = true;
    const branch = (type: BiquadFilterType, freq: number, q: number) => {
      const bf = c.createBiquadFilter();
      const bg = c.createGain();
      bf.type = type;
      bf.frequency.value = freq;
      bf.Q.value = q;
      bg.gain.value = 0;
      n.connect(bf); bf.connect(bg); bg.connect(sfxBus!);
      return [bf, bg] as const;
    };
    const [skidF, skidG] = branch('bandpass', 1800, 6);
    const [grassF, grassG] = branch('lowpass', 220, 1);
    const [windF, windG] = branch('highpass', 2500, 0.5);
    n.start();
    eng = { o, o2, f, g, last: 0, n, skidF, skidG, grassF, grassG, windF, windG };
  } catch { /* ignore */ }
}

/** Call every frame. Updates are thinned to about 20 per second. */
export function engineUpdate(speedRatio: number, boosting: boolean, surface?: { drift: number; tier: number; grass: boolean; curb: boolean }): void {
  try {
    const c = live();
    if (!c || !eng) return;
    const now = c.currentTime;
    if (now - eng.last < 0.05) return;
    eng.last = now;
    const r = Math.max(0, Math.min(1.3, speedRatio || 0));
    const hz = 70 + 170 * r + (boosting ? 25 : 0);
    eng.o.frequency.setTargetAtTime(hz, now, 0.08);
    eng.o2.frequency.setTargetAtTime(hz * 1.5, now, 0.08);
    eng.f.frequency.setTargetAtTime(boosting ? 900 : 500 + 200 * r, now, 0.1);
    eng.g.gain.setTargetAtTime(boosting ? 0.02 : 0.015, now, 0.1);
    const sf = surface ?? { drift: 0, tier: 0, grass: false, curb: false };
    eng.skidG.gain.setTargetAtTime(sf.drift > 0 ? 0.022 : 0, now, 0.05);
    eng.skidF.frequency.setTargetAtTime(1500 + sf.tier * 350, now, 0.1);
    // The curb pulses (a "brrrp"), the grass is a steady rumble
    const pulse = sf.curb ? (Math.floor(now * 14) % 2 ? 0.035 : 0.008) : 0;
    eng.grassG.gain.setTargetAtTime(sf.grass && r > 0.1 ? 0.035 : pulse * Math.min(1, r * 2), now, 0.03);
    eng.windG.gain.setTargetAtTime(0.02 * r * r, now, 0.15);
  } catch { /* ignore */ }
}

export function engineStop(): void {
  try {
    const e = eng;
    eng = null;
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    for (const gn of [e.g, e.skidG, e.grassG, e.windG]) gn.gain.setTargetAtTime(0, t, 0.08);
    e.o.stop(t + 0.5);
    e.o2.stop(t + 0.5);
    e.n.stop(t + 0.5);
    e.o.onended = () => {
      try {
        for (const nd of [e.o, e.o2, e.f, e.g, e.n, e.skidF, e.skidG, e.grassF, e.grassG, e.windF, e.windG]) nd.disconnect();
      } catch { /* ignore */ }
    };
  } catch { /* ignore */ }
}

// ===== Haptics (Android buzz; iOS Safari has no vibrate, so it quietly does nothing) =====

export function setHaptics(on: boolean): void {
  hapticsOn = on;
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (!hapticsOn || typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean; userActivation?: { hasBeenActive: boolean } };
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return; // browsers block it before the first tap
    if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
  } catch { /* ignore */ }
}

/** For tests: what the music player is doing right now. */
export function musicDebug(): { track: number | null; step: number; steps: number; running: boolean } {
  return { track: playingIdx, step, steps: current ? current.n : 0, running: !!voices && live() !== null };
}
