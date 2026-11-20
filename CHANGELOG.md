# Changelog

All notable changes to Loves MBz, newest first. Version numbers match
`info.json` and the git tags. A test build names its channel in the window
footer and in the package, because `info.json` must stay three numbers.

## 0.5.3 "Responsive" (2026-11-20)

The window says when it is working, and stops drawing cards it has nothing to
put in. "Responsive" because every wait in the window — saving an album release
ID, reloading after **Apply** — is now visible while it happens, instead of the
window looking stuck.

- **The window shows that it is working.** Saving a release ID starts a release
lookup in the background, and reloading after **Apply** reads the selection
again; until now the only sign of either was a sentence, and **Save ID** stayed
clickable. A small ring now turns beside the header sentence for as long as
anything is being read or written, **Save ID** is greyed for the duration, and
the window's cursor becomes the system's progress cursor. The ring is counted,
not flagged: saving an ID, the reload behind it and Apply's write run on top of
one another, so it stays up until the last of them has finished.
- **The ring does not depend on the page or the skin.** Like the italics and the
card gap, `dialogs/dlgMBzTag.js` builds it when the host is still serving an
older copy of `dialogs/dlgMBzTag.html`, and its size, border and colour are
pinned inline because MediaMonkey applies its skin sheet after the window's own:
styled only by the page, the element was there but drew nothing. A script timer
rotates it as well, so it turns even where the page's animation is ignored.
- **No release, no comparison cards.** An album without a release ID shows only
the release lookup and its existing MusicBrainz tags. **Fields to write** and
**Selected tracks** are not drawn at all until a release is loaded — including
right after **Save ID** succeeds — instead of standing there empty. The cards
start hidden and are cleared on every reload, so a failed or replaced lookup
cannot leave an old table behind. They also survive the skin: hiding sets the
declaration inline with `!important`.
- **Guidance reads as guidance.** The explanatory notes, the search and save
statuses, the pending-work line, warnings and Apply's report are italic, so a
sentence is not mistaken for a value. A release title in the header stays
upright. The notes and the gap are pinned inline too, so the result does not
depend on which copy of the page the host has loaded.
- **More air between the cards.** The gap is now `1rem` instead of 10px.

### Upgrading from 0.5.2

Nothing changes in the tags, the library or the write path. The release-ID
lookup, the disc/track matching, `applySelectionAsync` and the extended-tag rules
are the same; 0.5.3 changes what the window draws and what it shows while it
waits. A change to the window's page only appears after MediaMonkey is fully
restarted, because the host keeps the page it loaded at start-up.

## 0.5.3-rc5 (2026-11-19)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The ring is visible now.** rc4's ring was drawn only by the dialog's own
stylesheet, and the host applies its skin sheet afterwards: the element was
there, but it lost its border and size and drew nothing. Its shape, size and
colour are now pinned inline as well — the same fix the italics and the card
gap needed — so the skin cannot take them away.
- **It turns even where the page's animation is ignored.** A script timer
rotates the ring as well; the CSS animation simply wins when it does run. It is
larger and darker than before, so it reads at a glance.
- **A busy pointer while anything runs.** The window's cursor becomes the
system's progress cursor for the duration of a lookup or a write, so the wait
is visible even away from the ring.

## 0.5.3-rc4 (2026-11-19)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The window shows that it is working.** Saving a release ID starts a
release lookup in the background, and until now the only sign of it was the
sentence next to the field. A small ring now turns beside the header sentence
while anything is being read or written, and **Save ID** is greyed for the
duration. The ring is counted, not flagged: saving an ID, the reload behind it
and Apply's write run on top of each other, so it stays up until the last of
them has finished.
- **The ring does not depend on the page.** Like the italics and the card gap,
`dialogs/dlgMBzTag.js` builds it when the host is still serving an older copy
of `dialogs/dlgMBzTag.html`, so the feedback appears before MediaMonkey is
restarted.

## 0.5.3-rc3 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **Style pinned from script.** Hiding worked, but the italic notes and the
wider card gap did not change on screen: they lived in the dialog's stylesheet,
and the host was still serving the previous page while running the new script.
Both are now applied inline at start-up — `font-style: italic !important` on
every guidance label, `margin: 0 0 1rem 0 !important` on every card — so the
result no longer depends on which copy of the page the host has.
- **Every guidance line is italic.** `setSummary` treats a sentence as an aside
by default and only a loaded release title is upright, so statuses set before
the release is read ("Reading the selection…", multi-album, read errors) are
covered too.

