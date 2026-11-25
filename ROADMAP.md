# Roadmap

A living list — items get added as we go. **Owner** work needs artwork or an
account; **Agent** work is repo and documentation. UI and UX work is planned
separately in [UI-ROADMAP.md](UI-ROADMAP.md); this file tracks features and
release mechanics.

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
- [ ] **Moved to 0.7.0** — other relational native tags (genre, conductor,
      language and the rest) are audited there in one pass, not one include at
      a time.
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
- [ ] **Moved to 0.7.0** — the fetched-release cache across dialog openings;
      it currently lives as long as the dialog.

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
- [x] Album release ID editable in the window: validated, written
      through `setAlbumGuidAsync`, then the release is reloaded.
- [x] Version stamp in the window footer, kept equal to `info.json` by the test.
- [x] `node tools/build-mmip.js` runs the regression test first, packages the
      `.mmip` and stamps the build time into the window, so two builds of one
      version can be told apart.
- [x] `AGENTS.md` rewritten to the contract above.
- [x] README: the Track Properties sections become the new window; the
      screenshot list loses the tab.
- [x] `info.json` → 0.5.3, the "Responsive" CHANGELOG entry, and a fresh
      `LovesMBz.mmip`.
- [x] Tag `v0.5.3` and attach `LovesMBz.mmip` to the GitHub release.

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

## 0.6.x — the exact release, and files outside the library

Two roadmap items from 0.6, tackled one at a time so each can be tested on its
own.

### 0.6.1 — pick the release out of its release group

MediaMonkey usually matches the release group and then points the album at the
group's best-known release. The window now lists every release of that group
(date, country, format, track count), and picking one loads it in place of the
matched one. `Albums.MBGID` is still written only by **Save ID**; picking is a
load, not a write.

- [x] `mbzFetch.fetchReleaseGroupReleasesAsync` — one
      `release?release-group={id}&inc=media` request, cached by group ID, same
      queue and spacing as the release lookup. The browse endpoint is used
      because a `release-group?inc=releases` listing carries no media, and so
      no track count.
- [x] `releaseGroupReleases` — rows sorted oldest first, duplicate and ID-less
      releases dropped, track counts summed from the media the listing carries.
- [x] **Releases in this release group** card in `dlgMBzTag`, with a **use
      this** link on every row but the loaded one; the plan does not wait for
      the request. It is the window's first card, opens with the album's
      release ID field, and names each release's format.
- [x] Save ID compares with the album row, so a picked release's ID can be
      written; the field shows the loaded release.
- [x] `tests/tag-path.test.js` covers the group listing and the card, and
      refuses a chooser that writes the album row or the tags.
- [x] `tools/build-mmip.js` names a test build's package after its channel
      (`LovesMBz-0.6.1-rc1.mmip`), so it does not overwrite the release package.
- [x] `info.json` → 0.6.1, `ADDON_VERSION` 0.6.1, test builds on channels
      `rc1`–`rc10`.
- [x] Test the package in MediaMonkey through the rc builds, then drop the
      channel: 0.6.1 "We just getting started", a fresh `LovesMBz.mmip`, tagged
      `v0.6.1` with the package on the GitHub release.

### 0.6.2 — tag files that are not in the library yet

The other 0.6 job. The window works on files MediaMonkey has no album row for,
and writes nothing but their tags.

- [x] Scope by **album name** instead of album ID: every selected track must
      carry the same album name, and an empty name on all of them is allowed.
      `resolveTagScope` returns `albumName`, `albumNameConflict`, `tagOnly` and
      `outOfLibrary`; a differing name does not open the window.
- [x] Start from an empty release ID when the tag has none, instead of refusing
      the lookup, so a file outside the library can be tagged from a release ID
      the user supplies or picks from its release group. The field shows the
      files' `MUSICBRAINZ_ALBUMID` and its button is **Load**, not **Save ID**.
- [x] A track with a file but no library row is planned from its own
      `ExtendedTags` instead of being skipped as `noLibrary`.
- [x] The write path stays `mbzApply.applySelectionAsync`, with the same
      per-track order and per-track failure isolation; nothing on that path
      calls `setAlbumGuidAsync`.
