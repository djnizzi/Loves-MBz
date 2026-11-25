# UI roadmap

A living UI/UX plan for Loves MBz, audited against 0.5.1. The functional
roadmap is in [ROADMAP.md](ROADMAP.md); this file is only about how the add-on
looks, reads and behaves for the person using it.

The audit was made from the source (`dialogs/dlgMBzTag.js` / `.html`,
`dialogs/dlgLovesMBz.js` / `.html`, `actions_add.js`, `init.js`,
`controls/trackListView_add.js`, `mbzApply.js`, the guard and the packager) and
from the documented behaviour in [README.md](README.md). Rendered screens in a
running MediaMonkey have **not** been captured yet, so anything that depends on
the host skin is marked *verify in app*.

How to read this file:

- **P1** — breaks trust, hides information or blocks a user. Fix first.
- **P2** — costs clarity or consistency on every use. Fix next.
- **P3** — polish that pays off in screenshots and support threads.
- **S / M / L** — a dialog-local edit, a dialog rebuild, or a change that
  touches the engine or the guard.

## Principles

1. **Trust before polish.** A user must be able to see what Apply will write
   before pressing it, and must never lose an edit without being told.
2. **One write action, one explanation.** The window already has one Apply;
   everything that explains it belongs next to it.
3. **Host controls, not browser controls.** `Edit`, `Dropdown`, `Checkbox` and
   `Buttons` from `commonControls.js` are the only form controls in a dialog.
   0.5.1 proved that native inputs cannot be tamed by CSS in the host skin.
4. **No dead ends.** Every empty state says what happened and offers the next
   step; every failure says which track and why, and can be copied.
5. **Confirmation proportional to risk.** A per-row library write keeps its
   confirmation. A bulk file write gets a *legible* confirmation in the footer
   rather than a second modal.

## Audit summary

| Surface | Current state (0.5.1) | Main problem | Priority |
|---|---|---|---|
| Tag window header | one plain summary label, reused for title and errors | no visual hierarchy, no persistent context | P1 |
| Fields table | one row per differing field, all ticked by default | scope of Apply is invisible; album vs track fields mixed | P1 |
| Track table | title/artist pairs, length, changes (ISRC and recording ID removed in rc2) | table clipped at narrow widths; blank outcome cell | P1 |
| Footer | Apply + one status label + build stamp | Apply writes more than the user may expect; report is not copyable | P1 |
| Busy state | only Apply is disabled | editing during Apply silently loses work | P1 |
| Loading | sections appear in 4 async stages | layout jumps; Apply clickable before a plan exists | P2 |
| Status messages | 5 separate sinks | errors land in different places for similar actions | P2 |
| Empty states | no-ID state loses the "nothing written" promise | no "already matches" state; no guided recovery | P2 |
| Tag table | native `<input>` per row, clear-to-delete only | inconsistent control sizing; deletion undiscoverable | P2 |
| IDs dialog | native `<input>` and `<select>`, three equal buttons | inconsistent with the tag window; destructive action has no weight | P2 |
| Vocabulary | 4 names for the release ID, `Open` / `Changes` headers | jargon; ambiguous labels | P3 |
| Links | anchors with `href="#"` | no copy address or middle-click | P3 |
| Window fit | fixed scroll height from `basis * 0.68`, no resize refit | dead space after resize; 1200×960 tight at 125% | P3 |
| Columns / menus / toolbar | three read-only columns; three menu entries; one toolbar button | no copy path for IDs; menu order has no logic; icon-only button | P3 |
| Docs / screenshots | README is excellent but has no screenshots | cannot show the UI in the addon listing | Owner |

## Phase 1 — trust and legibility (next patch)

Goal: nothing in the window can surprise the user. Dialog-local, no write-path
change, guard-compatible.

### 1.1 Pending-work summary in the footer · S · **[x] done**
- **Now:** every field row starts ticked (`renderFields`), tag edits ride in the
  same Apply, and nothing states the combined effect.
- **Change:** a label beside Apply, recomputed from ticked field keys and staged
  tag edits: `Will write 9 fields on 5 tracks · 2 tag edits`, or
  `Nothing selected — tick a field or edit a tag`. Wire it to checkbox changes,
  tag inputs, Add, divergence actions and the "Use library ID" fill.
- **Keep:** a modal confirmation is not needed here; the footer summary plus the
  existing "nothing is written until Apply" line is the proportionate guard.
