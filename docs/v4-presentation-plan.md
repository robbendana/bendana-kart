# Bendana Kart 4.0 presentation plan: a world, a show and a front door

Version 3.0 made the driving feel right. This version leaves the driving alone
and works on everything around it: what the world looks like, what a race
sounds like, how you get into a race, and what happens when it ends. (A
sister change, on its own branch, covers gameplay, robots and netcode.)

The rules are the same as always: an original game, no downloaded art or
sound, the same architecture, Realtime channels only, 5 players on 5 devices,
and easy for a 4-year-old by default.

## What was wrong

A walk through the 3.0 game as each family member:

1. **The world was flat.** Trees, houses and mountains were emoji painted on
   upright cards, and the road was a painted picture on the ground. It read as
   a diorama, not a place.
2. **Races had no ceremony.** The start was a number over a grid. The finish
   was a dark page of text that covered the karts. Nobody stood on a podium.
3. **The front door was a form.** The first screen was a long scroll of every
   setting at once: name, 16 racers, 6 karts, paints, cups, tracks, laps,
   assists, sound, then three buttons at the very bottom. A 4-year-old could
   not find "go".
4. **Joining meant typing.** A second device needed someone to read a code
   and type it, which the two youngest racers can't do.
5. **Nothing was kept.** Win a cup, close the tab, and it was as if it never
   happened.
6. **Words everywhere.** "Final lap!", item names and results were text only,
   for players who can't read yet.
7. **Music looped fast.** Each tune was one 8-bar phrase, forever.

## What changed

### 1. A built world (app/world3d.ts)

Every track is now made of real low-poly models built in code: trees, pines,
palms, cacti, rocks, houses, cabins, snowmen, lollipops, cupcakes, donuts,
igloos, crystals, castles, tents, camels, a volcano. A proper road surface
with curbs, a start line and painted grid boxes; a start gantry with the
track's name and three lamps that count down; grandstands with a bobbing
crowd; chevron boards on the outside of every sharp bend; fences; mountains;
a sky dome with a sun and drifting clouds; hot-air balloons; and weather that
fits each place (petals, sprinkles, snow, dust, embers). Boost pads animate,
item boxes are spinning "?" cubes, and lava glows.

Everything is instanced and vertex-coloured, so the whole track is a few
dozen draw calls and stays smooth on a tablet. Low-power devices get fewer
weather particles and no anisotropic filtering.

### 2. A show at both ends (app/fx3d.ts)

- **Start:** a title card names the track (and the cup round) during the
  fly-in, and the gantry lamps count down with the beeps.
- **During:** tyres leave skid marks when drifting, and a round speed dial
  shows speed and glows on a boost.
- **Finish:** the victory lap stays in view behind a small card.
- **Podium:** the top three karts stand on a 3D winners' stage with
  spotlights, fireworks and confetti while the results slide in beside or
  below it. Everyone still gets an award.

### 3. A front door (app/page.tsx, app/ui.tsx)

The home screen is the logo, your racer on a turntable, and two big buttons:
**PLAY** and **FAMILY RACE**. My stats, Leaders, Garage, Settings and Help
are five small buttons underneath. Everything else moved into panels that slide over
the home screen:

- **Garage:** who's racing and your name, then Racer, Kart and Paint tabs under a live
  turntable with the stat bars.
- **Pick your race:** one race or a cup, tracks shown as little maps drawn
  from the real track shape with your best time, laps, and one START button.
- **Family race:** join a room (code) or start a room.
- **Settings:** Toddler Assist, steering help, sound, voice, camera, full
  screen.

### 4. Join by camera (app/qr.ts)

The lobby shows the room code, a "Send invite" button (the device's share
sheet) and a QR square. Point a phone or tablet camera at the host's screen
and it opens the game with the code filled in and one big "Join room" button.
The QR encoder is our own small file (no library, nothing sent anywhere).

The lobby itself is now five seats with faces, a HOST and READY badge, open
seats drawn as dashed boxes, and a bar at the bottom with the one button you
need. A sound plays when someone joins or leaves.

### 5. Saved racers on the front door

The saved racers, stats, stars, badges and family leaderboard come from
`app/players.ts` and `app/family-ui.tsx` (their own change). This version
gives them a home in the new screens rather than a second system:

- the home screen shows the active racer on the turntable with their level
  and stars, and a row of saved racers to switch between when the device
  holds more than one;
- **My stats** and **Leaders** are two of the small home buttons;
- the Garage opens with "Who's racing?";
- the race picker shows the active racer's best time on each track;
- the podium shows the stars, level-ups and badges just earned, and a button
  to the family leaderboard.

### 6. Spoken callouts (app/voice.ts)

The browser's built-in speech says the short things out loud: "Final lap!",
item names, "Back on track!", "You win!". It can be turned off in Settings
and follows the sound switch. If a browser has no speech, nothing happens.

### 7. Longer music (app/audio.ts)

Every tune has a second section, an arpeggio line, an echo and a drum fill,
so the loop is twice as long and less tiring. There is a new results tune for
the podium, menu taps make small sounds, and fireworks crackle.

### 8. An app icon (app/manifest.ts, app/icon.svg, app/apple-icon.tsx)

"Add to Home Screen" now gives a Bendana Kart icon that opens full screen
with no browser bars, which also stops little thumbs from hitting the address
bar.

## What did not change

Driving, items, robots, netcode, message rates and the room protocol are
untouched by this change. Top-down camera still works and still uses the 2D
renderer; only the podium borrows the 3D stage.
