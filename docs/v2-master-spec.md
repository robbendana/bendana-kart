# Bendana Kart v2.0 master spec

This spec turns the [master plan](./v2-master-plan.md) into exact behavior,
numbers and message formats. World units: the road is 210 wide, karts have a
26 unit radius and drive at 500 to 600 units a second.

## 1. Code layout

| File | What it holds |
| --- | --- |
| `app/page.tsx` | Game rules, physics, items, 2D drawing, React screens and HUD |
| `app/view3d.ts` | three.js renderer for the 3D cameras |
| `app/net.ts` | New. Transport (Supabase or the local simulator), clocks, snapshot buffers, interpolation and prediction, budget |
| `app/audio.ts` | New. Synthesized music, sound effects, engine hum, vibration |

## 2. Transport

`Transport` is a small interface with two implementations:

- **Supabase** (default): channel `bendana-kart:room:<CODE>`, config
  `broadcast: { self: false, ack: false }`, `presence: { key: playerId }`.
- **Local simulator** (`?net=local`): a `BroadcastChannel` between tabs of the
  same browser, with presence emulated by heartbeats. `&lag=150&jitter=60&loss=0.05`
  add one-way delay, random extra delay and drop rate. For testing only.

The interface: `connect()`, `send(event, payload)`, `on(event, cb)`,
`track(meta)`, `presence()`, `onPresence(cb)`, `onStatus(cb)`, `close()`.

## 3. Identity and host

- **Player id:** random, stored in `sessionStorage` (`bendana-kart-id`), so a
  refresh keeps the same id and slot, and two tabs are two players.
- **Host:** the device that tapped Host Race sets `host: true` in its presence
  and remembers it in `sessionStorage` for that room, so a refresh keeps host.
  The host is the earliest `joinedAt` among players with `host: true`. If none
  are present, it is the earliest `joinedAt` overall, ties broken by id. Every
  device runs the same rule on the same presence list.
- **Room cap:** 5. A sixth device sees "This room is full" and leaves.

## 4. Presence meta

The free plan allows 10 keys per presence object and only 5 presence calls per
client every 30 s, so the meta is packed and `track()` is rate limited:

```
{ v: 2, n: name, c: [kartIdx, paint, body, toddler, assist], r: ready(0|1),
  h: host(0|1), j: joinedAt, o: [trackIdx, laps, cup],
  race?: [id, track, order(ids), go(hostClockMs), laps, cup, round] }
```

- `track()` runs on every `SUBSCRIBED` (join and rejoin, because presence is
  not restored automatically) and otherwise at most once every 7 s. Changes in
  between are coalesced and sent at the next allowed slot.
- For instant lobby updates, the same meta is also broadcast as a `meta`
  event when it changes (rate limited to 2 a second). Presence remains the
  source of truth for who is in the room.
- Only the host sets `race`. A device in the lobby that sees a host `race`
  whose id it has not played, with `go` less than 3 minutes ago, starts that
  race. If GO has already passed it starts on its grid slot immediately.
- `leave` events that arrive during a sync are treated as noise: the list is
  rebuilt from `presenceState()` on each `sync`.

## 5. Clocks

- `wall()` = `performance.timeOrigin + performance.now()` (monotonic ms).
- **Host clock offset.** In the lobby each non-host sends `ping {f, t0}` every
  2 s for the first 10 s, then every 6 s. The host answers `pong {to, t0, t1}`.
  The client computes `rtt = t2 - t0` and `off = t1 - (t0 + t2) / 2`, keeps the
  last 12 samples, and uses the offset of the sample with the lowest rtt.
  `hostNow() = wall() + off`.
- **Race start.** The host sets `go = hostNow() + 4500`. Each device converts
  it to local `wall` as `go - off` and runs the countdown from that. The 3D
  fly-in plays during the first 1.3 s.
- **Race time.** `raceMs() = hostNow() - go`. Box respawns and finish times use
  race time, so they agree on every screen.

## 6. Kart state messages (`st`)

Sampling: every 50 ms of local time, push a sample. Each message holds every
sample since the last message plus the previous message's samples (up to 16).

```
{ id, r: raceId, q: seq, iv: sendIntervalMs, ts: senderWall,
  s: [[t, x, y, a, vx, vy, w, f], ...],   // t sender wall ms; a heading; w turn rate rad/s
  e: epoch, l: lap, i: trackIdx, c: coins, sp: spinAngle, ft: finishRaceMs,
  ev: [recent events] }
```

Flags `f`: 1 spinning, 2 boosting, 4 drifting, 8 airborne, 16 shield, 32
finished, 64 snoozed, 128 slipstream. Numbers are rounded (positions to 0.1,
angles to 0.001, velocities to 1).

**Send interval** `iv = max(100, ceil(N * N * 1000 / 66))` for N players in the
room: 100 ms for 2, 140 for 3, 250 for 4, 380 for 5. When the kart has not
moved for 1 s the interval becomes 1500 ms (a heartbeat).

