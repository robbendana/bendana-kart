# Bendana Kart 3.0 driving plan: smooth, exciting, joyous

Version 2.0 added the cup, points, music, items and smooth multiplayer. This
version touches one thing only: **how it feels to drive**. No new modes, no new
buttons, no new menus. Everything here happens inside the existing GAS, BRAKE,
steering, item and drift controls, the existing Steering help picker (Lots, A
little, Off) and Toddler Assist.

## What the best racing games get right

These are the practices that show up again and again in the racing games that
people still love decades later: the great kart racers, the arcade racers with
famous drifts and boosts, and the sim racers with famous assist systems. We
take the practices, never names, characters or art.

1. **Steering that answers at once but never twitches.** Input is shaped: a
   tap gives a small correction, holding gives a full turn, letting go
   recentres faster than turning in. Steering gets a little calmer at top
   speed. Analog sticks get a response curve and a dead zone.
2. **Grip you can feel, and slides you can control.** Karts carry a little
   sideways slip that the body shows, so you can see the car working. Drifts
   start with a small hop, the body angle follows how hard you steer (tighter
   or wider), and sparks change colour as the boost charges.
3. **Speed you feel in your stomach.** Field of view widens and the camera
   pulls back as you go faster, wind streaks appear near top speed, the engine
   and wind sound rise, and every boost lands with a punch (an FOV kick, a
   shove forward and a whoosh) that fades out instead of cutting off.
4. **A camera that is a spring, not a rod.** It follows the direction you are
   actually travelling, swings out in drifts so you see the kart sideways,
   looks a little into the turn, dips on landings, and shakes with smooth
   noise rather than random jitter. Every smoothing step is frame-rate
   independent, so 60, 90 and 120 Hz screens feel the same.
5. **Forgiving edges.** The curb is a warning, not a punishment: it rumbles
   (sound, buzz, tiny shake) before anything slows you. Grass slows you
   gradually the deeper you go, and you get your speed back quickly once you
   are back on the road.
6. **Collisions that bounce, not stick.** Karts bump apart with a springy
   push, keep most of their speed along the bump, wobble a little, and the
   sound matches how hard the hit was.
7. **A body that moves.** Karts roll into turns, pitch back when you
   accelerate and dip when you brake, squash on landing, and the front wheels
   turn with your steering.
8. **Assists that are invisible, graduated and fade as you improve.** The
   best assist systems (driving lines that turn red before a corner, steering
   that keeps you off the edge, automatic braking) come in steps, and players
   turn them down as they get better. We do the same, but automatically and
   gently, so a child gets less help only when they have shown they don't
   need it, and more help again the moment they struggle.
9. **Praise and tiny, timely lessons.** Celebrate clean laps and good drifts.
   Teach one thing at the moment it matters ("Hold a turn to drift!"), rarely,
   with emoji so pre-readers understand.

## The support ladder (scaffolding)

The picker still shows Lots, A little and Off, and Toddler Assist is
unchanged in what it promises: it steers by itself and nothing can spin you
out. Under the picker sits one hidden number, **help** from 0 to 1, that every
assist is scaled by.

| Step | Who it is for | Help |
| --- | --- | --- |
| 🛡️ Toddler Assist | Age 4: just hold GAS | Full autopilot, invincible |
| 🎯 Lots | Age 6, new players | 1.0, easing to 0.7 as they improve |
| 🎯 A little | Age 10, growing players | 0.55, easing to 0.35 |
| 🎯 Off | Adults, confident kids | 0, with only the invisible forgiveness |

What help does, in proportion:

- Follows the road when you are not steering, and adds a pull toward the
  road when you are.
- Eases off the gas before sharp bends (Lots).
- A soft cushion near the edge that turns outward drift back toward the road.
- Less grass slowdown and more grip on ice.
- A **driving line** painted on the road ahead: green where you can go flat
  out, yellow where you should ease off, red where you should brake. It fades
  as help goes down, so the training wheels disappear on their own.
- Automatic tricks on jumps (Lots).
- **Rescue help:** if you go onto the grass or the wrong way during a race,
  help rises a little for a while, then drifts back down.

**Getting better over time.** Each device keeps a small driving score
(stored only in the browser). It goes up when you steer the right way in
bends, stay on the road and drift. As it rises, help eases down inside your
step, drifting unlocks for Lots players on touch screens (with a "🔥 Hold a
turn to drift!" tip), and the menu says "🌟 Ready to try less help?" under the
picker. It never changes your step for you: the grown-up or the child decides.

## Delivery

1. Commit this plan and the spec (`docs/v3-driving-spec.md`).
2. Physics and assists in `app/page.tsx` (input shaping, engine curve, edges,
   drift, collisions, support ladder, driving line, coaching).
3. Camera and kart body motion in `app/view3d.ts`; 2D camera and speed lines.
4. Surface sounds (drift screech, grass rumble, wind) in `app/audio.ts`.
5. Test: `next build`, then automated drives on every track with Toddler,
   Lots, A little and Off to check lap times, time on grass and that robots
   stay about as easy as today (Rob asked for about 3/10 difficulty).
6. One push, one pull request, one preview deploy.

## What does not change

Multiplayer messages, the send rate and the Supabase budget are untouched:
all new motion is derived on each screen. Items, cups, points, music, the
lobby and Toddler Assist's promise stay the same.
