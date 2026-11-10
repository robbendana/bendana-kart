/* =========================================================================
   Saved racers, their stats and the family leaderboard.

   Everything lives in this device's localStorage. Nothing is written to any
   database. The leaderboard travels between devices as a small 'lb' message
   on the race room's Realtime channel whenever devices meet in a room.

   The board is built so that merging is always safe, in any order and any
   number of times:
     - every racer has counters per device, and a device only ever raises its
       own counters, so the merge of two copies is the larger number;
     - best times merge by taking the smaller time;
     - name and kart look merge by the latest change.
   A racer's totals are the sum over all devices they have played on.
   ========================================================================= */

export type Counters = {
  r: number; // races
  w: number; // wins
  p: number; // podiums (top 3)
  fr: number; // family races (2 or more people)
  fw: number; // family race wins
  pl: number; // sum of finishing places, for the average
  co: number; // coins
  dr: number; // drifts
  hi: number; // hits landed
  ba: number; // bananas dropped
  tk: number; // tricks
  bo: number; // boosts
  cl: number; // clean laps
  st: number; // stars earned
  cu: number; // cups won
  ms: number; // time spent racing
  aw: Record<string, number>; // awards, by "icon title"
  tr: Record<string, number>; // races per track
};

export type Rec = {
  p: string; // racer id, the same on every device
  n: string; // name
  k: [number, number, number]; // racer, paint, kart body
  u: number; // when the name or look last changed
  c: number; // when this racer was created
  d: Record<string, Counters>; // counters per device
  b: Record<string, number>; // best race time, by "track:laps"
  l: Record<string, number>; // best lap, by track
};

export type Prefs = { kartIdx: number; paint: number; body: number; toddler: boolean; assist: number; cam: string };
export type RecentRace = { t: number; tr: number; pl: number; of: number; ms: number; fam: boolean; st: number };
export type LocalPlayer = { pid: string; prefs: Prefs; recent: RecentRace[] };
export type Store = { v: 1; dev: string; active: string; locals: LocalPlayer[]; board: Record<string, Rec> };

export type RaceResult = {
  track: number;
  laps: number;
  place: number;
  total: number;
  family: boolean; // raced against at least one other person
  timeMs: number; // 0 when the race closed before the finish
  lapsMs: number[];
  stats: { drifts: number; coins: number; hits: number; bananas: number; boost: number; tricks: number };
  cleanLaps: number;
  award: string | null;
  cupWon: boolean;
};

export type Badge = { id: string; icon: string; name: string; hint: string; got: boolean; cur: number; goal: number };
export type Gain = { name: string; stars: number; levelUp: number; badges: Badge[]; bestTime: boolean; bestLap: boolean };

const BASE_KEY = 'bendana-kart-family';
const MAX_BOARD = 40;
const MAX_DEVICES = 12;
const MAX_KEYS = 40;
const ID_RE = /^[a-z0-9]{6,16}$/;

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const fin = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const count = (v: unknown) => Math.min(1e8, Math.max(0, Math.floor(fin(v))));

/** `?store=name` gives a tab its own save data, so one browser can act as several devices in tests. */
function storeKey(): string {
  try {
    const s = new URLSearchParams(window.location.search).get('store');
    if (s && /^[a-z0-9]{1,12}$/i.test(s)) return `${BASE_KEY}:${s}`;
  } catch {
    /* ignore */
  }
  return BASE_KEY;
}

export const newCounters = (): Counters => ({
  r: 0, w: 0, p: 0, fr: 0, fw: 0, pl: 0, co: 0, dr: 0, hi: 0, ba: 0, tk: 0, bo: 0, cl: 0, st: 0, cu: 0, ms: 0, aw: {}, tr: {},
});
const NUM_KEYS = ['r', 'w', 'p', 'fr', 'fw', 'pl', 'co', 'dr', 'hi', 'ba', 'tk', 'bo', 'cl', 'st', 'cu', 'ms'] as const;

const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 14);

function cleanMap(v: unknown, keyOk: (k: string) => boolean, val: (x: unknown) => number | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_KEYS) break;
    if (!keyOk(k)) continue;
    const y = val(x);
    if (y === null) continue;
    out[k] = y;
    n++;
  }
  return out;
}