**Budget guard:** Supabase measures the 100 a second limit as a rolling
one-minute average and closes the channel when it is exceeded. A token bucket
per device allows `66 / N` room-messages a second (each send costs N), with a
burst of 3 sends. Events spend from the
same bucket; a state send waits if the bucket is empty.

## 7. Receiver pipeline (per remote kart, every frame)

1. **Ingest.** Drop messages with the wrong race id or a seq more than 64 below
   the newest. Insert samples sorted by `t`, skipping duplicates. Keep 3 s.
2. **Offset.** `raw = recvWall - ts`. `base = min(raw)` over the last 20 s;
   `jitter = raw - base` into a ring of 48; `J95` is its 95th percentile.
3. **Delay.** Target `D* = clamp(0.5 * iv + J95 + 30, 90, iv + J95 + 40)`. The
   live delay `D` moves toward `D*` by at most 10% of elapsed time, so the
   timeline never jumps.
4. **Render time.** `tR = wall() - base - D` in the sender's clock.
5. **Pose.**
   - If two samples bracket `tR` and share an epoch, use cubic Hermite on
     position with velocity tangents, and Hermite on heading with turn-rate
     tangents (unwrapped).
   - Otherwise extrapolate from the newest sample by `τ = tR - t`:
     - `τ ≤ 150 ms`: constant turn rate and velocity.
     - `150 to 500 ms`: blend toward following the track: project onto the
       centerline, advance along it by speed × τ, keep the side offset (eased
       toward the center), heading = track direction + old heading difference.
     - Beyond 500 ms: hold the 500 ms pose and fade the kart to 60% after
       1.5 s ("connection" badge on its name tag).
6. **Smoothing.** When a new message changes the target pose, add the jump to
   an error offset and decay it with τ = 120 ms (heading 80 ms). Snap only if
   the jump is above 260 units or the epoch changed (respawn), with a puff.

Remote karts are created on the grid at race start from the race order and
presence, so the grid is full before anyone moves.

## 8. Events

Events go out at once as `ev {id, r, list}` and are repeated in the `ev` field
of the next 3 state messages. Each event has a unique id; receivers keep a set
of seen ids and apply each only once.

| Kind | Data | Effect on receivers |
| --- | --- | --- |
| `box` | box id, race ms | Hide that box until race ms + 6000 |
| `drop` | banana id, x, y | Add a banana |
| `bhit` | banana id | Remove that banana |
| `fire` | blast id, x, y, a, target | Add a homing blast |
| `xhit` | blast id | Pop that blast |
| `snooze` | from id, progress | If my progress is ahead, I get snoozed |
| `fin` | finish ms, stats | Mark finished, store stats for awards |
| `emote` | emoji | Float it over that kart for 2 s |
| `horn` | — | Play a horn if within 600 units |

Hits are decided by the victim's device (bananas, blasts). Bumps push only
your own kart, against the drawn position of the other kart.

## 9. Reconnects and staying awake

- The Supabase client uses `realtime: { worker: true, heartbeatIntervalMs: 15000,
  heartbeatCallback }`, so heartbeats keep running when the browser throttles
  timers, and a failed heartbeat triggers `connect()`.
- Nothing is sent unless the channel state is `joined` (otherwise realtime-js
  falls back to HTTP posts).
- On `visibilitychange` (visible), `pageshow`, `online`, and every 5 s, check
  the channel. If it is not joined for 6 s, `await removeChannel()` and join
  again with the same id. `track()` runs again on every `SUBSCRIBED`, and the
  device sends a fresh state message.
- Lobby and race show a yellow "Reconnecting…" badge while not joined.
- A remote kart that leaves presence stays drawn as a ghost for 6 s, and comes
  back if its messages resume.
- `navigator.wakeLock.request('screen')` in the lobby and race, released on the
  menu, re-requested when the page becomes visible again.

## 10. Lobby

- Player cards with emoji, name, kart, a ✅ Ready badge and a connection meter
  (green under 150 ms round trip, yellow under 350, red above).
- Everyone has a big **Ready** button. The host's **Start** button is always
  available; when everyone is ready a 3 s auto-start begins.
- Host options: track or cup, laps (2 or 3).
- Emote bar (👍 😂 😱 🎉 😜 ❤️), 1 per 2 s, shown above the card or kart.

## 11. Track features

Placement is automatic per track from the centerline, on the straightest
stretches, spaced apart:

- **Boost pads:** 3 per track, 70 long × 64 wide, at side offset −45, 0 or +45.
  Effect: 1.0 s at ×1.35 top speed and ×2 acceleration; hitting another pad
  restarts the timer. FOV kick in 3D, whoosh sound.
