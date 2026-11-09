# Bendana Kart 🏁

A family kart racer for phones, tablets and computers. Up to five players
race each other live, one per device.

## What's new in 2.0

- **Smooth multiplayer:** karts send a short history of their motion in each
  message, and other screens play it back a moment behind with smooth curves
  and prediction, so karts glide instead of jumping. Every device shares the
  host's race clock, so the start lights turn green at the same moment
  everywhere.
- **Reliable lobby:** a refresh, a locked phone or a dropped Wi-Fi rejoins the
  same room and the same race on its own. A missed start message no longer
  strands anyone. Everyone taps **I'm Ready!** and the race starts by itself.
- **Boost pads, jump ramps and tricks:** tap ⭐ (or Space) in the air for a
  trick and a boost when you land.
- **Coins:** each one adds a little top speed (up to 10). Getting hit drops some.
- **7 items with a spinning roulette:** 🚀 Turbo Rocket, 🚀 Triple Rockets,
  🍌 Banana Peel, 🍌 Triple Bananas, 💥 Homing Blast, 🫧 Bubble Shield and
  💤 Snooze Cloud (slows everyone ahead, only for karts at the back).
- **Slipstream:** stay right behind another kart for a speed boost.
- **Cups:** 🌼 Sunshine Cup and 🔥 Lava Cup, 4 races each, with points.
- **Podium and awards:** every racer gets an award, so every kid wins something.
- **Music and sound:** a tune for each track that speeds up on the final lap,
  plus sound effects and phone vibration.
- **Easier to read:** colored place number, lap dots, a race strip with
  everyone's face, start lights and a "seconds left" timer once someone finishes.
- **Emotes** in the lobby and during the race.

- **16 racers:** 🏎️ Red Flash, 🦖 Dino Turbo, 🦄 Cosmic Dash, 🦍 Kong Kart, 🤖 Robo Racer, 🐶 Rocket Pup, 🐱 Kitty Comet, 🐰 Bunny Hop, 🐢 Turbo Turtle, 🐧 Penguin Slide, 🐉 Blaze Dragon, 👽 Zippy Alien, 🦊 Foxy Flame, 🐼 Panda Pop, 🦁 Lion Roar and 🐝 Sparkle Bee, each with its own speed, acceleration, steering and grip.
- **6 kart bodies:** Classic, Speedster, Monster Truck (bounces over grass), Jet Racer, Mini Buggy and Bubble Car. They change the look and the stats.
- **10 paint jobs** to color your kart.
- **Steering help (🎯), on by default:** the kart follows the road by itself, and ◀ ▶ nudge it to dodge or grab a box. It also eases off the gas before sharp bends, and grass and ice are gentler. Pick Lots, A little, or Off on the menu. Practice robots are slower when help is on.
- **Toddler Assist (🛡️):** the kart steers itself and can't be spun out. Just hold GAS.
- **5 tracks:** 🌻 Sunny Meadow, 🍭 Candy Canyon, ⛄ Frosty Peaks (slippery ice), 🌵 Dusty Dunes, 🌋 Volcano Loop. The host picks the track for everyone.
- **3D cameras:** chase cam (default), close cam, driver's seat, a 360° cam you drag around your kart, and the classic top-down view. Hold 👀 (or Q) to look behind you. Each race opens with a fly-in over the start line, and the camera circles your kart when you finish.
- **Drifting:** hold Shift while turning (on touch screens, just keep holding a turn). Blue, then orange, then purple sparks; let go for a mini-turbo.
- **Rocket start:** press gas just before GO. Too early and you stall.
- **Polish:** lap and "Final lap!" banners, wrong-way warning, auto-respawn when you're lost off the road, screen shake, speed lines, engine sound, confetti, and game controller support.
- **Practice:** race four robot karts on one device.
- **Multiplayer:** one player taps **Host Race** and gets a 4-letter code. Everyone else taps **Join Race** and types it in.

## Controls

| Device | Drive | Steer | Item | Camera |
| --- | --- | --- | --- | --- |
| Keyboard | W / ↑ gas, S / ↓ brake | A D or ← → (Shift to drift) | Space (a trick in the air), H to honk | C to switch, hold Q to look back |
| Touch | GAS / BRAKE pedals (bottom right) | ◀ ▶ (bottom left, hold to drift) | 🎁 button or the item box at the top | 🎥 button at the top, hold 👀 to look back, drag to spin the 360° cam |
| Gamepad | A or right trigger, B or left trigger to brake | Left stick or d-pad (bumpers to drift) | X | Select or Start to switch, hold Y to look back |

## How multiplayer works

Multiplayer runs on Supabase Realtime (broadcast and presence) in the OgaVox
Supabase project. It never reads or writes any database table. Rooms are
named `bendana-kart:room:<CODE>`.

Each kart records its motion 20 times a second and sends a batch of those
samples a few times a second. The more players, the less often each sends, so
the room stays near 66 messages a second, well under the free plan's 100.
Supabase counts each broadcast once when sent plus once per receiver. The free
plan's 2 million messages a month covers about 8 hours of 5-player racing.

The full design is in [docs/v2-master-plan.md](docs/v2-master-plan.md) and
[docs/v2-master-spec.md](docs/v2-master-spec.md).

### Testing multiplayer on one computer

Add `?net=local` to the address to use a fake network between tabs of the same
browser instead of Supabase. `&lag=150&jitter=60&loss=0.05` adds delay, jitter
and lost messages. `&netdebug` shows the network numbers during a race.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` override the
built-in OgaVox URL and publishable key if set.

## Run it

```bash
npm install
npm run dev
```

The game lives in `app/page.tsx`, with the network code in `app/net.ts`, the
3D view in `app/view3d.ts` and the music and sound in `app/audio.ts`.
