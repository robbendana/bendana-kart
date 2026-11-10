// The trophy shelf: what this device's player has won so far. Saved in the
// browser only (localStorage), so nothing is sent anywhere.

export type Trophies = {
  races: number;
  wins: number;
  podiums: number;
  cups: Record<string, number>; // cup index -> times won
  awards: Record<string, number>; // award title -> times earned
  best: Record<string, number>; // "track|laps" -> best finish time in ms
};

const KEY = 'bendana-kart-trophies';

export const emptyTrophies = (): Trophies => ({ races: 0, wins: 0, podiums: 0, cups: {}, awards: {}, best: {} });

const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === 'number' && isFinite(n) && n > 0 && k.length < 60) out[k] = n;
    }
  }
  return out;
};

export function loadTrophies(): Trophies {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || 'null') as Partial<Trophies> | null;
    if (!v || typeof v !== 'object') return emptyTrophies();
    const n = (x: unknown) => (typeof x === 'number' && isFinite(x) && x > 0 ? Math.floor(x) : 0);
    return { races: n(v.races), wins: n(v.wins), podiums: n(v.podiums), cups: numMap(v.cups), awards: numMap(v.awards), best: numMap(v.best) };
  } catch {
    return emptyTrophies();
  }
}

function save(t: Trophies) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage blocked: trophies last until the page closes */
  }
}

export type RaceResult = {
  place: number; // 1 = winner
  racers: number;
  award: string; // the award title this player got
  track: number;
  laps: number;
  timeMs: number; // 0 if the player did not finish
  cupWon: number; // cup index if this race won a cup, else -1
};

export type TrophyNews = { newAward: boolean; newBest: boolean; firstWin: boolean; cupWon: boolean };

/** Add one finished race to the shelf and say what is new. */
export function recordRace(r: RaceResult): { trophies: Trophies; news: TrophyNews } {
  const t = loadTrophies();
  const news: TrophyNews = { newAward: false, newBest: false, firstWin: false, cupWon: false };
  t.races += 1;
  if (r.place === 1 && r.racers > 1) {
    news.firstWin = t.wins === 0;
    t.wins += 1;
  }
  if (r.place <= 3 && r.racers > 1) t.podiums += 1;
  if (r.award) {
    news.newAward = !t.awards[r.award];
    t.awards[r.award] = (t.awards[r.award] ?? 0) + 1;
  }
  if (r.timeMs > 0) {
    const k = `${r.track}|${r.laps}`;
    const prev = t.best[k];
    if (!prev || r.timeMs < prev) {
      news.newBest = !!prev; // the very first time on a track is not a "new record"
      t.best[k] = Math.round(r.timeMs);
    }
  }
  if (r.cupWon >= 0) {
    news.cupWon = true;
    t.cups[String(r.cupWon)] = (t.cups[String(r.cupWon)] ?? 0) + 1;
  }
  save(t);
  return { trophies: t, news };
}
