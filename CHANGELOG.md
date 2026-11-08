# Changelog

All notable changes to Loves MBz, newest first. Version numbers match
`info.json` and the git tags.

## 0.4.0 (beta test build)

Test build for the MusicBrainz metadata work — not published; install the
`.mmip` by hand and report what breaks. MediaMonkey requires a three-number
version, so `info.json` says `0.4.0` and the package is named
`LovesMBz-0.4.0-beta.mmip`; a numbered release follows live testing.

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
  saves only those fields for a multi-track selection.
- **Credits and labels** — every label on the release is joined into
  `publisher` instead of only the first.
- **Multi-value artist fields** — MediaMonkey's native Artist and Album Artist
  now receive `Isaiah Rashad; SZA` rather than the joined phrase. The joined
  credit is kept in the `ARTISTS` and `ALBUMARTISTS` extended tags for
  pipelines that need it.
- **Years and original date** — Fill writes the native year and original year
  alongside date and original date, and adds Picard's `originaldate` tag next
  to `originalyear`.
- **Preview fixes** — the album tracklist is read under a read lock, so the
  preview no longer fails with "Read lock not acquired!"; field rows use
  MediaMonkey's own checkboxes and can be selected again. The native Date field
  is always offered, separately from Original date, so the release date can be
  written to MediaMonkey's own date.
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
