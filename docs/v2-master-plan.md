# Bendana Kart v2.0 master plan

Version 1.0 is live at https://bendana-kart.vercel.app. It works, but joining a
room and watching the other karts felt wobbly. Version 2.0 fixes that first and
then adds the arcade features that make a kart racer feel finished.

## Ground rules (unchanged from 1.0)

- At most 5 players, one per device (phones, tablets, laptops).
- Multiplayer uses Supabase Realtime only (broadcast and presence) on the
  existing OgaVox project. No table reads or writes, ever.
- Stay inside the free plan: 100 messages a second for the project (a rolling
  one-minute average; going over closes the channel), 2 million a month, 200
  connections, 20 presence messages a second, and 5 presence updates per
  device every 30 s. Every broadcast costs 1 message plus 1 per receiver.
- Players are kids aged about 4, 6 and 10 plus two adults. Steering help stays
  on by default, and new mechanics must be easy by default.
- Original game: mechanics and feel from research, never names, characters or
  art from other games.
- Vercel allows 100 deploys a day and every push deploys. Build locally, test,
  push once.

## Why 1.0 felt wobbly (findings from the code)

1. **Arrival-time stamping.** Remote karts were placed on a timeline built from
   when each message *arrived*, so normal network jitter (30 to 150 ms) became
   visible stutter.
2. **Very low motion detail.** With 5 players each device sends one message
   every 360 ms, and each message held a single position. Curves between
   points were straight lines, and a missing message meant a 720 ms gap.
3. **Naive extrapolation.** When data ran out, karts slid along their last
   heading, off the road on every bend, then snapped back.
4. **No shared clock.** Each device started the countdown when the start
   message arrived, so GO happened at different moments, and finish times were
   not comparable.
5. **Fragile lobby.** The host was whoever had the earliest device clock, so a
   phone with a wrong clock could steal host. A missed `race_start` message
   left a player stuck in the lobby. A refresh created a new player, which left
   a ghost behind.
6. **Weak reconnect handling.** Supabase rejoins the channel after a drop but
   does not restore presence, and sending while disconnected falls back to
   slow HTTP posts. A tablet that slept could come back invisible to others.
7. **Lost item events.** Box pickups and banana hits were sent once with no
   repeat, so one lost message meant boxes or bananas differed between screens.

## The top 20 improvements

### A. Multiplayer smoothness (priority one)

1. **Batched motion samples.** Sample the kart every 50 ms and pack all new
   samples, plus a repeat of the previous batch, into each message. Same
   message count, 20 Hz motion detail, and one lost message loses nothing.
2. **Per-player timeline and jitter buffer.** Every sample carries the
   sender's own clock. Each receiver learns a stable offset per sender (the
   lowest observed delay) and measures jitter, so arrival jitter disappears.
3. **Smooth curves, smart prediction, no snaps.** Hermite curves using real
   velocity between samples. When data is late, predict with constant
   turn-rate, then follow the track for longer gaps. Any correction blends in
   over about 120 ms instead of snapping. Respawns are flagged so they jump
   cleanly.
4. **Shared race clock.** Devices ping the host in the lobby and keep the
   lowest-round-trip estimate. The host schedules GO in its own clock, so every
   screen shows GO within a few tens of milliseconds, and finish times compare
   fairly.
5. **Reliable lobby.** The host is the person who created the room, with a
   stable fallback if they leave. The host's presence carries the current race
   (id, track, grid, start time), so a player who missed the start message
   still joins the race. Messages from an old race are ignored.
6. **Reconnects and staying awake.** A per-tab player id survives refreshes.
   The game rejoins after sleep, tab switches and Wi-Fi changes, shows a
   "Reconnecting" badge, keeps a dropped kart on screen for a short grace
   period, and keeps the screen awake during races.
7. **Reliable events and a message budget.** Item events are sent at once and
   repeated inside the next motion messages, with ids so nobody applies one
   twice. A budget guard keeps the room under the free-plan rate.
8. **Ready-up lobby.** Big player cards with a Ready button and a connection
   meter, emoji reactions, and a one-tap "Race again" or "Next track" after the
   race.

### B. Arcade gameplay and feel

9. **Boost pads** on every track.
10. **Jump ramps with a trick.** Tap any button in the air for a landing boost
    (automatic in Toddler Assist).
11. **Coins.** Up to 10, each a small top-speed bonus. A hit drops a few.
12. **More items and a better roulette.** Bubble Shield, Triple Bananas and a
    kid-friendly Snooze Cloud for the back of the pack, a spinning item
    roulette, and fairer position-based odds.
13. **Slipstream.** Drive close behind someone to get pulled along with wind
    lines and a boost: a catch-up you earn.
14. **Grand Prix cups.** Four races with points for every place, standings
    between races and a cup at the end.
15. **Podium and awards for everyone.** Top three on a podium with confetti
    and a fanfare, and an award card for every racer (Best Drifter, Coin
    Collector, Banana Boss and more).
16. **Music and sound.** An original synthesized tune per track that speeds up
    on the final lap, plus a full set of sound effects. Still no audio files.
17. **Pre-reader HUD.** A big medal-colored place number that pops when it
    changes, lap dots, and a race strip that shows every racer's face from
    last to first.
18. **Character reactions and vibration.** The racer's face reacts (dizzy when
    hit, cool when boosting), and Android devices buzz on hits and boosts.
19. **Finish drama and a clearer start.** Start lights, a "photo finish" slow
    motion, and big finish effects.
20. **Smooth frames and a test harness.** Fixed-step physics with render
    smoothing so 90 and 120 Hz screens look right, plus a built-in network
    simulator (latency, jitter, loss) and a network stats overlay to test
    5-player races without five devices.

## Delivery steps

1. Commit this plan and the master spec (`docs/v2-master-spec.md`).
2. Build the network layer (`app/net.ts`) and wire it into the game.
3. Build the audio module (`app/audio.ts`) and the gameplay features.
4. Test: `next build`, then a 5-player race in the network simulator with 150 ms
   delay, 60 ms jitter and 5% loss, checking for smooth karts and in-sync GO.
5. One push, one pull request, one deploy. Merge to `main` for the live link.

## Message budget (5 players)

| Players | Send interval | Room messages/sec | Hours per month in 2M |
| --- | --- | --- | --- |
| 2 | 100 ms | 40 | 14 |
| 3 | 160 ms | 56 | 10 |
| 4 | 250 ms | 64 | 8.7 |
| 5 | 380 ms | 66 | 8.4 |

Item events, pings and presence add a few messages a second on top. Batching
means the longer interval no longer costs smoothness, only a little delay,
which prediction hides.
