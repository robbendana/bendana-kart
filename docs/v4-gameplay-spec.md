# Bendana Kart 4.0: gameplay and multiplayer

This is the analysis, plan and spec for the gameplay half of 4.0. A sister
change covers visuals, sound and menus.

## What the analysis found

| Area | Finding |
| --- | --- |
| Family races | An online race with 2 or 3 people had 2 or 3 karts on a track built for 5. Robots only existed in Practice. |
| Robots | They held one fixed lane, drove through bananas, never went for item boxes or boost pads, and fired items on a timer. |
| Items | 7 items, all rockets, bananas, a blast, a shield and a snooze. Nothing for coins, nothing that clears a path, no real comeback item. |
| Tracks | All 5 tracks had the same parts (pads, ramps, coins, boxes). Nothing on the road to steer around. |
| Bug | Sunny Meadow, the default track, had no boost pads, ramps or coins the first time it was raced after loading the page. |
| Message allowance | After a race ended, every device kept sending at full rate while the results screen was open (about 240,000 messages an hour for 5 players, 12% of the month's allowance). |
| Memory | Each track paints two 3120 x 2080 canvases (about 26 MB each) and all of them were kept, so a 4 track cup held over 200 MB. Tablets drop canvases well before that. |
| Places | Other players' place in the race came from their last message (up to 0.4 s old), so close battles showed the wrong order and places ticked over in steps. |
| Fairness | A Homing Blast could lock onto a Toddler Assist kart, which it cannot hit, and be wasted. |

## What changed

### 1. Robots in online races

- The host has a switch, **Robots fill the empty seats**, on by default. With
  it on, every online race has 5 racers.
- The host's device drives the robots. Their motion rides inside the host's
  own state messages (`b` in the `st` payload), so robots cost **no extra
  messages**. Every other device draws them like any other remote kart.
- The race tuple gains an 8th entry: `[level, ownerId, [[racer, body], ...]]`.
  The host picks robots that do not copy a player's racer and keeps the same
  line-up from race to race, so cup points follow them.
- Robots send samples every 100 ms (players: 50 ms).
- **Handover.** If the robots go quiet for 4 s (the host left, slept or lost
  its connection), the players take them over in id order: the first waits 4 s,
  the next 7 s, and so on, so exactly one device does. If two devices ever
  drive them at once, the higher id hands its robots back. Receivers start a
  fresh timeline when the owner changes, because clocks differ per device.
- A device that joins a race late never starts its own robots.
- Robots never start the 30 s hurry-up timer and are never waited for.

### 2. Smarter robots (Practice and online)

Each robot picks a lane a little way ahead and the existing autopilot drives
to it:

1. Start from the racing line plus the robot's favourite side.
2. With empty hands, go for the nearest visible item box. Go for a boost pad
   that is nearly in line.
3. Swerve around slower karts ahead (overtaking), banana peels and hazard
   patches.

- A long hard turn charges a robot mini-turbo, shown with the same drift
  sparks a player gets.
- Items are used with a reason: rockets on a straight, bananas when someone is
  right behind, a blast when the target is in range, a shield or honk when a
  blast is coming, a Rainbow Rush on a straight.
- **Fair play.** Chill and Fair robots leave alone anyone who was hit in the
  last 20 s (Fast: 8 s). They never target a Toddler Assist kart. Chill and
  Fair robots drop banana peels only off the middle of the road and never
  right in front of a player.
- **Coins belong to players.** Robots do not take coins off the road. They
  earn a coin every 5 s instead, up to a cap per level.
- **Robot level** (host option, also used in Practice): Chill, Fair (default)
  or Fast. Chill robots are 7% slower and have no mini-turbo. Fair robots are
  5% slower with a small mini-turbo, tuned so a Practice race is about as hard
  as it was before 4.0. Fast robots are 6% quicker, get full mini-turbos and
  slow down less when ahead.
- Robots still go easier when players have steering help on, and still pace
  themselves to the pack: against you in Practice, against the middle of the
  players online.

### 3. Three new items

| Item | What it does | Who gets it |
| --- | --- | --- |
| 🧲 Coin Magnet | For 7 s, coins within 240 units fly to you. | Front and middle |
| 🌈 Rainbow Rush | For 3.5 s you go 1.5x speed, nothing can hit you, grass and hazards do not slow you, and any kart you touch spins out. | Mostly the back |
| 📣 Mega Honk | A shockwave 290 units wide: karts in it are shoved away and slowed for 1.1 s, and banana peels and other people's blasts in it vanish. A bubble shield blocks it. | Everyone |

Each device decides what happens to its own karts, as before. The honk is a
new `honk` event; hits are reported with the existing `xhit` event.

Hits now say who did it: "🍌 Mia got you!" and "🎯 You got Dad!".

### 4. Track hazards

Each track gets 5 round patches that slow a kart that drives through: mud on
Sunny Meadow, syrup on Candy Canyon, snow drifts on Frosty Peaks, sand on
Dusty Dunes and lava cracks on Volcano Loop.

- They sit away from the middle of the road and away from the driving line, so
  the steering help and the coloured dots never lead a kart into one.
- In a patch the top speed drops to 55% (80% with full steering help, a little
  better in the Monster Truck). A boost carries you straight through.
- Toddler Assist karts and karts in the air or in a Rainbow Rush are not
  affected.
- They are data (`FEATURES.hazards`), painted into the top-down track and
  available to the 3D view.

### 5. Closer family races

Online, a player who is far behind the leading player gets a tailwind: up to
8% more top speed, growing from 1.5 s to about 9 s behind. The leader gets
nothing. This keeps a 4 year old, a 10 year old and a parent in the same race.

### 6. Multiplayer and device fixes

- **Places** use each remote kart's newest message moved forward by its age.
- **After the race** karts roll to a stop and each device sends once every
  5 s instead of 3 to 10 times a second.
- **Clock pings** drop to one every 20 s during a race once the clocks agree.
  With 5 players the replies were using up the host's message allowance and
  its kart went still for a second at a time on the other screens.
- **Robot pickups** ride with the next state message instead of their own.
- **Memory.** Only the current track's canvases are kept, and the top-down
  canvas is only painted when the top-down view is used.
- **Blasts** skip Toddler Assist karts when picking a target.
- **Sunny Meadow** gets its pads, ramps and coins on the first race.

## Testing

- `?testdrive=0|1|2|t` drives Practice with a scripted player.
  `&item=honk` (any item name) keeps handing that item to the player.
- `?net=local&netdebug&autodrive` links tabs of one browser. `window.__bkNet`
  then reports each kart's position, who drives the robots, the places and the
  message rate.
