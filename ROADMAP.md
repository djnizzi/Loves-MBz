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
album must already carry `Albums.MBGID`. When that is empty there is no search,
no name matching and no request — the album is skipped and reported as skipped,
so the add-on never guesses which release is meant.

MusicBrainz needs **no API key** for reads. The rules are a descriptive
`User-Agent` and at most one request per second, and both live in the fetch
module rather than in a user setting. Nothing is ever written to MusicBrainz, so
no account, token or secret is stored.

One `release/{mbid}` lookup with
`inc=artist-credits+labels+recordings+release-groups+media+discids+text-representation+isrcs`
supplies a whole album in a single request: the MBIDs, artist and album-artist
credits, label and catalogue number, barcode, status, type, country, date,
script and language, plus the track list with recording IDs, release-track IDs
and ISRCs. Library songs are matched to the release by disc and track number,
never by title.

### Checklist

- [x] `mbzFetch.js`: serialized queue (requests at least 1.1 s apart), a
      descriptive `User-Agent`, `fmt=json`, backoff on 503, cancellation when
      the dialog closes, and no request at all for an album without `MBGID`.
- [x] Read-only preview: one album per dialog, the fetched values and the full
      track list, nothing written. Albums with no release ID say why instead of
      being queried.
- [ ] Write step: current value against fetched value per field, one checkbox
      per field, nothing written until **Apply**.
- [ ] Native tags: artist, album artist, title, date, original date, genre,
      composer, lyricist, conductor, producer, publisher (label), copyright,
      language, ISRC, track and disc numbers.
- [ ] Extended tags for values with no column, under Picard's names:
      `MUSICBRAINZ_*` IDs, `BARCODE`, `SCRIPT`, `ARTISTS`, `ALBUMARTISTS`,
      `originalyear`, album type/status/country, `CATALOGNUMBER`.
- [ ] Writes go through `track.commitAsync()`; the tag/library disagreement
      strip is extended so a fetched ID cannot silently overwrite a tag.
- [ ] Cache a fetched release for the session, so reopening the dialog for the
      same album does not call the API again.

### Not in 0.4.0

- Searching MusicBrainz by artist or album name, AcoustID or disc ID.
- Cover art from the Cover Art Archive.
- Writing anything back to MusicBrainz (that needs OAuth and is out of scope).

## Backlog

- [x] **MusicBrainz links in the track-list context menu** — right-click a track
      in table view and open its release, release group or artist page directly
      (**MusicBrainz links** submenu, also under Edit → Tag Tools).
- Add ideas here as they come up.