## 0.5.3-rc2 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The cards hide even under the skin.** MediaMonkey's stylesheet is applied
after this window's and styles `fieldset`, so `display: none` on a class was
being outranked: an album with no release ID still drew the empty **Fields to
write** and **Selected tracks** cards. Hiding now also sets the declaration
inline with `!important`, the same technique that keeps the host's `Edit`
controls in check. The field card additionally refuses to return until
`hasRelease` is true.
- **The italics and the 1rem gap survive the skin.** Both are marked
`!important` so a host rule cannot reset them.

## 0.5.3-rc1 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **No release, no comparison cards.** An album without a release ID now shows
only the release lookup and its existing MusicBrainz tags. **Fields to write**
and **Selected tracks** are not drawn at all until a release is loaded —
including right after **Save ID** succeeds — instead of standing there empty.
The cards also start hidden and are cleared on every reload, so a failed or
replaced lookup cannot leave an old table behind.
- **Guidance reads as guidance.** The explanatory notes, the search and save
statuses, the pending-work line, warnings and Apply's report are italic, so a
sentence is not mistaken for a value. A release title in the header stays
upright; the "Reading the release…" and no-release sentences do not.
- **More air between the cards.** The gap is now `1rem` instead of 10px.

## 0.5.2 "Prettier" (2026-11-15)

A window you can read at a glance, and an Apply button that cannot be pressed
before there is a plan or while a write is running. "Prettier" because the
release is the 0.5 line's pass over the window itself: four cards instead of one
long sheet, a preview table about the music rather than its identifiers, and a
footer that says what a click will do.

- **The window reads in cards.** **Release**, **Fields to write**, **Selected
tracks** and **MusicBrainz tags** are now drawn as the rounded, titled box
MediaMonkey's own settings panels use — a fieldset with its legend — matching
ParaDeeJay's settings UI. The release overview and the album release ID share
one card; a card with nothing in it is not drawn, and a release that disappears
no longer leaves the previous overview on screen.
- **Apply waits for a plan.** The button is greyed out, with a tooltip saying
why, until the release comparison has produced a plan and while a reload is
re-reading the selection after an apply or a **Save ID**. It can no longer
report `Updated 0 of 0 tracks` because it was pressed while the window was
still loading.
- **A write locks the window.** While **Apply** runs, the field checkboxes, tag
values, **Add** row, **Save ID**, the library suggestions and the disagreement
strip's buttons are disabled. Previously only Apply itself was greyed out, so an
edit typed during the run was silently discarded by the reload that followed.
The lock clears when the run finishes, including when a track fails; Party Mode
stays read-only as before.
- **Apply says what it will write.** The footer beside **Apply** states the
pending work — for example `Will write 9 field changes on 5 tracks · 2 tag
edits` — and updates as fields are ticked, tag values are typed and tags are
cleared. Field changes are counted per track, so a field that differs on four
tracks counts as four. With nothing staged the line says so, instead of leaving
Apply's effect to be discovered. Party Mode shows no line, because nothing can
be written there.
- **The preview table pairs artists instead of listing ISRCs.** **Selected
tracks** now shows **Library title**, **Library artist**, **Release title** and
**Release artist**, side by side, and the **ISRC** and **Recording ID** columns
are gone. ISRCs and recording IDs are still fetched and still written to the
tags; they just no longer take width in the window. An unmatched track shows a
dash where the release title and artist would be.
- **Retry a lookup that failed.** When MusicBrainz is busy, does not answer or
cannot be reached, the window offers **Retry** beside the message. It repeats
the release lookup in place, so the window no longer has to be closed and
reopened, and tag edits made before the failure survive. A release ID that
MusicBrainz does not have gets a "check the release ID" note instead, because
retrying that cannot help.

### Upgrading from 0.5.1

Nothing changes in the tags or the library. The write path, the release-ID
lookup and the extended-tag rules are the same; 0.5.2 changes how the window
presents them and when **Apply** is available.

## 0.5.1 (2026-11-12)

