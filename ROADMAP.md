# Roadmap

A living list — items get added as we go. **Owner** work needs artwork or an
account; **Agent** work is repo and documentation.

## 0.3.x — polish and publish

### Owner

- [x] **New icon.** `loves-mbz.png` (115×128, with the `.ai` source beside it)
      is the add-on icon in `info.json` and is packaged in the `.mmip`;
      `skin/icon/lovesMBz.svg` is the 24×24 menu icon and draws with the skin's
      colour so it follows light and dark themes.
- [ ] **README cover.** A wide banner for the top of `README.md`, plus the square
      image for the addons listing. Suggested path `docs/cover.png`; the README
      gets the image tag once the file exists.
- [ ] **Publish on mediamonkey.com.** Submit at
      <https://www.mediamonkey.com/addons/> → Submit Addon → the MediaMonkey 5
      sub-category. Needs a forum account, the title `Loves MBz` (matching
      `info.json`), a description, screenshots, the square image and the release
      `.mmip`. Each later version is **Add New Version** and needs moderator
      approval again.

### Agent

- [x] Badges in `README.md`: latest release, downloads, MediaMonkey version,
      platform.
- [ ] Screenshots section in the README once the cover exists — the three
      columns, the IDs dialog, the Track Properties tab.
- [ ] Keep `info.json`, the README version line and the changelog in step on every
      release; tag `vX.Y.Z`, push, and attach `LovesMBz.mmip` to the release
      (`gh release create` now that `gh` is installed).
- [ ] Optional: a GitHub Actions workflow that builds the `.mmip` and attaches it
      when a `v*` tag is pushed, replacing the manual zip-and-upload step.

## 0.4.0 — metadata from MusicBrainz

The first release that talks to the MusicBrainz web service instead of only
reading IDs the library already holds. **Lookup is by release ID only**: an
album must already carry `Albums.MBGID`. When that is empty there is no
automatic search, no name matching and no request — the album is skipped and
reported as skipped, so the add-on never guesses which release is meant. The
preview offers a manual **Search MusicBrainz** button that opens the website's
release search; the add-on still does not choose a release or write an ID.

0.4.0 "Foundation" is tagged and pushed; the GitHub release carries the
installable `.mmip`.

MusicBrainz needs **no API key** for reads. The rules are a descriptive
`User-Agent` and at most one request per second, and both live in the fetch
module rather than in a user setting. Nothing is ever written to MusicBrainz, so
no account, token or secret is stored.

One `release/{mbid}` lookup with
`inc=artist-credits+labels+recordings+release-groups+media+discids+isrcs+url-rels+recording-level-rels+work-rels+work-level-rels+artist-rels`
supplies a whole album: the MBIDs, artist and album-artist credits, label and
catalogue number, barcode, status, type, country, date, script and language,
plus the track list with recording IDs, release-track IDs and ISRCs. The
relationship includes supply composers and lyricists from each recording's
work, and producers and remixers from the release and recording. If the release
has no Discogs URL, one `release-group/{id}?inc=url-rels` follow-up supplies the
group's Discogs master page. Library songs are matched to the release by disc
and track number, never by title.

### Checklist

- [x] `mbzFetch.js`: serialized queue (requests at least 1.1 s apart), a
      descriptive `User-Agent`, `fmt=json`, backoff on 503, cancellation when
      the dialog closes, and no request at all for an album without `MBGID`.
- [x] Read-only preview: one album per dialog, the fetched values and the full
      track list, nothing written. Albums with no release ID say why instead of
      being queried, and offer a manual MusicBrainz web search.
- [x] Write step: current value against fetched value per field, one checkbox
      per field, nothing written until **Apply**.
- [x] Fill from MusicBrainz in the Track Properties tab: stages the release's
      native fields and extended tags on the open track, with OK as the save
      gate. The dialog's own inputs are not rewritten.
- [x] Fill a multi-track selection: every selected file is matched by disc and
      track number against its own album's release, the chosen fields are
      staged on each track, and MediaMonkey's normal group save commits them
      with OK. The checkbox list is the confirmation; Cancel discards the fill.