- [ ] Test the package in MediaMonkey on files outside the library.
- [x] Drop the channel for 0.6.2: `BUILD_CHANNEL` is empty, the changelog
      carries the release entry, and `LovesMBz.mmip` is tagged `v0.6.2` with the
      package on the GitHub release.

## 0.7.x — every field MusicBrainz gives us, and a tag set you choose

Two jobs. 0.7.0 is research and engine work: the release lookup already carries
more than the window offers, and several fields are one include away. 0.7.1 is
the window: which of those fields Apply offers becomes a saved setting that any
selection can override, and the window's cards move into tabs.

### 0.7.0 — the field audit, and a release that outlives the window

The lookup asks for

`artist-credits+labels+recordings+release-groups+media+discids+isrcs+url-rels+recording-level-rels+work-rels+work-level-rels+artist-rels`

and maps eleven native fields and eighteen tags. Everything else the response
carries is dropped: `release.asin`, `media.format`, `media.title`, the
release's and recording's `disambiguation`, every ISRC after the first, and the
relationships the `*_level_rels` switches already pull in but nobody reads. Of
those, only genre needs a new include: language arrives with the release,
conductor and performer credits are in the relations already asked for, and work
IDs ride along with `work-rels`.

Audit the whole response — relational and not — and decide per field: a native
column, a Picard tag name, or deliberately not offered, with the reason written
down. `NATIVE_FIELDS` and `TAG_FIELDS` in `mbzApply.js` stay the only place a
field is declared; `describeRelease` is the only place it is filled.

