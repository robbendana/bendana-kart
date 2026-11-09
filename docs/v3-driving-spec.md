# Bendana Kart 3.0 driving spec

This spec turns the [driving plan](./v3-driving-plan.md) into exact behavior
and numbers. World units as before: the road is 210 wide (`HALF_W` 105), the
curb paint reaches 12 past the road edge, karts have a 26 unit radius and a
top speed of 500 to 600 units a second. `dt` is the physics step in seconds
(at most 1/60). Every "smooth toward" below uses the frame-rate independent
form `x += (target - x) * (1 - exp(-rate * dt))`.

## 1. The help value

`help` (0 to 1) is computed once per frame for my kart.

```
base  = Lots 1.0 · A little 0.55 · Off 0          (Toddler: 1, autopilot)
floor = Lots 0.7 · A little 0.35 · Off 0
fade  = races >= 2 ? clamp((skill - 0.55) / 0.35, 0, 1) : 0
help  = clamp(base - (base - floor) * fade + rescue, 0, 1)      (rescue only if base > 0)
```

- `skill` and `races` come from `localStorage['bendana-kart-skill']`
  (`{ s, n }`), see section 9. Missing or unreadable storage means skill 0.
- `rescue` (0 to 0.3) rises by 0.12 each time I leave the road for more than
  0.5 s or the wrong-way warning shows, and falls by 0.015 a second while I
  am on the road.

## 2. Input shaping

- **Digital steering** (keys, touch arrows, D-pad): `steer` moves toward the
  target at 5.5/s while turning further in the same direction, and at 12/s
  when easing off, recentring or reversing. A 0.08 s tap gives about 0.45; a
  hold reaches full lock in 0.18 s.
- **Analog stick**: dead zone 0.15, then `sign(x) * ((|x| - 0.15) / 0.85)^1.5`,
  used directly as the target with the same rates. The binary left and right
  inputs still work for the D-pad.
- **Speed sensitivity**: turn rate scales by `smoothstep(0, 140, |fwd|)` at low
  speed (no spinning on the spot) and by `1 - 0.25 * speedRatio` at speed
  (unchanged).
- **Toddler and robots**: their steering is rate limited at 6/s too, so the
  autopilot never snaps.

## 3. Engine and speed

- **Acceleration curve**: `accel * (1.45 - 1.0 * r^2)` where `r = fwd / maxS`.
  Strong launch, gentle approach to top speed; time to 95% of top speed stays
  within 10% of 2.0.
- **Over the limit** (after a boost ends, or entering the grass): speed falls
  toward the limit at 380/s on the road and 900/s on grass, so boosts fade out
  over about a third of a second instead of cutting off.
- **Boost punch**: when a boost starts (rocket, pad, mini-turbo, trick
  landing, slipstream) the kart gets an instant forward shove: rocket 70, pad
  55, mini-turbo 30 / 55 / 80 by tier, trick 45, slipstream 30, capped at the
  boosted top speed. The camera gets an FOV kick (section 7).

## 4. Road edges and grass

`dist` is the distance from the centerline.

| Zone | `dist` | Effect |
| --- | --- | --- |
| Road | up to 105 | Normal |
| Curb | 105 to 123 | No slowdown. Rumble: sound, a 6 ms buzz every 0.15 s, shake 1.5 |
| Grass | beyond 123 | Top speed blends from 100% to the grass limit over the first 40 units (smoothstep) |

- Grass limit: `min(0.75, track.offroad * body.offroad)`, raised toward 1 by
  `help * 0.5` of the gap (Toddler: no grass penalty, unchanged).
- `offroad` (used by particles, the respawn timer and the HUD) now means
  "on the grass", beyond 123.
- **Edge cushion** (help > 0): inside 20 units of the road edge or beyond it,
  sideways velocity heading away from the road is multiplied by
  `exp(-help * 6 * dt)`, and the steering gets an extra pull of `0.5 * help`
  toward the road. Off has no cushion.
- **Respawn** when far off the road: after `2.5 - 1.0 * help` s (was 2.5 s).

## 5. Drifting

- **Start**: unchanged triggers (Shift, the gamepad bumpers, or on touch a held
  turn of 0.3 s). New: a 0.18 s hop (height 7, visual only) and an outward
  sideways kick of 40.
- **Body angle**: the drawn kart turns `driftDir * (0.28 + 0.2 * into)` away
  from its direction of travel (into = how hard you steer into the drift, -1
  to 1), smoothed at rate 10. Outside drifts the body shows the real slip angle
  `atan2(lateral, forward) * 0.8`, clamped to 0.5, so ice and big slides look
  like slides.
