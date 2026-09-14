/**
 * Anything But The Notes App -- sheet sync endpoint.
 *
 * Paste this into the Apps Script editor of the spreadsheet you want to sync
 * to, then deploy it as a web app. See README.md next to this file.
 *
 * The app POSTs here with an action of "pull" or "push". There is no doGet on
 * purpose: a GET would carry the secret in the query string, where it lands in
 * Apps Script's execution log and in browser history.
 */

/** Replace with the secret the app generated for you. */
const SECRET = "__SECRET__";

/** Bumped when this file changes in a way the app needs to know about. */
const SCRIPT_VERSION = 4;

/**
 * Tabs the app writes. Anything else in the spreadsheet is left alone.
 *
 * "plan" is written only on the syncs that carry it. A push that omits a tab
 * leaves that tab untouched, which is what lets a coach's plan survive the
 * client's ordinary syncing until the client accepts it.
 */
const APP_TABS = ["sets", "sessions", "daily", "cardio", "plan"];

/**
 * Tabs the app reads back.
 *
 * "sets", "sessions" and "daily" because they carry editable columns; "plan"
 * for a different reason entirely -- it is not a log with editable cells, it is
 * a document a coach writes and the client reads.
 */
const TWO_WAY_TABS = ["sets", "sessions", "daily", "plan"];

const META_TAB = "_sync";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SECRET) {
      return json_({ ok: false, error: "bad-secret" });
    }

    if (body.action === "pull") return json_(pull_());
    if (body.action === "push") return json_(push_(body));
    if (body.action === "putPlan") return json_(putPlan_(body));

    return json_({ ok: false, error: "unknown-action" });
  } catch (err) {
    // Never let an exception escape: Apps Script would return an HTML error
    // page, which the app cannot parse and would report as an opaque failure.
    return json_({ ok: false, error: String(err) });
  }
}

// --- Actions --------------------------------------------------------------

function pull_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const meta = readMeta_(ss);
  const tabs = {};

  TWO_WAY_TABS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    tabs[name] = sheet ? readTab_(ss, sheet) : [];
  });

  return {
    ok: true,
    scriptVersion: SCRIPT_VERSION,
    revision: meta.revision,
    deviceId: meta.deviceId,
    spreadsheetUrl: ss.getUrl(),
    tabs: tabs,
  };
}

/**
 * Writes the plan tab, and nothing else.
 *
 * This is how a coach's plan reaches a client. It differs from `push_` in three
 * ways, each deliberate:
 *
 *   NO DEVICE CHECK. The whole point is that a device which does not own this
 *   sheet can write here. Ownership is about who may rewrite the LOG, and this
 *   touches none of it. `pull_` has no device check either, for the same
 *   reason: reading and advising are not claiming.
 *
 *   NO REVISION BUMP. The revision is the log's optimistic-concurrency token.
 *   Bumping it here would make the owning device's next push read as stale and
 *   send it round a pointless merge, over a tab the merge does not even look at.
 *
 *   NO expectedRevision. There is nothing to be stale against: a plan is a
 *   document that replaces the previous one wholesale, and the app's own
 *   issuedAt ordering decides which of two plans wins.
 *
 * The secret is still required -- doPost checks it before dispatching -- so
 * this is no more open than the rest of the endpoint.
 */
