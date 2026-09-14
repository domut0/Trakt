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

**Do this before anything else.** OAuth will not work without it, and changing it
later means editing every credential you are about to create.

There is no deploy config in this repo — no Vercel, Netlify, Fly, or CI config of
any kind. So Trakt currently has no home, and OAuth needs a fixed, HTTPS origin
that you tell Google about in advance.

Pick one and get the app deployed there before step 4:

- `trakt.yourdomain.com` if you already own a domain. Best option — clients see
  your name, and you never have to migrate.
- A free subdomain from a static host. Fine, and movable later if you accept
  redoing step 4.

Write the final origin down. It must include the scheme and no trailing path:
`https://trakt.yourdomain.com`.

You will register two origins: that one, and `http://localhost:3000` so the dev
server keeps working.

---

## Step 1 — create the project

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

**APIs & Services** then **OAuth consent screen** (it may appear as **Google Auth
Platform** then **Branding**).

1. User type: **External**. Internal is only available with Google Workspace and
   would limit you to your own organisation.
2. App name: **Trakt**. Your clients see this on the consent screen, so use the
   name they know.
3. User support email: yours.
4. Developer contact email: yours.
5. Save and continue.

### Scopes — the important screen

**Add or remove scopes**, then add exactly one:

```
https://www.googleapis.com/auth/drive.file
```

It may be listed as "See, edit, create, and delete only the specific Google Drive
files you use with this app."

**Add nothing else.** Not `spreadsheets`, not `drive`, not `drive.readonly`.
Those are sensitive scopes: adding any one of them triggers app verification,
which needs a privacy policy, a homepage, a demo video, and weeks of review. With
`drive.file` alone you skip all of it.

If the console shows your scopes in a "Sensitive scopes" or "Restricted scopes"
table rather than the non-sensitive one, stop — something other than `drive.file`
got added.

### Publishing status

Find **Publishing status** and click **Publish app** to move from Testing to
**In production**.

This matters more than it looks. In Testing you are capped at 100 named test
users and refresh tokens expire after seven days, which would break your clients
weekly. In production with only a non-sensitive scope there is no cap, no
verification review, and no unverified-app warning.

If it demands verification when you click Publish, a sensitive scope is still
attached. Go back and remove it.

---

## Step 4 — the OAuth client ID

**APIs & Services** then **Credentials** then **Create credentials** then
**OAuth client ID**.

1. Application type: **Web application**.
2. Name: `Trakt web` (internal label only, nobody sees it).
3. **Authorized JavaScript origins** — add both:
   - `https://trakt.yourdomain.com` (your real origin from step 0)
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
   - `https://trakt.yourdomain.com/*`
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

Both values also need setting in your host's environment variables for the
production build. Neither is secret, but keeping them out of the repo means
rotating one is a config change rather than a commit.

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

(It has to be served over `http://localhost:3000` rather than opened as a
`file://` URL, because that origin is what you registered in step 4.)

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