**The audit is done.** Every field of that response — read, dropped, one include
away, or refused — is tabled in
[TECHNICAL.md](TECHNICAL.md#the-release-response-field-by-field), verified on
2026-11-25 against five real releases (Daft Punk, Glenn Gould, Miles Davis,
Karajan/Beethoven, The Beatles).

What it found:

- **One include adds a native field: `genres`.** The release's genres and the
  release group's genres come back in the same request, because the group is a
  subquery of the release — no second request, no group lookup.
- **The relations we already ask for carry far more than we read.** `instrument`
  (with the instrument in `attributes`), `vocal`, `performing orchestra`,
  `conductor`, `engineer`, `mix`, `balance`, `instrument arranger` and
  `phonographic copyright` were all in the base response; `place-rels` adds
  `recorded at`, and `release-group-level-rels` adds the group's `part of`
  (series) and its web links.
- **Work genres are not in a release response**, even with `genres`. A work ID,
  title, language and ISWC are.
- **Free fields nobody reads:** `asin`, `media[].format`, `media[].title`,
  `media[].discs[].id` (five disc IDs on one CD), every ISRC after the first
  (three on one track), `release-events`, the label MBID,
  `recording.first-release-date`, the comment fields, and `cover-art-archive`.
- **Measured cost:** 275,236 → 301,460 bytes (+10%) for an 11-track classical
  release with every extra include, one request, 0.55 s of server time. The
  queue's 1.1 s spacing still dominates.
- **Refused, with the reason in the table:** `SCRIPT` (the write contract),
  `tags` and ratings (folksonomy, or user auth), annotations, series membership
  (18 on one pop album), release comments, per-track web links, and everything
  with no MediaMonkey column and no Picard tag.

The candidates that survive: genre, language, conductor, performer with
instrument, engineer/mixer/arranger, work ID and ISWC, media format, disc
subtitle, ASIN, disc ID, every ISRC, the full release-country list and the label
MBID. Fields with **no** MusicBrainz source stay out of the audit — BPM, initial
key, mood, occasion, energy, grouping, lyrics and artwork bytes are
MediaMonkey columns or another service, and nobody should hunt for them twice.

Checklist:

- [x] Audit the response field by field against real lookups, and write the
      table into `TECHNICAL.md`.
- [ ] One include string, checked against the API documentation: `genres`,
      `annotation`, `release-group-level-rels` and the relationship target
      types the new fields need, added to the release lookup. The relationship
      switches stay switches — `work-level-rels` alone provides no
      relationships without `work-rels` or `artist-rels` beside it.
- [ ] One request stays one request. Everything on a release or a recording is
      free; a field that lives on the release group is folded into the
      release-group request the Discogs URL already needs (made
      unconditionally once such a field is in the set), not into a new one.
- [ ] Measure the cost on a bad case — multi-disc, dense relationships: response
      size, parse time and wall time. The queue still spaces requests 1.1 s
      apart and nothing loops per track.
- [ ] `describeRelease` fills one value per new field; the field rows are the
      same eleven-plus-eight table plus the new ones, so `aggregateFields`,
      `tagValue` and the window need no per-field code.
- [ ] Alias collapse for every field MusicBrainz spells more than one way. Today
      that is country, status and type; each new field is checked for a second
      spelling before it is offered.
- [x] Cache across dialog openings (the 0.4.0 leftover). It lives in a
      container `init.js` creates on the main window — read by every dialog
      through `app.dialogs.getMainWindow().getValue`, the mechanism
      MediaMonkey's own `windowsCache` uses — under `lovesMBzFetchCache`, the
      only object two dialog windows share. A dialog cannot install a value on
      the main window, so the container is owned there and filled in place. A
      file cache was rejected: reference data must not be mistaken for library data, and
      300 KB per release does not belong in a settings file. A parsed release
      and a group listing are valid for **30 minutes** and for the life of the
      process, capped at 8 releases and 4 groups (oldest out), and a store from
      another build is emptied rather than read. Without a restart the new
      container does not exist yet, so windows cache separately until then —
      the same rule as the dialog page — and the window says so once in the
      diagnostic log, rather than silently caching alone.
- [x] Test the reuse: a second window opening the same album makes no request,
      an entry older than its lifetime is fetched again, the bound drops the
      oldest, a store from another build is replaced, and `clearCache()` empties
      both halves.
- [ ] Not offered, with the reason in the table: `SCRIPT` (the write contract
      bars it, even though `text-representation.script` arrives anyway), user
      ratings, user tags and collections (need the user's OAuth), annotations
      (long free text), cover art (a URL, and another service).
- [ ] `tests/tag-path.test.js`: the field tables and their aliases, no `SCRIPT`,
      one write path, and the extra includes still in one release request.
- [ ] `TECHNICAL.md` gets the audit table (field, source, include,
      destination), the README's field list matches it, and the changelog names
      what was added and what was refused.

### 0.7.1 — "MBZ tags to use": a saved set, tabs, and a configuration page

The user chooses once which fields the add-on offers; any selection can
override that choice; and the window stops being one long scroll of cards.

**Started and in place:** the saved set, both tabs, the catalogue, and the
panels built from script when the page has neither. Not yet verified in
MediaMonkey — the guard checks the set's round trip and the split, not what the
host draws.

- **The saved set.** Stored with the add-on's own settings (`app.getValue` /
  `app.setValue`, the way `init.js` remembers the toolbar offer): one key
  holding field keys from `NATIVE_FIELDS` and `TAG_FIELDS`, versioned so a
  later release can migrate it. A missing key, or a key this build does not
  know, falls back to today's list — so installing 0.7.1 changes nothing until
  the user edits the set.
- **Two levels, not two settings.** The saved set decides which field rows the
  window *offers*; the ticks in **Fields to write** still decide what *this*
  Apply writes. Ticking or unticking there is the per-selection override and
  touches no setting. **Save as default** writes the current ticks back to the
  setting; **Reset to saved** returns to it. Nothing in this path writes tags:
  the files change only on Apply, through `applySelectionAsync`.
- **Tab 1 — ID and changes.** Every card the window has today: the
  release-group card with the release ID field, the release card, **Fields to
  write**, **Selected tracks**, and the **MusicBrainz tags** editor.
- **Tab 2 — MBZ tags to use.** The catalogue: album fields and track fields,
  each with its native column or Picard tag name beside it, the saved-set ticks,
  **Save as default**, **Reset to saved**, and one sentence saying what the set
  is for. A field the release did not supply is still listed, marked as not
  supplied by this release, so it cannot look like a lost setting. That mark is
  `suppliedFields(release)` — the release before any comparison — and not the
  plan: the plan carries only the fields that differ, so a field equal to the
  library's value would otherwise read as one MusicBrainz never sent.
- **The strip is the host's `Tabs` control.** The `{name, order, load(track,
  dialog)}` model belongs to the properties dialog's own tab list, not to the
  control: `Tabs` takes a title and any content panel (`addTab(title, panel)`),
  which is exactly the two panels this window has. So the window hands it the
  panels and the host draws the strip, the selection and the keyboard
  behaviour. A host without the control gets the window's own `.mbzButton` bar
  instead, with `showTab` as its switch, so a missing control costs the native
  look and nothing else. The guard can check the wiring, not the host's
  drawing.
- **The stale page.** `AGENTS.md`'s rule applies in full: MediaMonkey keeps the
  dialog page it loaded at start-up, so the tab bar and the first panel are
  built from `dlgMBzTag.js` when the installed page has neither — exactly like
  the release-group card and the busy ring. The catalogue card is never written
  into the page: `panelTagSet` is a mount point and `buildFieldSetPanel()` draws
  the card for a fresh page and an older one alike, so the fallback cannot drift
  from a second copy of the markup.
- **The guard has to be changed deliberately.** `tests/tag-path.test.js` pins
  one `.mbzTagScroll` with `overflow-y: auto`, `fitScrollColumn` sized from
  `basis * 0.68`, the `.mbzSection` rhythm and `qid()` ↔ `data-id` parity. Two
  panels mean one scroll column per panel (or one inside the tab body); that is
  a guard update with its own test, not a workaround, and `fitScrollColumn`
  has to run again when a tab is first shown.
- [x] The saved set: read, fall back, version, write on **Save as default**.
      `lovesMBzFieldSet` as `{version, keys}`, read and written only by
      `mbzApply.readFieldSet` / `writeFieldSet`; a missing setting, another
      version or an unknown key falls back to the whole catalogue, and an empty
      list is kept as the user's answer.
- [x] Per-selection ticks that never touch the setting; **Reset to saved**.
- [x] The two tab keys, and which cards sit in which panel.
- [x] The panels built by script when the page has none; the catalogue card is
      always drawn by the script into its mount point, never duplicated in the
      page.
- [x] The footer pending-work summary (UI 1.1) counts the rows that exist, and
      says so when the saved set leaves nothing to offer.
- [x] Guard: tab split, saved-set round trip, no tag write from the tag-set tab.
- [ ] `TECHNICAL.md` and `README.md` describe the setting and the two tabs
      (written); the changelog entry is due at release, as usual. UI-ROADMAP's
      3.1 closes with this release.
- [ ] Open the window in MediaMonkey on a fresh install (no setting) and with
      every field turned off: both tabs draw, the catalogue marks what the
      release did not supply, and an old page still gets the tabs.

#### The add-on's configuration page

The saved set's first editor was the tag window's second tab, so the general
setting could not be reached from where MediaMonkey keeps add-on settings: a
fresh install had no Configure button and the window was the only way in. The
same setting now has a page of its own.

- **One setting, two views.** `info.json` names `config.js`, so **Tools →
  Addons → Loves MBz → Configure** opens a panel that lists the catalogue and
  writes `lovesMBzFieldSet`; the window's tab reads and writes the same key, so
  neither view can drift from the other. Nothing here touches tracks or tags.
- **The tab strip is the host's.** The window first drew its own buttons, on
  the reading that `Tabs` needs a per-track loader; `addTab(title, panel)` takes
  any panel, so the two panels are handed to the control and the window's bar
  stays only as the fallback for a host that has none.
- **The list is the engine's, written into the page.** One checkbox per
  catalogue entry, in two groups (album fields, track fields), each labelled
  with the Picard tag or native column it is written as and marked `extended
  tag` or `MediaMonkey field`. The page cannot load
  `mbzApply` from the Addons dialog, so `tools/build-mmip.js` writes
  `fieldCatalogue()` into the page's `data-fields` when it builds — into the
  source page too, like `BUILD_TIME` — and the guard fails when that list is
  stale. The page keeps only the set rule, held to `readFieldSet()` fixture by
  fixture; where the engine is on that window it asks it instead.
- **rc1's crash was the loader, not the install.** Inside the Addons dialog
  `localRequirejs` resolves against MediaMonkey's own scripts, so
  `localRequirejs('mbzApply')` asked for `//mediamonkey5/mbzApply.js` and raised
  the host's exception dialog before `window.configInfo` existed. The page calls
  no loader at all, and the guard fails if one comes back.