- [x] Per-field checkboxes in Fill: only the ticked fields are staged for one
      track or for a multi-track selection, then saved by OK.
- [x] Native tags for what the lookup returns: title, artist and album artist
      as `; `-separated names, date, year, original date, original year, every
      label joined into publisher, ISRC.
- [x] Relational native tags — composer and lyricist from work relations;
      generic writer relations fill Composer when no composer exists. Producer
      and remixer extended tags come from release/recording relations. All are
      multivalues joined with `; `.
- [ ] Other relational native tags — genre, conductor, copyright and language
      still need their own includes and mappings.
- [x] Extended tags for values with no column, under Picard's names:
      `MUSICBRAINZ_*` IDs, `BARCODE`, `ARTISTS`, `ALBUMARTISTS`,
      `WRITER`, `PRODUCER`, `REMIXER`, `originaldate`, album type/status/country,
      `CATALOGNUMBER`, and
      `discogs_url` from the release's or release group's Discogs URL
      relationship. `discogs_url`
      is a plain extended tag, so it stays out of the add-on tab and shows in
      MediaMonkey's built-in Custom tab.
- [x] Single-track and preview writes go through `track.commitAsync()`; Fill
      in group Track Properties stages each track's native fields before its
      extended tags and uses the dialog's normal group save. The album and
      artist ID columns are never written, so a fetched ID cannot silently
      overwrite the library value the lookup came from.
- [ ] Keep the fetched-release cache across dialog openings; it currently lives
      as long as the dialog.

### Not in 0.4.0

- Searching MusicBrainz by artist or album name, AcoustID or disc ID.
- Cover art from the Cover Art Archive.
- Writing anything back to MusicBrainz (that needs OAuth and is out of scope).

## 0.5.0 — Tag from MusicBrainz

One window does all the tagging, and the add-on stops writing inside
MediaMonkey's own dialogs.

The 0.4.x group Fill wrote into MediaMonkey's Track Properties dialog and let
MediaMonkey's group save commit the values. That does not work, and the
reasons are in MediaMonkey's own source (`src/js/dialogs/dlgTrackProperties.js`
in the parent folder):

- In group mode `btnOkPressed` (`:1446`) recomputes `modified` and
  `tagModified` **from the checked `data-control-class="Checkbox"` controls
  only**; flags set by the add-on are thrown away.
