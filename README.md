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
the album or artist behind the selected track. A **MusicBrainz** tab in
**Track Properties** reads the track's `Songs.ExtendedTags` JSON, links the
MusicBrainz extended tags that actually exist, and lets you edit them.

Right-click a track — or use **Edit → Tag Tools** — and pick **MusicBrainz
links** to open its release, release group or artist page on musicbrainz.org.

**Preview MusicBrainz metadata…** reads the release behind the selected album's
existing release ID, shows what MusicBrainz holds — artists, label, barcode,
status, type, country, script, the full track list and the release's Discogs
page — and lets you tick fields to write back. Nothing is written until
**Apply**. An album without a release ID is skipped without a request; the
add-on never searches MusicBrainz by name.

Current version: **0.3.12**.

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
**Track Properties → MusicBrainz** for the per-track extended tags.

The column cache rebuilds itself when MediaMonkey commits a change — re-reading
only the album rows, track links and artists that the event names — so releases
and artists matched through MediaMonkey's own MusicBrainz lookup show up in the
columns without a restart, even in a large library.

### Previewing and applying the release metadata

**Edit → Tag Tools → Preview MusicBrainz metadata…** (also in the track list
context menu) opens the release behind the first selected track's album: artist
credit, date, country, status, type, label and catalogue number, barcode, the
Discogs page when the release links one, script/language, and every medium's
tracks with their number, title, length, ISRC and recording ID. The Discogs link
is MusicBrainz's URL relationship for the release; it is the value Picard stores
as `discogs_url`.

Below that, **Fields to write** lists only the fields whose MusicBrainz value
differs from the library, one row and one checkbox each, with the current value,
the fetched value and how many matched tracks would change. Everything starts
ticked; untick anything you want to keep, then press **Apply**. Nothing is
written before that click.

| Written to | Fields |
|---|---|
| Native track tags | title, artist, ISRC |
| Native album-level tags | album artist, date, original date, label (`publisher`) |
| Extended tags, album-wide | `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_ALBUMARTISTID`, `ALBUMARTISTS`, `BARCODE`, `RELEASESTATUS`, `RELEASETYPE`, `RELEASECOUNTRY`, `CATALOGNUMBER`, `SCRIPT`, `originalyear`, `discogs_url` |
| Extended tags, per track | `MUSICBRAINZ_TRACKID`, `MUSICBRAINZ_RELEASETRACKID`, `MUSICBRAINZ_ARTISTID`, `ARTISTS` |

Library tracks are matched to the release by disc and track number, never by
title. A library track with no counterpart in the release is left alone, and a
release track with no library counterpart is counted, so a partial match cannot
write the wrong title onto a track. Extended tags are merged into each track's
existing `Songs.ExtendedTags`: a tag already stored under another file-format
name is replaced in place, unrelated tags and edits queued by the built-in
**Custom** tab survive, and a field MusicBrainz has no value for is not offered,
so nothing is cleared. `discogs_url` stays a plain extended tag, so it appears
in MediaMonkey's **Custom** tab rather than this add-on's MusicBrainz tab.

**Apply** writes the ticked fields, calls `commitAsync()` on every touched
track, then clears MediaMonkey's database cache and refreshes the view. The
dialog re-reads the library and lists whatever is still different. The album's
`MBGID`/`MBRGGID` and the artist rows are never written: the release ID is the
lookup key, so applying cannot overwrite it. In Party Mode the preview still
works, but the fields and **Apply** are hidden.

The lookup is by release ID only. The album must already carry `Albums.MBGID`
(set it in the IDs dialog, or let MediaMonkey match the release); when that is
empty or `0` the dialog says so and **no request is made**. There is no search
by artist or album name, no AcoustID and no disc-ID lookup, so the add-on
cannot pick the wrong release. No API key is needed: the add-on identifies
itself with a `User-Agent` and keeps requests at least 1.1 s apart. A busy
server (`503`/`429`) is retried twice with a growing delay, and the parsed
release is cached by ID for that dialog, so previewing the same album again
does not call the API.

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

### MusicBrainz extended tags in Track Properties