- **A failed page says why, and writes nothing.** A control that will not
  initialise replaces the rows with a sentence naming the failure, and `save`
  returns before touching the setting: a failure must never be saved as "every
  field off", nor look like an add-on with no fields.
- **The guardrail is stated, not stretched.** `AGENTS.md` records the one
  exception: the page runs inside MediaMonkey's Addons dialog, stages only
  `lovesMBzFieldSet` for the host's OK, and touches no track, tag or file.
  Writing each tick would not narrow the exception — the page would still run
  in the host's dialog — and would make Cancel lie.
- [x] `config.js` and `config.html`, named in `info.json` and carried by the
      packager.
- [x] The guard drives `load` and `save` through `window.configInfo`: the rows
      are the catalogue, the ticks are the saved set, save writes exactly those
      keys, and a page without the engine leaves the setting alone.
- [ ] Open **Tools → Addons → Loves MBz → Configure** in MediaMonkey: the panel
      draws every field in two groups, OK saves, and reopening shows the same
      ticks. Pull `mbzApply.js` out of the install and reopen it: the panel must
      say the engine did not load and change nothing.
- [x] `README.md` and `TECHNICAL.md` describe the page, and the changelog entry
      is written for the release.

## 0.8.0 — general UI revision (TBD)

Placeholder: the scope is not set yet. It takes what UI-ROADMAP has left after
0.7.1 — the single notice area and copyable failure report (1.6), hierarchy and
vocabulary (1.7), window context, resize and keyboard (1.8), plurals (1.9), the
control conversion and the IDs dialog work in Phase 2, shared styling and the
theme pass — and it is where the audit's "rendered screens have not been
captured" stops being true.