function cleanCounters(v: unknown): Counters {
  const c = newCounters();
  if (!v || typeof v !== 'object') return c;
  const o = v as Record<string, unknown>;
  for (const k of NUM_KEYS) c[k] = count(o[k]);
  const posInt = (x: unknown) => (count(x) > 0 ? count(x) : null);
  c.aw = cleanMap(o.aw, (k) => k.length > 0 && k.length <= 32, posInt);
  c.tr = cleanMap(o.tr, (k) => /^\d{1,2}$/.test(k), posInt);
  return c;
}

const timeVal = (x: unknown) => {
  const t = Math.round(fin(x));
  return t >= 3000 && t <= 3600000 ? t : null;
};

/** Checks a record from storage or from another device. Returns null if it is not usable. */
function cleanRec(v: unknown): Rec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.p !== 'string' || !ID_RE.test(o.p)) return null;
  const k = Array.isArray(o.k) ? o.k : [];
  const now = Date.now();
  const d: Record<string, Counters> = {};
  if (o.d && typeof o.d === 'object') {
    let n = 0;
    for (const [dev, c] of Object.entries(o.d as Record<string, unknown>)) {
      if (n >= MAX_DEVICES) break;
      if (!ID_RE.test(dev)) continue;
      d[dev] = cleanCounters(c);
      n++;
    }
  }
  return {
    p: o.p,
    n: cleanName(o.n),
    k: [Math.max(0, Math.floor(fin(k[0]))), Math.max(-1, Math.floor(fin(k[1], -1))), Math.max(0, Math.floor(fin(k[2])))],
    u: Math.min(now + 86400000, Math.max(0, fin(o.u))),
    c: Math.min(now + 86400000, Math.max(0, fin(o.c, now))),
    d,
    b: cleanMap(o.b, (x) => /^\d{1,2}:\d$/.test(x), timeVal),
    l: cleanMap(o.l, (x) => /^\d{1,2}$/.test(x), timeVal),
  };
}

function mergeCounters(a: Counters, b: Counters): Counters {
  const c = newCounters();
  for (const k of NUM_KEYS) c[k] = Math.max(a[k], b[k]);
  for (const key of ['aw', 'tr'] as const) {
    const m: Record<string, number> = { ...a[key] };
    for (const [k, v] of Object.entries(b[key])) m[k] = Math.max(m[k] ?? 0, v);
    c[key] = m;
  }
  return c;
}

function sameCounters(a: Counters, b: Counters): boolean {
  for (const k of NUM_KEYS) if (a[k] !== b[k]) return false;
  for (const key of ['aw', 'tr'] as const) {
    const ka = Object.keys(a[key]);
    if (ka.length !== Object.keys(b[key]).length) return false;
    for (const k of ka) if (a[key][k] !== b[key][k]) return false;
  }
  return true;
}

/** Merges two copies of one racer. Returns `a` itself when `b` adds nothing. */
function mergeRec(a: Rec, b: Rec): Rec {
  let changed = false;
  const newer = b.u > a.u;
  if (newer && (b.n !== a.n || b.k.some((x, i) => x !== a.k[i]))) changed = true;
  const d: Record<string, Counters> = { ...a.d };
  for (const [dev, c] of Object.entries(b.d)) {
    if (!d[dev]) {
      if (Object.keys(d).length >= MAX_DEVICES) continue;
      d[dev] = c;
      changed = true;
    } else {
      const m = mergeCounters(d[dev], c);
      if (!sameCounters(m, d[dev])) {
        d[dev] = m;
        changed = true;
      }
    }
  }
  const mins = (x: Record<string, number>, y: Record<string, number>) => {
    const m = { ...x };
    for (const [k, v] of Object.entries(y)) {
      if (m[k] === undefined || v < m[k]) {
        m[k] = v;
        changed = true;
      }
    }
    return m;
  };
  const best = mins(a.b, b.b);
  const lap = mins(a.l, b.l);
  if (b.c < a.c) changed = true;
  if (!changed) return newer ? { ...a, u: b.u } : a;
  return { p: a.p, n: newer ? b.n : a.n, k: newer ? b.k : a.k, u: Math.max(a.u, b.u), c: Math.min(a.c, b.c), d, b: best, l: lap };
}

