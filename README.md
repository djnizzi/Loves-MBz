# Loves MBz

[![Latest release](https://img.shields.io/github/v/release/djnizzi/Loves-MBz?label=release&sort=semver)](https://github.com/djnizzi/Loves-MBz/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/djnizzi/Loves-MBz/total)](https://github.com/djnizzi/Loves-MBz/releases)
[![MediaMonkey](https://img.shields.io/badge/MediaMonkey-5.0%2B-1f6feb)](https://www.mediamonkey.com/)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#install)

MediaMonkey 5 keeps MusicBrainz identifiers in its library database but never
shows them anywhere in the UI. **Loves MBz** exposes them.

Three read-only track-list columns:

| Column | Database source |
|---|---|
| MusicBrainz Release ID | `Albums.MBGID` |
| MusicBrainz Release Group ID | `Albums.MBRGGID` |
| MusicBrainz Artist ID | `Artists.MBGID` (via `ArtistsSongs`) |

Plus an **Edit → Tag Tools → MusicBrainz IDs…** dialog that lists the IDs for
the selected tracks, copies them as a tab-separated table, and can set them on
the album or artist behind the selected track.

Right-click a track — or use **Edit → Tag Tools** — and pick **MusicBrainz
links** to open its release, release group or artist page on musicbrainz.org.

**Tag from MusicBrainz…** is the one window that does the tagging: it reads the
release behind the selected album's existing release ID, shows what MusicBrainz
holds — artists, label, barcode, status, type, country, script, the full track
list and the release's Discogs page — and lets you tick the fields to write. The
same window lists and edits the selection's MusicBrainz extended tags, so Track
Properties is not involved at all. Nothing is written until **Apply**. An album
without a release ID is skipped without a request; the window offers a button
that opens the MusicBrainz website search by album and artist, but the add-on
itself never searches by name.

Current version: **0.5.1**.

---

## Install

### From an `.mmip`

1. Download `LovesMBz.mmip` from the [latest release](https://github.com/djnizzi/Loves-MBz/releases/latest),
   or build one (see [Building an `.mmip`](#building-an-mmip)).
2. In MediaMonkey: **Tools → Addons → Add**, pick the `.mmip`, restart.

### For development

MediaMonkey loads addons from a folder named after the addon id
(`lovesMBz`), so copy this folder under that name:

| Install for | Folder |
|---|---|
| Current user | `%APPDATA%\MediaMonkey5\Scripts\lovesMBz\` |
| All users | `%ProgramFiles%\MediaMonkey5\Scripts\lovesMBz\` |

Editing the dialog files only needs the dialog to be reopened; `info.json`,
`init.js`, `actions_add.js` and `controls/trackListView_add.js` are read at
startup, so restart MediaMonkey for those.

## Usage

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
medium's tracks with their number, title, length, ISRC and recording ID. The
Discogs link is MusicBrainz's URL relationship; a master page usually lives on
the release group. Either way it is the value Picard stores as `discogs_url`.

Under the title, **Open in MusicBrainz** links the album's release, its release
group and its album artist straight to musicbrainz.org. Those three links are
also built from the album and artist rows when the album has no release ID, so
they are there even without a lookup.

Below the release block, **Album release ID** holds the album's `Albums.MBGID`
— the value the whole lookup is keyed on. Correct it there when the album points
at the wrong release: **Save ID** checks the value is a MusicBrainz UUID, asks
before replacing an existing ID (naming the album and how many tracks it
covers), writes only that column, and reloads the window with the release behind
the new ID. An empty field clears the ID, and the window falls back to the
no-release-ID state with **Search MusicBrainz**. Like any library-side write,
MediaMonkey's own lookup can overwrite it later.

The footer of the window shows the add-on version — `Loves MBz 0.5.1` — so you
can tell which build is running before trusting a screenshot or a report from an
older one.

Below that, **Fields to write** lists only the fields whose MusicBrainz value
differs from the library, one row and one checkbox each, with the current value,
the fetched value and `changes / total`. A value that differs per track reads
**per track** instead of listing every value. Everything starts ticked; untick
anything you want to keep, then press **Apply**. Nothing is written before that
click.

**Selected tracks** lists the tracks you selected, each with the release row it
matched — disc/track, library title, release title, length, ISRC and recording
ID — and how many field changes it has. A track with no counterpart says
**no match** and is skipped. The full release listing is behind **Show all
release tracks**, so the default view is your selection and not the album.

The window works on **one album at a time**. A selection that spans more than
one album ID does not open until you confirm a prompt that names the albums (and
the release ID when they share one); then the first album's release is used and
every selected track is matched by disc and track number. This matters for
multi-disc releases too: MediaMonkey gives each disc its own album row.

| Written to | Fields |
|---|---|
| Native track tags | title, artist, composer, lyricist, ISRC, disc number |
| Native album-level tags | album artist and artist as `; `-separated names, date, year, original date, original year, all labels joined into `publisher` |
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
(no matching disc and track number). 0 failed.` The window then re-reads the
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
session, so opening the same album again does not call the API.

### The toolbar button

The Tag from MusicBrainz action is a normal MediaMonkey action: it has the
add-on icon, a tooltip, and is greyed out when nothing is selected. The add-on
places a button for it in the right-hand toolbar strip, beside MediaMonkey's own
tool buttons, when MediaMonkey starts: it is added with
`uitools.addToolButton('righttoolbuttons', …)`, the same call the host uses, so
it behaves like a built-in button and survives layout changes.

The action is also listed under **Options → Layout → Toolbar** and can be given
a hotkey there. A `toolbarItems` entry left by 0.5.0/0.5.1 — which put the
button on the custom toolbar, on a row of its own — is removed on the next
start.

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
original date, original year, every label joined into `publisher`, title, ISRC,
disc number) and the extended tags, including the joined credit in
`ARTISTS`/`ALBUMARTISTS`, `WRITER`, `PRODUCER`, `REMIXER`, `originaldate` and
`discogs_url`. The `originalyear` tag is deliberately not written, because a
library can store a full `YYYY-MM-DD` date there and a four-digit year would
replace it. Values that already match are skipped, and each track is matched to
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
- **Scope** — `mbzApply.resolveTagScope` is the only place that decides what the
  window works on: the selected tracks, their album IDs, each album's release
  ID, and whether the selection spans more than one album. The action and the
  window both call it, so they cannot disagree.
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
  A stale `lovesMBzTag` entry in `toolbarItems` from 0.5.0/0.5.1 is removed on
  start-up.
- **Lifecycle** — the dialog uses `window.localPromise` / `window.localListen`,
  long loops check `window._cleanUpCalled`, and the cache is only built in the
  main window (`init.js`). The add-on stores no settings of its own.

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
  were answered with `503`/`429`. Wait a minute and reopen the window.
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
AGENTS.md                          the write-path contract for future changes
tests/tag-path.test.js             regression guard for the write path
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the version history.
