// Networking for Bendana Kart v2.
//
// Everything here runs over Supabase Realtime channels (broadcast + presence)
// and never touches a database table. It also has a local simulator that
// links browser tabs with a BroadcastChannel and fake lag, jitter and loss,
// so a 5-player race can be tested on one computer (?net=local).
//
// The pieces:
//  - wall(): one clock for all network timestamps
//  - Room: a transport (Supabase or local) with reconnects, a presence rate
//    limiter and a message budget
//  - HostClock: estimates the host's clock with ping/pong (lowest round trip)
//  - RemoteKart: per-player snapshot buffer, timeline offset, jitter buffer,
//    Hermite interpolation, prediction and smooth corrections
//  - EventLog: one-time events that are also repeated in later messages

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/** Monotonic milliseconds, comparable to other devices' wall() up to an offset. */
export const wall = () => performance.timeOrigin + performance.now();

const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrapA = (a: number) => {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
};

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type NetStatus = 'connecting' | 'joined' | 'reconnecting' | 'error' | 'closed';
export type Meta = Record<string, unknown>;
type Handler = (payload: Record<string, unknown>, recvWall: number) => void;

export type NetStats = { sentPerSec: number; recvPerSec: number; roomPerSec: number };

/** What the game needs from a transport. */
export interface Room {
  readonly playerId: string;
  status: NetStatus;
  start(): void;
  send(event: string, payload: Record<string, unknown>, opts?: { force?: boolean }): boolean;
  canSend(): boolean;
  on(event: string, cb: Handler): void;
  setMeta(meta: Meta, urgent?: boolean): void;
  presence(): Map<string, Meta>;
  onPresence(cb: () => void): void;
  onStatus(cb: (s: NetStatus) => void): void;
  setPlayers(n: number): void;
  stats(): NetStats;
  close(): Promise<void>;
}

// Message budget. Supabase counts each broadcast once when sent and once per
// receiver, and closes the channel if the room averages over 100 a second.
// Each device gets an equal share of a 66/s target.
export const ROOM_BUDGET = 66;
export function sendIntervalFor(players: number): number {
  const n = Math.max(1, players);
  return Math.max(100, Math.ceil((n * n * 1000) / ROOM_BUDGET));
}

