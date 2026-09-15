# Google setup: the parts only you can do

Everything in this file is console work that has no API. There is no supported
way to create an OAuth client ID or configure a consent screen programmatically,
so this is the one genuinely manual session in `docs/coaching-plan.md`.

Budget 30 minutes. You do it once, ever.

Google reorganises this console regularly — the OAuth consent screen moved under
"Google Auth Platform" recently — so treat the click paths as a description of
what you are looking for rather than a literal script. The **settings** are what
matter, and they do not change.

Work through it in order. Step 0 blocks everything else.

---

## Step 0 — decide the domain

**Settled.** Trakt is on Vercel at:

```
https://trakt-fit.vercel.app
```

That is the origin every credential below is registered against. Three origins
get registered in total:

| Origin                         | What it is for                                                        |
| ------------------------------ | --------------------------------------------------------------------- |
| `https://trakt-fit.vercel.app` | Production. What clients use.                                         |
| `http://localhost:8080`        | The dev server (`npm run dev`) — the port is set in `vite.config.ts`. |
| `http://localhost:3000`        | The spike page in step 7, served separately.                          |

Two things about Vercel specifically, both worth knowing before you hit a
confusing failure:

**OAuth will not work on preview deployments.** Vercel gives every branch a URL
like `trakt-fit-git-somebranch-you.vercel.app`, and Google's authorized origins
do not accept wildcards. Only production and localhost can sign in. Test OAuth
on `localhost:8080` or on production, never on a preview.

**If you later add a custom domain**, add it to the authorized origins as a
fourth entry rather than replacing this one. The `.vercel.app` URL keeps working
and anything already connected through it keeps working too.

---

## Step 1 — create the project

**None of this costs anything, and no billing account is needed.** The console
pushes its free trial hard — a banner or full-screen modal offering $300 in
credits and asking for a card. Dismiss it. The trial is irrelevant here.

Billing exists for metered services like Compute Engine and BigQuery. Everything
this setup touches is free with no billing attached:

|                                            | Cost                                              |
| ------------------------------------------ | ------------------------------------------------- |
| Creating a project                         | Free                                              |
| Sheets, Drive and Picker APIs              | Free — Workspace APIs, not metered cloud services |
| Consent screen, OAuth client IDs, API keys | Free                                              |

The quotas are far above what a coaching practice generates. Trakt has no
backend, which is the point of the whole architecture, so there is no server
here to be billed for.

If a billing prompt genuinely blocks project creation rather than merely nagging,
the usual cause is a Google Workspace organization policy requiring billing on
every project — a different problem, fixed by an org admin or by using a
personal account instead. Do not attach a card to get past it.

1. Go to <https://console.cloud.google.com>.
2. Project dropdown in the top bar, then **New project**.
3. Name it `trakt`. No organisation needed.
4. Create, then make sure the project picker shows `trakt` before continuing.
   Everything below applies to the selected project, and doing it in the wrong
   one is the easiest mistake here.

---

## Step 2 — enable three APIs

**APIs & Services** then **Library**. Search for and enable each:

| API                   | What it is for                        |
| --------------------- | ------------------------------------- |
| **Google Sheets API** | Creating and reading the spreadsheet  |
| **Google Drive API**  | Sharing the sheet with you in Phase C |
| **Google Picker API** | Adding a client's sheet in coach mode |

All three are needed eventually. Enabling them now costs nothing and saves a
confusing 403 later.

---

## Step 3 — the consent screen

**APIs & Services** then **OAuth consent screen**. On the current console this
opens a numbered wizard under **Google Auth Platform** — App information,
Audience, Contact information, Finish — rather than the older single form. The
fields are the same either way.

1. App name: **Trakt**. Your clients see this on the consent screen, so use the
   name they know.
2. User support email: yours.
3. **Audience: External.** Internal means only users inside your own Google
   Workspace organisation can ever sign in. Clients are on personal Gmail
   accounts, so Internal would make the app unusable for exactly the people it
   is for — and without a paid Workspace plan it is not a real option anyway.
4. Developer contact email: yours.
5. Finish, and create.

The Audience step carries two warnings that both describe defaults you are about
to change, so do not be put off by them:

**"Your app will start in testing mode."** True, and it is why publishing below
matters. Testing caps you at 100 named test users and expires refresh tokens
every seven days, which would break every client weekly.

**"You may need to verify your app."** The "may" is load-bearing. Verification is
triggered by SENSITIVE scopes. With `drive.file` alone there is none to trigger
it.

### Scopes — the important screen

**Left sidebar → Data Access**, then **Add or remove scopes**. This is its own
page, not a step in the wizard you just finished, which is why the wizard never
asked you about it.

**What a scope is:** the list of things Trakt is allowed to touch in a client's
Google account. It is exactly what the consent screen shows them when they tap
Connect.

Add exactly one:

```
https://www.googleapis.com/auth/drive.file
```

It may be listed as "See, edit, create, and delete only the specific Google Drive
files you use with this app."

That sentence is the narrowest access Google offers for this. Trakt creates the
client's spreadsheet, so it can read and write that one file and nothing else —
not their photos, not their documents, not any other spreadsheet they own.

**Add nothing else.** Not `spreadsheets` (every spreadsheet they own), not
`drive` (everything), not `drive.readonly`. Those are SENSITIVE scopes, and
asking for one triggers app verification: a privacy policy, a homepage, a demo
video, and weeks of waiting before any client can use the app. With `drive.file`
alone there is nothing to review, which is the whole reason a client's setup is
one tap instead of a queue.

