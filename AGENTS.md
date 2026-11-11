# Loves MBz — project guardrails

These notes are for anyone, human or agent, changing Tag from MusicBrainz, the
write engine, or extended-tag handling.

## 0.5.0: one write path, nothing inside MediaMonkey's dialogs

0.4.x wrote through MediaMonkey's Track Properties dialog and relied on its
group save. That does not work: in group mode `btnOkPressed` rebuilds `modified`
and `tagModified` from its own checked controls, the group save commits a proxy
that holds one value per field, and each track was flushed as the loop walked
it. Per-track titles, composers, disc numbers and recording IDs could not be
expressed at all, and an abort could leave the selection half written.

0.5.0 removed the tab and moved the whole job into `dialogs/dlgMBzTag.js`.

The contract:

1. **One write path.** Every write goes through
   `mbzApply.applySelectionAsync`. No other module writes tags or native fields,
   and the window never calls `commitAsync` or `setExtendedTagsAsync` itself.
2. **Stage, then commit.** Per track: native fields, then one read and one
   merged `ExtendedTags` write, then `commitAsync()`. One commit per track, and
   the tag write happens once even when a fill and a tag edit touch the same
   track.
3. **Nothing runs inside MediaMonkey's dialogs.** The add-on registers no
   `propertiesTabs` tab, never stages values into a MediaMonkey dialog, and
   never relies on MediaMonkey's group save.
4. **One album at a time.** `resolveTagScope` is the only place that decides the
   scope. A selection spanning more than one album ID is refused unless the user
   insists; then the first album's release is used and tracks are matched by
   disc and track number.
5. **Field work belongs in the engine.** Fix field problems in
   `buildPendingAsync`, `aggregateFields`, `mergeTags` or `tagValue` — never in
   the dialog.
6. Disc # is written as `discNumberInt` with `kind: 'int'`, and `SCRIPT` is
   never offered or written.

Keep `applySelectionAsync` in that order. The failure handling is per track, so
one bad track is reported and the rest still commit. Do not add a second
`setExtendedTagsAsync` call, a per-field commit loop, or a `Promise.all` over
tracks.

## Run the guard

```bash
node tests/tag-path.test.js
```

The test checks the source shape (one write path, no `propertiesTabs`, the
action and toolbar wiring), scope resolution, field aggregation, the native →
tags → commit order, one tag write per track, per-track failure isolation, tag
edits, and the 0.4.x invariants (`discNumberInt`, no `SCRIPT`, alias collapse).
The packager runs it before building, and refuses to package when it fails.

## Build the package

```bash
node tools/build-mmip.js
```

The packager runs `tests/tag-path.test.js` first and stops when it fails, then
copies the sources into a temporary folder, fills the `BUILD_TIME` slot in
`dialogs/dlgMBzTag.js` (in the copy and in the source, so a copied dialog reports
the same build), and writes `LovesMBz.mmip` with `info.json` at the archive
root. Use it instead of zipping by hand: a hand-made archive has no build time,
and the version alone cannot tell two builds apart.

## Other invariants kept from 0.4.x

- Release country, status, and type are one logical field across Picard and
  canonical spellings; update the existing spelling and collapse duplicates.
- Fill does not offer or write `SCRIPT`. Existing values stay untouched.
- Library-side writes (`Albums.MBGID`, `Artists.MBGID`) never go through
  `applySelectionAsync`. The window's **Album release ID** field, the
  divergence strip's **Update library** and the **MusicBrainz IDs…** dialog all
  call `mbzMbgid.setAlbumGuidAsync` / `setArtistGuidAsync` directly, after their
  own confirmation. The field is a lookup key: write it, then reload.