class Bucket {
  tokens = 3;
  rate = 1; // sends per second
  last = wall();
  set(players: number) {
    const n = Math.max(1, players);
    // My share is budget/n room-messages; each send costs n of them.
    this.rate = ROOM_BUDGET / (n * n);
  }
  take(force: boolean): boolean {
    const now = wall();
    this.tokens = Math.min(3, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    if (force && this.tokens > -2) {
      // Rare one-off events may borrow a little; the debt is repaid by
      // delaying the next state messages.
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

class Rate {
  private t: number[] = [];
  hit(n = 1) {
    const now = wall();
    for (let i = 0; i < n; i++) this.t.push(now);
  }
  perSec() {
    const cut = wall() - 5000;
    while (this.t.length && this.t[0] < cut) this.t.shift();
    return this.t.length / 5;
  }
}

abstract class BaseRoom implements Room {
  status: NetStatus = 'connecting';
  protected handlers = new Map<string, Handler[]>();
  protected presenceCbs: (() => void)[] = [];
  protected statusCbs: ((s: NetStatus) => void)[] = [];
  protected meta: Meta = {};
  protected metaDirty = false;
  protected trackTimes: number[] = [];
  protected metaBroadcastAt = 0;
  protected metaTimer: ReturnType<typeof setTimeout> | null = null;
  protected bucket = new Bucket();
  protected players = 1;
  protected sentRate = new Rate();
  protected recvRate = new Rate();
  protected closed = false;
  /** Latest lobby meta per player, from presence or from 'meta' broadcasts. */
  protected live = new Map<string, Meta>();
  protected inPresence = new Set<string>();

  constructor(readonly playerId: string) {
    // Instant lobby updates arrive as 'meta' broadcasts; presence confirms.
    this.on('meta', (p) => {
      const id = String(p.id ?? '');
      if (!id || id === this.playerId || !this.inPresence.has(id)) return;
      const m = p.m as Meta | undefined;
      if (!m || typeof m !== 'object') return;
      this.live.set(id, m);
      this.firePresence();
    });
  }

  abstract start(): void;
  abstract close(): Promise<void>;
  protected abstract rawSend(event: string, payload: Record<string, unknown>): boolean;
  protected abstract rawTrack(meta: Meta): void;
  abstract canSend(): boolean;

  on(event: string, cb: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }
  onPresence(cb: () => void) {
    this.presenceCbs.push(cb);
  }
  onStatus(cb: (s: NetStatus) => void) {
    this.statusCbs.push(cb);
  }
  protected setStatus(s: NetStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }
  protected firePresence() {
    for (const cb of this.presenceCbs) cb();
  }
  protected dispatch(event: string, payload: Record<string, unknown>) {
    this.recvRate.hit();
    const list = this.handlers.get(event);
    if (!list) return;
    const t = wall();
    for (const cb of list) {
      try {
        cb(payload, t);
      } catch {
        /* a bad message must never break the game */
      }
    }
  }
  setPlayers(n: number) {
    this.players = Math.max(1, n);
    this.bucket.set(this.players);
  }
  send(event: string, payload: Record<string, unknown>, opts?: { force?: boolean }) {
    if (!this.canSend()) return false;
    if (!this.bucket.take(!!opts?.force)) return false;
    const ok = this.rawSend(event, payload);
    if (ok) this.sentRate.hit();
    return ok;
  }
  presence() {
    const out = new Map<string, Meta>();
    for (const id of this.inPresence) {
      const m = this.live.get(id);
      if (m) out.set(id, m);
    }
    if (!out.has(this.playerId) && this.status === 'joined') out.set(this.playerId, this.meta);
    return out;
  }
  // Presence updates are limited to 5 per client per 30 s on the free plan,
  // so tracks are spaced at least 7 s apart (except right after joining) and
  // changes in between are merged. A 'meta' broadcast gives instant updates.
  setMeta(meta: Meta, urgent = false) {
    this.meta = meta;
    this.live.set(this.playerId, meta);
    this.metaDirty = true;
    this.flushMeta(urgent);
    const now = wall();
    if (this.canSend() && now - this.metaBroadcastAt > 500) {
      this.metaBroadcastAt = now;
      this.rawSend('meta', { id: this.playerId, m: meta });
      this.sentRate.hit();
    }
  }
  protected flushMeta(urgent: boolean) {
    if (!this.metaDirty || this.status !== 'joined' || this.closed) return;
    const now = wall();
    this.trackTimes = this.trackTimes.filter((t) => now - t < 30000);
    const lastT = this.trackTimes[this.trackTimes.length - 1] ?? 0;
    const allowed = this.trackTimes.length < 4 && (urgent ? now - lastT > 1500 : now - lastT > 7000);
    if (allowed) {
      this.metaDirty = false;
      this.trackTimes.push(now);
      this.rawTrack(this.meta);
      return;
    }
    if (this.metaTimer) return;
    const oldest = this.trackTimes[0] ?? now;
    const wait = Math.max(500, this.trackTimes.length >= 4 ? oldest + 30500 - now : lastT + (urgent ? 1600 : 7100) - now);
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      this.flushMeta(urgent);
    }, wait);
  }
  /** Called on every (re)join: presence is not restored by the server. */
  protected retrackNow() {
    this.trackTimes = this.trackTimes.filter((t) => wall() - t < 30000);
    this.metaDirty = false;
    this.trackTimes.push(wall());
    this.rawTrack(this.meta);
  }
  stats(): NetStats {
    const s = this.sentRate.perSec();
    return { sentPerSec: s, recvPerSec: this.recvRate.perSec(), roomPerSec: s * this.players * this.players };
  }
}

// ----- Supabase -----

export class SupabaseRoom extends BaseRoom {
  private ch: RealtimeChannel | null = null;
  private notJoinedSince = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private rebuilding = false;
  private onWake = () => this.check(true);

  constructor(private client: SupabaseClient, private topic: string, playerId: string) {
    super(playerId);
  }

  start() {
    this.build();
    this.watchdog = setInterval(() => this.check(false), 2500);
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
    window.addEventListener('pageshow', this.onWake);
  }

  private build() {
    if (this.closed) return;
    const ch = this.client.channel(this.topic, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.playerId } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as unknown as Record<string, Meta[]>;
      this.inPresence = new Set(Object.keys(state));
      for (const key of Object.keys(state)) {
        const metas = state[key];
        const m = metas[metas.length - 1];
        if (m && key !== this.playerId) this.live.set(key, m);
      }
      this.firePresence();
    });
    ch.on('broadcast', { event: '*' }, (msg: { event?: string; payload?: Record<string, unknown> }) => {
      if (!msg || !msg.event || !msg.payload) return;
      this.dispatch(msg.event, msg.payload);
    });
    ch.subscribe((status) => {
      if (this.ch !== ch) return;
      if (status === 'SUBSCRIBED') {
        this.notJoinedSince = 0;
        this.setStatus('joined');
        this.retrackNow();
        this.dispatch('_joined', {});
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.setStatus(this.status === 'connecting' ? 'error' : 'reconnecting');
      } else if (status === 'CLOSED') {
        if (!this.closed) this.setStatus('reconnecting');
      }
    });
    this.ch = ch;
  }