- **Acceptance:** ticking or unticking any row, editing a tag, adding a tag or
  clearing one all update the sentence immediately; Apply reports exactly that
  work.
- **Implemented:** the footer counts ticked field writes per track, tag edits
  and removals, updates on checkbox clicks and tag input, reads
  `Nothing to apply yet — tick a field or edit a tag.` when nothing is staged,
  and stays empty in Party Mode.

### 1.2 Apply readiness and one busy lock · S · **[x] done**
- **Now:** Apply is enabled before `state.plan` exists and only gets
  `mbzDisabled` while writing (`dlgMBzTag.js:2221`); tag inputs, Add, Save ID
  and the divergence buttons stay live, and the post-apply reload discards any
  edit made meanwhile.
- **Change:** disable Apply until a plan exists; add `setBusy(on)` that locks
  Apply, Save ID, Add, the add fields, tag value inputs, suggestion chips and
  divergence buttons, and guards `saveAlbumId`, `addPending`, `onTagInput` and
  `applyNow`. Restore on success and on failure.
- **Acceptance:** during a 5-track apply, no editable control accepts input; a
  failed apply leaves the window editable and reports the failure.
- **Implemented:** the single `setBusy` lock covers Apply, Save ID, Add, the add
  fields, tag values, field checkboxes, suggestion chips and the divergence
  buttons, and is restored after the post-apply reload or a failure.
  `refreshApply` greys Apply until a plan exists and during reloads, with a
  tooltip explaining the wait.

### 1.3 Stop clipping wide tables · S
- **Now:** `.mbzTagRoot > .mbzTagScroll` is `overflow-x: hidden`
  (`dlgMBzTag.html:37`) while the track table requires more width than a
  squeezed window offers.
- **Change:** `overflow-x: auto` (the guard only pins `overflow-y`), and let
  the title and artist columns wrap instead of forcing width. The ISRC and
  recording ID columns are already gone (rc2), so this is now about a long
  title or artist next to the fixed disc/track/length cells.
- **Acceptance:** at the default size and at 1024px wide, the **Changes**
  column is reachable.

### 1.4 Readable per-row outcomes · S
- **Now:** the track table prints `3` for a changed row, an empty cell for a
  matched-but-current row (`dlgMBzTag.js:922`), and `no match (disc 1, track 7)`
  inline for an unmatched one.
- **Change:** `3 of 5 tracks` for changed rows, an em-dash for current rows, a
  muted or warning style plus a row marker for unmatched rows. Add one banner
  when `skipped.unmatched === entries.length`: none of the selected tracks match
  this release by disc and track number.
- **Acceptance:** a selection that matches nothing says so once, above the
  tables, not only per row.

### 1.5 Positive and guided empty states · S
- **Now:** the Fields section disappears when nothing differs; the no-ID state
  replaces the reassurance note with a search explanation.
- **Change:** `The library already matches this release` with the matched-track
  count when `plan.fields` is empty; in the no-ID state, keep the "nothing is
  written until Apply" promise and add a three-step hint (Search → paste ID →
  Save ID).
- **Acceptance:** both states read as deliberate, not broken.

### 1.6 One notice area, and a copyable failure report · M
- **Now:** five sinks (`summary`, `warning`, `note`, `tagStatus`,
  `applyStatus`); failures are a `\n` blob in the footer.
- **Change:** route Apply results, tag-edit state and add errors to one footer
  notice with severity styling; keep the per-track failure list and add
  **Copy report** (local clipboard helper, same fallback pattern as
  `dlgLovesMBz.js`).
- **Acceptance:** every failure after Apply appears in one place and can be
  pasted into a forum post with track names intact.

### 1.7 Hierarchy and vocabulary · M
- **Header:** album/release name at ~1.2em bold, muted subtitle
  `release · artist · date · label`, links row directly beneath.
- **Field rename:** `Album release ID` → `Release ID used for lookup`, with a
  helper line `Written to Albums.MBGID; not a file tag.` Update the README's
  occurrences and the changelog entry.
- **Grouping:** show album-level and track-level fields under `Album` and
  `Tracks` subtitles. Use a new class for these subheads so
  `.mbzSection { padding-top: 10px` stays exactly as the guard expects.
- **Headers:** `Open` → `Link`; `Changes` → readable counts.
- **Add picker:** show the friendly label with the canonical name
  (`Release ID — MUSICBRAINZ_ALBUMID`) instead of the raw tag name alone.
