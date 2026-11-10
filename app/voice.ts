// Spoken callouts ("Final lap!", "Banana peel!") for players who can't read yet.
// Uses the browser's built-in speech (no audio files). If the browser has no
// speech, or anything goes wrong, every function quietly does nothing.

let enabled = true;
let muted = false;
let voice: SpeechSynthesisVoice | null = null;
let picked = false;
let lastText = '';
let lastAt = 0;

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

/** Pick a friendly English voice once the browser has loaded its list. */
function pickVoice(s: SpeechSynthesis) {
  if (picked && voice) return;
  const all = s.getVoices();
  if (!all.length) return;
  picked = true;
  const en = all.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === 'en');
  const pool = en.length ? en : all;
  const score = (v: SpeechSynthesisVoice) => {
    let n = 0;
    if (/samantha|karen|moira|tessa|google us english|zira|aria|jenny|female/i.test(v.name)) n += 3;
    if (/en[-_]US/i.test(v.lang)) n += 2;
    if (v.localService) n += 1; // local voices start without a network delay
    if (/compact|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|albert|jester|organ|superstar|wobble/i.test(v.name)) n -= 6;
    return n;
  };
  voice = [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function voiceAvailable(): boolean {
  return synth() !== null;
}

export function setVoiceOn(on: boolean): void {
  enabled = on;
  if (!on) stopVoice();
}

export function setVoiceMuted(m: boolean): void {
  muted = m;
  if (m) stopVoice();
}

export function stopVoice(): void {
  try {
    synth()?.cancel();
  } catch { /* ignore */ }
}

/** Call from a tap so mobile browsers allow speech later in the race. */
export function unlockVoice(): void {
  try {
    const s = synth();
    if (!s) return;
    pickVoice(s);
    if (typeof s.addEventListener === 'function' && !picked) s.addEventListener('voiceschanged', () => pickVoice(s), { once: true });
  } catch { /* ignore */ }
}

/**
 * Say a short phrase. A new phrase replaces one that is still being spoken, so
 * callouts never queue up and fall behind the race.
 */
export function say(text: string, opts?: { rate?: number; pitch?: number }): void {
  try {
    const s = synth();
    if (!s || !enabled || muted || !text) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = Date.now();
    if (text === lastText && now - lastAt < 2500) return;
    lastText = text;
    lastAt = now;
    pickVoice(s);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-US';
    u.rate = opts?.rate ?? 1.08;
    u.pitch = opts?.pitch ?? 1.25;
    u.volume = 0.9;
    s.cancel();
    s.speak(u);
  } catch { /* ignore */ }
}