  // Watchdog: realtime-js rejoins on its own after most drops; if the channel
  // still is not joined after 6 s (or the tab just woke up), rebuild it.
  private check(wake: boolean) {
    if (this.closed || !this.ch || this.rebuilding) return;
    const joined = this.canSend();
    if (joined) {
      this.notJoinedSince = 0;
      if (this.status !== 'joined') this.setStatus('joined');
      return;
    }
    if (document.visibilityState === 'hidden') return;
    if (this.status === 'joined') this.setStatus('reconnecting');
    const now = wall();
    if (!this.notJoinedSince) this.notJoinedSince = now;
    try {
      const rt = this.client.realtime;
      if (!rt.isConnected()) rt.connect();
    } catch {
      /* ignore */
    }
    if (now - this.notJoinedSince > 6000 || (wake && now - this.notJoinedSince > 2000)) void this.rebuild();
  }

  private async rebuild() {
    this.rebuilding = true;
    const old = this.ch;
    this.ch = null;
    try {
      if (old) await this.client.removeChannel(old);
    } catch {
      /* ignore */
    }
    this.rebuilding = false;
    this.notJoinedSince = wall();
    this.build();
  }

  canSend() {
    return !!this.ch && (this.ch as unknown as { state: string }).state === 'joined';
  }
  protected rawSend(event: string, payload: Record<string, unknown>) {
    const ch = this.ch;
    if (!ch) return false;
    void ch.send({ type: 'broadcast', event, payload }).catch(() => undefined);
    return true;
  }
  protected rawTrack(meta: Meta) {
    const ch = this.ch;
    if (!ch || !this.canSend()) {
      this.metaDirty = true;
      return;
    }
    void ch.track(meta).catch(() => undefined);
  }
  async close() {
    this.closed = true;
    this.setStatus('closed');
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.metaTimer) clearTimeout(this.metaTimer);
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('pageshow', this.onWake);
    const ch = this.ch;
    this.ch = null;
    if (ch) {
      try {
        await ch.untrack();
      } catch {
        /* ignore */
      }
      try {
        await this.client.removeChannel(ch);
      } catch {
        /* ignore */
      }
    }
  }
}

// ----- Local simulator (testing) -----
// Tabs of one browser talk over a BroadcastChannel. Presence is emulated with
// heartbeats. Lag, jitter and loss come from the page URL.

export type SimOpts = { lag: number; jitter: number; loss: number };

export class LocalRoom extends BaseRoom {
  private bc: BroadcastChannel | null = null;
  private beat: ReturnType<typeof setInterval> | null = null;
  private seen = new Map<string, number>();
  private lastDeliver = new Map<string, number>();