/** A racer's totals across every device they have played on. */
export function totals(rec: Rec | undefined | null): Counters {
  const t = newCounters();
  if (!rec) return t;
  for (const c of Object.values(rec.d)) {
    for (const k of NUM_KEYS) t[k] += c[k];
    for (const key of ['aw', 'tr'] as const) for (const [k, v] of Object.entries(c[key])) t[key][k] = (t[key][k] ?? 0) + v;
  }
  return t;
}

// ---------- Levels and badges ----------
const LEVELS: [string, string][] = [
  ['🐣', 'Rookie'], ['🚲', 'Learner'], ['🏎️', 'Racer'], ['⚡', 'Speedster'], ['🔥', 'Drifter'], ['🎯', 'Pro'],
  ['🦅', 'Ace'], ['🌟', 'Star'], ['🏆', 'Champion'], ['🦸', 'Hero'], ['👑', 'Master'], ['🐉', 'Legend'],
];
/** Stars needed to reach a level: 0, 30, 90, 180, 300, ... */
const starsFor = (lvl: number) => (30 * lvl * (lvl - 1)) / 2;

export function levelOf(stars: number): { lvl: number; icon: string; title: string; into: number; span: number } {
  let lvl = 1;
  while (starsFor(lvl + 1) <= stars && lvl < 99) lvl++;
  const [icon, base] = LEVELS[Math.min(lvl, LEVELS.length) - 1];
  const title = lvl > LEVELS.length ? `${base} ${lvl - LEVELS.length + 1}` : base;
  return { lvl, icon, title, into: stars - starsFor(lvl), span: starsFor(lvl + 1) - starsFor(lvl) };
}

export const levelName = (lvl: number) => levelOf(starsFor(lvl)).title;

export function badgesOf(t: Counters, trackCount: number): Badge[] {
  const defs: [string, string, string, string, number, number][] = [
    ['first', '🏁', 'First Race', 'Finish a race', t.r, 1],
    ['win', '🥇', 'First Win', 'Win a race', t.w, 1],
    ['family', '👨‍👩‍👧‍👦', 'Family Racer', 'Race with your family', t.fr, 1],
    ['champ', '👑', 'Family Champ', 'Win 5 family races', t.fw, 5],
    ['ten', '🔟', 'Regular', 'Finish 10 races', t.r, 10],
    ['fifty', '🎖️', 'Veteran', 'Finish 50 races', t.r, 50],
    ['podium', '🥉', 'Podium Pro', 'Finish in the top 3, 20 times', t.p, 20],
    ['coins', '🪙', 'Coin Collector', 'Collect 100 coins', t.co, 100],
    ['rich', '💰', 'Treasure Hunter', 'Collect 500 coins', t.co, 500],
    ['drift', '🔥', 'Drift King', 'Drift 50 times', t.dr, 50],
    ['shot', '🎯', 'Sharp Shooter', 'Hit 20 karts', t.hi, 20],
    ['trick', '🦘', 'Trick Star', 'Do 25 tricks', t.tk, 25],
    ['boost', '🚀', 'Rocket Fan', 'Boost 100 times', t.bo, 100],
    ['clean', '✨', 'Clean Driver', 'Drive 10 clean laps', t.cl, 10],
    ['explore', '🗺️', 'Explorer', 'Race on every track', Object.keys(t.tr).length, Math.max(1, trackCount)],
    ['cup', '🏆', 'Cup Winner', 'Win a cup', t.cu, 1],
  ];
  return defs.map(([id, icon, name, hint, cur, goal]) => ({ id, icon, name, hint, got: cur >= goal, cur: Math.min(cur, goal), goal }));
}

// ---------- Loading and saving ----------
function defaultPrefs(kartIdx = 0): Prefs {
  return { kartIdx, paint: -1, body: 0, toddler: false, assist: 2, cam: 'chase' };
}

function cleanPrefs(v: unknown): Prefs {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    kartIdx: Math.max(0, Math.floor(fin(o.kartIdx))),
    paint: Math.max(-1, Math.floor(fin(o.paint, -1))),
    body: Math.max(0, Math.floor(fin(o.body))),
    toddler: !!o.toddler,
    assist: Math.min(2, Math.max(0, Math.floor(fin(o.assist, 2)))),
    cam: typeof o.cam === 'string' ? o.cam.slice(0, 12) : 'chase',
  };
}