- **Charge** per second: 1.0 steering into the drift, 0.55 neutral, 0.3
  steering out, times `clamp(speedRatio, 0.6, 1)`. Tiers at 0.6 / 1.2 / 2.0 s
  (unchanged, kid friendly).
- **Release**: mini-turbo 0.6 / 0.9 / 1.3 s at ×1.3 (unchanged) plus the punch
  in section 3.
- **Who can drift**: Toddler no. Lots on touch: only once help has eased to
  0.85 or below ("drift unlocked", section 9). Shift and gamepad drifting
  always work for non-toddlers.

## 6. Collisions between karts

For each kart I simulate against every other kart within `2 * 26` (×1.1 for
remote karts):

- Push out of overlap: half the overlap for karts on my device, the full
  overlap for a remote kart (its own device pushes it).
- Velocity along the contact normal: the closing part is removed and 35% is
  returned as a bounce. The sideways part keeps 92%.
- A wobble: `bumpT = 0.35`, which rolls the body (section 8).
- Feedback for my kart scales with closing speed `c`: shake `min(8, 2 + c/40)`,
  bump sound volume `clamp(c/200, 0.3, 1)`, buzz `10 + c/10` ms. At most one
  every 0.25 s.

## 7. Cameras

### 3D chase, close and driver's seat

- **Yaw** follows the direction of travel: `heading + clamp(slip, ±0.6) * 0.6`
  above speed 80, so a drift swings the kart sideways on screen. Smoothed at
  rate 5 (chase, close) and 14 (driver).
- **Speed**: `r = speed / maxSpeed`. FOV adds `9 * r^1.5`; distance adds
  `14 * r`; height drops by `6 * r`.
- **Boost kick**: on each boost start the FOV kick jumps to 12 and decays at
  rate 3, never below 6 while boosting. Replaces the old flat +12.
- **Look into turns**: the look-at point moves sideways by
  `yawRate * 28` (clamped to ±40).
- **Landing**: on touchdown the camera dips 7 and springs back (rate 9).
- **Shake**: smooth noise from three sine waves at 23, 31 and 41 rad/s.
- Driver's seat rolls by `-yawRate * 0.03` (±0.06) plus the drift roll.

### 2D top-down

- Follows `position + velocity * 0.35`, smoothed at rate 7 (frame-rate
  independent; was 0.12 per frame).
- Zoom: ×(1 − 0.08 r) with speed, ×0.9 while boosting, smoothed at rate 3.
- Shake uses the same smooth noise.

### Speed lines (both views)

Above `r = 0.82`, or while boosting, 22 streaks fly out from the vanishing
point (screen centre in 2D, 40% from the top in 3D). Each streak has a
stable seed and moves outward over 0.35 s instead of flickering. Opacity:
`clamp((r - 0.82) / 0.18, 0, 1) * 0.35`, or 0.5 while boosting.

## 8. Kart body motion (3D, all karts including remote ones)

Each kart object remembers last frame's heading and speed, so remote karts get
this too with no extra network data.

- **Roll** (lean out of the turn): `-yawRate * min(1, speed/400) * 0.09`,
  clamped ±0.16, plus the drift lean (0.14) and bump wobble
  (`sin(bumpT * 40) * bumpT * 0.3`). Smoothed at rate 10.
- **Pitch**: longitudinal acceleration `a` (smoothed): `-a / 6000`, clamped
  ±0.08 (nose up on launch, nose down on brakes).
- **Squash** on landing: height scale 0.8, width 1.1, back to 1 at rate 12.
- **Hop**: drift start lifts the kart 7 for 0.18 s.
- **Front wheels** turn by `steer * 0.45` (my kart and robots; remote karts
  use `clamp(yawRate / 2.5, -1, 1)`).

## 9. Support ladder

### Help effects (scaled by `help`, section 1)

| Effect | Rule |
| --- | --- |
| Road following | No steering input: target = `autopilot * help`. With input: `manual + autopilot * 0.7 * help`, clamped |
| Ease off for bends | When `help >= 0.7`: throttle 0.25 and brake `0.6 * autoBrake` when the autopilot would brake |
| Edge cushion | Section 4 |
| Grass | Section 4 |
| Ice grip | Road grip at least `THEME.grip + (0.9 - THEME.grip) * help` |
| Auto trick | When `help >= 0.7` |
| Driving line | Section 10, opacity `0.6 * help` |

### Driving score