  constructor(private topic: string, playerId: string, private sim: SimOpts) {
    super(playerId);
  }
  start() {
    this.bc = new BroadcastChannel(this.topic);
    this.bc.onmessage = (e: MessageEvent) => this.receive(e.data as { k: string; from: string; ev?: string; p?: Record<string, unknown>; m?: Meta });
    setTimeout(() => {
      if (this.closed) return;
      this.setStatus('joined');
      this.retrackNow();
      this.dispatch('_joined', {});
    }, 150 + this.sim.lag);
    this.beat = setInterval(() => {
      if (this.status === 'joined') this.post({ k: 'pres', from: this.playerId, m: this.meta });
      const now = wall();
      let changed = false;
      for (const [id, t] of this.seen) {
        if (now - t > 4000) {
          this.seen.delete(id);
          this.inPresence.delete(id);
          changed = true;
        }
      }
      if (changed) this.firePresence();
    }, 1000);
  }
  private post(msg: Record<string, unknown>) {
    try {
      this.bc?.postMessage(msg);
    } catch {
      /* ignore */
    }
  }
  private receive(d: { k: string; from: string; ev?: string; p?: Record<string, unknown>; m?: Meta }) {
    if (!d || d.from === this.playerId || this.closed) return;
    if (Math.random() < this.sim.loss) return;
    // Keep each sender's messages in order (a websocket does), but add delay.
    const delay = this.sim.lag + Math.random() * this.sim.jitter;
    const at = Math.max(wall() + delay, (this.lastDeliver.get(d.from) ?? 0) + 1);
    this.lastDeliver.set(d.from, at);
    setTimeout(() => {
      if (this.closed) return;
      if (d.k === 'pres') {
        const fresh = !this.inPresence.has(d.from);
        this.seen.set(d.from, wall());
        this.inPresence.add(d.from);
        if (d.m) this.live.set(d.from, d.m);
        if (fresh || d.m) this.firePresence();
      } else if (d.k === 'leave') {
        this.seen.delete(d.from);
        this.inPresence.delete(d.from);
        this.firePresence();
      } else if (d.k === 'b' && d.ev && d.p) {
        this.dispatch(d.ev, d.p);
      }
    }, at - wall());
  }
  canSend() {
    return this.status === 'joined' && !this.closed;
  }
  protected rawSend(event: string, payload: Record<string, unknown>) {
    this.post({ k: 'b', from: this.playerId, ev: event, p: payload });
    return true;
  }
  protected rawTrack(meta: Meta) {
    this.post({ k: 'pres', from: this.playerId, m: meta });
  }
  async close() {
    this.closed = true;
    this.post({ k: 'leave', from: this.playerId });
    this.setStatus('closed');
    if (this.beat) clearInterval(this.beat);
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.bc?.close();
    this.bc = null;
  }
}

// ---------------------------------------------------------------------------
// Host clock: hostNow() = wall() + offset, from ping/pong with the lowest
// round trip (its error is at most half that round trip).
// ---------------------------------------------------------------------------

export class HostClock {
  offset = 0;
  rtt = -1;
  samples: { rtt: number; off: number }[] = [];
  private pingAt = 0;
  private startedAt = 0;
  private host = '';

  reset() {
    this.offset = 0;
    this.rtt = -1;
    this.samples = [];
    this.pingAt = 0;
    this.startedAt = wall();
  }
  synced() {
    return this.rtt >= 0;
  }
  hostNow() {
    return wall() + this.offset;
  }
  setHost(hostId: string, meIsHost: boolean) {
    if (hostId === this.host) return;
    this.host = hostId;
    this.reset();
    if (meIsHost) this.rtt = 0;
  }
  /** Call often; sends a ping when one is due. */
  tick(room: Room, meIsHost: boolean) {
    if (meIsHost || !this.host || !room.canSend()) return;
    const now = wall();
    const fast = now - this.startedAt < 12000 || this.samples.length < 4;
    if (now - this.pingAt < (fast ? 2000 : 6000)) return;
    if (room.send('ping', { f: room.playerId, h: this.host, t0: now }, { force: true })) this.pingAt = now;
  }
  onPong(p: Record<string, unknown>, recv: number, myId: string) {
    if (p.to !== myId) return;
    const t0 = Number(p.t0);
    const t1 = Number(p.t1);
    if (!isFinite(t0) || !isFinite(t1)) return;
    const rtt = recv - t0;
    if (rtt < 0 || rtt > 5000) return;
    this.samples.push({ rtt, off: t1 - (t0 + recv) / 2 });
    if (this.samples.length > 12) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.off;
    this.rtt = best.rtt;
  }
}

// ---------------------------------------------------------------------------
// Remote karts
// ---------------------------------------------------------------------------

/** One motion sample: sender time, position, heading, velocity, turn rate, flags. */
export type Sample = { t: number; x: number; y: number; a: number; vx: number; vy: number; w: number; f: number; e: number };
export type Pose = { x: number; y: number; a: number; vx: number; vy: number; f: number; extrap: number };

export const F_SPIN = 1;
export const F_BOOST = 2;
export const F_DRIFT = 4;
export const F_AIR = 8;
export const F_SHIELD = 16;
export const F_DONE = 32;
export const F_SNOOZE = 64;
export const F_DRAFT = 128;

