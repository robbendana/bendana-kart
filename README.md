# Bendana Kart 🏁

A top-down family kart racer for phones, tablets and computers. Up to four
players race each other live from different devices.

- **Karts:** 🏎️ Red Flash, 🦖 Dino Turbo, 🦄 Cosmic Dash, 🦍 Kong Kart, each with its own speed, acceleration and steering.
- **Toddler Assist (🛡️):** the kart steers itself and can't be spun out. Just hold GAS.
- **Items from 🎁 boxes:** 🚀 Turbo Rocket (2 second boost), 🍌 Banana Peel (spins out whoever hits it), 💥 Homing Blast (chases the kart ahead).
- **5 tracks:** 🌻 Sunny Meadow, 🍭 Candy Canyon, ⛄ Frosty Peaks (slippery ice), 🌵 Dusty Dunes, 🌋 Volcano Loop. The host picks the track for everyone.
- **Drifting:** hold Shift while turning (on touch screens, just keep holding a turn). Blue, then orange, then purple sparks; let go for a mini-turbo.
- **Rocket start:** press gas just before GO. Too early and you stall.
- **Polish:** lap and "Final lap!" banners, wrong-way warning, auto-respawn when you're lost off the road, screen shake, speed lines, engine sound, confetti, and game controller support.
- **Practice:** race three robot karts on one device.
- **Multiplayer:** one player taps **Host Race** and gets a 4-letter code. Everyone else taps **Join Race** and types it in.

## Controls

| Device | Drive | Steer | Item |
| --- | --- | --- | --- |
| Keyboard | W / ↑ gas, S / ↓ brake | A D or ← → (Shift to drift) | Space |
| Touch | GAS / BRAKE pedals (bottom right) | ◀ ▶ (bottom left, hold to drift) | 🎁 button or the item box at the top |
| Gamepad | A or right trigger, B or left trigger to brake | Left stick or d-pad (bumpers to drift) | X or Y |

## How multiplayer works

Multiplayer runs on Supabase Realtime (broadcast and presence) in the OgaVox
Supabase project. It never reads or writes any database table. Rooms are
named `bendana-kart:room:<CODE>`.

Each kart sends its position a few times a second (only while it's moving),
and other screens smooth the movement in between. Supabase counts each
broadcast once when sent plus once per receiver, so a 3-player race uses about
45 messages a second. The free plan's 2 million messages a month covers
roughly 12 hours of 3-player racing.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` override the
built-in OgaVox URL and publishable key if set.

## Run it

```bash
npm install
npm run dev
```

The whole game lives in `app/page.tsx`.
