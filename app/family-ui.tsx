'use client';

import { useState, type ReactNode } from 'react';
import {
  totals, levelOf, levelName, badgesOf, boardRows, trackRecords, isLocal, activeLocal,
  type Store, type Rec, type Counters, type Gain,
} from './players';

/* Screens for saved racers: the "who's racing?" row, the add-racer sheet,
   a racer's own stats page and the family leaderboard. */

export type Kit = {
  karts: { name: string; emoji: string }[];
  tracks: { name: string; emoji: string }[];
  colors: (kartIdx: number, paint: number) => { color: string; dark: string };
  face: (kartIdx: number, size: number) => ReactNode;
  fmtTime: (ms: number) => string;
};
export type FamilyPanel = null | { kind: 'add' } | { kind: 'stats'; pid: string } | { kind: 'board' };

const kIdx = (kit: Kit, rec: Rec) => Math.min(Math.max(0, rec.k[0]), kit.karts.length - 1);
const shown = (name: string) => name.trim() || 'Racer';
const grad = (kit: Kit, rec: Rec) => {
  const c = kit.colors(kIdx(kit, rec), rec.k[1]);
  return `linear-gradient(145deg, ${c.color}, ${c.dark})`;
};

/** One big button per racer saved on this device. Tap to switch, no typing. */
export function WhoRow({ store, kit, onPick, onAdd }: { store: Store; kit: Kit; onPick: (pid: string) => void; onAdd: () => void }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-2">
      {store.locals.map((l) => {
        const rec = store.board[l.pid];
        if (!rec) return null;
        const on = l.pid === store.active;
        const lv = levelOf(totals(rec).st);
        return (
          <button
            key={l.pid}
            type="button"
            onClick={() => onPick(l.pid)}
            aria-pressed={on}
            aria-label={`Race as ${shown(rec.n)}`}
            className={`flex w-24 shrink-0 flex-col items-center rounded-2xl px-2 py-2 text-white transition active:scale-95 sm:w-28 ${on ? 'shadow-xl ring-4 ring-white' : 'opacity-75 ring-2 ring-white/25 hover:opacity-100'}`}
            style={{ background: grad(kit, rec) }}
          >
            {kit.face(kIdx(kit, rec), 52)}
            <span className="mt-1 max-w-full truncate text-sm font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{shown(rec.n)}</span>
            <span className="rounded-full bg-black/30 px-2 text-[11px] font-black">{lv.icon} Lv {lv.lvl}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="flex w-24 shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/60 bg-white/10 px-2 py-2 text-white transition active:scale-95 sm:w-28"
      >
        <span className="text-4xl leading-none">➕</span>
        <span className="mt-1 text-sm font-black">Add racer</span>
      </button>
    </div>
  );
}

/** The line on the results screen that says what the racer earned. */
export function GainStrip({ gain }: { gain: Gain }) {
  const chips: string[] = [];
  if (gain.levelUp) chips.push(`🎉 Level ${gain.levelUp}: ${levelName(gain.levelUp)}`);
  if (gain.bestTime) chips.push('⏱️ New best time!');
  if (gain.bestLap) chips.push('⚡ New best lap!');
  for (const b of gain.badges) chips.push(`${b.icon} New badge: ${b.name}`);
  return (
    <div className="rounded-2xl bg-gradient-to-r from-yellow-300 to-amber-400 px-4 py-3 text-center text-slate-900 shadow-xl" style={{ animation: 'bk-pop 0.45s 1.2s both' }}>
      <div className="text-xl font-black">⭐ +{gain.stars} stars for {shown(gain.name)}</div>
      {chips.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-slate-900/85 px-3 py-1 text-sm font-black text-yellow-200">{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-b from-indigo-950/95 via-purple-950/95 to-slate-950/95 px-4 py-5 backdrop-blur" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-10 pt-[max(0rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl bg-white/15 px-4 py-3 text-lg font-black text-white ring-1 ring-white/30 active:scale-95">
            ← Back
          </button>
          <h2 className="min-w-0 flex-1 truncate text-2xl font-black text-white sm:text-3xl">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddSheet({ store, kit, onClose, onCreate, onAdopt }: {
  store: Store; kit: Kit; onClose: () => void; onCreate: (name: string) => void; onAdopt: (pid: string) => void;
}) {
  const [name, setName] = useState('');
  const others = boardRows(store).filter((r) => !r.local).sort((a, b) => b.t.st - a.t.st);
  return (
    <Sheet title="➕ Add a racer" onClose={onClose}>
      <form
        className="flex flex-col gap-3 rounded-3xl bg-white/10 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim());
        }}
      >
        <label className="text-lg font-black text-white" htmlFor="bk-new-name">What&apos;s your name?</label>
        <input
          id="bk-new-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 14))}
          placeholder="Your name"
          maxLength={14}
          className="w-full rounded-2xl border-0 bg-white/90 px-5 py-4 text-xl font-black text-slate-900 shadow-inner outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-yellow-300"
        />
        <button type="submit" className="rounded-2xl bg-gradient-to-b from-lime-300 to-green-500 px-4 py-4 text-xl font-black text-slate-900 shadow-lg active:scale-95">
          ✅ Save my racer
        </button>
        <p className="text-sm font-bold text-white/75">You only type your name once. Next time, just tap your picture.</p>
      </form>
      {others.length > 0 && (
        <div className="rounded-3xl bg-white/10 p-4">
          <h3 className="text-lg font-black text-white">Already play on another device?</h3>
          <p className="mb-3 text-sm font-bold text-white/75">Tap your name to bring your stars and badges here.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {others.map(({ rec, t }) => (
              <button
                key={rec.p}
                type="button"
                onClick={() => onAdopt(rec.p)}
                className="flex items-center gap-3 rounded-2xl px-3 py-2 text-left text-white ring-2 ring-white/25 active:scale-95"
                style={{ background: grad(kit, rec) }}
              >
                {kit.face(kIdx(kit, rec), 44)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-black drop-shadow">{shown(rec.n)}</span>
                  <span className="block text-xs font-black opacity-90">⭐ {t.st} · 🏁 {t.r} races</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Tile({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-white/10 px-2 py-3 text-white">
      <span className="text-2xl leading-none">{icon}</span>
      <span className="mt-1 text-2xl font-black tabular-nums">{value}</span>
      <span className="text-center text-[11px] font-bold uppercase tracking-wide text-white/70">{label}</span>
    </div>
  );
}

function StatsSheet({ store, kit, pid, onClose, onRemove, onBoard }: {
  store: Store; kit: Kit; pid: string; onClose: () => void; onRemove: (pid: string) => void; onBoard: () => void;
}) {
  const [sure, setSure] = useState(false);
  const rec = store.board[pid];
  if (!rec) return <Sheet title="Stats" onClose={onClose}><p className="font-bold text-white">This racer is not here any more.</p></Sheet>;
  const t: Counters = totals(rec);
  const lv = levelOf(t.st);
  const local = store.locals.find((l) => l.pid === pid);
  const badges = badgesOf(t, kit.tracks.length);
  const gotCount = badges.filter((b) => b.got).length;
  const awards = Object.entries(t.aw).sort((a, b) => b[1] - a[1]);
  const times = kit.tracks
    .map((tr, i) => ({ tr, i, lap: rec.l[String(i)], race: rec.b[`${i}:3`] ?? rec.b[`${i}:2`], laps: rec.b[`${i}:3`] !== undefined ? 3 : 2, n: t.tr[String(i)] ?? 0 }))
    .filter((x) => x.n > 0 || x.lap !== undefined || x.race !== undefined);
  return (
    <Sheet title={`📊 ${shown(rec.n)}`} onClose={onClose}>
      <div className="flex items-center gap-4 rounded-3xl p-4 text-white shadow-xl" style={{ background: grad(kit, rec) }}>
        {kit.face(kIdx(kit, rec), 84)}
        <div className="min-w-0 flex-1">
          <div className="truncate text-3xl font-black drop-shadow">{shown(rec.n)}</div>
          <div className="text-lg font-black drop-shadow">{lv.icon} Level {lv.lvl} · {lv.title}</div>
          <div className="mt-2 h-4 overflow-hidden rounded-full bg-black/35">
            <div className="h-full rounded-full bg-gradient-to-r from-yellow-200 to-amber-400" style={{ width: `${Math.round((lv.into / Math.max(1, lv.span)) * 100)}%` }} />
          </div>
          <div className="mt-1 text-sm font-black drop-shadow">⭐ {t.st} stars · {lv.span - lv.into} more to level {lv.lvl + 1}</div>
        </div>
      </div>

      {t.r === 0 ? (
        <p className="rounded-3xl bg-white/10 p-5 text-center text-lg font-black text-white">No races yet. Finish a race to start earning stars and badges!</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Tile icon="🏁" value={t.r} label="Races" />
            <Tile icon="🥇" value={t.w} label="Wins" />
            <Tile icon="🥉" value={t.p} label="Top 3" />
            <Tile icon="👨‍👩‍👧‍👦" value={t.fw} label="Family wins" />
            <Tile icon="🏆" value={t.cu} label="Cups" />
            <Tile icon="📍" value={(t.pl / t.r).toFixed(1)} label="Usual place" />
            <Tile icon="🪙" value={t.co} label="Coins" />
            <Tile icon="🔥" value={t.dr} label="Drifts" />
            <Tile icon="🦘" value={t.tk} label="Tricks" />
            <Tile icon="🎯" value={t.hi} label="Hits" />
            <Tile icon="🚀" value={t.bo} label="Boosts" />
            <Tile icon="✨" value={t.cl} label="Clean laps" />
          </div>

          {times.length > 0 && (
            <div className="rounded-3xl bg-white/10 p-4 text-white">
              <h3 className="mb-2 text-lg font-black">⏱️ Best times</h3>
              <div className="flex flex-col gap-1">
                {times.map((x) => (
                  <div key={x.i} className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2 font-bold">
                    <span className="text-2xl">{x.tr.emoji}</span>
                    <span className="min-w-0 flex-1 truncate font-black">{x.tr.name}</span>
                    <span className="text-right text-sm tabular-nums">
                      {x.race !== undefined && <span className="block">Race ({x.laps} laps) <b className="text-yellow-300">{kit.fmtTime(x.race)}</b></span>}
                      {x.lap !== undefined && <span className="block">Best lap <b className="text-yellow-300">{kit.fmtTime(x.lap)}</b></span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="rounded-3xl bg-white/10 p-4 text-white">
        <h3 className="mb-2 text-lg font-black">🏅 Badges ({gotCount}/{badges.length})</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {badges.map((b) => (
            <div key={b.id} className={`flex flex-col items-center rounded-2xl px-2 py-3 text-center ${b.got ? 'bg-gradient-to-b from-yellow-300 to-amber-500 text-slate-900 shadow-lg' : 'bg-black/25 text-white/80'}`}>
              <span className={`text-3xl leading-none ${b.got ? '' : 'opacity-40 grayscale'}`}>{b.icon}</span>
              <span className="mt-1 text-sm font-black leading-tight">{b.name}</span>
              <span className="text-[11px] font-bold leading-tight opacity-80">{b.got ? 'Got it!' : b.hint}</span>
              {!b.got && (
                <span className="mt-1 w-full">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-white/20">
                    <span className="block h-full rounded-full bg-yellow-300" style={{ width: `${Math.round((b.cur / b.goal) * 100)}%` }} />
                  </span>
                  <span className="text-[10px] font-black tabular-nums">{b.cur}/{b.goal}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {awards.length > 0 && (
        <div className="rounded-3xl bg-white/10 p-4 text-white">
          <h3 className="mb-2 text-lg font-black">🎖️ Race awards</h3>
          <div className="flex flex-wrap gap-2">
            {awards.map(([a, n]) => (
              <span key={a} className="rounded-full bg-black/25 px-3 py-1.5 text-sm font-black">{a} <span className="text-yellow-300">×{n}</span></span>
            ))}
          </div>
        </div>
      )}

      {local && local.recent.length > 0 && (
        <div className="rounded-3xl bg-white/10 p-4 text-white">
          <h3 className="mb-2 text-lg font-black">🕘 Last races on this device</h3>
          <div className="flex flex-col gap-1">
            {local.recent.map((r) => {
              const tr = kit.tracks[r.tr];
              return (
                <div key={r.t} className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-1.5 text-sm font-bold">
                  <span className="w-12 font-black">{['🥇', '🥈', '🥉'][r.pl - 1] ?? ''} {r.pl}/{r.of}</span>
                  <span className="text-lg">{tr?.emoji ?? '🏁'}</span>
                  <span className="min-w-0 flex-1 truncate">{tr?.name ?? 'Race'} · {r.fam ? 'Family race' : 'Practice'}</span>
                  <span className="tabular-nums text-white/80">{r.ms > 0 ? kit.fmtTime(r.ms) : ''}</span>
                  <span className="font-black tabular-nums text-yellow-300">+{r.st}⭐</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button type="button" onClick={onBoard} className="rounded-2xl bg-gradient-to-b from-yellow-200 to-orange-400 px-4 py-4 text-xl font-black text-slate-900 shadow-lg active:scale-95">
        🏆 Family leaderboard
      </button>

      {local && (
        <button
          type="button"
          onClick={() => (sure ? onRemove(pid) : setSure(true))}
          onBlur={() => setSure(false)}
          className={`self-center rounded-full px-4 py-2 text-sm font-black ring-1 active:scale-95 ${sure ? 'bg-red-600 text-white ring-red-300' : 'bg-white/10 text-white/70 ring-white/25'}`}
        >
          {sure ? `Tap again to remove ${shown(rec.n)} from this device` : '🗑️ Remove this racer from this device'}
        </button>
      )}
    </Sheet>
  );
}

const METRICS: { id: string; icon: string; label: string; unit: string; get: (t: Counters) => number }[] = [
  { id: 'st', icon: '⭐', label: 'Stars', unit: 'stars', get: (t) => t.st },
  { id: 'fw', icon: '👑', label: 'Family wins', unit: 'wins', get: (t) => t.fw },
  { id: 'w', icon: '🥇', label: 'All wins', unit: 'wins', get: (t) => t.w },
  { id: 'r', icon: '🏁', label: 'Races', unit: 'races', get: (t) => t.r },
  { id: 'co', icon: '🪙', label: 'Coins', unit: 'coins', get: (t) => t.co },
];

function BoardSheet({ store, kit, onClose, onStats }: { store: Store; kit: Kit; onClose: () => void; onStats: (pid: string) => void }) {
  const [metric, setMetric] = useState('st');
  const m = METRICS.find((x) => x.id === metric) ?? METRICS[0];
  const rows = boardRows(store).sort((a, b) => m.get(b.t) - m.get(a.t) || b.t.st - a.t.st || a.rec.c - b.rec.c);
  const records = trackRecords(store, kit.tracks.length).filter((r) => r.lap || r.race);
  const me = activeLocal(store).pid;
  return (
    <Sheet title="🏆 Family leaderboard" onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        {METRICS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setMetric(x.id)}
            aria-pressed={x.id === m.id}
            className={`rounded-full px-4 py-2 text-sm font-black transition active:scale-95 ${x.id === m.id ? 'bg-yellow-300 text-slate-900' : 'bg-white/10 text-white ring-1 ring-white/25'}`}
          >
            {x.icon} {x.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-3xl bg-white/10 p-5 text-center text-lg font-black text-white">Nobody has finished a race yet. Be the first!</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map(({ rec, t }, i) => {
            const lv = levelOf(t.st);
            return (
              <li key={rec.p}>
                <button
                  type="button"
                  onClick={() => onStats(rec.p)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-white shadow transition active:scale-[0.98] ${rec.p === me ? 'ring-4 ring-yellow-300' : 'ring-1 ring-white/20'}`}
                  style={{ background: grad(kit, rec) }}
                >
                  <span className="w-9 text-center text-2xl font-black drop-shadow">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
                  {kit.face(kIdx(kit, rec), 48)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xl font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                      {shown(rec.n)} {isLocal(store, rec.p) && rec.p === me && <span className="text-sm opacity-90">(you)</span>}
                    </span>
                    <span className="block text-xs font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{lv.icon} Lv {lv.lvl} {lv.title} · 🏁 {t.r} · 🥇 {t.w}</span>
                  </span>
                  <span className="rounded-2xl bg-black/35 px-3 py-1 text-right">
                    <span className="block text-2xl font-black tabular-nums leading-tight">{m.get(t)}</span>
                    <span className="block text-[10px] font-black uppercase tracking-wide opacity-80">{m.icon} {m.unit}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {records.length > 0 && (
        <div className="rounded-3xl bg-white/10 p-4 text-white">
          <h3 className="mb-2 text-lg font-black">⏱️ Track records</h3>
          <div className="flex flex-col gap-1">
            {records.map((r) => {
              const tr = kit.tracks[r.track];
              return (
                <div key={r.track} className="flex items-center gap-2 rounded-xl bg-black/20 px-3 py-2 font-bold">
                  <span className="text-2xl">{tr.emoji}</span>
                  <span className="min-w-0 flex-1 truncate font-black">{tr.name}</span>
                  <span className="text-right text-sm tabular-nums">
                    {r.race && <span className="block">Race ({r.race.laps} laps) <b className="text-yellow-300">{kit.fmtTime(r.race.ms)}</b> {kit.karts[kIdx(kit, r.race.rec)].emoji} {shown(r.race.rec.n)}</span>}
                    {r.lap && <span className="block">Best lap <b className="text-yellow-300">{kit.fmtTime(r.lap.ms)}</b> {kit.karts[kIdx(kit, r.lap.rec)].emoji} {shown(r.lap.rec.n)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-center text-sm font-bold text-white/70">
        Scores are saved on each device. They hop between devices by themselves every time you race together in a room.
      </p>
    </Sheet>
  );
}

/** Whichever family sheet is open, drawn over the menu or the lobby. */
export function FamilySheets({ panel, store, kit, setPanel, onCreate, onAdopt, onRemove }: {
  panel: FamilyPanel;
  store: Store | null;
  kit: Kit;
  setPanel: (p: FamilyPanel) => void;
  onCreate: (name: string) => void;
  onAdopt: (pid: string) => void;
  onRemove: (pid: string) => void;
}) {
  if (!panel || !store) return null;
  const close = () => setPanel(null);
  if (panel.kind === 'add') return <AddSheet store={store} kit={kit} onClose={close} onCreate={onCreate} onAdopt={onAdopt} />;
  if (panel.kind === 'stats') {
    return <StatsSheet key={panel.pid} store={store} kit={kit} pid={panel.pid} onClose={close} onRemove={onRemove} onBoard={() => setPanel({ kind: 'board' })} />;
  }
  return <BoardSheet store={store} kit={kit} onClose={close} onStats={(pid) => setPanel({ kind: 'stats', pid })} />;
}
