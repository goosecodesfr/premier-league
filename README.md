# Fantasy Football Manager

A web-based football management game for you and your friends. Each of you takes charge of a Premier League club with its real 2026-27 squad. You build a squad in the transfer market, set tactics on a drag-and-drop pitch, and compete over full seasons against each other and against bot managers. That includes the league, the FA Cup, the League Cup and European competitions.

The league runs around the clock. Matches kick off on schedule, bots trade, and players get injured or lose form, even when nobody is online. Everyone gets push notifications for deadlines, results and bids.

**To get your league online for free, follow [SETUP.md](SETUP.md).**

## What's in the game

- **Real world:** 20 Premier League clubs, 16 Championship clubs, 56 European clubs and 186 clubs from the rest of the world, with about 3,400 players whose attributes come from a public ratings dataset, plus generated youth players.
- **Young talents:** around 360 of the best under-21s in the world (researched from Goal's NXGN 2026 list, Football Manager wonderkid lists and scouting sites), at the real clubs they play for, from River Plate and Palmeiras to Ajax and Salzburg.
- **Signature traits:** players carry their real PlayStyles (Finesse Shot, Incisive Pass, Rapid, Press Proven and 30 more, with elite versions). Each one changes specific moments in the match engine, and young players can learn new ones.
- **Match engine:** a possession-by-possession simulation with 18 pitch zones. It covers roles and duties, team and individual player instructions, familiarity with positions, set pieces, in-match triggers, fatigue, injuries, cards, penalties, extra time and shoot-outs. Every match has a report, ratings, a shot map, heatmaps, pass maps, key moments, a replay with commentary, and a "decisions, measured" breakdown of what each side's choices produced.
- **Tactics:** up to five tactics per club. Each has a formation you can drag to reshape, roles and duties, team instructions, per-player instructions, set-piece takers, a plan B and conditional triggers. A live analysis tab scores the set-up (build-up, creativity, pace in behind, box presence, aerial threat, pressing, solidity, set pieces), shows where the team plays with and without the ball, rates every player's fit and flags problems. The pre-match screen shows key individual battles, the tactical match-up, an opposition report and 200-run previews.
- **Players:** a position map with his rating everywhere on the pitch, his best roles, strengths and weaknesses, traits and per-90 numbers.
- **Transfers:** scouting with a knowledge level per player, regional scouting missions for young talent, bids and counter-offers (in public, or in private with a real chance the story leaks to the press), personal terms (wage and contract length), transfer listing, free agents, and transfer windows (pre-season and mid-season).
- **Bot managers:** eight personalities (possession purist, gegenpresser, counter-attacker, cynic, youth developer, big spender, tinkerman, pragmatist). They rotate squads, counter your tactics, trade among themselves and with you, and can get sacked.
- **Club life:** finances and ticket pricing, facilities, staff, sponsorship offers, board vision goals, youth intake, training focus, morale, contracts, player development and retirements.
- **Season cycle:** fixtures on the match days you choose, promotion and relegation, awards, a season review, and an automatic pre-season before the next season.
- **Social:** a news feed, a weekly digest, club profiles, head-to-heads, and optional Discord or Telegram posts.

## How it runs

```
 phones (installable web app, push notifications)
        │  HTTPS
        ▼
 Vercel (free Hobby plan)       ◄── cron-job.org every 15 min: GET /api/cron/tick
   static app + one serverless function (/api/*)   (+ optional GitHub Actions backup)
        │  SQL (transaction pooler)
        ▼
 Supabase Postgres (free plan): everything is stored here, including the job queue
```

- Everything that happens in the world (matches, deadlines, daily and weekly updates, windows, season end) is a row in the `jobs` table with a `run_at` time.
- Each **tick** takes a lease, so only one clock runs at a time, then runs the jobs that are due in order, one transaction per job. Missed ticks simply catch up. Failed jobs are retried and then shown in League admin.
- The cron endpoint replies immediately and keeps working in the background, so cron-job.org's 30-second timeout is never a problem. App visits also nudge the clock if it has been quiet for 10 minutes.
- Web Push uses VAPID keys, which are generated on first run and stored in the database. Notifications are queued during a job and sent only after it commits.

## Repository layout

| Path | Contents |
| --- | --- |
| `packages/engine` | Pure TypeScript game rules: attributes, roles, tactics, team selection, player development, finances, and the match engine (`src/match`). No I/O. |
| `packages/server` | HTTP API (`src/routes`), job runner (`src/jobs`), game systems (`src/game`: matchday, market, bots, competitions, finance, news and more), Postgres access and migrations. Entry points: `vercel.ts` (serverless) and `local.ts` (a plain Node server). |
| `packages/client` | React 19 + Vite PWA: TanStack Query, React Router, Tailwind 4. Screens are in `src/features`. |
| `packages/shared` | Nation data shared by the importer and the client. |
| `data/seed/world-seed.json` | The generated world: clubs, players and competitions. |
| `tools/importer` | Rebuilds the seed from the source data (`npm run seed`). |
| `tools/harness` | Engine calibration runs (`npm run harness`): goals, shots, cards, and home and draw rates against real-world targets. `decisions.ts` measures how much each tactical decision changes results. |
| `scripts/` | Build scripts: Vercel Build Output API, local server bundle, dev runner, one-off tick. |
| `.github/workflows/tick.yml` | Optional backup clock. |

## Commands

```bash
npm install
npm run dev          # API with auto-reload (:3000) + Vite dev server (:5173, proxies /api)
npm run build        # client build + server bundle (dist/server/local.mjs)
npm start            # production-style local server on :3000; runs the clock every minute
npm run tick         # run due jobs once against DATABASE_URL
npm run typecheck    # all packages
npm test             # engine tests
npm run harness      # match-engine calibration report
npx tsx tools/harness/decisions.ts 400   # points per game gained or lost by each tactical choice
```

Configuration is through environment variables. See [.env.example](.env.example). The only two you need are `DATABASE_URL` and `APP_SECRET`.

## Notes

- Any Postgres works (Supabase, Neon, or your own). The schema is created and migrated automatically on first request.
- Leagues created from an older version are upgraded in place on the next clock tick (new clubs, young talents, traits), without touching results, squads or finances.
- The first account is created through `/setup` using `APP_SECRET`. Everyone else joins with an invite code.
- Player ratings are derived from a community ratings dataset and converted to the game's own attribute scale. Club crests are simple generated badges, not official logos.