To settle before it is numbered: one revision or the remaining phases in order;
cover art in the header (3.3); a filter for large selections (3.4); copy depth
(3.5); and the open questions in UI-ROADMAP's *Decisions needed* that 0.7.1
still leaves — a confirmation sheet above a threshold, and whether a close
window may guard unsaved edits. The All/None control (3.2) is partly answered
by the tag set and only needs the per-scope counts.

## 0.9.0 — cover art

Not scoped yet; the shape is already visible in what the lookup returns.

- **What MusicBrainz reports is free.** `cover-art-archive` arrives in every
  release lookup (`artwork`, `front`, `back`, `count`, `darkened`) and the
  add-on currently reads none of it. That is enough to say whether artwork
  exists without another request — see the field table in
  [TECHNICAL.md](TECHNICAL.md#the-release-response-field-by-field).
- **The images themselves are another service.** The Cover Art Archive
  (`coverartarchive.org`, backed by archive.org) is a different host with its
  own rate limits and its own failure modes, so it goes behind the same queue
  and `User-Agent` as the release lookup, and its errors are reported as its
  own, not as MusicBrainz ones.
- **Two separate jobs.** Show the front cover in the window so the release in
  hand is obvious at a glance (UI-ROADMAP 3.3, which is where the header work
  already sits), and write artwork into the library or the files, which is the
  larger half and needs its own decision.
- **Artwork is not a tag.** MediaMonkey keeps artwork as its own record, so
  whatever writes it does **not** go through `mbzApply.applySelectionAsync` —
  the one write path in `AGENTS.md` stays the only writer of tags and native
  fields. Nothing may silently replace existing artwork: a release that
  already has a cover keeps it unless the user says otherwise.
- Open questions to settle before this is numbered: write to the file or to
  the library row; front only, or every image the archive holds; which size
  and quality; what the window shows when the archive has nothing or is
  unreachable; and whether a download is cached the way parsed releases are
  (0.7.0's shared cache is the obvious place for the *availability*, not the
  bytes).

Checklist, once the questions above are answered:

- [ ] The window's header shows the front cover, or says the archive has none.
- [ ] Artwork writes are a separate, confirmed path outside the tag write path.
- [ ] One request at a time, spaced and attributed like every other request.

## Nice to have

- Moved to **0.7.0**: conductor, genre and the other relational credits, with
  the rest of what the release carries.

## Backlog

- [x] **MusicBrainz links in the track-list context menu** — right-click a track
      in table view and open its release, release group or artist page directly
      (**MusicBrainz links** submenu, also under Edit → Tag Tools).
- Add ideas here as they come up.