If the console shows your scopes in a "Sensitive scopes" or "Restricted scopes"
table rather than the non-sensitive one, stop — something other than `drive.file`
got added.

### Publishing status

**Left sidebar → Audience** — the same page where you chose External. Find
**Publishing status** and click **Publish app** to move from Testing to **In
production**.

Every new Google app starts in test mode, which has two limits that would wreck
a coaching practice:

- Only people you have added by email can sign in at all, capped at 100.
- Their sign-in expires after seven days, so every client would be locked out
  weekly.

Publishing just flips it to normal. Because the only scope attached is
`drive.file`, it costs nothing: no review, no waiting, and no "Google hasn't
verified this app" warning in front of your clients.

If it demands verification when you click Publish, a sensitive scope is still
attached. Go back and remove it.

---

## Step 4 — the OAuth client ID

**APIs & Services** then **Credentials** then **Create credentials** then
**OAuth client ID**.

1. Application type: **Web application**.
2. Name: `Trakt web` (internal label only, nobody sees it).
3. **Authorized JavaScript origins** — add all three, exactly as written, with
   no trailing slash:
   - `https://trakt-fit.vercel.app`
   - `http://localhost:8080`
   - `http://localhost:3000`
4. **Authorized redirect URIs**: leave empty. Google Identity Services uses the
   token model, which does not redirect.
5. Create.

Copy the **Client ID**. It looks like
`123456789-abc123def456.apps.googleusercontent.com`.

Ignore the client secret. The browser flow does not use one, and it must never
enter this repo.

The client ID itself is **not a secret** — it ships in the bundle and is visible
to anyone who opens devtools. That is normal and expected for this flow.

---

## Step 5 — the API key, for the Picker

Still under **Credentials**: **Create credentials** then **API key**.

Copy it, then immediately click **Edit API key** and restrict it, because an
unrestricted key is abusable:

1. **Application restrictions**: HTTP referrers (web sites). Add:
   - `https://trakt-fit.vercel.app/*`
   - `http://localhost:8080/*`
   - `http://localhost:3000/*`
2. **API restrictions**: Restrict key, and select **Google Picker API** only.
3. Save. Restrictions can take a few minutes to take effect.

---

## Step 6 — hand the values over

Create `.env.local` in the repo root:

```sh
VITE_GOOGLE_CLIENT_ID=123456789-abc123def456.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=AIzaSy...
```

`.env.local` is already covered by `.gitignore`, so it will not be committed.

Both also need setting on Vercel, or the production build ships without them and
the Connect button fails with `no-client-id`:

**Vercel dashboard → your project → Settings → Environment Variables.** Add
`VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_API_KEY`, ticking Production (and
Preview, if you want the spike reachable from a preview build).

Two Vercel gotchas:

- The `VITE_` prefix is not decorative. Vite only exposes variables with that
  prefix to client code, and everything here runs in the browser.
- Environment variables are read at **build** time, so adding them does nothing
  to the deployment already live. Redeploy after adding them.

Neither value is secret, but keeping them out of the repo means rotating one is
a config change rather than a commit.

---

## Step 7 — the spike

Do not skip this. It is five minutes and it answers two questions that the whole
coach-mode design rests on. If either answer is no, the design changes, and
finding that out now is worth far more than the time it costs.

The page is at `scripts/google-spike.html`. It needs no build step and no server:

```sh
npx serve scripts -l 3000
# then open http://localhost:3000/google-spike.html
```

It has to be served over `http://localhost:3000` rather than opened as a
`file://` URL, because Google checks the origin against what you registered and
a `file://` page has none. Port 3000 rather than 8080 so it does not collide
with the dev server if you have that running.

Paste in your client ID and API key, then work down the page. It runs four
checks:

| Check                  | Question it answers                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| 1. Sign in             | Does the consent screen show only `drive.file`, with no unverified-app warning?             |
| 2. Create a sheet      | Does `spreadsheets.create` work with `drive.file` alone?                                    |
| 3. Share it            | Can the app add a reader to a file it created, without a Drive scope?                       |
| 4. Pick a shared sheet | **The critical one.** Does picking a sheet another account created grant read access to it? |

Check 4 needs a second Google account: sign in as that account somewhere, create
a spreadsheet, share it with your main account, then run check 4 as your main
account and try to pick it.

**If check 4 fails**, coach-mode reading cannot work under `drive.file` and Phase
B's client-add path needs redesigning — most likely by having the client's app
share a copy into a folder the coach's app created. Tell me and I will rework it.

**If check 3 fails**, Phase C keeps a manual Drive-sharing step. Annoying, not
fatal.

---

## What is still manual afterwards

Two things, both small:

**Deploying an updated `sync.gs`.** Only affects sheets set up the old Apps
Script way. Each owner has to paste the new file and deploy a **new version** of
the existing deployment — not a new deployment, which would change the `/exec`
URL. Once every client is on the OAuth path this goes away entirely.

**Testing silent token renewal on a real iPhone.** It cannot be reproduced in a
desktop browser, and it is the behaviour most likely to disappoint. Install the
PWA, connect a sheet, leave it overnight, and open it the next morning: either it
syncs silently or it asks you to reconnect. Either is survivable — logging never
waits on sync — but you should know which one you shipped.