function newRec(pid: string, name: string, prefs: Prefs): Rec {
  const now = Date.now();
  return { p: pid, n: cleanName(name), k: [prefs.kartIdx, prefs.paint, prefs.body], u: now, c: now, d: {}, b: {}, l: {} };
}

function parseStore(raw: string | null): Store | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.dev !== 'string' || !ID_RE.test(o.dev)) return null;
    const board: Record<string, Rec> = {};
    for (const v of Object.values((o.board ?? {}) as Record<string, unknown>)) {
      const r = cleanRec(v);
      if (r) board[r.p] = r;
    }
    const locals: LocalPlayer[] = [];
    for (const v of Array.isArray(o.locals) ? o.locals : []) {
      const l = v as Record<string, unknown>;
      if (!l || typeof l.pid !== 'string' || !board[l.pid] || locals.some((x) => x.pid === l.pid)) continue;
      const recent = (Array.isArray(l.recent) ? l.recent : []).slice(0, 12).map((x) => {
        const q = (x ?? {}) as Record<string, unknown>;
        return { t: fin(q.t), tr: count(q.tr), pl: count(q.pl), of: count(q.of), ms: count(q.ms), fam: !!q.fam, st: count(q.st) };
      });
      locals.push({ pid: l.pid, prefs: cleanPrefs(l.prefs), recent });
    }
    if (!locals.length) return null;
    const active = typeof o.active === 'string' && locals.some((l) => l.pid === o.active) ? o.active : locals[0].pid;
    return { v: 1, dev: o.dev, active, locals, board };
  } catch {
    return null;
  }
}

/**
 * Reads the saved racers. The first time, it makes one racer from the name and
 * kart the game used to remember, so nobody starts over.
 */
export function loadStore(legacyName: string, legacyPrefs: Partial<Prefs>): Store {
  let saved: Store | null = null;
  try {
    saved = parseStore(window.localStorage.getItem(storeKey()));
  } catch {
    /* storage unavailable */
  }
  if (saved) return saved;
  const pid = rid();
  const prefs = cleanPrefs(legacyPrefs);
  const store: Store = { v: 1, dev: rid(), active: pid, locals: [{ pid, prefs, recent: [] }], board: { [pid]: newRec(pid, legacyName, prefs) } };
  try {
    // The driving-help score used to be one per device: the first racer keeps it
    const sk = window.localStorage.getItem('bendana-kart-skill');
    if (sk) window.localStorage.setItem(`bendana-kart-skill:${pid}`, sk);
  } catch {
    /* ignore */
  }
  saveStore(store);
  return store;
}

/** Writes the store. Anything another tab saved in the meantime is merged in, never lost. */
export function saveStore(store: Store): void {
  try {
    const other = parseStore(window.localStorage.getItem(storeKey()));
    let out = store;
    // (a racer removed here before their first race stays removed)
    if (other) out = mergeBoard(store, Object.values(other.board).filter((r) => store.board[r.p] || totals(r).r > 0)).store;
    window.localStorage.setItem(storeKey(), JSON.stringify(out));
  } catch {
    /* storage unavailable: the game still works, it just forgets */
  }
}

// ---------- Changing racers ----------
export const activeLocal = (s: Store): LocalPlayer => s.locals.find((l) => l.pid === s.active) ?? s.locals[0];
export const recOf = (s: Store, pid: string): Rec | undefined => s.board[pid];
export const isLocal = (s: Store, pid: string) => s.locals.some((l) => l.pid === pid);

/** Keeps the active racer's name and kart in step with what is on screen. Returns the same store if nothing changed. */
export function syncActive(s: Store, name: string, prefs: Prefs): Store {
  const loc = activeLocal(s);
  const rec = s.board[loc.pid];
  if (!rec) return s;
  const n = cleanName(name);
  const k: [number, number, number] = [prefs.kartIdx, prefs.paint, prefs.body];
  const lookSame = rec.n === n && rec.k.every((x, i) => x === k[i]);
  const p = loc.prefs;
  const prefsSame = p.kartIdx === prefs.kartIdx && p.paint === prefs.paint && p.body === prefs.body && p.toddler === prefs.toddler && p.assist === prefs.assist && p.cam === prefs.cam;
  if (lookSame && prefsSame) return s;
  return {
    ...s,
    locals: s.locals.map((l) => (l.pid === loc.pid ? { ...l, prefs: { ...prefs } } : l)),
    board: lookSame ? s.board : { ...s.board, [rec.p]: { ...rec, n, k, u: Date.now() } },
  };
}