**Track Properties → MusicBrainz** reads the selected track's
`Songs.ExtendedTags` JSON and lists only entries whose names normalize to
`MUSICBRAINZ*`. The same tag is therefore found whether the file stores it as
`MUSICBRAINZ_TRACKID` (FLAC/Vorbis) or `MusicBrainz Track Id` (ID3 TXXX). The
tab does not list `Albums.MBGID`, `Albums.MBRGGID` or `Artists.MBGID` as rows;
those are separate fields and stay in the columns and the IDs dialog. It does
compare them with a matching tag and flag a disagreement (see below).

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
drops that artist and keeps the rest; on **OK** the rows are merged back into the
single stored value, using the `/` separator the file already had instead of
rewriting it to `;`, which other players would read as one malformed ID.
On ID tags, values that are not UUIDs are kept, marked **Not a valid MusicBrainz
ID**, and not linked. Non-ID MusicBrainz tags (album
status/type/country/date, disc ID) are listed without a link.

Edit a value and click **OK** to write it back; an empty value removes that tag.
Values made up only of valid IDs are stored in dashed lower-case form. The tab re-reads the current
`ExtendedTags` array and merges only the rows you changed, so non-MusicBrainz
tags and changes made in the built-in **Custom** tab survive. Editing a value
never writes the album or artist database fields; only the warning strip below
does, and only after a confirmation — except when it fills an empty library
field, which overwrites nothing and happens immediately.

A track with no MusicBrainz extended tags is not a dead end. Use **Add tag** at
the bottom of the tab: pick the tag, type a value and click **Add** — the new
row is marked *(not saved yet)* and is written when you click **OK**, under the
canonical `MUSICBRAINZ_*` name. Clear the value of such a row before **OK** to
discard it. Clearing a tag that already exists still removes it.

Adding `MUSICBRAINZ_ARTISTID` or `MUSICBRAINZ_ALBUMARTISTID` to a tag that
already holds IDs appends to that tag instead of creating a second entry with
the same name: the existing IDs keep their order, the new one goes last, and the
value keeps the separator the file uses (`/` for MP3, `; ` otherwise). Adding an
ID the tag already has changes nothing.

When the library already knows an ID, you do not have to paste it. The
**From the library** suggestions above the picker offer the track's
`Albums.MBGID`, `Albums.MBRGGID` and `Artists.MBGID` as one-click tags, so a
track matched in MediaMonkey can be given the matching extended tag without
typing. A tag that is already listed — or already exists with another value —
is not suggested; edit its row instead. In a group selection a suggestion is
only offered for IDs that are identical on every selected track.

### When the tag and the library disagree

The release, release-group and artist IDs exist twice: in the file's extended
tags and on the `Albums` or `Artists` row. When a single track's tag and its
library row hold different values, a strip above the picker says so:

```
The library ID and the tag disagree:
Release ID — library 3f6a1c2e…, tag 9b7e2d41…   [Use library ID] [Update library]
```

- **Use library ID** puts the library's value into the tag row, so the usual
  **OK** saves it. The database is not touched.
- **Update library** writes the tag's value onto the album or artist row. When
  that field already holds a different ID it asks first, naming the row and how
  many tracks it covers; filling an empty field overwrites nothing, so it
  writes straight away. The tag keeps its value. MediaMonkey's own MusicBrainz
  lookup can overwrite that library value later.

The strip works for a selection as well. The tag side is the value the selected
tracks share; the library side is what their own album and artist rows hold, and
it is compared only when those rows agree — a selection spread over albums with
different IDs has no single library value to compare, so it stays quiet.
**Use library ID** fills the group row, so **OK** writes it to every selected
track. **Update library** is offered only when the selection resolves to one
album or one artist; when it would touch several rows the strip says so instead
of copying one release ID onto unrelated albums.

The artist comparison needs exactly one artist row per selected track — a
featured or multi-artist credit has no unambiguous row and is left alone — and a
tag holding several IDs at once is not compared either. In Party Mode the strip
still reports the disagreement but shows no buttons.

