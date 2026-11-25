# LGU Field Planner — Developer Handbook

Everything a new developer (or an AI coding assistant) needs to pick this project up, run it, change it safely and ship it. The user guide is in `README.md`.

- **What it is:** a planning tool for Los Gatos United (LGU) fields. It tracks field inventory and status, weekly training sessions per team, field capacity, gaps, a drag-and-drop schedule board with an optimizer, version history and a Long Term Planning view.
- **Tech:** plain HTML, CSS and JavaScript (ES2020). No framework, no build step to run it, no server, no external network calls.
- **Data:** stored in the user's browser (`localStorage`). Moved between people as JSON or CSV files.
- **Status (Nov 24, 2026):** feature-complete v1. Tested with Node (analysis module) and jsdom (UI), not yet in a real-browser test suite.

---

## 1. Quick start

```bash
# Run it: just open the file
open index.html                     # macOS; or double-click it

# Develop
npm install                         # once: installs jsdom (dev-only, for UI tests)
npm test                            # analysis tests (Node only, no dependencies)
npm run test:ui                     # simulated-browser UI tests (needs jsdom)
npm run build                       # → dist/lgu-field-planner.html (single shareable file)
```

Requirements: any modern browser (Safari, Chrome, Edge, Firefox). Node 18+ for tests and the build.

---

## 2. Repository layout

| Path | What it is | Notes |
|---|---|---|
| `index.html` | Page shell: header, tab bar, one `<section role="tabpanel">` per tab | Scripts load with `defer`, in this order: `seed-data.js`, `analysis.js`, `app.js`, `versions.js`, `board.js`, `longterm.js`, `github-sync.js` |
| `style.css` | All styling | LGU brand block (black / yellow `#fbd108` / white) is appended near the end. Later rules override earlier ones |
| `seed-data.js` | `window.LGU_SEED`, the starting data set | One long JSON line. Regenerate with a script, don't hand-edit (see §8) |
| `analysis.js` | **Analysis engine.** Pure functions, no DOM | Works in the browser (`window.LGUAnalysis`) and Node (`require`). Most business logic lives here |
| `app.js` | UI core: state, save/load, migrations, tabs, Dashboard, Weekly gaps, Field inventory, Teams, Schedule, Data & settings, import/export | Defines shared globals used by the other UI files |
| `versions.js` | Undo/redo, named versions, compare, restore | `window.LGUVersions` |
| `board.js` | Drag-and-drop Board tab and the **Optimize** panel | `window.LGUBoard` |
| `longterm.js` | **Long Term Planning** tab | `window.LGULongTerm`. Meeting-note content (owners, blockers, options) is hard-coded here |
| `github-sync.js` | **Shared versions on GitHub** (Versions tab, top card + header banner) | `window.LGUShared`. See §10a |
| `data/plan.json` | The shared plan (created by the first Publish) | Each publish is one commit, so the git history is the shared version history |
| `logo.png` | LGU crest (header + favicon) | Hidden automatically if missing |
| `tools/test-analysis.js` | Analysis unit tests | `npm test` |
| `tools/test-ui.js` | UI smoke tests in jsdom | `npm run test:sync` | Shared versions against a fake GitHub API: first visit loads shared, auto-follow, local edits never overwritten, banner, history/compare/load, conflict blocking, offline | ~5 s, needs `npm install` |
| `npm run test:ui` |
| `tools/test-sync.js` | Shared-version tests against a fake GitHub API | `npm run test:sync` |
| `tools/build-single.js` | Bundles everything into one HTML file | `npm run build` → `dist/` |
| `tools/coaches-2026-11.json` | Source list of head coaches and GK rosters used to build the seed | Reference data |
| `package.json` | npm scripts + jsdom dev dependency | Not needed to *run* the app |

---

## 3. Architecture

```mermaid
flowchart LR
  subgraph Browser
    LS[(localStorage<br/>lgu-field-planner-v1<br/>lgu-field-planner-versions-v1)]
    SEED[seed-data.js<br/>window.LGU_SEED]
    A[analysis.js<br/>LGUAnalysis.analyze]
    APP[app.js<br/>state · render · tabs]
    V[versions.js]
    B[board.js]
    L[longterm.js]
  end
  SEED -->|first run| APP
  LS <-->|load / save| APP
  APP -->|state| A -->|result| APP
  APP -- renderHooks --> B & L
  APP -- changeHooks --> V
  B -->|edits state, changed()| APP
  L -->|what-if copies of state| A
```

