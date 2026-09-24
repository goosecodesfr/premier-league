# Setting up your league

This gets the game online for you and your friends, running 24/7, for free. It takes about 30–45 minutes the first time. You don't need a credit card for any of it.

## How it fits together

| Piece | What it does | Service (free plan) |
| --- | --- | --- |
| Database | Stores everything: clubs, players, fixtures, results, transfers, messages | **Supabase** |
| Website and game server | The app your friends open on their phones, plus the game logic | **Vercel** (Hobby) |
| League clock | Calls the game every 15 minutes so matches kick off, bots trade, injuries happen and alerts go out, even when nobody is online | **cron-job.org** |
| Code storage | Vercel deploys the game from here | **GitHub** |

Nobody needs to have the app open for the league to run. Every 15 minutes the clock asks the server to "do whatever is due". Matches get played, results and news get written, and push notifications (plus optional Discord or Telegram posts) go out to everyone.

You'll need four free accounts: [GitHub](https://github.com/signup), [Supabase](https://supabase.com/dashboard/sign-up), [Vercel](https://vercel.com/signup) (sign up with your GitHub account, it's easier) and [cron-job.org](https://console.cron-job.org/signup).

---

## Step 1: Create the database (Supabase)

1. In the Supabase dashboard, click **New project**.
2. **Name:** anything, for example `football-league`.
3. **Database password:** click *Generate a password* and **save it somewhere**, because you'll need it in a minute. (A password with only letters and numbers avoids problems later. If yours has symbols like `@ # / ? %`, generate a new one.)
4. **Region:** pick the one closest to you and your friends. **Frankfurt (eu-central-1)** is the default this project expects. If you pick another region, see the region note in Step 3.
5. Click **Create new project** and wait a minute or two while it starts.
6. When it's ready, click the **Connect** button at the top of the project page.
7. Under **Connection string**, choose **Transaction pooler** (it uses port **6543**). Copy the URI. It looks like this:

   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```

8. Replace `[YOUR-PASSWORD]` (square brackets included) with the password from step 3. This full string is your **`DATABASE_URL`**. Keep it private.

You don't need to create any tables. The game sets up the database itself the first time it starts.

> Don't use the "Direct connection" string. It only works over IPv6, and Vercel can't reach it.

## Step 2: Put the code on GitHub

Unzip the project somewhere on your computer, then do **one** of the following.

**Option A: GitHub Desktop (no command line)**

1. Install [GitHub Desktop](https://desktop.github.com/) and sign in.
2. Choose **File → Add local repository…** and select the unzipped `ffm` folder. When it says the folder isn't a repository, click **create a repository**, then **Create repository**.
3. Click **Publish repository**. Keeping it **private** is fine.

**Option B: command line**

```bash
cd ffm
git init && git add -A && git commit -m "Fantasy Football Manager"
# create an empty private repo on github.com first (no README), then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main && git push -u origin main
```

(GitHub's browser upload is limited to 100 files at a time, and this project has more than that. Use one of the two options above.)

## Step 3: Deploy the game (Vercel)

1. On [vercel.com/new](https://vercel.com/new), find your repository and click **Import**.
2. **Framework Preset:** leave it as **Other**. Don't change the build or output settings, because `vercel.json` already has them.
3. Open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase string from Step 1 |
   | `APP_SECRET` | a long random password, 30+ letters and digits (a password manager's generator is ideal). **Save it**, because you'll use it twice more. |

   *Region note:* if your Supabase project is **not** in Frankfurt, add a third variable, `FUNCTION_REGION`, so the game server runs next to your database: `lhr1` for London, `dub1` for Ireland, `cdg1` for Paris, `iad1` for US East.

4. Click **Deploy** and wait about 2 minutes.
5. When it finishes, you get a web address like **`https://your-project.vercel.app`**. That's your game. (You can change the name under *Settings → Domains*.)

If you add or change environment variables later, go to **Deployments → ⋯ → Redeploy** so they take effect.

## Step 4: Create the league

1. Open your `https://…vercel.app` address. The first visit takes you to **Create your league**.
2. **Setup key:** paste your `APP_SECRET`. Pick a league name and your time zone.
3. **Schedule:** choose which days league matches are played, the kick-off time, the Europe night, the cup day, and how long before kick-off team sheets lock. Pick how sharp the bot managers are. The defaults (two league days a week) make a season last about five months.
4. **Your account:** choose a username and password. You're the league admin.
5. You'll see an **invite code and link**. Copy the link, because this is what your friends use to join. (It works 25 times. You can make more under *Club → Settings → League admin → Invite friends*.)
6. Pick your club.

**Don't start the season yet.** Until you do, the league is in **pre-season**, and the transfer window is open while your friends join and bots trade.

## Step 5: Start the league clock (cron-job.org)

1. Sign in to [console.cron-job.org](https://console.cron-job.org/) and click **Create cronjob**.
2. **Title:** `League clock`
   **URL:** `https://your-project.vercel.app/api/cron/tick`
3. **Execution schedule:** *Every 15 minutes*.
4. Open the **Advanced** tab. Under **Headers**, add:
   - Key: `Authorization`
   - Value: `Bearer YOUR_APP_SECRET` (the word `Bearer`, one space, then your secret)
5. Save it. Use **Test run**, which should answer **200** with `{"ok":true,"data":{"accepted":true,…}}`. A **403** means the header value is wrong.
6. Check in the app: go to **Club tab → Settings → League admin**. **Clock last ran** should show a few minutes ago.

The server answers cron-job.org right away and finishes the work in the background (up to 5 minutes), so cron-job.org's 30-second timeout is never a problem.

**Optional backup clock (GitHub Actions).** The repo includes `.github/workflows/tick.yml`, which also calls the clock every 30 minutes in case cron-job.org ever stops. To turn it on, go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret** and add `APP_URL` (e.g. `https://your-project.vercel.app`) and `APP_SECRET`. Running both is harmless, because only one clock can work at a time and jobs that are already done are skipped.

**Also:** every time someone opens the app and the clock hasn't run for over 10 minutes, the visit nudges it. So even if both schedulers stop, the league catches up the next time anyone looks.

## Step 6: Invite your friends

Send them the invite link, which looks like `https://your-project.vercel.app/register?code=ABCD2345`. Each friend:

1. Opens the link, creates an account, and **picks a club**. Clubs are first come, first served. Every club nobody picks is run by a bot manager.
2. Installs it like an app:
   - **iPhone / iPad** (iOS 16.4 or newer): open the link in **Safari** → tap **Share** → **Add to Home Screen**. Then open the game **from the new home-screen icon**. On iPhone, notifications only work from the home-screen app.
   - **Android:** in Chrome, tap **⋮ → Install app** (or *Add to Home screen*).
   - **Computer:** it works in any browser. Chrome and Edge also show an install icon in the address bar.
3. Taps **Enable** on the notification prompt on the Home screen, or goes to *Club → Settings → Notifications*. They'll get alerts for team-sheet deadlines, results, bids for their players, injuries and news.

## Step 7: Transfer window and kick-off

- In **pre-season**, everyone can scout, bid, negotiate and sell. Bot managers are active too. They make and answer bids, sell unwanted players, and sign free agents.
- When everyone has joined, the admin taps **Start the season** (on Home, or in *League admin*). Fixtures are generated, and the first matchday is at least two days away, so there's still time to sign players.
- Before each match, managers set their line-up and tactics before the deadline. Anyone who forgets gets a team picked by their assistant.
- Matches are simulated at kick-off by the clock. Results, match reports, ratings and a replay appear right away, and everyone gets notified.
- Through the season you'll see injuries, suspensions, form swings, bot managers getting sacked, sponsorship and board events, a mid-season transfer window, cup runs and European nights.
- At the end of the season there's an awards and review screen, promotion and relegation, and an automatic pre-season before the next season starts.

## Optional: post to your group chat

In *League admin → Group chat*, paste a **Discord webhook URL** (Discord server settings → Integrations → Webhooks → New Webhook → Copy URL) or a **Telegram bot token and chat id** (create a bot with @BotFather and add it to your group). Results, big transfers and a weekly digest get posted there.

---

## Staying within the free plans

- **Supabase free plan:** a 500 MB database. A league uses roughly 60–100 MB in its first season, and the game tidies up old logs every week. *League admin* shows the current size. Supabase pauses free projects after a week with little database activity. The 15-minute clock counts as activity, so this shouldn't happen. If it ever does, open the Supabase dashboard and click **Resume project**, and nothing is lost.
- **Vercel Hobby:** free for personal, non-commercial projects. Each clock run takes a few seconds, well within the limits.
- **cron-job.org:** completely free.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The page says **"DATABASE_URL is not set"** | Add the variable in Vercel (*Settings → Environment Variables*), then **Redeploy**. |
| Setup says **"One more step"** | `APP_SECRET` is missing. Add it and redeploy. |
| Errors about connecting to the database, or timeouts | Make sure you used the **Transaction pooler** string (port 6543), replaced `[YOUR-PASSWORD]` (no brackets left), and that the password has no special characters. If you use another region, set `FUNCTION_REGION`. |
| **Clock last ran** shows "never" or is orange | Check the cron-job.org header: `Authorization` = `Bearer <secret>`. Use *Test run*. You can also press **Run due jobs now** in *League admin*. |
| A job shows as failed in *League admin* | Tap **Retry failed jobs**. If it keeps failing, the error text shows what went wrong. |
| No notifications on iPhone | The app has to be opened from the home-screen icon (iOS 16.4+), and notifications must be allowed in iOS *Settings → Notifications*. |
| A friend forgot their password | *League admin → Members → Reset password* gives them a temporary one. |
| A friend quits | *League admin → Members → Release club*. A bot takes over the club. |
| You want to start over | *League admin → Danger zone → Reset the league* (type RESET). Accounts are kept, and everyone picks a club again. |

## Updating the game later

Any change you push to GitHub is deployed by Vercel automatically. Database changes happen by themselves on the first request after a deploy, and your league's data is kept.

## Running it on your own computer (optional)

You need Node.js 20+ and a Postgres database (a local one, or your Supabase string).

```bash
npm install
cp .env.example .env            # then edit DATABASE_URL and APP_SECRET
export $(grep -v '^#' .env | xargs)
npm run dev                     # API on :3000 + app on http://localhost:5173
# or a production-style build (the clock runs every minute by itself):
npm run build && npm start      # http://localhost:3000
```
