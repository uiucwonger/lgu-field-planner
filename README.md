# LGU Field Planner

Open `index.html` in a browser. It works offline and doesn't need a server.

- **Share it:** run `npm run build` and send `dist/lgu-field-planner.html`, one self-contained file. Each person's edits are saved in their own browser; use *Data & settings → Export / Import all data (JSON)* to pass a plan between people.
- **Shared versions:** people who open the **editor link** (`…/lgu-field-planner/#key=…`) once can click **Save version**, and it's saved on GitHub for everyone, with their name. Everyone else opens the plain link and sees the latest shared plan and its full history (**Versions → Shared versions**).
- **Develop it:** see [`DEVELOPER.md`](DEVELOPER.md) for architecture, data model, business rules, tests and publishing.

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page layout |
| `app.js` | UI: editing, saving, import/export, rendering |
| `board.js` | Drag-and-drop schedule board |
| `versions.js` | Undo/redo and the Compare view |
| `analysis.js` | **Analysis module**: pure functions, no DOM. It works in the browser or Node. |
| `logo.png` | LGU crest (header and browser tab). `logo-placeholder.svg` is shown only if logo.png is missing. |
| `longterm.js` | Long Term Planning tab (risks, opportunities, sunset) |
| `seed-data.js` | Starting data from the Oct 19–23, 2026 screenshots and the LGU Field Inventory workbook |
| `tools/test-analysis.js` | `npm test`. Tests for the analysis module. |
| `tools/test-ui.js` | `npm run test:ui`. Simulated-browser UI tests (needs `npm install`). |
| `tools/build-single.js` | `npm run build`. Writes `dist/lgu-field-planner.html`. |
| `DEVELOPER.md` | Developer handbook |

## Tabs
- **Dashboard:** KPIs, daily capacity vs. demand, field status, an action list, coverage by program, and data issues.
- **Optimize (Board):** fills every team to its weekly target using open capacity. It never puts a coach at two different fields at the same time (travel time set in Data & settings), keeps a coach's or age group's sessions on the same field that day when it can, follows each program's allowed surfaces, books at most one session per team per day, and moves sessions off lapsed or lost fields. You see a preview first; applying it can be undone.
- **Board:** drag teams below target from the tray onto a field and day, or drag session cards to move them. Cells turn green, amber or red while you drag. Drag a card to *Remove* to take it off the board, or click it to edit. Field capacity stays fixed.
- **Versions:** the shared plan history on GitHub. Editors add to it with **Save version** (header or Versions tab); everyone can Compare, Load or Download any version, and editors can Delete one. Versions are not stored on devices. Undo/Redo is in the header (⌘/Ctrl+Z) and covers Optimize, imports, reset and loading a shared version until the page is reloaded.
- **Long Term Planning:** three ranked lists for the program manager, with a "Focus this month" strip on top.
  1. *Risks to protect*: fields the plan depends on, ranked by sessions that couldn't be re-homed if lost (what-if runs of the current plan), weighted by how unconfirmed the booking is. Unconfirmed bookings are also shown as one combined risk.
  2. *Quality-field opportunities*: Creekside, Dartmouth, Saratoga, Canyon Heights, Fisher, LGHS hockey turf and Westmont grass (from the Oct 12 meeting notes), ranked by backup for the top risk plus busiest-day relief, times certainty. Lit turf ranks highest. Each card's hours are editable assumptions.
  3. *Fields to sunset*: grass or unlit fields, ranked by sessions ending after sunset. Fields that are also a top risk are kept and listed last ("fix hours, keep field").
  Status, owner and answer-by dates are saved with the plan; *Download plan (CSV)* exports the list.
- **Teams & targets:** includes a Coach(es) column (separate several with `;`). Use *Coach template (CSV)* and *Import coaches (CSV)* to fill it in bulk.
- **Weekly gaps:** field × day utilization heatmap (click a cell for its bookings), team × day coverage matrix, and suggested placements.
- **Field inventory / Teams & targets / Schedule:** editable tables. Edits save automatically in this browser.
- **Data & settings:** renewal warning window, planning days, default sessions per program, JSON backup/restore, and CSV import/export.

## Updating each week
1. Export bookings from the scheduling tool as CSV with columns `day,field,start,end,team,canceled,note`.
2. In **Data & settings**, tick *Replace existing bookings* and import the CSV.
3. Update permits and renewal dates in **Field inventory**, then set **As of** in the header.
4. Editors: click **Save version** (e.g. "Week of Nov 30 – final") so everyone gets the update.
5. Use **Export all data (JSON)** to back up or share. Edits are stored per browser.

## Using the analysis module elsewhere
```js
const A = require('./analysis.js');
const result = A.analyze({ settings, fields, teams, bookings });
// result: { summary, fields, teams, daily, suggestions, unplaced, issues }
```