**One-way data flow:**
1. `state` (plain JSON) is the single source of truth.
2. Any edit mutates `state`, then calls `changed(rebuildEditors?)`.
3. `changed()` saves to `localStorage`, notifies `changeHooks` (undo history), then after 120 ms calls `render()`.
4. `render()` runs `result = A.analyze(state)` and redraws every tab, then calls each `renderHooks` entry (Board, Long Term Planning).

**Shared globals from `app.js`** (used by `board.js`, `versions.js`, `longterm.js`):

| Global | Purpose |
|---|---|
| `state` | Current data (see §4) |
| `result` | Latest `A.analyze(state)` output |
| `A` | `window.LGUAnalysis` |
| `h(tag, props, ...children)` | Tiny DOM builder. `props.text` sets text, `on*` adds listeners, `class` sets className. Children may be nested arrays; `null`/`false` are skipped |
| `$(id)` | `document.getElementById` |
| `changed(rebuild)` | Call after every edit |
| `clock('15:00')` | → `"3:00p"` |
| `download(name, text, mime)` | Save a file |
| `renderHooks`, `changeHooks`, `beforeReplaceHooks` | Extension points (arrays of functions) |
| `currentTab`, `showTab(id)` | Tab state |

> **Rule:** never write raw `innerHTML` with data. Always build with `h()` and `text:`, which avoids injection and the "[object HTMLElement]" class of bugs.

---

## 4. Data model (`state`)

Saved under `localStorage['lgu-field-planner-v1']`, and exported or imported as JSON from Data & settings.

```jsonc
{
  "version": 1,
  "settings": {                       // all optional; defaults in A.DEFAULT_SETTINGS
    "asOf": "2026-11-24",             // "today" for status calcs; blank = real today
    "expiringDays": 30,               // renewal within N days → "Expiring"
    "weekDays": ["Mon","Tue","Wed","Thu","Fri"],
    "targets":  { "Comp": 3, "ECNL": 3, "ECNL RL": 3, "Pre-ECNL": 3, "Pre 7v7": 2, "GK": 2 },
    "surfaces": { "ECNL": ["Turf"], "ECNL RL": ["Turf"], "Comp": ["Grass","Turf"], ... },
    "coachTravelMin": 15,             // min gap for one coach between two different fields
    "sessionMin": 75                  // slot length Optimize uses when a field day has no bookings
  },
  "fields": [{
    "name": "Daves Avenue Elementary",   // unique key; renames cascade to bookings
    "surface": "Grass|Turf|Hardwood", "lights": "Yes|No",
    "compEligible": true,                // used/allowed for competitive teams
    "permit": "Confirmed|Pending|Unknown|Lost",
    "renewal": "2026-11-05",             // booking end / renewal date
    "statusOverride": null,              // manual status; null = auto (see §5.1)
    "baselineCap": 74,                   // FIXED capacity (players at once) from Oct 19–23
    "planningCap": null,                 // user override of capacity
    "windows": { "Mon": "15:00–17:30", "Tue": "", ... },   // availability, one HH:MM–HH:MM per line
    "contact": "", "cost": "", "notes": "", "quality": "", "certainty": ""
  }],
  "teams": [{
    "name": "2009/08G ECNL RL (U18)",    // unique key; must match booking.team exactly
    "age": "U18", "gender": "Girls|Boys|Coed",
    "roster": 20,                        // null = unknown (flagged in Data issues)
    "program": "",                       // blank = inferred from name (see §5.3)
    "target": null,                      // sessions/week; null = program default
    "coach": "Joel Fumia"                // head coach(es), separated by ';'
  }],
  "bookings": [{
    "id": "b1", "day": "Mon", "field": "…", "start": "15:00", "end": "16:00",
    "team": "…", "canceled": false, "note": "Added by Optimize"
  }],
  "longTerm": {                          // Long Term Planning tracking (optional)
    "track":  { "risk:Union Middle School Turf": { "status": "In progress", "owner": "Phil", "due": "2026-12-01" } },
    "assume": { "creekside": { "teams": 4, "players": 14, "days": ["Mon",…], "window": "16:00–20:00", "surface": "Turf", "lights": "Yes" } }
  },
  "migrations": ["2026-11-teams", "2026-11-fixed-capacity", …]   // see §7
}
```

Bookings whose `team` isn't in `teams` are kept (rec, technical training, etc.) but **don't count** toward capacity or coverage.

---

## 5. Business rules (where to change them)

