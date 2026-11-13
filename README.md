# Splitstorm

A browser game about popping bouncing balls that split when you hit them. One to four
players, on one keyboard or online, peer to peer. It's a static site (GitHub Pages) plus
a tiny optional log collector on Cloudflare.

Live: https://jonsploder.github.io/bubble-trouble-online/

## Running it

```bash
npm install
npm run dev        # http://localhost:5173  (?play=hard-8 jumps straight to a level)
npm run build      # static site in dist/; pushing to main deploys it via GitHub Actions
```

Controls: arrows + Space (player 2 on one keyboard: A / D + W), Esc to pause.
On a phone: left thumb slides to move, right thumb holds to fire.

## Game modes

Picked on the menu, or by the host in an online lobby.

| Mode | Rules |
|---|---|
| Classic | Everyone shoots. |
| One Gun | Only one player, picked at random, can shoot; they carry a glowing gold harpoon. When they're hit, the gun passes to a random player who is still standing. |
| Protect the VIP | One random player (wearing a crown) can't shoot. If the VIP is hit, everyone still standing loses a life and the attempt is over. |
| Versus | Each player gets their own lane (the level set is ignored; rounds are generated). When you pop a ball, its first piece stays and the rest drop into random rivals' lanes. Clear your lane first, or be the last one standing, to win the round. First to 3 rounds wins. |
| Tethered | Players are roped to their neighbours and can't get more than 240 px apart. |
| Revive | The team shares 3 lives. A hit player waits in a small circle for 15 seconds; a teammate standing in it for 1.5 s brings them back. If time runs out, the whole team goes down and loses a life. Every player must be up for a level to count as cleared. |

Except in Revive, each player has their own 3 lives. A hit sits you out until the level is cleared or
restarts; the level restarts once everyone is down. Single-player games are always Classic.

## Level sets

- **Campaign** (16) and **Hard mode** (13): the main game, then gravity flips, armoured balls, wind, spin and moving blocks.
- **Twists** (9): portals (a ball entering the orange one comes out of the blue one, and the other way round), balls that split into 3 or 4, levels where you run too fast, and levels whose drops are curses: the lightning **haste** pickup (8 s of uncontrollably fast running) and the beam / pulse guns, which pop far more than you want.

The pause screen lists every mode's rules. The results screen hands out awards: **Most reckless** (time spent within 16 px of a ball), **Closest shave** (smallest gap to a ball that didn't hit you) and **Sharpshooter** (pops per shot).

## How online play works

- **Finding each other.** The host's browser registers a 4-letter room code with the free
  public PeerJS broker. Guests ask the broker for that code, the browsers exchange
  connection details through it, and from then on they talk directly (WebRTC). No game
  server, no port forwarding. Guests connect to the host and to each other; if two guests
  can't reach each other directly, their inputs are passed along by the other players.
- **Rollback netcode** (`src/rollback.ts`). Only key presses are sent. Every browser runs
  the whole game itself; the game (`src/sim.ts`) is deterministic, so the same inputs give
  the same result everywhere. Your own presses apply after a short input delay; other
  players' presses are predicted and corrected when they arrive. Clocks are kept in step by
  running a few percent faster or slower, never by skipping frames, and the game only
  freezes after about a second of silence. Checksums catch any desync.

## Logs, stats and the report

When an online game ends, every player's browser uploads its own session log. At the end
of any game (online or not) player 1 uploads a record of each attempt at each level. Both
go to the Worker in `worker/` (Cloudflare free plan, Workers KV). Logs hold timings, key
presses and packet arrival times; no IP addresses or names. The dev server never uploads.

```bash
npm run fetch-traces       # download new logs into traces/ and level stats into stats/levels/
npm run report             # build report/index.html (add -- --sweep to compare netcode settings)
npm run replay             # replay every logged session through today's netcode, in the terminal
npm run replay -- --sweep  # same, trying alternative netcode settings
```

`fetch-traces` needs `.env.local` (not in git) containing `TRACE_READ_KEY=...`; the
collector's address comes from `.env`.

The report has two parts:

- **Online play**: per game version and player count, the link quality and what players
  actually experienced: time frozen, time slowed, and how often other players were drawn
  visibly in the wrong place (more than 8 px off). A final row replays every recorded
  session through today's netcode, which shows whether a change would have helped.
- **Level difficulty**: per level, the number of attempts, the share cleared, the share
  cleared first try, attempts per clear, median clear time, and solo vs group. Levels that
  are cleared first time in at least 90% of games are flagged "too easy?". Levels cleared on
  fewer than 20% of attempts are flagged "too hard?". Fewer than 5 attempts is "little data".

### Why replays stay useful

A session log records the *conditions*, not what the netcode did with them: when each
player's frames happened, what they were holding, and when each packet from each other
player arrived (or didn't). `scripts/tracelib.ts` rebuilds the real links from that,
aligning the players' clocks, and runs today's netcode over them. So old logs remain a
valid test for new netcode, and the library of logs grows into a regression suite. The
limit is that if the game rules or levels change, the replayed *game* plays out
differently, though the network conditions are still real.

### Tuning the netcode

The knobs are in `tuning` at the top of `src/rollback.ts`. A good loop:

1. `npm run fetch-traces && npm run replay -- --sweep` (or `npm run report -- --sweep`).
2. Change one knob, check `npm run nettest` (synthetic networks: loss, outages, 4 players,
   missing links) still passes, ship, and compare live numbers in the next report.

What the data has shown so far (Sydney–Japan, about 63 ms each way, under 1% loss):

| Change | Effect |
|---|---|
| Synchronised start and clock sync by speed (v5) | Freezes went from frequent to 0% |
| Input delay 2 → 3 frames (v6+) | Other player visibly off: 5.8% → 2.0% of frames (live) |
| Input delay 4 | Replays suggest about 0.7%, at the cost of another 17 ms on your own keys |
| Slowdown / clock-sync thresholds | Within a few percent either way; left alone |

Ideas not yet tried:

- **Adaptive input delay**: pick 2–4 frames per game from the measured ping in the lobby.
- **Smarter prediction**: predict "still holding fire" for less long, or predict a
  direction release after a typical hold length.
- **Render-side smoothing**: blend corrections over more frames for small errors and snap
  big ones; tune the 0.4 easing in `render.ts`.
- **Lobby room**: refuse or warn when one player's ping is far worse than everyone else's.

## Tests

```bash
npm run smoke     # a look-ahead bot plays every level: all must be beatable and deterministic
npm run nettest   # 14 simulated network scenarios, 2-4 players
```

`e2e-check.html` (open on the dev server, `?players=4`) runs 2–4 real copies of the game in
iframes: join by link, change settings, play, pause, quit, results, and One Gun.

## The collector (worker/)

```bash
cd worker   # needs Node 20+
npx wrangler deploy
```

It's a standalone Worker on its own `*.workers.dev` address with no routes or domains, on
the free plan only. Going over the free limits makes uploads fail; it does not bill.
Uploads are only accepted from the game's own site, and listing or downloading needs the
secret read key.

## Files

| Path | What |
|---|---|
| `src/sim.ts` | The game rules. Deterministic: same inputs, same result. |
| `src/levels.ts` | All levels as data. |
| `src/rollback.ts` | Netcode. |
| `src/net.ts` | Rooms and peer-to-peer links. |
| `src/main.ts` | Menus, lobby, input, game loop, uploads. |
| `src/render.ts` | Drawing. |
| `scripts/` | Bot test, network tests, replay, report, fetch. |
| `worker/` | Log collector. |
