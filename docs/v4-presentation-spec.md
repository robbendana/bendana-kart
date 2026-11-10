# Bendana Kart 4.0 presentation spec

Companion to `v4-presentation-plan.md`. This is the "how": files, data shapes
and the rules each piece follows.

## Files

| File | Role |
| --- | --- |
| `app/world3d.ts` | `World3D`: everything static or ambient in the 3D scene |
| `app/fx3d.ts` | `SkidMarks`, `Fireworks`, `PodiumStage` |
| `app/view3d.ts` | Owns the renderer, karts, items and camera; creates the above |
| `app/ui.tsx` | `HomeBackdrop`, `Logo`, `Sheet`, `QrCode`, `TrackThumb` |
| `app/qr.ts` | `qrMatrix(text)`, `qrPath(matrix)` |
| `app/players.ts`, `app/family-ui.tsx` | Saved racers, stats and leaderboard (not part of this change; the screens here host them) |
| `app/voice.ts` | `say(text)`, `setVoiceOn`, `setVoiceMuted`, `unlockVoice` |
| `app/audio.ts` | Music data and synth, new UI sounds, `musicDebug()` |
| `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.tsx`, `app/icon-512.png/route.tsx`, `app/app-icon.tsx` | Install icon and manifest |
| `app/page.tsx` | Screens, panels, HUD, race-loop hookup |

## The 3D world

`page.tsx` hands `View3D.setTrack` a `SceneTrack`:

```ts
type SceneTrack = {
  xs, ys, tx, ty: Float32Array; n: number;   // centre line and tangents
  halfW: number; worldW: number; worldH: number;
  theme: number; name: string;
  colors: { grassA, grassB, edge, outside, road, roadInner, curbA, curbB, line, dust };
  scenery: { x, y, e, size, big }[];          // same list the 2D map uses
  sky, horizon, hills: string; night: boolean;
  ramps?: { x, y, a, len, width }[];
  pads?: { x, y, a, len, width }[];
  hazards?: { x, y, a, r, kind }[];           // optional, drawn if present
};
```

Coordinates: world x is three.js X, world y is three.js Z, up is Y. A heading
`a` points along `(cos a, 0, sin a)`.

- **Scenery** keeps the emoji list as its data. `EMOJI_MODELS` maps each
  emoji to a model builder; an unknown emoji falls back to an upright sprite,
  so adding a track never breaks.
- **Models** are merged box, cone and cylinder parts with colours baked into
  the vertices. Each kind is one `InstancedMesh` (one draw call per kind).
- **Layering** on the ground uses `polygonOffset` and `renderOrder`
  (ground, road, paint, pads, hazards), never tiny height gaps, so nothing
  flickers at a distance.
- **Low power** (`lowPower: true` on touch devices): fewer weather particles,
  smaller crowd, no anisotropy. Pixel ratio stays capped at 1.5.
- `World3D.update(now, dt, camera, { countdownLeft, excite })` drives the
  start lamps, crowd, weather, balloons, pads and lava.

## Podium

`FrameView.podium` is `string[] | null`: the top three ids in order. While it
is set, `View3D`:

1. places those karts on `PodiumStage.spot(place)` and hides the rest,
2. uses the stage camera (on wide screens it is shifted left so the results
   panel on the right does not cover the winners; on tall screens it aims low
   so the stage sits in the top half),
3. runs fireworks.

`page.tsx` sets it 1.8 s after the race closes, switches the music to the
results tune (`startMusic(-2)`), and uses the 3D view even for players on the
top-down camera. If WebGL is not available the results panel still shows over
the 2D map.

## Screens

`Screen` is still `'menu' | 'lobby' | 'race'`. Menus add a `Panel`:

```ts
type Panel = null | 'garage' | 'solo' | 'family' | 'settings' | 'help';
```

A panel is a `Sheet` (full-screen, slides up, Esc or the back arrow closes).
Panels render over both the home screen and the lobby. Changing `screen`
closes any panel. Opening the game from an invite link (`?room=CODE`) opens
the Family panel with the code filled in.

The race has a **Menu** button (and Esc): keep racing, camera, sound, and a
two-tap leave. The race keeps running underneath; nothing pauses, because in
a family race nobody else would be paused.

## Join by camera

`shareUrl` is `origin + pathname + ?room=CODE`. `qrMatrix` encodes it in byte
mode at error level L, picking version 1 to 5 by length (up to 106
characters) and the best of the 8 masks. Longer links return `null` and the
square is simply not shown; the code and the invite button still work. The
encoder is checked in development by decoding its output with a QR reader.

## Storage

Everything is `localStorage`, per browser:

| Key | What |
| --- | --- |
| `bendana-kart-profile` | name, racer, kart, paint, track, laps, cup, camera, assists, sound |
| `bendana-kart-prefs` | `{ voice: boolean }` |
| `bendana-kart-family` | saved racers, stats and the leaderboard (see `players.ts`) |

The profile is only written after it has been read once (`profileLoaded`),
so a slow start can never overwrite a saved profile with defaults.

Stats are recorded by `players.ts` (`applyRace`). The screens only read
them: `totals(rec)` and `levelOf(stars)` for the home chips, `rec.b` (best
race time by `track:laps`) for the race picker, and the `Gain` from the last
race for the podium strip. The stats and leaderboard sheets (`FamilyPanel`)
are a second, independent layer that opens above the menu panels, so "Add
racer" works from inside the Garage.

## Voice

`say(text)` cancels whatever is being spoken and says the new line, so
callouts never queue. The same line is not repeated within 2.5 s. Banners
are spoken with emoji stripped ("🏁 FINAL LAP!" becomes "Final lap!",
"LAP 2/3" becomes "Lap 2 of 3"); banners longer than 40 characters are
skipped. Speech needs a tap first on phones: every menu tap calls
`unlockVoice()`.

## Music

`TrackDef` gains `chordsB`, `leadB`, `scale`, `arp` and `arpVol`. Tracks are
indexed `-2` results, `-1` menu, `0..4` races. Lead and arpeggio feed an echo
(`0.27 s`, feedback `0.28`, low-passed). Every fourth bar ends with a short
drum fill.

## Checks

- `npx tsc --noEmit` and `next build` pass.
- Screens checked at 390×800 (phone), 800×380 (phone on its side),
  1024×768 (tablet) and 1280×760 (desktop).
- A full solo race reaches the podium with the results tune playing and the
  racer's stats updated.
- Two to five local tabs (`?net=local`) join one room, ready up, race and
  return to the lobby.
