# Loves MBz

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

Current version: **0.3.3**.

---

## Install

### From an `.mmip`

1. Build one (see [Building an `.mmip`](#building-an-mmip)) or use a release.
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

After MediaMonkey matches new releases/artists, use **Tools → Loves MBz:
reload MusicBrainz ID cache** to rebuild the track-list columns without
restarting MediaMonkey.

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
tab does not pull in `Albums.MBGID`, `Albums.MBRGGID` or `Artists.MBGID`; those
are separate fields and stay in the columns and the IDs dialog.

Each row shows the raw tag name, a short description and its current value. ID
tags link to the matching MusicBrainz page:

| Extended tag | Opens |
|---|---|
| `MUSICBRAINZ_ALBUMID` | release |
| `MUSICBRAINZ_RELEASEGROUPID` | release group |
| `MUSICBRAINZ_ARTISTID`, `MUSICBRAINZ_ALBUMARTISTID`, performer IDs | artist |
| `MUSICBRAINZ_TRACKID` | recording |
| `MUSICBRAINZ_RELEASETRACKID` | track |
| `MUSICBRAINZ_WORKID` | work |
| `MUSICBRAINZ_LABELID` | label |

A value containing several IDs (`;`, `,` or whitespace separated) gets one link
per ID. On ID tags, values that are not UUIDs are kept, marked **Not a valid
MusicBrainz ID**, and not linked. Non-ID MusicBrainz tags (album
status/type/country/date, disc ID) are listed without a link.

Edit a value and click **OK** to write it back; an empty value removes that tag.
Values made up only of valid IDs are stored in dashed lower-case form. The tab re-reads the current
`ExtendedTags` array and merges only the rows you changed, so non-MusicBrainz
tags and changes made in the built-in **Custom** tab survive. It never writes
the album or artist database fields.

A track with no MusicBrainz extended tags is not a dead end. Use **Add tag** at
the bottom of the tab: pick the tag, type a value and click **Add** — the new
row is marked *(not saved yet)* and is written when you click **OK**, under the
canonical `MUSICBRAINZ_*` name. Clear the value of such a row before **OK** to
discard it. Clearing a tag that already exists still removes it.

When the library already knows an ID, you do not have to paste it. The
**From the library** suggestions above the picker offer the track's
`Albums.MBGID`, `Albums.MBRGGID` and `Artists.MBGID` as one-click tags, so a
track matched in MediaMonkey can be given the matching extended tag without
typing. A tag that is already listed — or already exists with another value —
is not suggested; edit its row instead. In a group selection a suggestion is
only offered for IDs that are identical on every selected track.

With several tracks selected, the tab shows tags whose value is the same on
every selected track that stores them — typically album-level tags such as the
release, release-group and album-artist IDs. Editing one applies the new value
to every selected track; clearing it removes the tag from every selected track,
and a tag added with **Add tag** is written to every selected track.

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
  occurrence, so duplicate artist IDs and the built-in Custom tab are safe. In
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
Compress-Archive -Path .\info.json, .\init.js, .\mbzMbgid.js, .\actions_add.js, .\controls, .\dialogs, .\skin -DestinationPath .\LovesMBz.zip -Force
Rename-Item .\LovesMBz.zip .\LovesMBz.mmip
```

bash / Git Bash, if `zip` is available:

```bash
zip -r LovesMBz.mmip info.json init.js mbzMbgid.js actions_add.js controls dialogs skin
```

## Troubleshooting

- **The columns list is empty** — the cache has not loaded yet, or the library
  has no MusicBrainz matches. MediaMonkey only fills these fields when a
  release/artist is matched through its own MusicBrainz lookup.
- **IDs do not change after matching a release** — the column cache is built at
  start-up. Run **Tools → Loves MBz: reload MusicBrainz ID cache**, or
  restart MediaMonkey. The dialog always shows current values.
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
- **The MusicBrainz tab is missing** — `dialogs/dlgTrackProperties_add.js` did
  not load; check `debug.log` for lines starting with `Loves MBz:`, then
  reopen Track Properties.

## Layout

```
info.json                          addon manifest (id, version, icon)
init.js                            startup: loads the module, starts the cache
mbzMbgid.js                        database access, ID lookup tables, writes
actions_add.js                     Edit > Tag Tools and Tools menu actions
controls/trackListView_add.js      the three track-list columns
dialogs/dlgLovesMBz.html           dialog markup
dialogs/dlgLovesMBz.js             dialog: view, copy, edit
dialogs/dlgTrackProperties_add.js  registers the Track Properties tab
dialogs/dlgTrackProperties/tabLovesMBz.html  tab markup
dialogs/dlgTrackProperties/tabLovesMBz.js    tab: filter, link, edit
skin/icon/lovesMBz.svg             menu icon
```

## Changelog

### 0.3.3
- **Fill missing tags across a selection** — a tag that exists on only some of
  the selected tracks is no longer hidden. It is listed with an **All tracks**
  checkbox, and the label says how many selected tracks lack it. Ticking the box
  and clicking **OK** writes the value the other tracks already have to those
  tracks. Tags every track already carries show the box ticked and disabled.

### 0.3.2
- **Suggestions from the library** — when the database already holds a native
  MusicBrainz ID for the track's album or artists, the tab offers it as a
  **From the library** suggestion. One click adds that tag with the stored
  value, so a matched track does not need its IDs pasted in by hand. With
  several tracks selected, only IDs shared by all of them are offered.

### 0.3.1
- **Add a tag** — the MusicBrainz tab no longer stops at what a track already
  has. A picker at the bottom of the tab adds a tag the track is missing, under
  its canonical `MUSICBRAINZ_*` name, and keeps it alongside whatever the
  built-in Custom tab queued.
- **Group adding** — in a multi-track selection the same picker adds the tag to
  every selected track through the group patch, so an album can be given a
  release or release-group ID in one step.

### 0.3.0
- **Renamed to Loves MBz** — the addon id is now `lovesMBz` (was `mbzLovesMM5`).
  Remove an older install folder under the old id, or MediaMonkey loads both.
- **Group editing** — with multiple tracks selected, the Track Properties tab
  shows only MusicBrainz tags that are identical across the selection and
  applies edits or removals to all selected tracks. Per-track tags stay
  untouched.

### 0.2.0
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

### 0.1.0
- Initial release: three track-list columns for `Albums.MBGID`,
  `Albums.MBRGGID` and `Artists.MBGID`, plus a dialog to view and copy the IDs
  for the current selection.