- **Ramps:** 2 per track, full road width, 36 long. Launch when crossing at more
  than 220 speed. Air time 0.75 s with a parabolic hop (height 46). Steering
  drops to 35% in the air. Pressing the item button or Shift in the air does a
  trick (automatic in Toddler Assist and with steering help Lots); landing
  after a trick gives 0.6 s at ×1.25.
- **Coins:** 4 rows of 5, personal to each device (not synced), respawn 8 s
  after pickup. Up to 10; each coin adds 1% top speed. Pickup gives 0.25 s at
  ×1.08 and a rising chime. A spin-out drops 3.

## 12. Items

| Item | Emoji | Effect |
| --- | --- | --- |
| Turbo Rocket | 🚀 | 2 s at ×1.6 |
| Triple Rockets | 🚀×3 | 3 charges of 1.2 s |
| Banana Peel | 🍌 | Drop behind; spins out (1 s) whoever hits it |
| Triple Bananas | 🍌×3 | 3 charges |
| Homing Blast | 💥 | Chases the nearest kart ahead |
| Bubble Shield | 🫧 | Blocks the next hit, or lasts 8 s |
| Snooze Cloud | 💤 | Everyone ahead: 1.5 s at ×0.7 top speed (no spin, no item loss). You: 1.5 s rocket |

**Roulette:** 1.2 s with slowing ticks; tapping the item button during the
roll stops it early.

**Odds** by how far back you are (`b` = 0 leader to 1 last), linear between
these anchors (weights):

| Item | Leader | Middle | Last |
| --- | --- | --- | --- |
| Rocket | 10 | 25 | 25 |
| Triple Rockets | 0 | 10 | 25 |
| Banana | 45 | 15 | 0 |
| Triple Bananas | 20 | 15 | 0 |
| Blast | 0 | 20 | 25 |
| Shield | 25 | 15 | 10 |
| Snooze | 0 | 0 | 15 (only with 3+ racers, once per race per player) |

## 13. Slipstream

Another kart 45 to 230 units ahead, within 0.3 rad of my heading, me above 250
speed, not Toddler Assist: charge for 1.0 s (wind lines show), then 1.0 s at
×1.15.

## 14. Race flow

- Laps 2 or 3 (host or menu choice, default 3).
- When the first human finishes, a 30 s timer starts ("Hurry!" banner). When
  every human has finished or the timer ends, the race closes. Unfinished
  racers are placed by progress. The host broadcasts the final order (`res`);
  solo races decide locally.
- **Grand Prix:** two cups, 🌼 Sunshine Cup (Sunny Meadow, Candy Canyon, Dusty
  Dunes, Frosty Peaks) and 🔥 Lava Cup (Candy Canyon, Frosty Peaks, Dusty Dunes,
  Volcano Loop). Points per place: 10, 8, 6, 5, 4. Standings after each race;
  a cup ceremony after race 4. In multiplayer the host drives the cup: its
  `race` meta carries the cup and round.

## 15. Podium and awards

After each race: a podium screen with the top 3 on steps (gold, silver,
bronze), rising one by one with a fanfare and confetti, then award cards. Each
racer gets one award, picked greedily so nobody shares one:

🔥 Drift Master (most mini-turbos), 🪙 Coin Collector (most coins picked up),
🎯 Sharp Shooter (most hits landed), 🍌 Banana Boss (most bananas dropped),
🚀 Speed Demon (most boost seconds), 🛡️ Safe Driver (fewest times hit),
🦘 Air Ace (most tricks), 💪 Never Give Up (fallback).

## 16. HUD

- Place: large number colored gold, silver, bronze or white. It scales 1.4 to
  1.0 over 250 ms and flashes green when gaining a place, red when losing one,
  with a sound.
- Laps: filled dots, plus 🏁 on the final lap.
- Race strip across the top: every racer's face placed by race progress.
- Coins: 🪙 count.
- Start lights: three red lights then green with the countdown.
- Reaction bubbles over karts: 💫 when hit, 🔥 on a mini-turbo, ⭐ on a trick,
  💤 when snoozed.
- Network badge (multiplayer): green, yellow or "Reconnecting…".
- `?netdebug` shows per-player delay, jitter, extrapolation and messages a
  second.

## 17. Sound and vibration

`app/audio.ts` provides `sfx(name)`, a per-track looping tune
(`startMusic(track)`) that speeds up a little and rises a semitone on the final
lap, fanfares, the engine hum, and `vibrate()` (Android only). The menu has
music and vibration toggles.

## 18. Testing

1. `next build` passes with no type errors.
2. Solo race on every track: pads, ramps, coins, items, finish, podium.
3. Local simulator, 5 tabs, `lag=150&jitter=60&loss=0.05`: everyone sees GO
   within 50 ms of each other; remote karts move with no visible snaps;
   refresh one tab mid-lobby and it returns as the same player; a missed start
   still starts the race.
4. Check the message rate in `?netdebug` stays under 70 a second for 5.
