# Loves MBz for MediaMonkey

[![Latest release](https://img.shields.io/github/v/release/djnizzi/Loves-MBz?label=release&sort=semver)](https://github.com/djnizzi/Loves-MBz/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/djnizzi/Loves-MBz/total)](https://github.com/djnizzi/Loves-MBz/releases)
[![MediaMonkey](https://img.shields.io/badge/MediaMonkey-5.0%2B-1f6feb)](https://www.mediamonkey.com/)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#install)

![The Tag from MusicBrainz window in MediaMonkey 5, listing the release read
from MusicBrainz beside the fields it can write](docs/lovesmbz-cover.jpg)

**Loves MBz tags your albums from MusicBrainz.** Select the tracks, open **Tag
from MusicBrainz…**, and the add-on reads the release behind the album's
existing MusicBrainz release ID: artist credit, label and catalogue number,
barcode, status, type, country, script, the full track list and the release's
Discogs page. Tick the fields you want, press **Apply**, and the tags are
written track by track. Nothing is written before that click.

## Tag from MusicBrainz

Open it from **Edit → Tag Tools**, the track-list context menu, or its own
button in MediaMonkey's toolbar. It works on one album at a time.

- **It compares before it offers.** Only fields whose MusicBrainz value differs
  from your library are listed, with the current value beside the fetched one;
  a value that differs per track reads `per track`. Everything that already
  matches is left alone.
- **You choose what gets written.** Every field starts ticked, and beside
  **Apply** the footer counts exactly what that click will do — for example
  `Will write 9 field changes on 5 tracks · 2 tag edits`. Untick a field to
  keep your value.
- **Two tabs, and a field set you choose once.** **ID and changes** holds every
  card the window draws; **MBZ tags to use** lists every field the add-on can
  write, with the column or Picard tag name beside it and whether this release
  supplied it. A field you turn off there is not offered again — in any
  window, for any album — until you turn it back on; **Save as default**
  stores the set and **Reset to saved** puts the ticks back. The ticks in
  **Fields to write** still decide what this Apply writes, so turning a field
  off is a setting, not a write.
- **The exact release, not just the right group.** MediaMonkey often matches
  the release group's best-known release rather than the pressing the album is.
  The window's first card lists every release of the group with its date,
  country, format and track count, under the album's release ID field;
  **use this** loads one in place, and the fields, the track comparison and
  **Apply** follow it. A list that could not be read says why and offers
  **Retry**. Nothing is written to the album by picking: **Save ID** is still
  what changes the album's release ID.
- **Tracks are matched by disc and track number, never by title.** A library
  track with no counterpart in the release is skipped and counted, so a partial
  match cannot put the wrong title on a track.
- **Tags, not your library.** The album's release ID is the lookup key and is
  never written by a fill; only the **Save ID** field touches the library, and
  only when you press it. Correct a wrong release ID there and the window
  reloads around the new release.
- **The selection's MusicBrainz extended tags live in the same window** — list,
  edit, add and remove them, with links to the matching MusicBrainz pages, no
  Track Properties in the way, and a strip that reconciles a tag that
  disagrees with the library ID.
- **Honest when it cannot help.** An album with no release ID gets a **Search
  MusicBrainz** button instead of a guess: there is no search by artist or
  album name, no AcoustID and no disc-ID lookup, so the add-on cannot pick the
  wrong release for you. A busy server, a timeout or a bad ID is reported with
  **Retry** where retrying can help.
- **No API key, one album at a time.** It identifies itself to MusicBrainz,
  keeps requests at least 1.1 s apart, caches the parsed release for the
  session, and writes fields, extended tags and one commit per track inside a
  single apply — a failing track is reported while the rest still commit.

While it reads or writes, the window shows it is busy: a small ring turns beside
the header, **Save ID** greys out and the pointer becomes the progress cursor.

## Also in the add-on

MediaMonkey keeps MusicBrainz identifiers in its library database but never
shows them anywhere in the UI. Loves MBz exposes them as three read-only
track-list columns:

| Column | Database source |
|---|---|
| MusicBrainz Release ID | `Albums.MBGID` |
| MusicBrainz Release Group ID | `Albums.MBRGGID` |
| MusicBrainz Artist ID | `Artists.MBGID` (via `ArtistsSongs`) |

An **Edit → Tag Tools → MusicBrainz IDs…** dialog lists the IDs for the
selected tracks, copies them as a tab-separated table, and can set them on the
album or artist behind the selected track. Right-click a track — or use
**Edit → Tag Tools** — and pick **MusicBrainz links** to open its release,
release group or artist page on musicbrainz.org.

Current version: **0.6.2**. A test build names its channel (for
example `0.6.2-rc1`) in the window footer and in the package.

---

## Install

Download `LovesMBz.mmip` from the [latest release](https://github.com/djnizzi/Loves-MBz/releases/latest),
then in MediaMonkey open **Tools → Addons → Add**, pick the file and restart.

Requires MediaMonkey 5 on Windows. To build the package from source or copy the
folder in for development, see [TECHNICAL.md](TECHNICAL.md).

## Documentation

| Document | Covers |
|---|---|
| [TECHNICAL.md](TECHNICAL.md) | every window and field in detail, the release lookup, the write path, building the `.mmip`, troubleshooting, file layout |
| [AGENTS.md](AGENTS.md) | the write-path contract for anyone changing the tagging engine |
| [CHANGELOG.md](CHANGELOG.md) | the version history |
| [ROADMAP.md](ROADMAP.md) | what has shipped and what is next |

---

2026 · made with ❤️ by NiZ Design
