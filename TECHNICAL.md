# Loves MBz — technical reference

Everything beyond the introduction in [README.md](README.md): what each part of
the add-on does in detail, how it is put together, how to build the package, and
what to do when something looks wrong.

- [Usage in detail](#usage-in-detail)
- [How it works](#how-it-works)
- [Development install](#development-install)
- [Building an `.mmip`](#building-an-mmip)
- [Troubleshooting](#troubleshooting)
- [Layout](#layout)

---

## Usage in detail

### Showing the columns

Right-click any column header in a track list and choose **Column settings**
(or use the view's column chooser), then pick from the new **MusicBrainz IDs**
group:

- MusicBrainz Release ID
- MusicBrainz Release Group ID
- MusicBrainz Artist ID

The columns are normal MediaMonkey columns: resize, reorder, hide and show them
like any other. They are read-only.

The identifier tables load in the background once per MediaMonkey session, so
cells can be empty for the first moment after start-up. They fill in when the
load finishes and the current view is refreshed. Tracks whose IDs are `''` or
`0` in the database — MediaMonkey's "not matched in MusicBrainz" value — show
as empty.

### Viewing and copying IDs

1. Select one or more tracks in any track list.
2. Run **Edit → Tag Tools → MusicBrainz IDs…**, or the same entry in the track
   list context menu.
3. The dialog lists Track, Album, Artist, and the three IDs for up to 1000
   selected tracks, with a count of how many have each ID.
4. **Copy table** puts a tab-separated table (with a header row) on the
   clipboard, ready to paste into a spreadsheet. **Reload** re-reads the
   database, which is useful after MediaMonkey has matched new releases.

The dialog queries `Albums` and `Artists` directly every time, so it is never
stale. Artist cells list every artist MBID for the track, separated by `; `.
This dialog shows the native MBGID columns, not `Songs.ExtendedTags`; use
**Tag from MusicBrainz** for the per-track extended tags.

The column cache rebuilds itself when MediaMonkey commits a change — re-reading
only the album rows, track links and artists that the event names — so releases
and artists matched through MediaMonkey's own MusicBrainz lookup show up in the
columns without a restart, even in a large library.

### Tag from MusicBrainz

**Edit → Tag Tools → Tag from MusicBrainz…**, the track-list context menu and
the toolbar button all open the same window on the current selection. It reads
the release behind the first selected track's album: artist credit, date,
country, status, type, label and catalogue number, barcode, the Discogs page
when the release or its release group links one, script/language, and every
medium's tracks with their number, title, length and artist credit. The
Discogs link is MusicBrainz's URL relationship; a master page usually lives on
the release group. Either way it is the value Picard stores as `discogs_url`.

Under the title, **Open in MusicBrainz** links the album's release, its release
group and its album artist straight to musicbrainz.org. Those three links are
also built from the album and artist rows when the album has no release ID, so
they are there even without a lookup.

**Releases in this release group** lists every release of the loaded release's
group — title, date, country and track count, oldest first — with the loaded one
marked `✓` and a **use this** link on the rest, both flush right. The release
status is not repeated there; the release block above already names it.
MediaMonkey often matches the group's best-known release; **use this** loads
another pressing in place
and the release block, the field comparison, the track table and **Apply** all
follow it. Picking writes nothing: the album's `Albums.MBGID` still changes only
through **Save ID**, and the card is drawn only when the group has more than one
release. One `release?release-group={id}&inc=media` request supplies the list,
cached by group ID, and the plan does not wait for it.

Below the release block, **Album release ID** holds the album's `Albums.MBGID`
— the value the whole lookup is keyed on. Correct it there when the album points
at the wrong release: **Save ID** checks the value is a MusicBrainz UUID, writes
only that column, and reloads the window with the release behind the new ID. It
asks nothing first — the field exists to be saved, and the line under it reports
what was written (or why it was not). The field shows the release currently loaded, so after picking one
from the group it holds the picked ID; **Save ID** compares it with the album
row, so pressing it writes the new ID instead of reporting it as already set. An empty field clears the ID, and the window falls back to the
no-release-ID state with **Search MusicBrainz**. Like any library-side write,
MediaMonkey's own lookup can overwrite it later.

While anything is being read or written — the lookup **Save ID** starts, the
reload that follows it and **Apply**'s write — the window shows that it is busy:
a small ring turns beside the header sentence, **Save ID** is greyed, and the
pointer becomes the system's progress cursor. The ring is counted rather than
flagged, because saving an ID, the reload behind it and Apply's write can
overlap, so it stays up until the last of them has finished. It is built by the
script with its size, border and colour pinned inline, so it turns under
MediaMonkey's skin even when the host is still serving an older copy of the
dialog page.

The footer of the window shows the add-on version — `Loves MBz 0.6.1` for this
release, with a test build's channel appended — so you can tell which build is
running before trusting a screenshot or a report from an older one. The build
time follows it.

Below that, **Fields to write** lists only the fields whose MusicBrainz value
differs from the library, one row and one checkbox each, with the current value,
the fetched value and `changes / total`. A value that differs per track reads
**per track** instead of listing every value. Everything starts ticked; untick
anything you want to keep, then press **Apply**. Nothing is written before that
click.

Beside **Apply**, the footer states exactly what that click writes — for example
`Will write 9 field changes on 5 tracks · 2 tag edits` — and it updates as you
tick fields, type a tag value or clear one. A field that differs on four tracks
counts as four field changes. With nothing staged the line reads
`Nothing to apply yet — tick a field or edit a tag.`

**Selected tracks** lists the tracks you selected, each with the release row it
matched — disc/track, library title and artist, release title and artist, and
length — and how many field changes it has. A track with no counterpart says
**no match** and is skipped. Only your selection is listed: the window does not
preview the rest of the release.

The window works on **one album at a time**. A selection that spans more than
one album ID does not open until you confirm a prompt that names the albums (and
the release ID when they share one); then the first album's release is used and
every selected track is matched by disc and track number. This matters for
multi-disc releases too: MediaMonkey gives each disc its own album row.

| Written to | Fields |
|---|---|
| Native track tags | title, artist, composer, lyricist, ISRC, disc number |
| Native album-level tags | album artist and artist as `; `-separated names, date, year, original date, all labels joined into `publisher` |
| Extended tags, album-wide | `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_ALBUMARTISTID`, `ALBUMARTISTS`, `BARCODE`, `RELEASESTATUS`, `RELEASETYPE`, `RELEASECOUNTRY`, `CATALOGNUMBER`, `originaldate`, `discogs_url` |
| Extended tags, per track | `MUSICBRAINZ_TRACKID`, `MUSICBRAINZ_RELEASETRACKID`, `MUSICBRAINZ_ARTISTID`, `ARTISTS`, `WRITER`, `PRODUCER`, `REMIXER` |

Release status, type and country are matched across Picard's format-specific
names: `RELEASECOUNTRY` / `MusicBrainz Album Release Country`, `RELEASESTATUS`
/ `MusicBrainz Album Status`, and `RELEASETYPE` / `MusicBrainz Album Type`. The
window updates the spelling the track already has and collapses duplicates
instead of adding a second copy.

Composer and lyricist are native MediaMonkey fields; they come from the work
linked to each recording. A work with only generic writer relationships fills
Composer from those writers and also exposes them as the `WRITER` extended tag.
Producer and remixer are extended tags because MediaMonkey has no native
columns for them; they come from the release and recording relationships. All
of these are multivalues: names are deduplicated and joined with `; `.

Library tracks are matched to the release by disc and track number, never by
title. A library track with no counterpart in the release is left alone, and a
release track with no library counterpart is counted, so a partial match cannot
write the wrong title onto a track. Extended tags are merged into each track's
existing `Songs.ExtendedTags`: a tag already stored under another file-format
name is replaced in place, unrelated tags survive, and a field MusicBrainz has
no value for is not offered, so nothing is cleared. `discogs_url` stays a plain
extended tag, so it appears in MediaMonkey's **Custom** tab.

**Apply** writes the ticked fields track by track: that track's native fields,
then one read and one merged write of its `ExtendedTags` (the fill and any tag
changes together), then `commitAsync()`. A failing track is reported and the
rest still commit; the status line reads `Updated 12 of 15 tracks. Skipped 3
(no matching disc and track number). 0 failed.` While it runs it counts
`Writing 7 of 15…`, and when tracks do fail the report names each one with its
error. Every step — reading the extended tags, writing them, and the commit —
has a 30-second deadline, so one stuck track is reported instead of leaving the
window on **Writing…** with the rest of the selection unwritten. **Apply** is
greyed out until the release comparison has produced a plan, with a tooltip
saying why. While it runs, the field checkboxes, tag values, **Add** row,
**Save ID**, the library suggestions and the disagreement strip's buttons are
locked, so an edit cannot
be typed into a write that has already read its inputs. The window
then re-reads the
library and lists whatever is still different. Applying never writes the
album's `MBGID`/`MBRGGID` or the artist rows: the release ID is the lookup key,
so a fill cannot overwrite it. The one library write in the window is the
**Album release ID** field, which touches `Albums.MBGID` only when you press
**Save ID**. In Party Mode the window still shows the release and the tags, but
the fields, **Apply** and the ID field are hidden.

The lookup is by release ID only. The album must already carry `Albums.MBGID`
(set it in the window's **Album release ID** field or in the IDs dialog, or let
MediaMonkey match the release); when that is
empty or `0` the window says so and **no request is made**. It also offers
**Search MusicBrainz**, which opens the website release search with
`release:"Album" AND artist:"Artist"`; the add-on does not choose a release or
write an ID from that search. There is no API search by artist or album name,
no AcoustID and no disc-ID lookup, so the add-on cannot pick the wrong release.
No API key is needed: the add-on identifies itself with a `User-Agent` and
keeps requests at least 1.1 s apart. A busy server (`503`/`429`) is retried
twice with a growing delay, and the parsed release is cached by ID for the
session, so opening the same album again does not call the API. When the lookup
still fails, the window says why and, for a busy server, a timeout or a network
error, offers **Retry** beside the message. **Retry** repeats the lookup in
place, so the tag edits and every other value in the window stay; when the
release ID points at a release MusicBrainz does not have, the message says to
check the ID instead of offering a retry that cannot help.

### The toolbar button

The Tag from MusicBrainz action is a normal MediaMonkey action: it has the
add-on icon, a tooltip, and is greyed out when nothing is selected. The add-on
places a button for it in the right-hand toolbar strip, beside MediaMonkey's own
tool buttons, when MediaMonkey starts: it is added with
`uitools.addToolButton('righttoolbuttons', …)`, the same call the host uses, so
it behaves like a built-in button and survives layout changes.

The action is also listed under **Options → Layout → Toolbar** and can be given
a hotkey there. A `toolbarItems` entry left by a 0.5.0 test build — which put
the button on the custom toolbar, on a row of its own — is removed on the next
start. The button also works when MediaMonkey has just started and tracks are
already selected: if the host has no "last focused" track list yet, the window
finds the selection in the main panel.

### Setting an ID

Click a row in the table to open the editor at the bottom of the dialog. It
shows which album and which artist that row writes to, and how many library
tracks each of them covers:

```
Album "Kind of Blue" — 5 tracks    •    Artist "Miles Davis" — 214 tracks
```

Then edit the field you want:

| Field | Writes to | Affects |
|---|---|---|
| Release ID | `Albums.MBGID` | every track on that album |
| Release group ID | `Albums.MBRGGID` | every track on that album |
| Artist ID | `Artists.MBGID` | every track by that artist |

**Save changes** applies only the fields you changed. Before anything is
written, a confirmation dialog repeats the album or artist, the track count it
covers, and the old and new value. **Clear these IDs** empties the three fields
— that is the album's two IDs and the ID of the artist currently chosen in the
dropdown, not every artist of a collaboration — and goes through the same
confirmation, so it is not a one-click delete.

Values must be MusicBrainz UUIDs (`8d1a1d1e-1c1a-4d1e-9c1a-1d1e1c1a4d1e`). The
bare 32-character hex form is accepted and stored in the dashed lower-case form.
Any other input is rejected before a query runs. An empty field clears the ID.

The editor is hidden when MediaMonkey is in Party Mode, where it refuses edits
elsewhere too; the table and **Copy table** keep working.

Edits here do not touch your files or tags, and they do not run a MusicBrainz
lookup — you are supplying the identifier yourself. MediaMonkey's own lookup
can overwrite it the next time it re-matches that release or artist, which is
also why the confirmation says so.

### MusicBrainz extended tags in the window

The **MusicBrainz tags** table reads the selection's `Songs.ExtendedTags` JSON
and lists only entries whose names normalize to `MUSICBRAINZ*`. The same tag is
therefore found whether the file stores it as `MUSICBRAINZ_TRACKID`
(FLAC/Vorbis) or `MusicBrainz Track Id` (ID3 TXXX). The table does not list
`Albums.MBGID`, `Albums.MBRGGID` or `Artists.MBGID` as rows; those are separate
fields — `Albums.MBGID` has its own field above **Fields to write**, the others
stay in the columns and the IDs dialog. It does compare them with a matching tag
and flag a disagreement (see below).

Each row shows the raw tag name and its current value. ID tags link to the
matching MusicBrainz page:

| Extended tag | Opens |
|---|---|
| `MUSICBRAINZ_ALBUMID` | release |
| `MUSICBRAINZ_RELEASEGROUPID` | release group |
| `MUSICBRAINZ_ARTISTID`, `MUSICBRAINZ_ALBUMARTISTID`, performer IDs | artist |
| `MUSICBRAINZ_TRACKID` | recording |
| `MUSICBRAINZ_RELEASETRACKID` | track |
| `MUSICBRAINZ_WORKID` | work |
| `MUSICBRAINZ_LABELID` | label |

A value containing several IDs (`;`, `,`, `/` or whitespace separated) is shown
as one row per ID, each editable and each with its own link. This matters for
MP3: ID3v2.3 has no repeated text frames, so MediaMonkey writes several artist
IDs into one value joined with `/` (`8d1a1d1e…/9b7e2d41…`). Clearing one row
drops that artist and keeps the rest; on **Apply** the rows are merged back into
the single stored value, using the `/` separator the file already had instead
of rewriting it to `;`, which other players would read as one malformed ID.
On ID tags, values that are not UUIDs are kept, marked **Not a valid
MusicBrainz ID**, and not linked. Non-ID MusicBrainz tags (album
status/type/country/date, disc ID) are listed without a link.

Edit a value and press **Apply** to write it back; an empty value removes that
tag. Values made up only of valid IDs are stored in dashed lower-case form. The
window re-reads each track's current `ExtendedTags` array and merges only the
rows you changed, so non-MusicBrainz tags survive. Editing a value never writes
the album or artist database fields; only the disagreement strip below does, and
only after a confirmation — except when it fills an empty library field, which
overwrites nothing and happens immediately.

The **Fields to write** table covers the release side of the same window: native
fields (`; `-separated album artist and artist, composer, lyricist, date, year,
original date, every label joined into `publisher`, title, ISRC, disc number)
and the extended tags, including the joined credit in
`ARTISTS`/`ALBUMARTISTS`, `WRITER`, `PRODUCER`, `REMIXER`, `originaldate` and
`discogs_url`. Neither the native **Original year** field nor the
`originalyear` tag is written, because a library can store a full `YYYY-MM-DD`
date there and a four-digit year would replace it. Values that already match are skipped, and each track is matched to
the release by disc and track number. **Apply** writes the ticked fields on
every matched track and reports what happened per track. An album without a
release ID is reported without a request, and the fields and **Apply** are
hidden in Party Mode.

A track with no MusicBrainz extended tags is not a dead end. Use **Add tag** at
the bottom of the table: pick the tag, type a value and click **Add** — the new
row is marked *(not saved yet)* and is written when you press **Apply**, under
the canonical `MUSICBRAINZ_*` name. Clear the value of such a row before
**Apply** to discard it. Clearing a tag that already exists still removes it.

Adding `MUSICBRAINZ_ARTISTID` or `MUSICBRAINZ_ALBUMARTISTID` to a tag that
already holds IDs appends to that tag instead of creating a second entry with
the same name: the existing IDs keep their order, the new one goes last, and the
value keeps the separator the file uses (`/` for MP3, `; ` otherwise). Adding an
ID the tag already has changes nothing.

When the library already knows an ID, you do not have to paste it. The
**From the library** suggestions above the add row offer the selection's
`Albums.MBGID`, `Albums.MBRGGID` and `Artists.MBGID` as one-click tags, so a
track matched in MediaMonkey can be given the matching extended tag without
typing. A tag that is already listed — or already exists with another value —
is not suggested; edit its row instead. In a multi-selection a suggestion is
only offered for IDs that are identical on every selected track.

With several tracks selected, the table shows the tags whose value is the same
on every selected track that stores them — typically album-level tags such as
the release, release-group and album-artist IDs — each badged with how many
tracks carry it (`on 3 of 5 tracks`). Editing one applies the new value to every
selected track; clearing it removes the tag from every selected track, and a
tag added with **Add tag** is written to every selected track. Per-track tags
such as `MUSICBRAINZ_TRACKID` differ by design, so they are listed for a single
track.

Nothing in the tag table is written until **Apply**, and **Apply** writes each
track individually, so one failing file does not stop the rest. A track that
stores the same tag name twice is left out of a multi-selection: there is no
single row to edit.

In Party Mode the values are disabled but the links still work. The file format
must support extended tags — formats such as WAV may discard them.

### When the tag and the library disagree

The release, release-group and artist IDs exist twice: in the file's extended
tags and on the `Albums` or `Artists` row. When a single track's tag and its
library row hold different values, a strip below the tag table says so:

```
The library ID and the tag disagree:
Release ID — library 3f6a1c2e…, tag 9b7e2d41…   [Use library ID] [Update library]
```

- **Use library ID** puts the library's value into the tag row, so the next
  **Apply** saves it. The database is not touched.
- **Update library** writes the tag's value onto the album or artist row. When
  that field already holds a different ID it asks first, naming the row and how
  many tracks it covers; filling an empty field overwrites nothing, so it
  writes straight away. The tag keeps its value. MediaMonkey's own MusicBrainz
  lookup can overwrite that library value later.

The strip works for a selection as well. The tag side is the value the selected
tracks share; the library side is what their own album and artist rows hold, and
it is compared only when those rows agree — a selection spread over albums with
different IDs has no single library value to compare, so it stays quiet.
**Use library ID** fills the group row, so **Apply** writes it to every selected
track. **Update library** is offered only when the selection resolves to one
album or one artist; when it would touch several rows the strip says so instead
of copying one release ID onto unrelated albums.

The artist comparison needs exactly one artist row per selected track — a
featured or multi-artist credit has no unambiguous row and is left alone — and a
tag holding several IDs at once is not compared either. In Party Mode the strip
still reports the disagreement but shows no buttons.

## How it works

- **Columns** — `controls/trackListView_add.js` adds three field definitions to
  `uitools.tracklistFieldDefs` and a `MusicBrainz IDs` group to
  `uitools.tracklistFieldGroups`. Cells are rendered synchronously from the
  lookup tables below.
- **Lookup tables** — `mbzMbgid.js` preloads the album and artist IDs with
  paged SQL (`WHERE ID > lastId ORDER BY ID LIMIT 2000`), yielding between pages
  so a large library does not freeze the UI:

  ```sql
  SELECT ID, MBGID, MBRGGID FROM Albums WHERE ... ORDER BY ID LIMIT 2000
  ```

  and one row per song for artists:

  ```sql
  SELECT s.ID, group_concat(DISTINCT a.MBGID)
  FROM Songs s
  JOIN ArtistsSongs asg ON asg.IDSong = s.ID AND asg.PersonType = 1
  JOIN Artists a ON a.ID = asg.IDArtist
  WHERE a.MBGID IS NOT NULL AND a.MBGID <> '' AND a.MBGID <> '0'
  GROUP BY s.ID
  ```

- **Tag from MusicBrainz** — `dialogs/dlgMBzTag.js` asks `mbzFetch.js` for the
  release behind the scope's first album. `releaseIdForAlbumAsync` reads
  `SELECT MBGID FROM Albums WHERE ID = ?` and returns `''` without any HTTP
  request when the album has no ID; `fetchReleaseAsync` validates the UUID,
  serializes lookups through a queue (at least 1.1 s apart), sends a
  `User-Agent`, retries `503`/`429` with backoff, stops once the dialog has
  closed, and caches the parsed release by ID. `recording-level-rels`,
  `work-rels`, `work-level-rels` and `artist-rels` are part of the lookup, so
  work composers and lyricists and release/recording producers and remixers are
  available; `url-rels` supplies the release's Discogs page. When the release
  has none, `fetchReleaseAsync` makes one `release-group/{id}?inc=url-rels`
  follow-up for the group's Discogs master page and attaches it to the cached
  release; `discogsUrls` reads both.
- **The release group's other releases** — `fetchReleaseGroupReleasesAsync`
  makes one `release?release-group={id}&inc=media` request through the same
  queue and spacing, caches the parsed list by group ID, and hands it to the
  window's chooser. It browses releases instead of looking the group up: a
  `release-group?inc=releases` response lists the same releases but without
  their media, and the media is where each pressing's track count lives. `releaseGroupReleases` turns that response into rows (date, country, format,
  status, summed track counts, oldest first, ID-less and duplicate releases
  dropped); `releaseFormats` names each distinct medium format once, so a CD
  and a DVD in one box read `CD, DVD`; a chosen release is then loaded with the ordinary
  `fetchReleaseAsync` path, so its tags and matching are the ones already tested.
  The card itself is not only in the page: `ensureGroupCard` builds it in the
  window when the page is older than the script (the host keeps the page it
  loaded at start-up), and a listing that cannot be read leaves the card in
  place with the reason, so an install without a restart still shows the
  section. It is the first card in the column and holds the **Album release ID**
  field: `syncGroupCard` keeps it on screen while it has rows or that field, and
  `relocateAlbumIdRow` moves the row into the card on a page that predates the
  move.
- **Scope** — `mbzApply.resolveTagScope` is the only place that decides what the
  window works on: the selected tracks, their album IDs, each album's release
  ID, and whether the selection spans more than one album. The action and the
  window both call it, so they cannot disagree. A selection with no album row
  (files browsed from MediaMonkey's Folders node) is scoped by **album name**
  through `albumNameScope`: one name for every selected track, none at all is
  allowed, and a differing name refuses the window. That scope reports
  `tagOnly`, its release ID comes from the files' `MUSICBRAINZ_ALBUMID` tag,
  `loadFileTagsAsync` reads their tags from the tracks themselves, and the ID
  field's **Load** loads a release instead of writing an album row.
- **The plan** — `mbzApply.buildSelectionPlanAsync` calls `buildPendingAsync`
  per track, matching by disc and track number and reading the selection's
  `ExtendedTags` in one database query, so the library's current value is
  reported beside the fetched one. `aggregateFields` turns the per-track work
  into one row per field, collapsing values that differ per track.
- **Writing** — `mbzApply.applySelectionAsync` is the only write path. Per
  track: the ticked native fields (dates as `YYYYMMDD`, years and disc numbers
  as numbers, `discNumberInt` rather than the string property), then one read
  and one merged `ExtendedTags` write (`mergeTags` for the fill,
  `applyTagEdits` for the tag table), then `track.commitAsync()`. A failing
  track is collected and the rest still commit; at the end
  `app.db.clearCache()` and `uitools.refreshView()` run.
- **Tag positions** — `mergeTags` replaces a tag in place by normalized name,
  keeping the raw title the file already uses, and collapses duplicate aliases.
  `applyTagEdits` addresses a stored title and occurrence, removes a tag when
  the value is cleared, and never adds a second entry with the same name.
- **Library writes** — `setAlbumGuidAsync` / `setArtistGuidAsync` in
  `mbzMbgid.js` run one validated `UPDATE` against `Albums` or `Artists`, then
  `app.db.clearCache()` and `uitools.refreshView()` so MediaMonkey does not keep
  serving old values. An album write updates the in-memory tables directly; an
  artist write rebuilds them, because the artist column is keyed by song. The
  window's disagreement strip uses these; the tag table never touches those
  columns.
- **Toolbar** — `init.js` adds the button to `righttoolbuttons` with
  `uitools.addToolButton`, the call MediaMonkey uses for its own tool buttons,
  so it sits with the other icons on the right instead of on the custom toolbar.
  A stale `lovesMBzTag` entry in `toolbarItems` from the 0.5.0 test builds is
  removed on start-up.
- **Lifecycle** — the dialog uses `window.localPromise` / `window.localListen`,
  long loops check `window._cleanUpCalled`, and the cache is only built in the
  main window (`init.js`). The add-on stores no settings of its own. Every
  promise the window starts is handled where it is built, through
  `handledInWindow(work, onError)`: a rejection reaching `trackWork` is reported
  by MediaMonkey's promise library as an unhandled exception, because
  `trackWork` adopts the promise through the native `Promise` one microtask
  after the rejection.

### The release response, field by field

`fetchReleaseAsync` makes one `release/{mbid}` lookup. This table is the audit
of that response: every field it returns, whether the add-on reads it, and where
it could go. **read** means a row in `NATIVE_FIELDS` or `TAG_FIELDS`;
**dropped** means it arrives and nothing reads it; **needs `inc=`** means one
subquery away; **refused** means deliberately not offered, with the reason.

Audited on 2026-11-25 against five real lookups: Daft Punk *Random Access
Memories* (`1f1710cf…`, 13 tracks, digital), Glenn Gould *The Goldberg
Variations* (`fed9286f…`, 32 tracks on vinyl, track numbers like `A1`), Miles
Davis *Kind of Blue* (`e32a3f0b…`, CD with five disc IDs), Karajan/Beethoven 9
(`84462a15…`, conductor and orchestra credits) and The Beatles *Abbey Road*
(`cf754b8b…`, engineers).

#### The release

| Field | JSON path | Destination | State | Seen in a sample |
|---|---|---|---|---|
| Release title | `title` | — the album name belongs to the library | refused | every sample |
| Artist credit | `artist-credit[]` | native Album artist, `ALBUMARTISTS`, `MUSICBRAINZ_ALBUMARTISTID` | read | Daft Punk; Bach / Glenn Gould |
| Date | `date` | native Date and Year | read | `2013-05`, `1982`, `2005` |
| Country | `country` | `RELEASECOUNTRY` | read | `KR`, `XE` |
| Every release event | `release-events[]` (area + date) | `RELEASECOUNTRY` as a list | dropped | one area per sample |
| Status, status ID | `status`, `status-id` | `RELEASESTATUS` (status only) | read | Official |
| Packaging, packaging ID | `packaging` | — no Picard tag, no column | refused | Jewel Case, Gatefold Cover |
| Quality | `quality` | — no destination | refused | normal |
| Barcode | `barcode` | `BARCODE` | read | `8803581120707` |
| ASIN | `asin` | `ASIN` | dropped | null in all five; field present |
| Release group ID | `release-group.id` | `MUSICBRAINZ_RELEASEGROUPID` | read | `aa997ea0…` |
| Release type | `release-group.primary-type`, `secondary-types` | `RELEASETYPE` | read | Album + none |
| Release group first date | `release-group.first-release-date` | native Original date, `originaldate` | read | `2013-05-17` |
| Release group title | `release-group.title` | — no Picard tag for it | refused | same as the release in samples |
| Release group comment | `release-group.disambiguation` | — | refused | `1981 recording` |
| Script | `text-representation.script` | — | refused: the contract never offers `SCRIPT` | Latn |
| Language | `text-representation.language` | native Language | dropped, no `inc=` needed | `eng`; null on the vinyl |
| Release comment | `disambiguation` | `comment` (Picard's name) | dropped | empty in all five |
| Cover art availability | `cover-art-archive.front`, `back`, `count` | — a header concern, not a tag | dropped | front true, count 6 |
| Label name | `label-info[].label.name` | native Labels (`publisher`) | read | Columbia, EMI Classics |
| Catalogue number | `label-info[].catalog-number` | `CATALOGNUMBER` | read | `CK 40579` |
| Label MBID | `label-info[].label.id` | `MUSICBRAINZ_LABELID` | dropped | `011d1192…` |
| Label sort name, code, type | `label-info[].label.*` | — no destination | refused | label-code 162 |
| Release relations | `relations[]` | Discogs URL, and the artist relations `PRODUCER` already reads | partly read | discogs, amazon asin, producer, mix, liner notes |
| Genres | `genres[]` | native Genre | needs `genres` | classical, symphony |
| Tags | `tags[]` | — | refused: folksonomy with counts, duplicates the genres | club/dance, dance music |
| Annotation | `annotation` | — | refused: long free text that changes under the user | null |
| Aliases | `aliases[]` | — | refused: releases carry none (the include is accepted) | empty |

#### The medium and the track

| Field | JSON path | Destination | State | Seen in a sample |
|---|---|---|---|---|
| Disc number | `media[].position` | native Disc # (`discNumberInt`) | read | 1 |
| Format | `media[].format` | `media` | dropped | CD, `12" Vinyl` |
| Medium title | `media[].title` | `discsubtitle` | dropped | empty in the samples |
| Disc ID | `media[].discs[].id` | `MUSICBRAINZ_DISCID` | dropped | `4kSYpFmYHKYLhncXgoJSsyaY488-` |
| Track count, offset | `media[].track-count`, `track-offset` | — read-only | refused | — |
| Track number | `tracks[].number` | matching by disc and track | read | `1`; `A1` on vinyl |
| Track position | `tracks[].position` | matching, when the number carries none | read | 1 |
| Track title | `tracks[].title` | native Title | read | The Goldberg Variations: Aria |
| Lengths | `tracks[].length`, `recording.length` | — read-only | refused | 274000 ms |
| Release track MBID | `tracks[].id` | `MUSICBRAINZ_RELEASETRACKID` | read | `80eabf52…` |
| Track artist credit | `tracks[].artist-credit[]` | native Artist, `ARTISTS`, `MUSICBRAINZ_ARTISTID` | read | every sample |

#### The recording, the work and their relations

| Field | JSON path | Destination | State | Seen in a sample |
|---|---|---|---|---|
| Recording MBID | `recording.id` | `MUSICBRAINZ_TRACKID` | read | every sample |
| ISRCs | `recording.isrcs[]` | native ISRC | read, **first only** | Goldberg carries 3 on one track |
| Recording comment | `recording.disambiguation` | `comment` | dropped | empty in the samples |
| Recording first release date | `recording.first-release-date` | — a Picard variable only | refused | `2013-05-17` |
| Video flag | `recording.video` | — no destination | refused | false |
| Recording genres | `recording.genres[]` | native Genre | needs `genres` | classical, romantic classical, symphony |
| Recording tags | `recording.tags[]` | — | refused | same reason as release tags |
| Producer | relation `producer` to artist | `PRODUCER` | read | George Martin; Thomas Bangalter |
| Remixer | relation `remixer` to artist | `REMIXER` | read | — |
| Instrument (performer) | relation `instrument` with `attributes[]` | native Involved people, `performer:instrument` | dropped | keyboard, bass guitar, piano |
| Vocal | relation `vocal` to artist | — no column | dropped | John Lennon, Paul McCartney |
| Performing orchestra | relation `performing orchestra` to artist | — no column | dropped | Wiener Philharmoniker |
| Conductor | relation `conductor` to artist | native Conductor | dropped | Herbert von Karajan, George Martin |
| Engineer | relation `engineer` to artist | `engineer` | dropped | Geoff Emerick, Phil McDonald |
| Mix | relation `mix` to artist | `mixer` | dropped | Kind of Blue, at release level |
| Balance | relation `balance` to artist | — Picard has no tag for it | dropped | Douglas Larter |
| Instrument arranger | relation `instrument arranger` to artist | `arranger` | dropped | George Martin |
| Arranger, DJ-mix | relations `arranger`, `DJ-mix` to artist | `arranger`, `djmixer` | dropped | documented type; not in these five |
| Phonographic copyright | relation `phonographic copyright` | — | refused | — |
| Liner notes | relation `liner notes` to artist | — | refused | Kind of Blue, at release level |
| Recording to recording | relations `mashes up`, `remix`, `edit` | — | refused | one dance track |
| Work ID, title, language, ISWC | `work.id`, `title`, `language`, `languages`, `iswcs` | `MUSICBRAINZ_WORKID`, `WORK`, native Language, `ISWC` | dropped (composer and lyricist are read) | work IDs and `zxx`/`eng` |
| Work relations | `work.relations[]` composer, lyricist, writer, arranger | native Composer, Lyricist, `WRITER`, `arranger` | partly read | Beethoven, Bach |
| Work genres | `work.genres` | — | **not delivered** by a release lookup, even with `genres` | absent in all five |
| Recorded at | relation `recorded at` to place | — no column | dropped | needs `place-rels` |
| Part of a series | release-group relation `part of` to series | — | refused | 18 series on one pop album |
| URL relations | release, group and recording `url-rels` | `discogs_url` only | partly read | official homepage, allmusic, wikidata, streaming |
| Artist sort name, type, country | `artist.*` | — no column | refused | `Beatles, The` |

#### What the audit says

- **One include adds a native field: `genres`.** The release's genres and the
  release group's genres arrive in the same request, because the group is a
  subquery of the release — no second request and no group lookup.
- **The relations the lookup already asks for carry far more than is read.**
  `instrument` (with the instrument in `attributes`), `vocal`, `performing
  orchestra`, `conductor`, `engineer`, `mix`, `balance`, `instrument arranger`
  and `phonographic copyright` were all in the base response. `place-rels` adds
  `recorded at`; `release-group-level-rels` adds the group's `part of` (series)
  and its web links.
- **Work genres are the exception:** they are not in a release response at all.
  A work ID, title, language and ISWC are.
- **Free fields nobody reads:** `asin`, `media[].format`, `media[].title`,
  `media[].discs[].id` (five on one CD), every ISRC after the first (three on
  one track), `release-events`, the label MBID, `recording.first-release-date`,
  the three comment fields, and `cover-art-archive`.
- **Cost:** 275,236 → 301,460 bytes (+10%) for an 11-track classical release
  with every extra include, one request, 0.55 s of server time. The queue's
  1.1 s spacing still dominates the wait.
- **Response shapes worth knowing:** `tracks[].number` is a string that may be
  `A1`; labels live under `label-info`, not `labels`; an absent value is `null`
  or `""`, never missing; relation types are link type names (`instrument`,
  `performing orchestra`, `phonographic copyright`), so matching by type name is
  stable but must be spelled exactly.

### Deliberately not included

- **Album Artist MBGID** — the album artist is a separate relation
  (`ArtistsAlbums`); the artist column is the track's Artist field.
- **Per-track MBIDs in the database** — MediaMonkey has no recording or work
  MBID column on `Songs`; Tag from MusicBrainz edits the per-track values in
  `Songs.ExtendedTags`, not the album/artist rows.
- **Per-track album overrides** — a release ID belongs to the `Albums` row. Two
  tracks of the same album cannot have different release IDs, and the window
  makes that explicit rather than pretending otherwise.
- **Batch editing IDs** — one row at a time, with one confirmation per row, so a
  mistyped ID cannot spread across a multi-select.
- **Works, labels, relationships as database columns** — not stored there.
  Their IDs can appear in `Songs.ExtendedTags` and are shown by Tag from
  MusicBrainz.

## Development install

MediaMonkey loads addons from a folder named after the addon id
(`lovesMBz`), so copy this folder under that name:

| Install for | Folder |
|---|---|
| Current user | `%APPDATA%\MediaMonkey5\Scripts\lovesMBz\` |
| All users | `%ProgramFiles%\MediaMonkey5\Scripts\lovesMBz\` |

The dialog script (`dialogs/dlgMBzTag.js`) is read again each time the window
opens, but its page (`dialogs/dlgMBzTag.html`) is not: MediaMonkey keeps the
page it loaded when the process started, so a change to the markup or CSS only
shows after MediaMonkey is fully restarted. `info.json`, `init.js`,
`actions_add.js` and `controls/trackListView_add.js` are read at startup too and
need the same restart. That is why the window's busy ring and the card gap are
pinned inline in the script as well as in the page.

## Building an `.mmip`

An `.mmip` is a ZIP with `info.json` at its **root** — zip the contents, not the
containing folder, and leave out the repository files.

```bash
node tools/build-mmip.js
```

The script copies the add-on into a temporary folder, writes the build time into
`dialogs/dlgMBzTag.js` (in the copy and in the source), and zips the contents to
`LovesMBz.mmip`, so the window footer reports the build it came from. It uses
`zip` when available and PowerShell's `Compress-Archive` otherwise. Do not zip
by hand: an archive built that way has no build time, and the version alone
cannot tell two builds apart.

The packager runs the save-path regression test first and refuses to build when
it fails. The same guard runs on its own with:

```bash
node tests/tag-path.test.js
```

It guards the 0.5.0 write path: one write path, native fields before the single
merged extended-tags write, one commit per track, per-track failure isolation,
and the 0.4.x invariants (`discNumberInt`, no `SCRIPT`). The contract is in
[AGENTS.md](AGENTS.md).

## Troubleshooting

- **The columns list is empty** — the cache has not loaded yet, or the library
  has no MusicBrainz matches. MediaMonkey only fills these fields when a
  release/artist is matched through its own MusicBrainz lookup.
- **IDs do not change after matching a release** — the columns are fed by a
  cache that rebuilds on MediaMonkey's change events. A match written straight
  into the database (by another tool, or with MediaMonkey closed) still needs a
  restart. The dialog always shows current values.
- **No MusicBrainz IDs group in the column chooser** — `controls/trackListView_add.js`
  failed to load. Check `debug.log` in the MediaMonkey program folder for lines
  starting with `Loves MBz:`.
- **Sorting** — these columns are computed values, not database columns, so
  MediaMonkey's auto-sort has no field to sort on. Use **Copy table** and sort
  in a spreadsheet.
- **An edit did not stick** — MediaMonkey re-matched the release or artist and
  wrote its own ID back. The dialog is not involved after the write; check the
  value again under **Reload**.
- **The editor is missing** — Party Mode is on (the dialog hides editing), or
  the track has no album or artist row in the database.
- **A cleared ID shows blank, not `0`** — clearing writes an empty string.
  Both `''` and `'0'` are treated as "not matched", here and by MediaMonkey.
- **Party mode / read-only views** — Edit → Tag Tools is hidden, same as the
  built-in tag tools; the columns themselves still display.
- **Saving reports "This is not a valid MusicBrainz ID"** — the field holds
  something other than a UUID. Use **Clear these IDs** to remove an ID, or paste
  the ID from a MusicBrainz release/artist page.
- **Only one artist lost its ID** — a track can credit several artists and each
  has its own `Artists` row. Choose the artist in the dropdown before saving or
  clearing; the dropdown appears whenever a row has more than one artist.
- **The MusicBrainz tags table is empty** — the selection has no MusicBrainz
  entries in `Songs.ExtendedTags`; the native album/artist MBIDs are not stored
  there. Use the IDs dialog or the columns for those.
- **A MusicBrainz tag has no link** — its value is not a UUID (the window marks
  it) or the tag has no entity page (album status/type/country/date, disc ID).
  Fix the value from a MusicBrainz page to get a link.
- **An extended-tag edit did not stick** — the file format may not support the
  tag, or Party Mode is on. Check the value after pressing **Apply** again.
- **Apply changed nothing** — every offered field already matched, or no library
  track matched the release by disc and track number. Nothing is matched by
  title.
- **Some tracks were skipped** — their disc/track numbers have no counterpart in
  the release. The window counts them; fix the numbering or apply to the release
  that matches.
- **The window says the album has no release ID** — `Albums.MBGID` is empty or
  `0`. Paste one into **Album release ID** and press **Save ID**, use the IDs
  dialog, or let MediaMonkey match the release. The **Search MusicBrainz** button
  opens a web search by album and artist, but does not choose a release or write
  an ID.
- **The window reports that MusicBrainz is busy** — three requests in a row
  were answered with `503`/`429`. Wait a moment and press **Retry** in the
  window: it repeats the lookup in place, so your tag edits stay. When the
  album release ID points at a release MusicBrainz does not have, **Retry** is
  not offered; correct the ID or clear it and search.
- **The toolbar button is missing** — it is added to the right-hand strip at
  start-up; check `debug.log` for `Loves MBz: could not add the toolbar button`.
  The action is also listed under **Options → Layout → Toolbar**, so it can be
  placed on the custom toolbar or given a hotkey there.
- **Tag from MusicBrainz does not open** — `dialogs/dlgMBzTag.js` did not load;
  check `debug.log` for lines starting with `Loves MBz:`.

## Layout

```
info.json                          addon manifest (id, version, icon)
init.js                            startup: cache, change events, toolbar button
mbzMbgid.js                        database access, ID lookup tables, writes
mbzFetch.js                        throttled MusicBrainz release lookup
mbzApply.js                        scope, plan and the only write path
actions_add.js                     Edit > Tag Tools and track-list menu actions
controls/trackListView_add.js      the three track-list columns
dialogs/dlgLovesMBz.html           IDs dialog markup
dialogs/dlgLovesMBz.js             IDs dialog: view, copy, edit
dialogs/dlgMBzTag.html             Tag from MusicBrainz markup
dialogs/dlgMBzTag.js               Tag from MusicBrainz: release, fields, tags
loves-mbz.png                      add-on icon (info.json)
skin/icon/lovesMBz.svg             toolbar and menu icon
docs/lovesmbz-cover.jpg            README cover image (its .psd is ignored)
AGENTS.md                          the write-path contract for future changes
TECHNICAL.md                       this document: usage in detail, internals
UI-ROADMAP.md                      the UI audit and prioritised design plan
tests/tag-path.test.js             regression guard for the write path
```