"Tag from MusicBrainz" as it ships: the first public build of the 0.5 line,
combining the 0.5.0 rewrite with the fixes and polish below.

- **`mbzApply.js can't be loaded! (NOT FOUND)` on Tag from MusicBrainz.** The
  action called `localRequirejs` from inside `script://actions`, where the loader
  resolves paths against MediaMonkey's own script and aborted before the window
  opened. The engine is loaded by `init.js` at start-up instead; if it is
  missing, the action now opens the window and logs the reason.
- **The toolbar button sits with the other tool icons.** 0.5.1 appended the
  action to `toolbarItems`, the *custom* toolbar, which drew it on a row of its
  own. It is now added to `righttoolbuttons` with `uitools.addToolButton`, on
  start-up, and a stale `toolbarItems` entry is removed. The one-time offer
  prompt is gone: the button is always there.
- **The window scrolls.** One scrolling column, with the summary block and the
  **Apply** footer pinned, instead of a dialog that grew past its own footer.
- **Album, release group and album artist links** — **Open in MusicBrainz**
  under the release title opens the release, its release group and the album
  artist, from the fetched release or, when the album has no release ID, from
  the library rows.
- **The album's release ID is editable in the window.** **Album release ID**
  validates the value as a MusicBrainz UUID, confirms before replacing an
  existing ID (naming the album and the number of tracks it covers), writes
  `Albums.MBGID` through `mbzMbgid.setAlbumGuidAsync`, and reloads the window on
  the new release. An empty value clears the ID and shows the no-ID state. The
  write never goes through `applySelectionAsync`.
- **Version and build stamp.** The window footer shows `Loves MBz` with the
  version and the time the package was built, so two builds of the same version
  can be told apart. `node tools/build-mmip.js` writes the time in as it
  packages; the version half is checked against `info.json` by the regression
  test. The packager runs that test first and refuses to build when it fails.
- **The window uses MediaMonkey's own controls.** Every text field and the tag
  picker are the host's skinned `Edit` and `Dropdown` controls (the dialog loads
  `commonControls.js`), so they are the same height as the rest of the
  application. Native `<input>`/`<select>` elements were drawn oversized by the
  skin and ignored every stylesheet and inline rule aimed at them. The
  **Album release ID** field takes the row's width so a 36-character UUID is
  readable, and both field rows are centred vertically.
- **Only the selected tracks are listed.** The release-wide track preview and
  its **Show all release tracks** button are gone.
- **Table headers match their data and stay out of the way.** They are
  left-aligned over their columns — the skin centres `th` — and a header row is
  hidden when its table has no rows, for example an album without a release ID.
- **Original year is no longer offered.** The native **Original year** field
  landed in the same library field as the original date and overwrote it, so the
  field is gone (the `originalyear` tag was already excluded).
- **Apply cannot hang any more.** Reading the extended tags, writing them and
  the commit each have a 30-second deadline: a stalled track is reported as
  failed and the rest still commit, instead of the window sitting on
  **Writing…** with half the selection written. The status line counts
  `Writing 3 of 8…` as it goes, and the report names every failed track with its
  error, up to six of them, then `...and N more.`.
- **The toolbar button works on a fresh start.** Opening it when MediaMonkey has
  just started and tracks are already selected used to do nothing until the
  selection changed, because the host reports no "last focused" track list yet;
  the window now looks for the selection in the main panel.

## 0.5.0 "Tag from MusicBrainz" (2026-11-11)

- **One window does the tagging.** **Edit → Tag Tools → Tag from
  MusicBrainz…**, the track-list context menu and a toolbar button all open the
  same window on the current selection. It shows the release, the selected
  tracks with the release row each one matched, the differing fields with one
  checkbox each, and the selection's MusicBrainz extended tags. Nothing is
  written until **Apply**; closing the window writes nothing.
- **The Track Properties tab is gone.** 0.4.x staged values inside
  MediaMonkey's dialog and relied on its group save, which rebuilds
  `modified`/`tagModified` from its own checkboxes and commits a proxy holding
  one value per field. Per-track titles, composers, disc numbers and recording
  IDs could not be expressed, and an abort could leave the selection half
  written. The add-on registers no `propertiesTabs` tab any more.