All of these are in `analysis.js` unless noted.

### 5.1 Field status — `fieldStatus()`
Priority order:
1. `permit === 'Lost'` → **Lost**
2. Field is used for comp and `renewal` is in the past → **Lapsed**
3. `renewal` within `expiringDays` → **Expiring**
4. `permit === 'Pending'` → **Pending permit**
5. Used for comp → **Active**
6. Has availability windows → **Rec only**
7. Otherwise → **Not in use**

`statusOverride` replaces the result. `STATUS` defines `usable` and `risk` for each status: Active, Expiring and Pending are usable; Lapsed and Lost are not.

### 5.2 Capacity (fixed quantity)
- `capacity = planningCap || baselineCap || live observed peak`.
- `baselineCap` is frozen from the Oct 19–23 schedule. That week's peak includes GK groups.
- **Moving or removing sessions must never change capacity.** A test enforces this.
- If a field falls back to the live peak, it's flagged as **Capacity not fixed**.
- **Peak load** (`peakLoad`) sweeps start and end times and sums roster sizes of overlapping sessions.

### 5.3 Programs
- `inferProgram(name)`: "GK…" → GK; names containing ECNL RL, ECNL, Pre-ECNL, Pre 7v7 or Comp map to that program; Academy → **Comp** (`normalizeProgram`).
- The program sets the default `target` and allowed `surfaces`.

### 5.4 Team coverage
- A **session** is a distinct day with a non-canceled booking. Two bookings on the same day count once.
- **secure:** the session is on a usable field.
- **atRisk:** the session is on a Lapsed or Lost field.
- **gap** = `target − secure`.

### 5.5 Optimizer — inside `analyze()`, "Optimizer" block
Builds candidate **slots**: for each usable field and day, use the existing booking blocks, or, if the day is empty, availability windows cut into `sessionMin` pieces.

**Hard rules:**
- capacity not exceeded
- surface allowed for the program
- at most one secure session per team per day
- **no coach at two different fields** with overlapping times or less than `coachTravelMin` between them (same field is fine)

**Order:** turf-only programs first, then biggest gap, then biggest roster.

**Preference within a team:**
1. lower-risk field
2. same field the coach or age group is already on that day
3. not the day before or after another session
4. most headroom

A session on a Lapsed or Lost field can be **re-homed**: the suggestion carries `replaces`. The output is `result.suggestions`, plus `result.unplaced` with a `reason`. `board.js` `applyOptimize()` turns suggestions into bookings in one undo step, and auto-saves a version first.

### 5.6 Data issues
Built in `analyze()` (`issues`, each with `type`, `sev`, `detail` and structured fields). Displayed in `app.js` `renderIssues()`, grouped by type and sorted by severity. To add an issue type:
1. push it in `analysis.js`
2. add an `ISSUE_INFO` entry (fix text + target tab) in `app.js`
3. optionally add a custom table in `issueTable()`

### 5.7 Long Term Planning — `longterm.js`
Every number is a **what-if**: deep-copy `state`, change it, run `A.analyze`. About 20 runs, roughly 1 second. Results are cached until the data changes.

- **Risks:** for each field with comp sessions, mark it Lost and count the change in `shortAfterPlacement`. That number is weighted by exposure: set to Active by hand, Lapsed, Pending or Expiring is "high"; no renewal date on file is "med". Unconfirmed fields are grouped into one package card; their combined loss is computed separately because they back each other up.
- **Opportunities:** listed in `OPPORTUNITIES`, from the Oct 12 meeting notes. Each one is added as a temporary field (`[LTP] …`) from its editable assumptions.
  - Score = (sessions backed up for the top single risk + 2 × sessions placed now + 0.5 × busiest-day drop) × certainty weight × quality factor (lit turf 1.3, turf 1.0, grass 0.35).
  - Player capacity = teams × players/team (default: club average roster) × 75-min slots × days.
- **Sunset:** grass or unlit fields with comp sessions, scored on sessions ending after sunset. The sunset table `SUNSET` holds approximate Los Gatos times by month. Fields that are also top risks are tagged "Fix hours, keep field" and listed last.
- **To update meeting content:** edit `RISK_NOTES` and `OPPORTUNITIES` at the top of `longterm.js`.

---

## 6. Common tasks