export function setActive(s: Store, pid: string): Store {
  return isLocal(s, pid) ? { ...s, active: pid } : s;
}

/** A brand new racer on this device. `kartCount` lets each new racer start with a different character. */
export function addPlayer(s: Store, name: string, kartCount: number): Store {
  const pid = rid();
  const used = new Set(s.locals.map((l) => l.prefs.kartIdx));
  let kartIdx = 0;
  for (let i = 0; i < kartCount; i++) {
    if (!used.has(i)) {
      kartIdx = i;
      break;
    }
  }
  const prefs = defaultPrefs(kartIdx);
  return { ...s, active: pid, locals: [...s.locals, { pid, prefs, recent: [] }], board: { ...s.board, [pid]: newRec(pid, name, prefs) } };
}

/** Someone who already plays on another device starts playing here too, keeping all their stats. */
export function adoptPlayer(s: Store, pid: string): Store {
  const rec = s.board[pid];
  if (!rec || isLocal(s, pid)) return rec ? setActive(s, pid) : s;
  const prefs = { ...defaultPrefs(rec.k[0]), paint: rec.k[1], body: rec.k[2] };
  return { ...s, active: pid, locals: [...s.locals, { pid, prefs, recent: [] }] };
}

/** Takes a racer off this device. Their record stays on the leaderboard if they have raced. */
export function removeLocal(s: Store, pid: string, kartCount: number): Store {
  if (!isLocal(s, pid)) return s;
  const locals = s.locals.filter((l) => l.pid !== pid);
  const board = { ...s.board };
  if (totals(board[pid]).r === 0) delete board[pid];
  let out: Store = { ...s, locals, board, active: s.active === pid ? locals[0]?.pid ?? '' : s.active };
  if (!locals.length) out = addPlayer(out, '', kartCount);
  return out;
}

// ---------- Recording a race ----------
const FAMILY_STARS = [15, 10, 7, 5, 4];
const PRACTICE_STARS = [8, 5, 3, 2, 1];

/** Adds one finished race to a racer on this device and says what they earned. */
export function applyRace(s: Store, pid: string, res: RaceResult, trackCount: number): { store: Store; gain: Gain } | null {
  const rec = s.board[pid];
  if (!rec || !isLocal(s, pid)) return null;
  const before = totals(rec);
  const mine: Counters = mergeCounters(newCounters(), rec.d[s.dev] ?? newCounters());
  const place = Math.max(1, Math.floor(res.place));
  const finished = res.timeMs > 0;

  const bKey = `${res.track}:${res.laps}`;
  const lKey = String(res.track);
  const b = { ...rec.b };
  const l = { ...rec.l };
  let bestTime = false;
  let bestLap = false;
  const t = Math.round(res.timeMs);
  if (finished && t >= 3000 && t <= 3600000 && (b[bKey] === undefined || t < b[bKey])) {
    bestTime = b[bKey] !== undefined;
    b[bKey] = t;
  }
  const laps = res.lapsMs.map(Math.round).filter((x) => x >= 3000 && x <= 3600000);
  if (laps.length) {
    const lap = Math.min(...laps);
    if (l[lKey] === undefined || lap < l[lKey]) {
      bestLap = l[lKey] !== undefined;
      l[lKey] = lap;
    }
  }

  let stars = finished ? 10 : 5;
  if (finished) stars += (res.family ? FAMILY_STARS : PRACTICE_STARS)[place - 1] ?? 1;
  stars += Math.min(15, Math.max(0, res.stats.coins));
  stars += 2 * Math.max(0, res.cleanLaps);
  if (bestTime) stars += 5;
  if (res.cupWon) stars += 20;

  mine.r++;
  if (place === 1) mine.w++;
  if (place <= 3) mine.p++;
  if (res.family) {
    mine.fr++;
    if (place === 1) mine.fw++;
  }
  mine.pl += place;
  mine.co += count(res.stats.coins);
  mine.dr += count(res.stats.drifts);
  mine.hi += count(res.stats.hits);
  mine.ba += count(res.stats.bananas);
  mine.tk += count(res.stats.tricks);
  mine.bo += count(res.stats.boost);
  mine.cl += count(res.cleanLaps);
  mine.st += stars;
  if (res.cupWon) mine.cu++;
  mine.ms += finished ? t : 0;
  if (res.award) {
    const a = res.award.slice(0, 32);
    if (mine.aw[a] !== undefined || Object.keys(mine.aw).length < MAX_KEYS) mine.aw = { ...mine.aw, [a]: (mine.aw[a] ?? 0) + 1 };
  }
  mine.tr = { ...mine.tr, [lKey]: (mine.tr[lKey] ?? 0) + 1 };

  const next: Rec = { ...rec, d: { ...rec.d, [s.dev]: mine }, b, l };
  const after = totals(next);
  const had = new Set(badgesOf(before, trackCount).filter((x) => x.got).map((x) => x.id));
  const badges = badgesOf(after, trackCount).filter((x) => x.got && !had.has(x.id));
  const lvA = levelOf(before.st).lvl;
  const lvB = levelOf(after.st).lvl;
  const recent: RecentRace = { t: Date.now(), tr: res.track, pl: place, of: res.total, ms: finished ? t : 0, fam: res.family, st: stars };
  const store: Store = {
    ...s,
    board: { ...s.board, [pid]: next },
    locals: s.locals.map((x) => (x.pid === pid ? { ...x, recent: [recent, ...x.recent].slice(0, 12) } : x)),
  };
  return { store, gain: { name: rec.n, stars, levelUp: lvB > lvA ? lvB : 0, badges, bestTime, bestLap } };
}