With several tracks selected, the tab shows tags whose value is the same on
every selected track that stores them — typically album-level tags such as the
release, release-group and album-artist IDs. Editing one applies the new value
to every selected track; clearing it removes the tag from every selected track,
and a tag added with **Add tag** is written to every selected track.

The **Save MusicBrainz tags** box above the list ticks itself as soon as you
edit a row. A group edit decides whether anything changed from the ticked
boxes — the ones beside each standard field — so this box is what makes **OK**
write the tab's tags to the files; without it the dialog would close without
saving. Untick it to discard the tab's pending changes.

A tag that only some of the selected tracks have is shown too, never hidden.
Its **All tracks** checkbox is clear and its label counts how many selected
tracks are missing it (`(missing on 2 of 5 tracks)`); tick the box and click
**OK** and the value that is already there is written to those tracks. A tag
that every selected track already has shows the box ticked and disabled,
because there is nothing left to apply. Like the other fields in Track
Properties, the box only queues the change — nothing is written until **OK**.
Tracks that store the same tag name twice, or at different values, cannot be
patched through the group, so that tag is left out.

Per-track tags such as `MUSICBRAINZ_TRACKID` follow the same rule: they appear
when the tracks agree (or only some have it). Group editing also requires every
selected track to be in the library.

In Party Mode the values are disabled but the links still work. The file format
must support extended tags — formats such as WAV may discard them.

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

- **Release preview** — `dialogs/dlgMBzPreview.js` asks `mbzFetch.js` for one
  album. `releaseIdForAlbumAsync` reads `SELECT MBGID FROM Albums WHERE ID = ?`
  and returns `''` without any HTTP request when the album has no ID;
  `fetchReleaseAsync` validates the UUID, serializes lookups through a queue
  (one request, then at least 1.1 s), sends a `User-Agent`, retries
  `503`/`429` with backoff, stops once the dialog has closed, and caches the
  parsed release by ID. `url-rels` is part of the lookup, so the release's
  Discogs page is available as `discogsUrls`. The dialog renders the release
  and its track list, then asks `mbzApply.js` for the diff.
- **Applying** — `mbzApply.js` describes the release (native values and the
  Picard extended tag names), loads the album's tracks with
  `app.db.getTracklist('SELECT * FROM Songs WHERE IDAlbum = …')`, and matches
  them by disc and track number. `buildPlanAsync` returns one entry per field
  whose fetched value differs, reading current values from the track and its
  `ExtendedTags`. `applyAsync` writes only the ticked fields, merges tags with
  `mergeTags` (replace in place by normalized name, append the rest), calls
  `track.commitAsync()`, then `app.db.clearCache()` and `uitools.refreshView()`.
- **Writes** — `setAlbumGuidAsync` / `setArtistGuidAsync` in `mbzMbgid.js` run
  one validated `UPDATE` against `Albums` or `Artists`, then
  `app.db.clearCache()` and `uitools.refreshView()` so MediaMonkey does not keep
  serving old values. An album write updates the in-memory tables directly; an
  artist write rebuilds them, because the artist column is keyed by song.
  Nothing in this dialog writes to tags, files or anything outside those two
  tables; the Track Properties tab is the separate path for per-track tags.
- **Track Properties tab** — `dialogs/dlgTrackProperties_add.js` registers
  `tabLovesMBz` after **Custom**. `tabLovesMBz.js` filters
  `Songs.ExtendedTags` with `mbzMbgid.normalizeExtendedTagName`, builds links
  from `mbzMbgid.musicBrainzUrl` and opens them with `uitools.openWeb`. On OK it
  re-reads the whole array and merges changed rows by exact tag name and
  occurrence, so duplicate artist IDs and the built-in Custom tab are safe. It
  writes only `Songs.ExtendedTags`; MediaMonkey writes the file from that array,
  so a repeated artist ID becomes repeated fields in FLAC and one `/`-joined
  value in an ID3v2.3 MP3. In
  group mode it reads each selected song's row, shows only tags with one
  identical stored name and value across the selection, and sends a
  deletion-aware patch through the group track.
- **Lifecycle** — the dialog uses `window.localPromise` / `window.localListen`,
  long loops check `window._cleanUpCalled`, and the cache is only built in the
  main window (`init.js`). Settings are not stored.

