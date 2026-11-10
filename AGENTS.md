# Loves MBz — project guardrails

These notes are for anyone, human or agent, changing Fill, Track Properties
saves, or extended-tag handling.

## The 0.4.3 group-save order is a hard contract

Track Properties Fill only stages values; MediaMonkey's OK commits them.
`setExtendedTagsAsync` can trigger the group commit as soon as a track's
extended tags are set. If one track's tags are written before another track's
native fields, the commit can save a partial selection. This is the regression
that 0.4.3 fixed.

Keep these rules:

1. `mbzExtStageFillOnSaveAsync` in
   `dialogs/dlgTrackProperties/tabLovesMBz.js` must call
   `apply.applyPendingAsync(track, work[i].pending, tagsText)` once per track
   inside the `work` loop.
2. Do not split native and extended-tag staging into two passes. Do not add an
   `applyPendingTagsAsync` helper, call `applyNative` from the group loop, use
   `Promise.all`, or add a per-track `commitAsync` loop.
3. `applyPendingAsync` in `mbzApply.js` must set that track's native properties
   first, then read, merge, and write its `ExtendedTags`.
4. Field work belongs in `buildPendingAsync`, `filterPending`, `mergeTags`, or
   `tagValue`. Fix field problems there; do not change when or how the dialog
   stages or commits values.
5. Disc # must write `discNumberInt` with `kind: 'int'`, not the string
   `discNumber`. Setting the string property can trigger the same early group
   commit.

The 0.4.3 implementations of those two functions are the reference. If you
change either, diff it against `v0.4.3` and explain why the contract still
holds.

## Run the guard

```bash
node tests/save-path.test.js
```

The test checks the source shape, the real native-before-tags call order,
duplicate alias collapse, and that `SCRIPT` is not written. Run it before
building an `.mmip`.

## Other 0.4.4 invariants

- Release country, status, and type are one logical field across Picard and
  canonical spellings; update the existing spelling and collapse duplicates.
- Fill does not offer or write `SCRIPT`. Existing values stay untouched.
