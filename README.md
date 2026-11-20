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

Current version: **0.5.3** "Responsive". A test build names its channel (for
example `0.5.3-rc1`) in the window footer and in the package.

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