- The group save (`:1522`) commits a **proxy** — `app.utils.createTrackGroupData()`
  plus `assignGroupData2ListAsync` — so the only channel to the real tracks is
  what a tab puts on that proxy. The proxy holds one value per field, so
  per-track values (title, composer, disc #, recording ID) cannot be expressed
  at all.
- The Fill's field checkboxes were MediaMonkey checkboxes, so they armed
  `tagModified` and made MediaMonkey **rewrite the tag file of every selected
  track**, including tracks the Fill never matched.
- Each track was flushed as the loop walked it, so an abort left the selection
  half written — the "press OK again and a few more land" symptom.
- `afterCommitCalls` runs in the single-track branch only (`:1500`), so a tab
  has no post-commit hook in group mode.

0.5.0 therefore removes the Track Properties tab and moves the whole job into
the add-on's own window, where the write path is the one that already works:
**stage, then commit, per track, and report what was written.**

### The window

`dlgMBzPreview` becomes `dlgMBzTag` — **Tag from MusicBrainz**. It opens on
the current selection and holds:

1. **Summary line** — release title, artist and release ID for the album.
2. **Warning bar** — only when it has something to say (release and library
   track counts differ, the selection spans more than one album and the user
   insisted, a track was matched by number only).
3. **Track table** — the **selected** tracks with their matched release row
   (disc/track, library title, release title, length, ISRC, recording ID) and
   a "changes" marker. The full release track list is behind a
   *Show all release tracks* toggle, so the default view is the selection and
   not the album.
4. **Fields to write** — one row per field that differs: checkbox, field,
   current value, new value, `changes / total`. Values that differ per track
   read **per track** instead of listing every value.
5. **MusicBrainz tags** — the selection's existing MusicBrainz tags with
   links, an editor, and an add-row. In a multi-selection only the tags every
   selected track shares are listed, each badged with how many tracks carry it;
   per-track tags (recording IDs) stay in the track table.
6. **Apply** and a status line — `Updated 12 of 15 tracks. Skipped 3 (no
   matching disc and track number). 0 failed.`

Nothing is written until **Apply**. Closing the window writes nothing.

### Entry points

The window is reachable three ways, all from the same action:

- **Edit → Tag Tools → Tag from MusicBrainz…**
- the track-list context menu (same menu branch)
- **the toolbar** — a button that opens the window on the current selection.

The toolbar button uses MediaMonkey's own toolbar, so it behaves like every
other toolbar button: the right icon, the right tooltip, and greyed out when
nothing is selected.

- The action stays `hotkeyAble: true` with `icon: 'lovesMBz'` and a title, so
  it appears in **Options → Layout → Toolbar** among the available actions and
  can be given a hotkey.
- The button itself goes in the **right-hand strip** (`righttoolbuttons`) via
  `uitools.addToolButton`, on start-up, beside MediaMonkey's own tool buttons
  and the other add-ons' icons. That strip is static, so the button survives
  settings changes and does not claim a row of the main toolbar.
- The add-on does **not** append to `toolbarItems`: that is the *custom*
  toolbar, which renders its items on a row of their own — 0.5.1 did exactly
  that and the button ended up alone on a second line. A stale `lovesMBzTag`
  entry is removed on start-up.

### Guardrails against a crowded window

- The track table shows the **selection**, not the whole release; the release
  listing is opt-in.
- The release overview stays a compact key/value block.
- Per-track values collapse to **per track** (or the first three values plus
  an ellipsis) instead of one row per value.
- The tag table lists only MusicBrainz tags, and only the shared ones in a
  multi-selection.
- One scrolling column, one Apply button, no nested panes beyond the two
  tables.

### Guardrail: one album at a time

A selection that spans **more than one album ID** does not open the window.
Even when the albums share a release — MediaMonkey gives each disc of a
multi-disc release its own album row — the window stays closed until the user
insists.

The prompt names what will happen, and the release ID when the albums share
one:

> This selection spans 3 albums. Tag from MusicBrainz works on one album at a
> time. Continue and treat the selection as one release?

*Continue anyway* opens the window on the **first** selected album's release
and matches every selected track by disc and track number; tracks that do not
match are skipped and named in the report. *Cancel* opens nothing.

The rule lives in one place (`resolveTagScope`) so the entry point and the
window cannot disagree.

### What changes

- `mbzApply.js` — the write engine.
  - `buildPendingAsync` also reports the library's current value per field.
  - `buildSelectionPlanAsync(tracks, release, tagsById)` — per-track pending
    for the selection, aggregated fields and skip counters.
  - `aggregateFields(work)` — the field rows, with per-track values collapsed.
  - `applySelectionAsync(plan, keys, tagEdits)` — **the only write path**:
    per track native fields first, then one read, one merged `ExtendedTags`
    write (fill tags and tag edits together), then `commitAsync()`; failures
    are collected per track and the rest still commit.
  - `resolveTagScope(tracks)` — album IDs, release IDs, the multi-album
    decision.
  - `buildPlanAsync` / `applyAsync` (the album-centric pair) are replaced by
    the selection pair.
- `dialogs/dlgMBzTag.js` / `.html` — the window (renamed from `dlgMBzPreview`).
  The tag table, the suggestions and the divergence strip are ported from the
  tab, with the group patch replaced by per-track writes.
- `actions_add.js` — `actions.lovesMBzPreview` becomes `actions.lovesMBzTag`,
  titled **Tag from MusicBrainz…**; it resolves the scope and asks before
  opening on a multi-album selection.
- `init.js` — the one-time toolbar offer (asked on first run, remembered with
  `app.setValue`), and the toolbar item appended to `toolbarItems`.
- `dialogs/dlgTrackProperties_add.js` and `dialogs/dlgTrackProperties/` —
  **deleted**, with the tab registration.
- `AGENTS.md` — rewritten around the 0.5.0 contract (below).
- `tests/save-path.test.js` — replaced by `tests/tag-path.test.js`.
- `README.md`, `CHANGELOG.md`, `info.json` (0.5.0) — updated.

### The 0.5.0 save-path contract

1. **One write path.** Every write goes through
   `mbzApply.applySelectionAsync`. No other module writes tags or native
   fields.
2. **Stage, then commit.** Per track: native fields, then one read and one
   merged `ExtendedTags` write, then `commitAsync()`. One commit per track,
   and the tag write happens once even when the fill and a tag edit touch the
   same track.
3. **Nothing runs inside MediaMonkey's dialogs.** The add-on registers no
   `propertiesTabs` tab, never stages values into a MediaMonkey dialog, and
   never relies on MediaMonkey's group save.
4. **One album at a time.** A selection spanning more than one album ID is
   refused unless the user insists; then the first album's release is used and
   tracks are matched by disc and track number.
5. **Field work belongs in the engine.** Field problems are fixed in
   `buildPendingAsync`, `aggregateFields`, `mergeTags` or `tagValue` — never
   in the dialog.
6. Disc # is written as `discNumberInt` with `kind: 'int'`, and `SCRIPT` is
   never offered or written.

### Checklist

- [x] `resolveTagScope` + the multi-album prompt, with the shared-release case
      named in the message.
- [x] Entry points: Edit → Tag Tools, the track-list context menu, and the
      toolbar button (native toolbar item + the one-time offer).
- [x] `buildSelectionPlanAsync`, `aggregateFields`, `applySelectionAsync` in
      `mbzApply.js`, replacing the album-centric pair.
- [x] `dlgMBzTag`: selection-scoped window, compact release block, selection
      track table with the release table behind a toggle, field rows with
      collapsed per-track values, one Apply, one report.
- [x] Tag table ported from the tab: view, edit, add, delete, links, the
      "from the library" suggestions and the divergence strip, all writing per
      track.
- [x] Track Properties tab and its registration removed; the `.mmip` no longer
      ships `dialogs/dlgTrackProperties/`.
- [x] `tests/tag-path.test.js`: scope resolution, field aggregation, write
      order (native → tags → commit), one tag write per track, per-track
      failure isolation, and the 0.4.x invariants kept (`discNumberInt`, no
      `SCRIPT`).
- [x] Album release ID editable in the window: validated, confirmed, written
      through `setAlbumGuidAsync`, then the release is reloaded.
- [x] Version stamp in the window footer, kept equal to `info.json` by the test.
- [x] `node tools/build-mmip.js` runs the regression test first, packages the
      `.mmip` and stamps the build time into the window, so two builds of one
      version can be told apart.
- [x] `AGENTS.md` rewritten to the contract above.
- [x] README: the Track Properties sections become the new window; the
      screenshot list loses the tab.
- [x] `info.json` → 0.5.1 (0.5.0 was the first build; 0.5.1 carries the fixes), CHANGELOG entries, and a fresh `LovesMBz.mmip`.
- [ ] Tag `v0.5.1` and attach `LovesMBz.mmip` to the GitHub release (owner:
      needs a moderator-approved addon page and a push).

### Known consequences

- Multi-disc albums have one album row per disc in MediaMonkey, so a
  selection spanning both discs trips the guardrail. Selecting one disc, or
  insisting, are the two ways through.
- Writing the file tags is per track, so a large selection takes time. The
  window shows progress per track and reports the outcome; there is no
  overall timeout.
- Library-side writes stay outside the apply path: `Albums.MBGID` is editable in
  the window's **Album release ID** field, `Artists.MBGID` stays in the
  **MusicBrainz IDs…** dialog, and both keep their own confirmation.

### Not in 0.5.0

- Searching MusicBrainz by name, AcoustID or disc ID.
- Writing anything back to MusicBrainz.
- Reading or writing the **artist** ID column from the new window (the album
  release ID is editable there).

## Nice to have

- Conductor, genre, copyright and other relational credits, fetched from
  artist/work relations and genres; these have native columns to write to.

## Backlog

- [x] **MusicBrainz links in the track-list context menu** — right-click a track
      in table view and open its release, release group or artist page directly
      (**MusicBrainz links** submenu, also under Edit → Tag Tools).
- Add ideas here as they come up.