function putPlan_(body) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return { ok: false, error: "busy" };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    var rows = body.tabs && body.tabs.plan;
    if (!rows || !rows.length) return { ok: false, error: "empty-plan" };
    writeTab_(ss, "plan", rows);
    return {
      ok: true,
      scriptVersion: SCRIPT_VERSION,
      revision: readMeta_(ss).revision,
      spreadsheetUrl: ss.getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

function push_(body) {
  const lock = LockService.getDocumentLock();
  // Without the lock two pushes can interleave mid-rewrite and leave a tab
  // holding half of each.
  if (!lock.tryLock(20000)) return { ok: false, error: "busy" };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const meta = readMeta_(ss);

    // One sheet, one device. Each device tracks what IT last pushed, so a
    // second device reads the first one's push as a pile of sheet edits and
    // its own next push deletes the first one's history. Refusing is the only
    // honest option short of per-record versioning.
    //
    // `takeover` is the deliberate override, sent only when the user has
    // confirmed in the app that this device should own the sheet from now on.
    // The write below then claims it.
    if (!body.takeover && meta.deviceId && body.deviceId && meta.deviceId !== body.deviceId) {
      return { ok: false, error: "other-device", deviceId: meta.deviceId };
    }

    // Optimistic concurrency. The app merged against `expectedRevision`; if the
    // sheet has moved since, whatever was typed in between would be silently
    // overwritten, so the app is told to pull and merge again instead.
    if (!body.force && meta.revision !== body.expectedRevision) {
      return { ok: false, error: "stale", revision: meta.revision };
    }

    const revision = meta.revision + 1;

    APP_TABS.forEach(function (name) {
      if (body.tabs && body.tabs[name]) writeTab_(ss, name, body.tabs[name]);
    });

    writeMeta_(ss, {
      revision: revision,
      deviceId: body.deviceId || meta.deviceId,
      unit: body.unit || "",
      formatVersion: body.formatVersion || "",
    });

    return {
      ok: true,
      scriptVersion: SCRIPT_VERSION,
      revision: revision,
      spreadsheetUrl: ss.getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

// --- Tab IO ---------------------------------------------------------------

function getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeTab_(ss, name, rows) {
  const sheet = getOrCreate_(ss, name);
  const isNew = sheet.getLastRow() === 0;

  sheet.clearContents();
  if (!rows.length) return;

  const width = rows[0].length;
  const clean = rows.map(function (row) {
    const out = [];
    for (let i = 0; i < width; i++) {
      // JSON turns an absent cell into null, and setValues rejects null and
      // undefined. Empty string is what "no value" looks like in a sheet.
      out.push(row[i] === null || row[i] === undefined ? "" : row[i]);
    }
    return out;
  });

  // A new sheet is 1000 rows by 26 columns and setValues throws rather than
  // growing it. A year of serious training passes 1000 sets, so this is a
  // "works until it suddenly doesn't" failure without the grow.
  if (clean.length > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), clean.length - sheet.getMaxRows());
  }
  if (width > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, clean.length, width).setValues(clean);
  sheet.setFrozenRows(1);

  if (isNew) {
    sheet.getRange(1, 1, 1, width).setFontWeight("bold");
    // The ID column anchors a row to its record across re-sorts. It is noise to
    // read, so it is hidden rather than removed.
    if (clean[0][0] === "ID") sheet.hideColumns(1);
    // Force date columns to plain text. Left as dates, Sheets hands back a Date
    // object that JSON turns into a UTC string, which moves the day by one for
    // anyone west of UTC -- the exact bug dayKey exists to avoid.
    const dateColumn = clean[0].indexOf("Date");
    if (dateColumn >= 0) {
      sheet.getRange(2, dateColumn + 1, sheet.getMaxRows() - 1, 1).setNumberFormat("@");
    }
  }
}

function readTab_(ss, sheet) {
  if (sheet.getLastRow() === 0) return [];
  const values = sheet.getDataRange().getValues();
  const zone = ss.getSpreadsheetTimeZone();

  return values.map(function (row) {
    return row.map(function (cell) {
      // Normalise here rather than in the app: only the script knows the
      // spreadsheet's timezone, and formatting a Date anywhere else guesses it.
      if (Object.prototype.toString.call(cell) === "[object Date]") {
        return Utilities.formatDate(cell, zone, "yyyy-MM-dd");
      }
      return cell;
    });
  });
}

// --- Meta tab -------------------------------------------------------------

function readMeta_(ss) {
  const sheet = ss.getSheetByName(META_TAB);
  const meta = { revision: 0, deviceId: "" };
  if (!sheet || sheet.getLastRow() === 0) return meta;

  sheet
    .getDataRange()
    .getValues()
    .forEach(function (row) {
      if (row[0] === "Revision") meta.revision = Number(row[1]) || 0;
      if (row[0] === "Device") meta.deviceId = String(row[1] || "");
    });
  return meta;
}

function writeMeta_(ss, meta) {
  const sheet = getOrCreate_(ss, META_TAB);
  sheet.clearContents();
  sheet.getRange(1, 1, 7, 2).setValues([
    ["Key", "Value"],
    ["Revision", meta.revision],
    ["Device", meta.deviceId],
    ["Unit", meta.unit],
    ["Format version", meta.formatVersion],
    ["Script version", SCRIPT_VERSION],
    [
      "Last push",
      Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm"),
    ],
  ]);
  sheet.setFrozenRows(1);
}

// --- Helpers --------------------------------------------------------------

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/**
 * Run this from the editor's Run button to check the script works before the
 * app is involved at all. It writes two sample rows and a _sync tab. Delete
 * those tabs afterwards, or just let the first real sync overwrite them.
 */
function testPush_() {
  const result = push_({
    action: "push",
    force: true,
    deviceId: "editor-test",
    unit: "lbs",
    formatVersion: 1,
    tabs: {
      daily: [
        ["Date", "Calories", "Protein (g)", "Bodyweight"],
        ["2026-08-12", 2400, 180, 185.5],
        ["2026-08-13", 2600, 190, 185.0],
      ],
    },
  });
  Logger.log(result);
  return result;
}