/** Optional track-following prediction supplied by the game. */
export type FollowFn = (x: number, y: number, a: number, speed: number, tauSec: number) => { x: number; y: number; a: number } | null;

export class RemoteKart {
  samples: Sample[] = [];
  lastSeq = -1;
  base = Infinity; // lower envelope of (recv - sender time), eased
  private baseTarget = Infinity;
  private raws: { t: number; raw: number }[] = [];
  private jit: number[] = [];
  j95 = 40;
  delay = 250;
  interval = 380;
  lastRecv = 0;
  epoch = 0;
  // Visual error offset that decays, so corrections never snap
  ex = 0;
  ey = 0;
  ea = 0;
  private prev: Pose | null = null;
  private prevEpoch = -1;
  snapped = 0; // wall time of the last hard snap (for a puff effect)
  extrapMs = 0;

  ingest(samples: Sample[], seq: number, ts: number, iv: number, recv: number) {
    if (seq <= this.lastSeq - 64) return;
    if (seq > this.lastSeq) this.lastSeq = seq;
    this.lastRecv = recv;
    if (iv > 0) this.interval = iv;
    // Timeline offset: the lowest (recv - send) seen in the last 20 s
    const raw = recv - ts;
    this.raws.push({ t: recv, raw });
    while (this.raws.length && this.raws[0].t < recv - 20000) this.raws.shift();
    let mn = Infinity;
    for (const r of this.raws) if (r.raw < mn) mn = r.raw;
    this.baseTarget = mn;
    if (this.base === Infinity) this.base = mn;
    this.jit.push(raw - mn);
    if (this.jit.length > 48) this.jit.shift();
    const sorted = [...this.jit].sort((a, b) => a - b);
    this.j95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 40;
    // Insert samples sorted by time, skipping duplicates
    for (const s of samples) {
      const arr = this.samples;
      if (arr.length && s.t <= arr[arr.length - 1].t) {
        if (arr.some((o) => Math.abs(o.t - s.t) < 0.5)) continue;
        let i = arr.length - 1;
        while (i >= 0 && arr[i].t > s.t) i--;
        arr.splice(i + 1, 0, s);
      } else arr.push(s);
    }
    const cut = (this.samples[this.samples.length - 1]?.t ?? 0) - 3000;
    while (this.samples.length > 2 && this.samples[0].t < cut) this.samples.shift();
  }

  /** Has this kart sent anything yet? */
  ready() {
    return this.samples.length > 0;
  }

  /** Pose to draw at local wall time `now`. dt is the frame time in seconds. */
  pose(now: number, dt: number, follow: FollowFn | null, near: boolean): Pose | null {
    const s = this.samples;
    if (!s.length) return null;
    // Target delay: half a send interval plus jitter, more if we must.
    let target = clampN(0.5 * this.interval + this.j95 + 30, 90, this.interval + this.j95 + 40);
    if (near) target = Math.max(80, target * 0.6); // fairer bumping up close
    // Move the delay at most 10% of real time, so the timeline never jumps
    const maxStep = dt * 1000 * 0.1;
    this.delay += clampN(target - this.delay, -maxStep, maxStep);
    if (isFinite(this.baseTarget)) this.base += clampN(this.baseTarget - this.base, -maxStep, maxStep);
    const tR = now - this.base - this.delay;

    let p: Pose | null = null;
    const last = s[s.length - 1];
    if (tR <= s[0].t) {
      const f = s[0];
      p = { x: f.x, y: f.y, a: f.a, vx: f.vx, vy: f.vy, f: f.f, extrap: 0 };
      this.epoch = f.e;
    } else if (tR <= last.t) {
      let i = s.length - 2;
      while (i > 0 && s[i].t > tR) i--;
      const a = s[i];
      const b = s[i + 1];
      if (a.e !== b.e) {
        const c = tR - a.t < b.t - tR ? a : b;
        p = { x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, f: c.f, extrap: 0 };
        this.epoch = c.e;
      } else {
        p = hermite(a, b, tR);
        this.epoch = b.e;
      }
    } else {
      p = extrapolate(last, Math.min(500, tR - last.t), follow);
      p.extrap = tR - last.t;
      this.epoch = last.e;
    }
    this.extrapMs = p.extrap;

    // Smooth corrections: compare with last frame's drawn pose moved forward
    if (this.prev && this.prevEpoch === this.epoch) {
      const px = this.prev.x + this.prev.vx * dt;
      const py = this.prev.y + this.prev.vy * dt;
      const jx = px - p.x;
      const jy = py - p.y;
      if (Math.hypot(jx, jy) > 260) {
        this.ex = this.ey = this.ea = 0;
        this.snapped = now;
      } else {
        // The drawn kart carries on from where it was; the gap to the target
        // becomes an error offset that fades out (about 120 ms).
        this.ex = jx;
        this.ey = jy;
        this.ea = wrapA(this.prev.a + this.lastW * dt - p.a);
      }
    } else if (this.prev) {
      this.ex = this.ey = this.ea = 0;
      this.snapped = now;
    }
    const kp = Math.exp(-dt / 0.12);
    const ka = Math.exp(-dt / 0.08);
    this.ex *= kp;
    this.ey *= kp;
    this.ea *= ka;
    const out: Pose = { x: p.x + this.ex, y: p.y + this.ey, a: wrapA(p.a + this.ea), vx: p.vx, vy: p.vy, f: p.f, extrap: p.extrap };
    this.lastW = this.prev ? wrapA(out.a - this.prev.a) / Math.max(1e-3, dt) : 0;
    if (!isFinite(this.lastW) || Math.abs(this.lastW) > 30) this.lastW = 0;
    this.prev = out;
    this.prevEpoch = this.epoch;
    return out;
  }
  private lastW = 0;