| Task | Where |
|---|---|
| Add a column to Field inventory | `app.js` → `FIELD_COLS` (label, width, `get`, `filter` type), plus a matching `h('td', …)` in `renderFields()` in the same position |
| Add a program | `analysis.js` → `DEFAULT_SETTINGS.targets` and `.surfaces`, and `inferProgram()` |
| Change default session length or coach travel time | `settings.sessionMin`, `settings.coachTravelMin` (Data & settings has a travel field) |
| New opportunity or meeting update | `longterm.js` → `OPPORTUNITIES`, `RISK_NOTES` |
| New tab | `index.html`: add a `<button role="tab" data-tab="x">` and a `<section id="x" role="tabpanel" hidden>`. New JS file: `renderHooks.push(rebuild => { if (currentTab === 'x') … })`. Add its `<script defer>` after `app.js` |
| Change brand colors | `style.css` → `:root` variables `--yellow`, `--band`, `--ink`, and the LGU brand block |
| Weekly data refresh (user task) | Data & settings → import bookings CSV (`day,field,start,end,team,canceled,note`) |

---

## 7. Data migrations (don't skip this)

Users keep their own data in the browser. When the **seed** changes (teams added or removed, new fields, frozen capacities), existing users don't get it automatically. `app.js` → `migrate(s)` runs once per user for each named migration:

```js
if (!s.migrations.includes('2026-12-my-change')) {
  // change s carefully: only fill blanks / exact old values, never overwrite user edits
  s.migrations.push('2026-12-my-change');
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) {}
}
```

Also add the migration name to `seed-data.js` → `migrations`, so new users (who start from the seed) don't run it.

Existing migrations:

| Migration | What it did |
|---|---|
| `2026-11-teams` | Removed two non-existent teams; added 2016/15B Academy II (U11) |
| `2026-11-academy2-roster` | Set Academy II roster to 11 |
| `2026-11-fixed-capacity` | Froze `baselineCap` per field |
| `2026-11-coaches` | Added the `coach` field |
| `2026-11-gk-coaches` | Added 9 GK groups and head coaches; refreshed Union Grass baseline 26 → 46 |

---

## 8. Regenerating the seed

`seed-data.js` is one generated line: `window.LGU_SEED = {…};`. To change it, load, edit and write back with Node:

```bash
node -e "
const fs=require('fs'); global.window={}; require('./seed-data.js'); const s=window.LGU_SEED;
/* edit s here, e.g. s.teams.push({...}) */
const src=fs.readFileSync('seed-data.js','utf8');
fs.writeFileSync('seed-data.js', src.slice(0, src.indexOf('window.LGU_SEED')) + 'window.LGU_SEED = ' + JSON.stringify(s) + ';\n');"
npm test
```

If the change affects users with saved data, add a migration (§7).

**Original data sources:**
- Oct 19–23, 2026 schedule screenshots
- `LGU Field Inventory.xlsx` (Field Inventory and Teams and Roster Size tabs)
- LGU coach directory screenshots (head coaches only) and GK team pages: `tools/coaches-2026-11.json`
- `LGU Fields Status - October 12, 2026.xlsx` (meeting notes, which feed Long Term Planning)

---

## 9. Testing

| Command | Covers | Runtime |
|---|---|---|
| `npm test` | `analysis.js`: status rules, capacity is fixed, surfaces, Optimize (coach clashes, same-field preference, re-homing, slot length), coach parsing, diff, seed sanity (99 teams, 9 GK groups, head coaches) | < 1 s, no dependencies |
| `npm run test:ui` | Every tab opens, with no stray `null`, `undefined` or `[object` text and no script errors; Optimize applies within capacity; Undo reverts; removing a card keeps capacity fixed; Long Term Planning renders | ~5 s, needs `npm install` |

**Before every release:** run both commands, then open `index.html` in Safari **and** Chrome and click through each tab. jsdom doesn't do real layout or real drag-and-drop.

**Known gaps:**
- no automated real-browser tests (Playwright would be the natural next step)
- drag-and-drop is tested with simulated events only

---

## 10. Building & publishing

`npm run build` writes `dist/lgu-field-planner.html`: one self-contained file (~430 KB) with CSS, all scripts and the logo inlined. Share that file, or host it on any static web host.

**GitHub Pages (current host):** the repository root is served as-is, so `index.html` works without the build step.
- Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`.
- The site is at `https://uiucwonger.github.io/lgu-field-planner/`.
- Every push to `main` redeploys within about a minute.
- On the free plan the site is **public**, even if the repository is private.

**Important data behavior:**
- Each person's edits live **in their own browser**, per site address. There is no shared database.
- To share a plan, use **Data & settings → Export all data (JSON)**, then **Import** on the other machine.
- Opening the same file from a different location or browser starts fresh from the seed.
- Clearing browser data deletes local edits. Remind users to export a JSON backup.