- **Acceptance:** the same object is named the same way everywhere in the
  window, and the README matches.

### 1.8 Window context, resize and keyboard · M
- **Now:** the tag window has no Esc/Close and its footer Apply is a `div`
  (`dlgMBzTag.html:262`); the scroll column is sized once and never refits;
  several windows can be open with identical titles.
- **Change:** set the window title to include the album once the scope resolves;
  add a small **Reload** beside the summary; refit `fitScrollColumn` on
  `resize` (keep `basis * 0.68`); give Apply a focusable, Enter/Space-activated
  element, add Esc close and Ctrl+Enter apply, and make chips and divergence
  buttons focusable. *Verify in app* which host hook provides the default
  action and Esc; `dlgLovesMBz.html` already uses the host `Buttons` control
  with `data-default` / `data-esc` as the model.
- **Acceptance:** a keyboard-only run can open, edit and apply; resizing the
  window fills the extra height; two open windows are distinguishable.

### 1.9 Plurals and microcopy · S
- `%d track(s)`, `on %d of %d tracks` with 1, `Apply %d change(s)?` become
  proper singular/plural; one ellipsis style; one verb for checkboxes
  (README currently mixes **tick** and **checked**).
- **Acceptance:** no `(s)` patterns anywhere in the two dialogs.

### 1.10 Retry after a failed release lookup · S · **[x] done**
- **Now:** a busy server, timeout or network error left the window on
  `Could not read the release…` with no way forward except closing and
  reopening it — which also discarded tag edits made before the failure.
- **Change:** **Retry** sits beside the summary and repeats the lookup in
  place. `mbzFetch` now tags its errors with `mbzCode`, so the window offers
  Retry only where it can help: busy, timeout, network, HTTP and malformed
  responses; a `404` says to check the release ID instead.
- **Acceptance:** a busy server is recoverable without closing the window, and
  staged tag edits survive the retry.

## Phase 2 — consistency across the add-on (next minor)

Goal: the two windows feel like one product, and every control is a host
control.

### 2.1 Finish the control conversion · M
- The tag table's per-row value is still a native `input`
  (`dlgMBzTag.js:1165`) and the IDs dialog still uses native `input`/`select`
  (`dlgLovesMBz.html:77`, `:84`). Convert to skinned `Edit` / `Dropdown`, or
  replace the per-row input with one "edit selected tag" field below the table
  if a hundred host controls per window proves too heavy. *Verify in app* before
  choosing.
- **Acceptance:** no native form control is visible in either dialog, at 100% and
  at 150% scaling.

### 2.2 Tag rows: show removal, not just emptiness · S
- Clearing a value deletes the tag, but the only affordance is an empty box and
  there is no pending-removal state. Add a per-row clear action that marks the
  row `will be removed`, and include removals in the pending-work summary.
- **Acceptance:** a user can remove a tag without knowing that empty = delete.

### 2.3 Links behave like links · S
- `href="#"` means no "Copy link address" and no middle-click. Set the real
  MusicBrainz URL on the anchor and keep the click interception; keep the
  `mbzTextLink hotlink` class and the non-breaking-space gap the guard pins.
- **Acceptance:** right-clicking a link offers the address; clicking still opens
  through `uitools.openWeb`.

### 2.4 IDs dialog: hierarchy, density, keyboard · M
- **Buttons:** Save is primary; Clear becomes secondary/danger and its
  confirmation names all three fields it empties; Copy/Reload stay quiet.
- **Density:** short GUIDs in the ID columns with full values in `title`; per
  column counts in the header (`Release ID (3)`) instead of the five-number
  sentence; keep the totals sentence as a second line.
- **Editor:** show it only for a selected row, and make rows focusable and
  Enter-selectable; the close button already follows the host `Buttons` pattern.
- **Acceptance:** the dialog is readable at 100% with 1000 rows and usable
  without a mouse.

### 2.5 Shared styling · S
- `.mbzTable`, `.mbzGuid`, `.mbzButton`, section titles and status styles are
  duplicated between the two HTML files and have drifted (`.button` vs
  `mbzButton` on the divergence strip, `.mbzLinks` spacing). Extract a shared
  stylesheet loaded by both, keeping the specific rules the guard asserts in
  `dlgMBzTag.html`.