  /** Seconds since we last heard from this kart. */
  silentFor(now: number) {
    return this.lastRecv ? (now - this.lastRecv) / 1000 : 999;
  }
}

function hermite(a: Sample, b: Sample, t: number): Pose {
  const h = Math.max(1, b.t - a.t) / 1000;
  const s = clampN((t - a.t) / 1000 / h, 0, 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const x = h00 * a.x + h10 * h * a.vx + h01 * b.x + h11 * h * b.vx;
  const y = h00 * a.y + h10 * h * a.vy + h01 * b.y + h11 * h * b.vy;
  // Heading: unwrap, and if the kart spun fast use the turn rate instead
  let dA = wrapA(b.a - a.a);
  const wAvg = (a.w + b.w) / 2;
  if (Math.abs(wAvg * h) > Math.PI * 0.9) dA = wAvg * h;
  const a1 = a.a + dA;
  const ang = h00 * a.a + h10 * h * a.w + h01 * a1 + h11 * h * b.w;
  // Velocity: derivative-free blend is good enough for the camera and wheels
  const vx = a.vx + (b.vx - a.vx) * s;
  const vy = a.vy + (b.vy - a.vy) * s;
  return { x, y, a: wrapA(ang), vx, vy, f: s < 0.5 ? a.f : b.f, extrap: 0 };
}

function extrapolate(s: Sample, tauMs: number, follow: FollowFn | null): Pose {
  const tau = Math.max(0, tauMs) / 1000;
  const speed = Math.hypot(s.vx, s.vy);
  // Constant turn rate and velocity (the turn rate is eased off over time,
  // because drivers straighten out of turns)
  const w = s.w * Math.exp(-tau / 0.4);
  const steps = Math.max(1, Math.ceil(tau / 0.02));
  const dtS = tau / steps;
  let x = s.x;
  let y = s.y;
  const velA = Math.atan2(s.vy, s.vx);
  let va = isFinite(velA) ? velA : s.a;
  let a = s.a;
  for (let i = 0; i < steps; i++) {
    va += w * dtS;
    a += w * dtS;
    x += Math.cos(va) * speed * dtS;
    y += Math.sin(va) * speed * dtS;
  }
  let out = { x, y, a };
  // Longer gaps: follow the track instead, so bends stay on the road
  if (follow && tau > 0.15 && speed > 60) {
    const tr = follow(s.x, s.y, s.a, speed, tau);
    if (tr) {
      const k = clampN((tau - 0.15) / 0.25, 0, 1);
      out = { x: x + (tr.x - x) * k, y: y + (tr.y - y) * k, a: a + wrapA(tr.a - a) * k };
    }
  }
  const vx = Math.cos(va) * speed;
  const vy = Math.sin(va) * speed;
  return { x: out.x, y: out.y, a: wrapA(out.a), vx, vy, f: s.f, extrap: tauMs };
}

// ---------------------------------------------------------------------------
// Sending side: 50 ms samples, each message carries new samples plus the
// previous message's samples, so one lost message loses no motion.
// ---------------------------------------------------------------------------

export class Sampler {
  private fresh: number[][] = [];
  private prev: number[][] = [];
  private at = 0;
  seq = 0;
  sample(now: number, x: number, y: number, a: number, vx: number, vy: number, w: number, f: number) {
    if (now - this.at < 50) return;
    this.at = now;
    this.fresh.push([Math.round(now), r1(x), r1(y), r3(a), Math.round(vx), Math.round(vy), r3(w), f]);
    if (this.fresh.length > 12) this.fresh.shift();
  }
  /** Force a sample now (e.g. right before sending, or after a respawn). */
  force(now: number, x: number, y: number, a: number, vx: number, vy: number, w: number, f: number) {
    this.at = 0;
    this.sample(now, x, y, a, vx, vy, w, f);
  }
  take(): number[][] {
    const out = [...this.prev, ...this.fresh].slice(-16);
    this.prev = this.fresh;
    this.fresh = [];
    this.seq++;
    return out;
  }
  reset() {
    this.fresh = [];
    this.prev = [];
    this.at = 0;
  }
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function parseSamples(raw: unknown, epoch: number): Sample[] {
  if (!Array.isArray(raw)) return [];
  const out: Sample[] = [];
  for (const r of raw.slice(0, 24)) {
    if (!Array.isArray(r) || r.length < 8) continue;
    const [t, x, y, a, vx, vy, w, f] = r.map(Number);
    if (![t, x, y, a, vx, vy, w].every(isFinite)) continue;
    out.push({ t, x, y, a, vx, vy, w, f: f | 0, e: epoch });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Events: sent at once, repeated in the next 3 state messages, applied once.
// ---------------------------------------------------------------------------

export type NetEvent = { i: string; k: string; [key: string]: unknown };

export class EventLog {
  private pending: { ev: NetEvent; left: number }[] = [];
  private seen = new Set<string>();
  private order: string[] = [];
  add(ev: NetEvent) {
    this.pending.push({ ev, left: 3 });
    this.markSeen(ev.i);
  }
  /** Events to piggyback on the next state message. */
  piggyback(): NetEvent[] {
    const out: NetEvent[] = [];
    for (const p of this.pending) {
      out.push(p.ev);
      p.left--;
    }
    this.pending = this.pending.filter((p) => p.left > 0);
    return out;
  }
  /** True the first time an event id is seen. */
  fresh(id: string) {
    if (this.seen.has(id)) return false;
    this.markSeen(id);
    return true;
  }
  private markSeen(id: string) {
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > 600) {
      const old = this.order.shift();
      if (old) this.seen.delete(old);
    }
  }
  clear() {
    this.pending = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers for the page
// ---------------------------------------------------------------------------

export function readSimOpts(): SimOpts | null {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('net') !== 'local') return null;
    return {
      lag: clampN(Number(q.get('lag') ?? 60) || 0, 0, 2000),
      jitter: clampN(Number(q.get('jitter') ?? 30) || 0, 0, 2000),
      loss: clampN(Number(q.get('loss') ?? 0) || 0, 0, 0.9),
    };
  } catch {
    return null;
  }
}

/** Keep the screen awake during lobbies and races (tablets sleeping = dropouts). */
export class WakeLock {
  private lock: { release: () => Promise<void> } | null = null;
  private want = false;
  private onVis = () => {
    if (this.want && document.visibilityState === 'visible') void this.get();
  };
  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
  }
  private async get() {
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
      if (!nav.wakeLock || this.lock) return;
      const l = await nav.wakeLock.request('screen');
      this.lock = l;
      (l as unknown as EventTarget).addEventListener?.('release', () => {
        if (this.lock === l) this.lock = null;
      });
    } catch {
      /* not allowed or not supported */
    }
  }
  set(on: boolean) {
    this.want = on;
    if (on) void this.get();
    else if (this.lock) {
      const l = this.lock;
      this.lock = null;
      void l.release().catch(() => undefined);
    }
  }
  dispose() {
    this.set(false);
    document.removeEventListener('visibilitychange', this.onVis);
  }
}
