# Sheet sync setup

One-time setup, about five minutes, on a computer. The Apps Script editor is
usable on a phone in desktop mode but the deploy flow is several dialogs deep and
easy to get wrong.

You need this only once. Everything afterwards happens on your phone.

## 1. Make the spreadsheet

Create a new Google Sheet. Name it whatever you like. Leave it empty: the script
creates the tabs it needs on the first sync.

## 2. Add the script

In the sheet: **Extensions** then **Apps Script**. Delete whatever is in the
editor.

In the app: **Settings**, then the **Google sheet** section, then **Set up sheet sync**,
then **Copy script**. That copies
`sync.gs` with your secret already filled in, so there is nothing to edit. Paste
it into the editor and save.

If you are setting this up by hand instead, copy `sync.gs` from this directory
and replace `__SECRET__` on line 13 with a long random string. You will need the
same string in the app.

## 3. Check it works before going further

In the editor's toolbar, pick `testPush_` from the function dropdown and press
**Run**. Google asks you to authorize the script the first time. It is your own
script running on your own sheet, so the "unverified app" warning is expected:
click through **Advanced** then **Go to (your project)**.

Switch back to the sheet. There should now be a `daily` tab with two sample rows
and a `_sync` tab.

**If that worked, the hard part is done.** If it did not, fix it here rather than
debugging a silent sync later.

## 4. Deploy it as a web app

**Deploy** then **New deployment**. Click the gear next to "Select type" and pick
**Web app**. Then:

- Description: anything
- Execute as: **Me**
- Who has access: **Anyone with the link**

Press **Deploy**, authorize if asked, and copy the **Web app URL**. It ends in
`/exec`.

## 5. Connect the app

Paste the URL into the app's **Google sheet** section and press **Connect**. The
first sync publishes everything the app has.

## Pointing a Claude Project at the sheet

Reading the sheet is most of the point. See
[`claude-project-instructions.md`](claude-project-instructions.md) in this directory for a
document to paste into a Claude Project's custom instructions: it teaches the schema, the
conventions that keep its numbers matching the app's, and the handful of traps (a blank cell is
not a zero, warm-up sets are never logged) that otherwise produce confident wrong answers.

## Updating the script later

If you ever paste a newer `sync.gs`, you must deploy a **new version** of the
existing deployment, not a new deployment:

**Deploy** then **Manage deployments**, click the pencil icon, set Version to
**New version**, then **Deploy**.

Creating a _new_ deployment instead gives you a different `/exec` URL, and the
app keeps talking to the old one. The app's Settings screen shows when it last
synced, which is how you would notice, but it is easier not to do it.

## Things worth knowing

**The URL is the credential.** Anyone who has it can read and write this sheet.
The secret in the request body is the only other check. Both live in IndexedDB on
your phone and are deliberately left out of JSON backups, so sharing a backup
does not hand over your sheet. Treat the URL like a password.

**One sheet, one device.** The app remembers what it last pushed in order to work
out what you changed in the sheet. A second device has its own idea of that, so
it would read the first device's work as sheet edits and overwrite it. The script
records a device id and refuses a push from a different one, so this fails with a
message instead of scrambling your data.

**Moving to a new phone** is that refusal on purpose, and the way through it is
**Take over this sheet** in Settings on the new device. Note that disconnecting on
the OLD device is not enough by itself: that clears the connection there, but the
sheet still records the old device id, so the new phone stays refused.

Take over replaces the sheet's contents with whatever the new device holds, so do
it in this order:

1. **Export backup** on the old phone.
2. **Import backup** on the new one.
3. **Take over this sheet**.

Skip the first two and you take over with an empty log, and the sheet is emptied to
match. The confirmation names how many sets and days it is about to push, which is
there so that "0 sets" stops you.

**Your own tabs are safe.** The script only touches `sets`, `sessions`, `daily`, `cardio`
and `_sync`. Any other tab you add, with formulas or pivot tables over the synced data, is
never read or written. If your sheet still has `habits` or `Food Log` tabs from an older
version, they are no longer written to and are yours to delete.

**Edit these columns only:**

| Tab        | Editable                              |
| ---------- | ------------------------------------- |
| `daily`    | everything, and you can add new dates |
| `sets`     | Weight, Reps, RPE, Setup Note         |
| `sessions` | Note                                  |

Anything else you type into an app-owned column is overwritten on the next sync.
Rows you add to `sets` or `sessions` are ignored, since a set typed into a
spreadsheet has no session to belong to. Rows you _delete_ are restored, on
purpose: sorting and filtering are ordinary things to do to a spreadsheet, and a
training log is not something you can re-derive.

To delete a day, blank its cells rather than deleting the row.

**Column A is hidden on purpose.** It holds the record id that ties a row to the
app. You can sort and filter freely, but do not delete that column or the app
stops recognising the rows.