- **Per-track writes.** `mbzApply.applySelectionAsync` is the only write path:
  each track gets its native fields, then one read and one merged
  `ExtendedTags` write (fill tags and tag edits together), then one
  `commitAsync()`. A failing track is reported and the rest still commit, and
  the status line reads `Updated X of N tracks. Skipped S. F failed.`
- **Toolbar button.** The action is `hotkeyAble` with the add-on icon, so it is
  available under Options → Layout → Toolbar and can be hotkeyed. The add-on
  offers to add it to the toolbar once, remembers the answer, and never injects
  a DOM button into MediaMonkey's toolbar container, which is rebuilt from
  `toolbarItems` on every settings change.
- **One album at a time.** A selection spanning more than one album ID is
  refused unless the user confirms a prompt that names the album count and the
  shared release ID when there is one. Then the first album's release is used
  and every selected track is matched by disc and track number.
- **Tag table in the window.** The MusicBrainz extended-tag editor moved out of
  Track Properties: view, edit, add, delete, one row per ID for slash-joined
  artist IDs, musicbrainz.org links, **From the library** suggestions and the
  tag-vs-library disagreement strip. Every tag change is written per track by
  **Apply**.
- **Kept from 0.4.x** — lookup by release ID only with no name search, the
  website search button when an album has no ID, `discNumberInt` for Disc #, no
  `SCRIPT` write, alias collapse for release status/type/country, the Discogs
  URL from the release or its release group, and library-side ID writes only
  where they already were.

## 0.4.5 (2026-11-11)