- **Acceptance:** one definition per component; the guard still passes unchanged.

### 2.6 Theme and contrast pass · S
- Small text sits at 0.7 opacity and the warning red is fixed. Check both skins
  at 100% and dark mode; give warnings an icon or weight as well as colour, and
  raise the minimum contrast of muted text. *Verify in app.*
- **Acceptance:** all secondary text is legible in both shipped skins.

### 2.7 Unsaved-changes guard · M
- Closing after a tag edit discards it silently. Warn on close only when the
  pending-work summary is non-zero. *Verify in app* which close hook the host
  exposes; this is the riskiest item in the phase.
- **Acceptance:** closing with staged edits asks once; closing an untouched
  window stays silent.

### 2.8 Section cards · S · **[x] done**
- The window now uses the fieldset-and-legend card that MediaMonkey's settings
  panels draw (and that ParaDeeJay's settings page inherits): **Release**,
  **Fields to write**, **Selected tracks** and **MusicBrainz tags**. The
  release overview and the album release ID share one card, an empty card is
  hidden, and a release that disappears clears the old overview.
- **Acceptance:** the cards line up at 100% and 150% in both skins; no empty
  card is drawn; the guard's `.mbzSection` rhythm and scrolling column are
  unchanged.

## Phase 3 — structure and scale

Goal: the window still works when there is a lot to read.

### 3.1 Two jobs, two views · L
- The window combines release fill and extended-tag maintenance in one long
  scroll. Evaluate a `Release` / `Extended tags` tab pair (or two collapsible
  sections) with a shared header and footer. This halves scroll length and
  narrows the meaning of Apply per view.
- **Dependency:** the guard pins one `.mbzTagScroll` with `overflow-y: auto`,
  `fitScrollColumn` and its `basis * 0.68`; a tabbed body requires a deliberate
  guard update, not a workaround.
- **Decided:** tabs — but the split is not Release / Extended tags. Tab 1,
  **ID and changes**, keeps every card the window has today; tab 2, **MBZ tags
  to use**, holds the saved set of fields the add-on offers. Moved to
  ROADMAP.md **0.7.1**, because the tab exists to hold that setting.
- **Implemented in 0.7.1:** two `.mbzButton` tabs above the one scrolling
  column, with `panelChanges` holding today's cards and `panelTagSet` holding
  the catalogue. The window shows and hides the panels itself and runs
  `fitScrollColumn()` again for the panel it shows; `ensureTabs()` builds the
  bar and the first panel when the installed page has none, and
  `buildFieldSetPanel()` draws the catalogue card into its mount point for a
  fresh page and an old one alike, so the card exists once. The
  strip is the host's `Tabs` control, which takes any content panel; the
  `load(track, dialog)` model belongs to the properties dialog's own tab list,
  not to the control. The drawn `.mbzButton` bar stays as the fallback for a
  host without it. Corrected in ROADMAP 0.7.1.
- **Also in 0.7.1:** the saved set gets a page in **Tools → Addons →
  Configure**, so the general setting is reachable without opening the window.
  The tab stays as the in-context view of the same setting, with the
  "this release" column the configuration page has no release to fill.

### 3.2 Field selection controls · S
- Add `All` / `None` per scope, and show `9 of 12 selected` in the section
  subtitle. With 12 native and 18 tag fields, unticking one by one is the
  slowest part of a careful apply.

### 3.3 Album context in the header · S
- Cover art would make the right release obvious at a glance, but it needs a
  new Cover Art Archive request and caching, so it belongs here, not in Phase 1.
  Until then, show the release's track count and medium count next to the date.

### 3.4 Larger selections · M
- For a long tag list or 1000-row IDs table, add a filter box and sticky section
  subheads. The IDs dialog caps at 1000 rows and says so; keep that.

### 3.5 Copy depth · S
- Add "copy this value" to ID cells, the meta table and the failure report, so
  users can move MBIDs into Picard or a forum post without retyping.

## Phase 4 — across the board

### 4.1 Track-list columns · S
- Fixed widths of 19 / 22 / 19 em and read-only cells are fine, but offer a
  **Copy MusicBrainz IDs** action on the current selection (same tab-separated
  shape as the IDs dialog) and mention the "no sorting on computed columns"
  limitation in the column tooltip, not only in the README.

### 4.2 Menus and toolbar · S
- Three entries under **Edit → Tag Tools** (IDs, links, tag) have no stated
  order. Put the primary tagging action first, group the read-only entries
  together, and give the toolbar button a second affordance only if the menu
  proves undiscoverable. Keep the tooltip `Tag from MusicBrainz`.
- The action titles already carry ellipses correctly (dialogs open, submenu does
  not); keep that convention in any new entry.

### 4.3 Documentation and screenshots · Owner + S
- The README is the product's manual and is unusually complete; it needs the
  visual layer: the three columns, the IDs dialog, the tag window's header,
  fields and tags, the divergence strip, and the no-ID state. Add a
  `docs/screenshots/` set and a README section (already tracked as an owner
  item in ROADMAP.md). Use the same set for the mediamonkey.com addon listing.
- After Phase 1, capture "before/after" of the footer summary and the clipped
  table; those are the changes a moderator and a new user will notice.

### 4.4 Localization and strings · M
- Almost every visible string goes through `_()`, which is good. Audit for
  remaining English literals (the `Tag: …` tooltip, fallback `#id` names,
  concatenated sentences such as `parts.join(' ')` warnings) so translators see
  whole sentences, not fragments. No translation work is planned; the strings
  should simply be translatable.

## Guardrails this roadmap must respect

`tests/tag-path.test.js` pins the UI shape on purpose. Any change must keep, or
consciously update, these:

- one `.mbzTagScroll` with `data-id="scrollColumn"` and `overflow-y: auto`;
- `.mbzSection { padding-top: 10px` as the section rhythm;
- `.mbzButton { padding: 0 14px; line-height: 24px` as the button size;
- no `<input>` or `<select>` in `dlgMBzTag.html`;
- links built with `createElement('a')`, class `mbzTextLink hotlink`, and the
  `\u00a0\u00a0\u00a0` gap;
- `fitScrollColumn` sized from `basis * 0.68`, never `root.clientHeight`;
- every `qid()` present as a `data-id` in the markup;
- one write path, native fields → one merged tag write → commit, per track.

The write contract itself is in [AGENTS.md](AGENTS.md) and is out of scope for
UI work.

## Suggested order

| Order | Item | Phase | Effort | Unblocks |
|---|---|---|---|---|
| 1 | Pending-work summary + Apply lock | 1.1, 1.2 | S+S | trust in Apply |
| 2 | Clipping + short GUIDs + row outcomes | 1.3, 1.4 | S | reading the tables |
| 3 | Empty states + one notice area | 1.5, 1.6 | S+M | support and recovery |
| 4 | Hierarchy, vocabulary, plurals | 1.7, 1.9 | M+S | screenshots, docs |
| 5 | Keyboard, resize, window title | 1.8 | M | accessibility |
| 6 | Tag-row control conversion | 2.1 | M | visual consistency |
| 7 | IDs dialog hierarchy + keyboard | 2.4 | M | parity between windows |
| 8 | Shared styling + theme pass | 2.5, 2.6 | S | maintainability |
| 9 | Links, removals, unsaved guard | 2.2, 2.3, 2.7 | S+S+M | polish |
| 10 | Tabs — "ID and changes" / "MBZ tags to use" | 3.1 → 0.7.1 | L | long-term layout |

## Review checklist

Before calling a UI change done, open the window in MediaMonkey on:

- a single track with an existing release ID;
- a multi-track album, including one track with no disc tag;
- an album with no release ID;
- a selection spanning two albums (confirm and refuse);
- Party Mode (read-only);
- a 1000-row IDs dialog;
- 100% and 150% display scaling, light and dark skins.

Confirm: no clipped columns, no layout jump while loading, the footer summary
matches what Apply writes, failures are copyable, and keyboard-only navigation
reaches Apply and both tables. Source-only checks (`node tests/tag-path.test.js`)
do not cover any of that.

## Decisions needed

1. Footer summary only, or also a confirmation sheet above a threshold of
   changed fields?
2. Per-row skinned `Edit` controls, or a single editor for the selected tag row?
3. ~~Tabs, collapsible sections, or keep one scroll?~~ **Answered:** tabs, split
   as **ID and changes** / **MBZ tags to use** — see 3.1 and ROADMAP.md 0.7.1.
4. Is a close guard acceptable given the host's dialog lifecycle, or should the
   window simply warn in the footer before Apply?

Record answers here as they are made, so the next change does not re-litigate
them.