During a race, for my kart (not Toddler), while racing and not finished:

- `bendT`: time in bends (autopilot steer magnitude > 0.25).
- `goodT`: bend time where my own steering points the same way as the
  autopilot (or I am drifting the right way).
- `roadT` and `grassT`: time on the road (including curbs) and on the grass.
- `driftN`: mini-turbos.

At the finish:

```
steerScore = bendT > 3 ? goodT / bendT : 0.5
roadScore  = roadT / (roadT + grassT)
driftScore = min(1, driftN / (laps * 2))
race = 0.45 * steerScore + 0.4 * roadScore + 0.15 * driftScore
s    = n == 0 ? race : s + (race - s) * 0.3,   n += 1
```

Stored as `{ s, n }`. Toddler races are not scored.

### Celebrations and tips

- **Clean lap** ✨: a lap with no grass and no spin-outs shows "✨ Clean lap!"
  (and the lap banner shows after it). A ding plays.
- **Drift unlocked** 🔥: the first race a Lots player on touch has help at or
  below 0.85: "🔥 Hold a turn to drift!" during the countdown.
- **Drift tip**: a non-Toddler player who has not drifted by the middle of lap
  2 sees "🔥 Hold a turn to drift!" (touch) or "🔥 Hold Shift in turns to drift!"
  (keys). At most 3 times per device.
- **Grass tip**: three grass trips in one lap with help < 1 shows "🌱 Grass is
  slow: ease off in tight turns". At most 3 times per device.
- Tip counts live in `localStorage['bendana-kart-tips']`. At most one tip per
  race.
- **Finish card**: "🌟 Your driving is getting better!" when this race beat
  the stored score by 0.05 or more.
- **Menu**: under the Steering help picker, "🌟 Ready to try less help?" when
  the stored score is at least 0.8 after 3 or more races and the picker is not
  on Off.

## 10. Driving line

A racing line is computed once per track:

1. Curvature `k[i]` = the change in track angle from sample `i-6` to `i+6`,
   divided by `12 * 8`.
2. Smoothed twice with a ±20 sample box filter (so the line starts turning in
   before the bend: out, in, out).
3. Offset `lat[i] = clamp(k[i] * 9000, -60, 60)` toward the inside, then
   smoothed once more.

The autopilot (robots, Toddler, steering help) aims at this line plus the
robot's own lane offset × 0.5.

Drawing (help > 0, not Toddler, racing, not finished): 56 points from 6 to
90 samples ahead of my kart. Each point's colour compares my speed with the
safe speed there, `maxS * clamp(1.2 - bend * 0.6, 0.45, 1)` (the same rule
the autopilot brakes by): green when I am under it, yellow within 60 over,
red beyond. Alpha fades in over the first 8 points and out over the last 16.

- 3D: a flat ribbon 9 wide, 1.2 above the road, additive, no depth write.
- 2D: dots of radius 5 every 2nd point.

## 11. Sound and vibration

- **Engine**: a second oscillator a fifth above at 30% volume; pitch
  `70 + 170 r` (+25 while boosting).
- **Surface loop** (one looping noise source, three filtered branches):
  drift screech (band-pass 1800 Hz, gain 0.03 while drifting, pitch rises with
  tier), grass rumble (low-pass 220 Hz, gain 0.05 on grass, pulsing on curbs),
  wind (high-pass 2500 Hz, gain `0.025 * r^2`).
- **Clean lap** ding: a short rising pair.
- Curb buzz and bump buzz as in sections 4 and 6.

## 12. Things that stay the same

- Multiplayer messages, rates and the budget. Body motion for remote karts is
  derived from their existing motion samples.
- Item effects and odds, spin-out time (1 s), coins, pads, ramps, slipstream
  rules, Grand Prix scoring and awards.
- Toddler Assist: autopilot, invincible, bubble, "just hold GAS".
- Robot difficulty stays near today's (about 3/10 for kids): robots use the
  same physics and their skill factors are retuned if lap times move.

## 13. Testing

1. `next build` passes.
2. Test URL flags: `?autodrive` holds gas (existing). New `&testdrive=N` makes
   my kart drive itself with digital (on/off) steering like a person pressing
   keys, with steering help N (0, 1, 2); `&testdrive=t` uses Toddler. A
   `window.__bk` object exposes lap times, grass time and help.
3. Solo race on every track at each help level: no stuck karts, lap times
   and grass time recorded before and after.
4. Robot lap times within 5% of 2.0 on every track.
5. Look at 3D and 2D screenshots during drifts, boosts and landings.