- **Search MusicBrainz from the no-ID state** — when an album has no
  `Albums.MBGID`, the preview and the Track Properties tab now offer **Search
  MusicBrainz**. It opens the website's release search with `release:"Album"
  AND artist:"Artist"`; the add-on still makes no metadata request and does not
  choose a release. The tab checks the album's release ID as it loads — and
  each distinct album in a group selection — so the button appears before Fill
  even while the ID cache is still filling. The preview reads the loaded
  selection through `getAllValues` so it appears even when MediaMonkey has not
  exposed `firstSelected` yet.

- **Discogs URL from release groups** — a master Discogs page is usually linked
  from the release group, not the release. The fetch now follows one
  `release-group/{id}?inc=url-rels` lookup when the release itself has no
  Discogs URL, and `discogs_url` reads either level.
- **Disc # writes through the integer property** — Fill and Preview now stage
  `discNumberInt` instead of the string `discNumber`. The string property can
  trigger a group commit as soon as it is assigned, which saved only part of a
  multi-track Fill; the integer property writes the same value through the
  normal native-field staging.

## 0.4.4 (2026-11-10)

- **Release fields no longer duplicate** — Fill treats Picard's
  `MusicBrainz Album Release Country`, `MusicBrainz Album Status` and
  `MusicBrainz Album Type` as the same fields as `RELEASECOUNTRY`,
  `RELEASESTATUS` and `RELEASETYPE`. It updates the spelling already in the
  track, and collapses existing duplicate spellings when the field is next
  written, instead of adding a second copy. Add tag uses the same matching.
- **Script is no longer written** — Fill no longer offers or writes the
  `SCRIPT` extended tag. Existing values are left in place; the preview still
  shows the release's script as read-only metadata.
- **Group Fill save path unchanged** — 0.4.4 leaves the 0.4.3 per-track save
  order alone: each track's native fields are staged before its extended tags,
  and MediaMonkey's normal group save commits them. The duplicate repair changed
  only which tags Fill writes, not how the dialog saves.

## 0.4.3 (2026-11-09)

- **Composer and lyricist** — Fill now reads the work linked to each
  recording and writes MediaMonkey's native Composer and Lyricist columns.
  Multiple names are deduplicated and joined with `; `.
- **Generic writers** — works that only use MusicBrainz's generic `writer`
  relationship now fill Composer and are also written to the `WRITER` extended
  tag. Specific composer relationships win when both exist.
- **Producer and remixer** — Fill now reads release and recording
  relationships and writes `PRODUCER` and `REMIXER` extended tags. Multiple
  names are deduplicated and joined with `; `.
- **Group Fill native fields** — Composer and Lyricist are staged before the
  extended tags. MediaMonkey's normal group save then commits the native
  fields with the same model as the rest of Fill; there is no per-track
  commit loop.
- **Full group selection** — group Fill now merges the Properties dialog's
  group tracklist with the main selected tracklist. The dialog list can be
  shorter than the selection, which previously staged Composer on only the
  first few tracks while the group tag patch reached all of them.

## 0.4.2 (2026-11-09)

- **No new duplicate tag aliases** — saving a tag that already exists under
  another file-format spelling now updates that entry and keeps its raw title,
  instead of appending an uppercase `MUSICBRAINZ_*` copy. Add tag follows the
  same rule, and Fill's merge collapses aliases when it writes the field.
- **Group OK cannot hang** — group saves no longer read extended tags from the
  group proxy, whose promise never completes. The deletion-aware patch is set
  directly on the group track, and tag reads, writes and Fill stages have
  bounded waits so OK can finish or report an error instead of leaving the
  modal open.

## 0.4.1 (2026-11-09)

- **Fill saves with Track Properties OK** — the separate **Apply selected**
  button is gone. Multi-track Fill now stages the selected fields on the
  selected tracks and lets MediaMonkey's global OK commit them through the
  normal group save, so a slow track is no longer reported as a 15-second
  timeout. Opening the Fill plan marks the group dialog dirty and ticks
  **Save MusicBrainz tags**, so global OK schedules the save reliably. Cancel
  discards the pending fill.

## 0.4.0 "Foundation" (2026-11-08)

The first release of the MusicBrainz metadata work. MediaMonkey requires a
three-number version, so `info.json` says `0.4.0`; the release asset is
`LovesMBz.mmip` from tag `v0.4.0`.

- **Lookup fix** — the request no longer sends `text-representation`, which
  MusicBrainz rejects for releases with HTTP 400. The release response still
  carries script and language, so the `SCRIPT` tag is unaffected, and a failed
  request now includes MusicBrainz's own error text instead of just the status.
- **Multi-track fill** — selecting several files and pressing **Fill from
  MusicBrainz** fills each matching disc/track and saves those tracks
  immediately when **Apply selected** is clicked; the checkbox list is the
  confirmation, and Cancel cannot undo it. Group fill reads extended tags with
  one database query, reports release and track progress, and times out a
  stalled request or save instead of leaving the button disabled.
- **Disc/track matching** — files with no disc tag are matched to the first
  disc, a single-disc release matches by track number alone, and releases whose
  track positions are not plain numbers (vinyl A1/B1) use the medium position.
  Preview writes the missing native Disc # from the matched medium; a Disc #
  that is already set is left alone.
- **Edit-tag menu icons** — all Loves MBz entries use the same theme-coloured
  `lovesMBz.svg` as MusicBrainz IDs, instead of the artwork that was unclear at
  24×24.
- **Per-field selection** — Fill now lists every differing field with a
  checkbox. Apply selected stages only the ticked fields for one track, or
  saves only those fields for a multi-track selection. The per-tag **All tracks**
  boxes in the MusicBrainz tab use MediaMonkey's native Checkbox control, so
  they match **Save MusicBrainz tags** instead of drawing a blue browser
  checkbox.
- **Credits and labels** — every label on the release is joined into
  `publisher` instead of only the first.
- **Multi-value artist fields** — MediaMonkey's native Artist and Album Artist
  now receive `Isaiah Rashad; SZA` rather than the joined phrase. The joined
  credit is kept in the `ARTISTS` and `ALBUMARTISTS` extended tags for
  pipelines that need it.
- **Years and original date** — Fill writes the native year and original year
  alongside date and original date, and adds Picard's `originaldate` tag. The
  `originalyear` extended tag is no longer offered or written: some libraries
  use it for a full `YYYY-MM-DD` date, and replacing that with only the year
  loses the month and day.
- **Track-count warnings** — preview warns when the MusicBrainz release and
  the local album have different numbers of tracks, and the tag-vs-library
  warning fetches both release IDs and reports when their track totals differ.
- **Preview fixes** — the preview waits for MediaMonkey's selected tracklist
  to finish loading before reading its album, so a valid selection no longer
  opens as "No album is selected"; a reopened dialog clears the previous
  release before showing the new one. The album tracklist is read under a read
  lock, so the preview no longer fails with "Read lock not acquired!"; the
  field chooser is capped at its own height with a scrollbar, and the track list
  takes the remaining height as a native scrollable list, so a 30-track release
  scrolls inside the dialog instead of expanding it. The redundant bottom-right
  Close button is removed; the window's close icon closes the preview. The
  release details are arranged as two
  label/value pairs per row, and the dialog opens at 1200×960 so more of the
  release fits without resizing. Field rows use MediaMonkey's own checkboxes and
  can be selected again. The native Date field is always offered, separately
  from Original date, so the release date can be written to MediaMonkey's own
  date.
- **Metadata lookup by release ID** — the album's `Albums.MBGID` is the only
  input: one `release/{mbid}` request supplies IDs, credits, label, catalogue
  number, barcode, status, type, country, date, script, language, ISRCs and the
  track list. An album without a release ID is reported and never searched for.
  Requests are serialized at least 1.1 s apart with a descriptive User-Agent and
  backoff on 503/429.
- **Preview before writing** — compare the current album and track values with
  the fetched ones, tick the fields to write, then **Apply**. Only values that
  actually differ are offered, and nothing is cleared.
- **Fill from MusicBrainz** in Track Properties → MusicBrainz stages the open
  track's native fields and extended tags after choosing fields; **OK** is the
  save gate. Library tracks match release tracks by disc and track number,
  never by title.
- **Discogs URL** — when the release has a Discogs relationship its URL is
  written as the plain `discogs_url` extended tag, visible in MediaMonkey's
  built-in Custom tab.
- **Dates** — `date` and `origDate` are written as the numeric `YYYYMMDD`
  MediaMonkey expects; the dialog shows and compares ISO dates.
- Album and artist ID columns are never written, so a fetched ID cannot
  overwrite the library ID the lookup came from.

## 0.3.12
- **One row per artist** — a MusicBrainz tag that stores several IDs in one value
  (an ID3v2.3 MP3 joins artists with `/`) is now shown as one editable row per
  ID, each with its own link, instead of a single value the user had to split by
  hand. Clearing a row drops that artist and keeps the rest; on **OK** the rows
  are merged back into the single stored value, keeping the `/` or `; `
  separator the file already used.
- **Adding an artist ID extends the tag** — picking `MUSICBRAINZ_ARTISTID` or
  `MUSICBRAINZ_ALBUMARTISTID` in **Add tag** now appends to the tag that is
  already there rather than creating a second entry with the same name. The
  stored IDs keep their order and the new one goes last; an ID the tag already
  has changes nothing.

## 0.3.11
- **Slash-joined artist IDs** — an ID3v2.3 file has no repeated text frames,
  so MediaMonkey stores a multi-artist `MUSICBRAINZ_ARTISTID` as one value
  joined with `/`. The Track Properties tab now reads that as several IDs, gives
  each artist its own link, and keeps the `/` separator when the value is saved
  instead of rewriting it to `;`.

## 0.3.10
- **Scoped cache refresh** — a change event now re-reads only the album row, the
  track's artist links or the songs of the artist it names, instead of clearing
  and reloading every lookup table. A large library no longer does a full pass
  after each edit.
- **MusicBrainz links in the track-list menu** — right-click a track (or use
  **Edit → Tag Tools**) and pick **MusicBrainz links** to open its release,
  release group or artist page; only the IDs that track actually has are
  offered.
- **New icon** — the menu icon follows the skin's colour again (white on dark
  themes) instead of carrying its own dark fill, and the add-on icon is now the
  square PNG, so the install dialog shows it fitted rather than overflowing.

## 0.3.9
- **Columns refresh themselves** — the lookup tables behind the three track-list
  columns are rebuilt when MediaMonkey commits a change, so IDs matched through
  MediaMonkey's own MusicBrainz lookup appear without restarting. The
  **Tools → reload MusicBrainz ID cache** entry is gone; the IDs dialog still
  queries the database every time.

## 0.3.8
- **Shorter Add tag picker** — the dropdown lists the MusicBrainz tag names only
  instead of each name plus its description, so the value field beside it gets
  the width. The description is still available as the option's tooltip.
- The explanatory line above the table in a group selection is gone; the tab
  opens straight onto the tags.
- New icon artwork for the menu and the add-on.

## 0.3.7
- **Group edits are saved** — with several tracks selected, MediaMonkey decides
  whether anything changed from the ticked boxes beside its own fields, so an
  edit made only in the MusicBrainz tab was dropped unless another tag was
  edited too. The tab now has a **Save MusicBrainz tags** box that ticks itself
  on any change; unticking it discards the tab's pending edits.
- Tag rows no longer repeat the tag name as a description underneath; only the
  row's state (not saved yet, missing on some tracks) is still spelled out.
- The tab uses the dialog's font instead of a monospace one.

## 0.3.6
- **Filling an empty library ID no longer asks** — when the album or artist row
  has no MusicBrainz ID yet, **Update library** writes the tag's value straight
  away, because there is nothing to overwrite. The confirmation stays for
  replacing an ID that is already there.
- Shortened the add-on description.

## 0.3.5
- **Tag vs. library warning for selections** — the strip now also works with
  several tracks selected, comparing the shared tag with the album and artist
  rows of those tracks as long as the rows agree. **Use library ID** applies to
  every selected track; **Update library** appears only when the selection
  resolves to a single album or artist, so one tag ID is never written across
  unrelated albums.

## 0.3.4
- **Tag vs. library warning** — a single track whose release, release-group or
  artist extended tag differs from the ID on its `Albums` or `Artists` row now
  gets a warning strip. **Use library ID** copies the stored ID into the tag;
  **Update library** writes the tag's ID back to the album or artist row after
  a confirmation that says how many tracks that row covers.

## 0.3.3
- **Fill missing tags across a selection** — a tag that exists on only some of
  the selected tracks is no longer hidden. It is listed with an **All tracks**
  checkbox, and the label says how many selected tracks lack it. Ticking the box
  and clicking **OK** writes the value the other tracks already have to those
  tracks. Tags every track already carries show the box ticked and disabled.

## 0.3.2
- **Suggestions from the library** — when the database already holds a native
  MusicBrainz ID for the track's album or artists, the tab offers it as a
  **From the library** suggestion. One click adds that tag with the stored
  value, so a matched track does not need its IDs pasted in by hand. With
  several tracks selected, only IDs shared by all of them are offered.

## 0.3.1
- **Add a tag** — the MusicBrainz tab no longer stops at what a track already
  has. A picker at the bottom of the tab adds a tag the track is missing, under
  its canonical `MUSICBRAINZ_*` name, and keeps it alongside whatever the
  built-in Custom tab queued.
- **Group adding** — in a multi-track selection the same picker adds the tag to
  every selected track through the group patch, so an album can be given a
  release or release-group ID in one step.

## 0.3.0
- **Renamed to Loves MBz** — the addon id is now `lovesMBz` (was `mbzLovesMM5`).
  Remove an older install folder under the old id, or MediaMonkey loads both.
- **Group editing** — with multiple tracks selected, the Track Properties tab
  shows only MusicBrainz tags that are identical across the selection and
  applies edits or removals to all selected tracks. Per-track tags stay
  untouched.

## 0.2.0
- **Read-lock fix** — the IDs dialog now copies the selected tracks inside a
  `SharedList.locked()` callback, fixing "Read lock not acquired!" on MediaMonkey
  2024 when the selection is opened.
- **Track Properties → MusicBrainz** — a new tab lists only the MusicBrainz
  extended tags that exist in `Songs.ExtendedTags`, normalizes tag names across
  file formats, links IDs to musicbrainz.org and edits values in place. It
  re-reads the array on save and merges changes, so other extended tags survive.
- **Set ID** — select a row in the dialog and edit its release, release group
  or artist ID. Values are validated as UUIDs, the confirmation names the album
  or artist and the number of tracks it covers, and the write clears
  MediaMonkey's DB cache and refreshes the views.
- An empty field clears an ID; the bare 32-hex UUID form is accepted and stored
  in canonical form.
- The cache reload now waits for an in-flight load before rebuilding, so a
  reload during start-up cannot leave the tables half-populated.

## 0.1.0
- Initial release: three track-list columns for `Albums.MBGID`,
  `Albums.MBRGGID` and `Artists.MBGID`, plus a dialog to view and copy the IDs
  for the current selection.