### Deliberately not included

- **Album Artist MBGID** — the album artist is a separate relation
  (`ArtistsAlbums`); the artist column is the track's Artist field.
- **Per-track MBIDs in the database** — MediaMonkey has no recording or work
  MBID column on `Songs`; the Track Properties tab edits the per-track values
  in `Songs.ExtendedTags`, not the album/artist rows.
- **Per-track album overrides** — a release ID belongs to the `Albums` row. Two
  tracks of the same album cannot have different release IDs, and the dialog
  makes that explicit rather than pretending otherwise.
- **Batch editing** — one row at a time, with one confirmation per row, so a
  mistyped ID cannot spread across a multi-select.
- **Works, labels, relationships as database columns** — not stored there.
  Their IDs can appear in `Songs.ExtendedTags` and are shown by the Track
  Properties tab.

## Building an `.mmip`

An `.mmip` is a ZIP with `info.json` at its **root** — zip the contents, not the
containing folder, and leave out the repository files.

PowerShell:

```powershell
# from this folder
Compress-Archive -Path .\info.json, .\init.js, .\mbzMbgid.js, .\mbzFetch.js, .\mbzApply.js, .\actions_add.js, .\controls, .\dialogs, .\skin -DestinationPath .\LovesMBz.zip -Force
Rename-Item .\LovesMBz.zip .\LovesMBz.mmip
```

bash / Git Bash, if `zip` is available:

```bash
zip -r LovesMBz.mmip info.json init.js mbzMbgid.js mbzFetch.js mbzApply.js actions_add.js controls dialogs skin loves-mbz.png
```

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
- **The MusicBrainz tab is empty** — the track has no MusicBrainz entries in
  `Songs.ExtendedTags`; the native album/artist MBIDs are not stored there. Use
  the IDs dialog or the columns for those.
- **A MusicBrainz tag has no link** — its value is not a UUID (the tab marks it)
  or the tag has no entity page (album status/type/country/date, disc ID). Fix
  the value from a MusicBrainz page to get a link.
- **An extended-tag edit did not stick** — the file format may not support the
  tag, or Party Mode is on. Check the value after reopening Track Properties.
- **Apply changed nothing** — every offered field already matched, or no library
  track matched the release by disc and track number. Nothing is matched by
  title.
- **Some tracks were skipped** — their disc/track numbers have no counterpart in
  the release. The dialog counts them; fix the numbering or apply to the release
  that matches.
- **The preview says the album has no release ID** — `Albums.MBGID` is empty or
  `0`. Set it in the IDs dialog (or let MediaMonkey match the release); the
  preview deliberately does not search by name.
- **The preview reports that MusicBrainz is busy** — three requests in a row
  were answered with `503`/`429`. Wait a minute and reopen the dialog.
- **The MusicBrainz tab is missing** — `dialogs/dlgTrackProperties_add.js` did
  not load; check `debug.log` for lines starting with `Loves MBz:`, then
  reopen Track Properties.

## Layout

```
info.json                          addon manifest (id, version, icon)
init.js                            startup: loads the module, starts the cache
mbzMbgid.js                        database access, ID lookup tables, writes
mbzFetch.js                        throttled MusicBrainz release lookup
mbzApply.js                        release-to-library diff and writes
actions_add.js                     Edit > Tag Tools and track-list menu actions
controls/trackListView_add.js      the three track-list columns
dialogs/dlgLovesMBz.html           dialog markup
dialogs/dlgLovesMBz.js             dialog: view, copy, edit
dialogs/dlgMBzPreview.html         preview dialog markup
dialogs/dlgMBzPreview.js           preview: compare, tick fields, Apply
dialogs/dlgTrackProperties_add.js  registers the Track Properties tab
dialogs/dlgTrackProperties/tabLovesMBz.html  tab markup
dialogs/dlgTrackProperties/tabLovesMBz.js    tab: filter, link, edit
loves-mbz.png                      add-on icon (info.json)
skin/icon/lovesMBz.svg             menu icon
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the version history.
