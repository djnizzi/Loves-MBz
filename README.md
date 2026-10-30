# MBz loves MM5

MediaMonkey 5 keeps MusicBrainz identifiers in its library database but never
shows them anywhere in the UI. **MBz loves MM5** exposes them.

Three read-only track-list columns:

| Column | Database source |
|---|---|
| MusicBrainz Release ID | `Albums.MBGID` |
| MusicBrainz Release Group ID | `Albums.MBRGGID` |
| MusicBrainz Artist ID | `Artists.MBGID` (via `ArtistsSongs`) |

Plus an **Edit → Tag Tools → MusicBrainz IDs…** dialog that lists the IDs for
the selected tracks, copies them as a tab-separated table, and can set them on
the album or artist behind the selected track.

Current version: **0.2.0**.

---

## Install

### From an `.mmip`

1. Build one (see [Building an `.mmip`](#building-an-mmip)) or use a release.
2. In MediaMonkey: **Tools → Addons → Add**, pick the `.mmip`, restart.

### For development

MediaMonkey loads addons from a folder named after the addon id
(`mbzLovesMM5`), so copy this folder under that name:

| Install for | Folder |
|---|---|
| Current user | `%APPDATA%\MediaMonkey5\Scripts\mbzLovesMM5\` |
| All users | `%ProgramFiles%\MediaMonkey5\Scripts\mbzLovesMM5\` |

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

After MediaMonkey matches new releases/artists, use **Tools → MBz loves MM5:
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

Edits do not touch your files or tags, and they do not run a MusicBrainz
lookup — you are supplying the identifier yourself. MediaMonkey's own lookup
can overwrite it the next time it re-matches that release or artist, which is
also why the confirmation says so.

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
  Nothing writes to tags, files or anything outside those two tables.
- **Lifecycle** — the dialog uses `window.localPromise` / `window.localListen`,
  long loops check `window._cleanUpCalled`, and the cache is only built in the
  main window (`init.js`). Settings are not stored.

### Deliberately not included

- **Album Artist MBGID** — the album artist is a separate relation
  (`ArtistsAlbums`); the artist column is the track's Artist field.
- **Per-track recording MBID** — this version exposes the album and artist
  identifiers; it does not assume a recording ID column on `Songs`, so there is
  no per-track ID to set.
- **Per-track album overrides** — a release ID belongs to the `Albums` row. Two
  tracks of the same album cannot have different release IDs, and the dialog
  makes that explicit rather than pretending otherwise.
- **Batch editing** — one row at a time, with one confirmation per row, so a
  mistyped ID cannot spread across a multi-select.
- **Works, labels, relationships** — not stored in the database.

## Building an `.mmip`

An `.mmip` is a ZIP with `info.json` at its **root** — zip the contents, not the
containing folder, and leave out the repository files.

PowerShell:

```powershell
# from this folder
Compress-Archive -Path .\info.json, .\init.js, .\mbzMbgid.js, .\actions_add.js, .\controls, .\dialogs, .\skin -DestinationPath .\MBzLovesMM5.zip -Force
Rename-Item .\MBzLovesMM5.zip .\MBzLovesMM5.mmip
```

bash / Git Bash, if `zip` is available:

```bash
zip -r MBzLovesMM5.mmip info.json init.js mbzMbgid.js actions_add.js controls dialogs skin
```

## Troubleshooting

- **The columns list is empty** — the cache has not loaded yet, or the library
  has no MusicBrainz matches. MediaMonkey only fills these fields when a
  release/artist is matched through its own MusicBrainz lookup.
- **IDs do not change after matching a release** — the column cache is built at
  start-up. Run **Tools → MBz loves MM5: reload MusicBrainz ID cache**, or
  restart MediaMonkey. The dialog always shows current values.
- **No MusicBrainz IDs group in the column chooser** — `controls/trackListView_add.js`
  failed to load. Check `debug.log` in the MediaMonkey program folder for lines
  starting with `MBz loves MM5:`.
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

## Layout

```
info.json                          addon manifest (id, version, icon)
init.js                            startup: loads the module, starts the cache
mbzMbgid.js                        database access, ID lookup tables, writes
actions_add.js                     Edit > Tag Tools and Tools menu actions
controls/trackListView_add.js      the three track-list columns
dialogs/dlgMBzLovesMM5.html        dialog markup
dialogs/dlgMBzLovesMM5.js          dialog: view, copy, edit
skin/icon/mbzLovesMM5.svg          menu icon
```

## Changelog

### 0.2.0
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