// ---------- Sharing the board between devices ----------
/** The records to send to the other devices in the room. */
export function wireBoard(s: Store, only?: string): Rec[] {
  const list = Object.values(s.board).filter((r) => totals(r).r > 0 && (!only || r.p === only));
  return list.slice(0, MAX_BOARD);
}

/** Merges records from storage or from another device. Bad data is ignored. */
export function mergeBoard(s: Store, recs: unknown): { store: Store; changed: boolean } {
  if (!Array.isArray(recs)) return { store: s, changed: false };
  let board = s.board;
  let changed = false;
  for (const raw of recs.slice(0, MAX_BOARD)) {
    const r = cleanRec(raw);
    if (!r) continue;
    const cur = board[r.p];
    const next = cur ? mergeRec(cur, r) : r;
    if (next !== cur) {
      if (board === s.board) board = { ...board };
      board[r.p] = next;
      changed = true;
    }
  }
  if (!changed) return { store: s, changed: false };
  // Keep the board small: racers on this device always stay, then the most active
  const all = Object.values(board);
  if (all.length > MAX_BOARD) {
    const keep = all
      .map((r) => ({ r, w: isLocal(s, r.p) ? Infinity : totals(r).r }))
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_BOARD);
    board = {};
    for (const { r } of keep) board[r.p] = r;
  }
  return { store: { ...s, board }, changed: true };
}

// ---------- Leaderboard views ----------
export type BoardRow = { rec: Rec; t: Counters; local: boolean };
export function boardRows(s: Store): BoardRow[] {
  return Object.values(s.board)
    .map((rec) => ({ rec, t: totals(rec), local: isLocal(s, rec.p) }))
    .filter((x) => x.t.r > 0);
}

export type TrackRecord = { track: number; lap: { ms: number; rec: Rec } | null; race: { ms: number; laps: number; rec: Rec } | null };
export function trackRecords(s: Store, trackCount: number): TrackRecord[] {
  const recs = Object.values(s.board);
  const out: TrackRecord[] = [];
  for (let tr = 0; tr < trackCount; tr++) {
    let lap: TrackRecord['lap'] = null;
    let race: TrackRecord['race'] = null;
    for (const rec of recs) {
      const lv = rec.l[String(tr)];
      if (lv !== undefined && (!lap || lv < lap.ms)) lap = { ms: lv, rec };
    }
    for (const laps of [3, 2]) {
      for (const rec of recs) {
        const rv = rec.b[`${tr}:${laps}`];
        if (rv !== undefined && (!race || (race.laps === laps && rv < race.ms))) race = { ms: rv, laps, rec };
      }
      if (race) break;
    }
    out.push({ track: tr, lap, race });
  }
  return out;
}