**If shared, multi-user editing is needed later**, the clean path is:
1. keep `analysis.js` unchanged
2. replace `load()` and `save()` in `app.js` (and `loadVersions` / `storeVersions` in `versions.js`) with calls to a small backend (any JSON document store), keyed by club or season
3. add sign-in

No other code needs to know where data lives.

---

## 10a. Shared versions (GitHub)

`github-sync.js` makes the GitHub repository the shared store. **`data/plan.json` is the plan everyone sees; every Publish is a git commit to it**, so GitHub keeps the full history (who, when, message), and any version can be compared, loaded or downloaded.

| Who | Opens | Can |
|---|---|---|
| Viewers | `https://uiucwonger.github.io/lgu-field-planner/` | See the latest shared plan and its full history; compare, load or download any version; try changes. *Save version* stays on their device |
| Editors | **Editor link** `https://uiucwonger.github.io/lgu-field-planner/#key=<token>` (once per device) | Everything above, plus **Save version saves for everyone**: one GitHub commit, with their name (asked once) and the time |

- **Editor link:** the key is remembered on the device and removed from the address bar. The `#…` part of a URL is never sent to the web server.
- **Copying the link:** editors can copy it for others under *Versions → Shared versions → Editor options*.
- **Stopping:** *Stop editing on this device* switches that device back to view-only.
- **The key** is one fine-grained token created by the repository owner: this repository only, *Contents: Read and write*, with an expiry.
- **Rotating:** to revoke everyone's editing, delete the token on GitHub, create a new one and send a new editor link. Note that the key can write any file in this repository, not just the plan.

**Behavior on page load:**
1. **First visit on a device:** loads the latest shared plan automatically.
2. **Returning, no local edits since loading a shared version:** follows the latest shared version automatically.
3. **Returning with unpublished local edits:** nothing is overwritten. A banner offers *See what changed* or *Load it*; loading auto-saves the local edits as a device version first.
4. **GitHub unreachable or rate-limited:** the app works from local data, and the card explains why.

**Two editors:** before saving, the planner compares the file's current `sha` with the one this browser loaded. If someone saved in between, the editor sees whose version it was and chooses: save theirs as the newest version (both stay in the history), or keep theirs on the device only. GitHub also rejects stale writes with 409.

**Limits:**
- Unauthenticated GitHub API reads are 60/hour per network; one page load uses 2, so about 30 page loads an hour from one location. Editors with a token get 5,000/hour.
- Files over 1 MB fall back to `download_url`.
- The plan is public if the repository is public.

**Config:** owner and repository are detected from `https://<owner>.github.io/<repo>/`. Otherwise the defaults are `uiucwonger/lgu-field-planner`, branch `main`, path `data/plan.json`. They can be overridden under *Repository settings* in the Editor box.

**Storage keys:** `lgu-github-token-v1` (editor key), `lgu-editor-name-v1` (name shown in history), `lgu-github-sync-v1` (which shared commit this device is based on, plus a content hash for "unpublished changes"), `lgu-github-config-v1`.

## 11. Conventions

- Prefer **ES2020**, no build tooling. Keep `analysis.js` free of DOM access so it stays testable in Node.
- All times are `HH:MM` 24-hour strings internally; display them with `clock()`.
- Day keys are `Mon`–`Sun`.
- Field and team **names are keys**. Use `renameEverywhere()` in `app.js` when renaming.
- Every user-visible list should handle "empty" explicitly. Never pass `null` or objects as text.
- Every board action must be one undo step: call `window.LGUVersions.commit()` before mutating.
- Update `README.md` (user guide) and this handbook when behavior changes.

---

## 12. Open items / backlog

- **Sunset-aware Optimize:** avoid placing sessions on unlit fields after sunset. The data is in `longterm.js` → `SUNSET`; it would become a rule in the optimizer slot filter.
- **Multi-head-coach teams:** currently every listed head coach must be free. U17/U18G Black has 6 head coaches, so consider "at least one free".
- **Duplicate coach names:** "Jeff Honda" and "Jeffrey Honda" are probably the same person.
- **Long Term Planning assumptions:** opportunity hours are placeholders until confirmed with Phil, Shawn and Shaun.
- **Weekend days:** the seed has Mon–Fri data only.
- **Real-browser test suite** (Playwright) and **shared storage** (see §10).
