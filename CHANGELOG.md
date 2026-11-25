# Changelog

All notable changes to Loves MBz, newest first. Version numbers match
`info.json` and the git tags. A test build names its channel in the window
footer and in the package, because `info.json` must stay three numbers.

## 0.7.1 (2026-11-25)

The 0.7 job: every field the audit found is reachable, the window offers only
the ones you choose, and that choice — like the window's tabs — is drawn by
MediaMonkey rather than by the add-on. The shared release cache from the
unreleased 0.7.0 ships here too.

- **A fetched release is reused across windows.** Reopening an album, or opening
  a second window on one already fetched, no longer asks MusicBrainz again: the
  parsed release is kept in a store that is bounded, timestamped, dropped when
  the build changes and emptied by `clearCache()`, so a stale entry is never
  served as news.
- **You choose which fields the window offers, once.** `lovesMBzFieldSet` is one
  versioned setting — a missing key, another version, or a key this build does
  not declare all fall back to the whole catalogue, so installing changes
  nothing until the set is edited. An empty list is a real answer, not a missing
  setting.
- **Two levels, not two settings.** The saved set decides which rows **Fields to
  write** offers; its ticks still decide what this Apply writes and never touch
  the setting. **Save as default** writes the set and **Reset to saved** reloads
  it. Nothing in that path writes a tag.
- **The tab strip is MediaMonkey's own `Tabs` control**, the strip the
  properties modal draws: the window hands it the two panels it already has, so
  the cards, their wiring and the one scrolling column are unchanged. A host
  without the control gets the window's own button bar, so neither panel is ever
  unreachable.
- **The same set from Tools → Addons → Loves MBz → Configure.** `info.json`
  names `config.js`, which lists the catalogue in two groups — each row naming
  the column or Picard tag it is written as and whether that is an extended tag
  or one of MediaMonkey's own fields — and writes the same setting the window's
  tab writes. MediaMonkey evaluates it inside the Addons
  dialog, where the add-on's loader cannot find its own files — that is what
  crashed rc1 with `mbzApply.js can't be loaded!` —   so the packager writes
  the engine's catalogue into the page and the page keeps only the set rule; the
  guard fails if either is stale or wrong, and the page calls no loader. It is settings only — no track, tag or native value is
  read or staged, and Apply is still the only writer of the files — the one
  exception `AGENTS.md` records to "nothing runs inside MediaMonkey's dialogs".
  A page that cannot draw its list says why and saves nothing, so a failure can
  never be mistaken for an add-on with no fields.
- **A field that already matches is not "not supplied".** The catalogue's mark
  comes from `mbzApply.suppliedFields(release)`, read before any comparison. The
  plan carries only the fields that differ, so reading it there marked every
  already-correct field as one MusicBrainz never sent.

## 0.6.2 (2026-11-25)

The second of the two 0.6 jobs: the window now tags files MediaMonkey has no
library row for — a file picked from the Folders node — and writes nothing but
their own tags.

- **Scoped by album name, not album ID.** A selection with no album row is
  scoped by the album name its files carry: every selected track must have the
  same one, and all of them carrying none is allowed. Two different names do
  not open the window; the entry point says why before it opens, and the window
  applies the same rule again. `resolveTagScope` reports `albumName`,
  `albumNameConflict`, `tagOnly` and `outOfLibrary`.
- **A file with no library row is planned from its own tags.**
  `buildSelectionPlanAsync` used to skip a track without a song row as
  `noLibrary`; it now reads that file's `ExtendedTags` from the track itself,
  matches it by disc and track number like any other, and counts only a track
  with neither a row nor a file as skipped.
- **The release ID field starts from the files, and its button says Load.**
  Outside the library there is no `Albums.MBGID`, so the field shows the
  `MUSICBRAINZ_ALBUMID` tag the files carry, empty when they carry none,
  instead of refusing the lookup. **Load** fetches the release into the window
  and changes nothing; Apply then writes the release's tags, the release ID tag
  included, onto the files through `applySelectionAsync`.
- **Reading the files' tags can no longer hang the window.** Reading a file
  that is not in the library goes through MediaMonkey's own reader, which can
  stall the way a save does. Every read now has a deadline
  (`mbzApply.readTrackTagsAsync`, 5 s in the engine, 4 s per file when the
  window lists them) and the whole listing has a 15 s budget; a file that does
  not answer is reported as unreadable instead of being waited for forever. The
  plan builder reads through the same deadline, so a tag-only plan cannot stall
  either. The release ID field and **Search MusicBrainz** appear as soon as the
  scope is known rather than after the last file's tags came back, and no
  release is looked up on its own: the field and the group card are the whole
  way in.
- **Nothing outside the library touches the library.** No album or artist row is
  read for suggestions or for the disagreement strip, `setAlbumGuidAsync` is
  never called from that path, and the window says the only thing it will write
  is the files' own tags.
- **The write path is unchanged.** Every write still goes through
  `mbzApply.applySelectionAsync`: per track, native fields, one merged tag
  write, one commit, with per-track failure isolation.

### Upgrading from 0.6.1

Nothing changes for library albums: the scope, the release lookup, the group
card and the write path are the same. This release adds a second scope, for
selections MediaMonkey has no album row for. Install over 0.6.1 and restart
MediaMonkey, so the dialog page is read again.

## 0.6.2-rc3 (2026-11-23)

Test build for the 0.6.2 line, fixing what rc2 did while reading the files'
tags.

- **Reading the files' tags can no longer hang the window.** Reading a file
  that is not in the library goes through MediaMonkey's own reader, which can
  stall the way a save does. Every read now has a deadline
  (`mbzApply.readTrackTagsAsync`, 5 s in the engine, 4 s per file when the
  window lists them) and the whole listing has a 15 s budget; a file that does
  not answer is reported as unreadable instead of being waited for forever. The
  plan builder reads through the same deadline, so a tag-only plan cannot stall
  either.
- **The way in is usable before the tags are read.** Outside the library the
  release ID field and **Search MusicBrainz** now appear as soon as the scope is
  known, instead of after the last file's tags came back.

## 0.6.2-rc2 (2026-11-23)

Test build for the 0.6.2 line, fixing what rc1 did when the window opened on
files outside the library.

- **No release lookup without a release ID.** rc1's window read a release by
  itself whenever it opened, and on files with no `MUSICBRAINZ_ALBUMID` tag the
  footer sat on "Reading the release from MusicBrainz..." while nothing of the
  sort was happening. Outside the library the window now reads a release only
  when the user presses **Load** in the release ID field or picks one from the
  group card; until then it says the files' tags are being read, and then that
  no release is loaded. Search MusicBrainz and the release ID field are the
  whole way in, as they are for an album with no release ID.
- **A release loaded in the field survives the reload.** Reloading after Apply
  keeps the release that is on screen instead of reading it again.

## 0.6.2-rc1 (2026-11-22)

Test build for the 0.6.2 line. The window only worked on albums MediaMonkey
already had: a file selected from the Folders node had no album row, so the
selection had no release to look up. This build tags those files too, and
nothing in it writes to the library.

- **Scoped by album name, not album ID.** `resolveTagScope` now scopes a
  selection with no album row by the **album name** the selected files carry:
  every track must have the same one, and all of them carrying none is allowed.
  Two different names do not open the window; the entry point says why before it
  opens, and the window applies the same rule again.
- **A file with no library row is planned from its own tags.**
  `buildSelectionPlanAsync` used to skip a track without a song row as
  `noLibrary`; it now reads that file's `ExtendedTags` from the track itself,
  matches it by disc and track number like any other, and counts only a track
  with neither a row nor a file as skipped.
- **The release ID field starts from the files.** Outside the library there is
  no `Albums.MBGID`, so the field shows the `MUSICBRAINZ_ALBUMID` tag the files
  carry, empty when they carry none, instead of refusing the lookup. Its button
  says **Load**, not **Save ID**: it fetches the release into the window and
  changes nothing. Apply then writes the release's tags, the release ID tag
  included, onto the files through `applySelectionAsync`.
- **Nothing outside the library touches the library.** No album or artist row is
  read for suggestions or for the disagreement strip, `setAlbumGuidAsync` is
  never called from that path, and the window says the only thing it will write
  is the files' own tags.

### Upgrading from 0.6.1

Nothing changes for library albums: the scope, the release lookup, the group
card and the write path are the same. This build adds a second scope, for
selections MediaMonkey has no album row for.

## 0.6.1 "We just getting started" (2026-11-22)

MediaMonkey matches the release group well and then points the album at the
group's best-known release, which is often not the pressing in hand. This
release lets that pressing be picked in the window. "We just getting started"
because it is the first of the two 0.6 jobs: tagging files that are not in the
library yet is 0.6.2.

- **Pick the pressing, not the group.** A card lists every release of the
  loaded release's group — title, date, country, format and track count, oldest
  first — with the loaded one marked `✓` and a **use this** link on the rest,
  both flush right. The links carry their sentence in the tooltip and
  `aria-label`, and the column no longer repeats the release status the block
  above already names.
- **The card is the first one, with the release ID in it.** The list sits above
  the release block, and the **Album release ID** field, **Save ID** and its
  status line open the card, above the list. The card stays on screen while the
  field does, even when the group has nothing to list or could not be read.
- **A card that cannot be read says why, and offers Retry.** MusicBrainz answers
  "busy" often enough that the first attempt regularly fails; a failure that can
  pass gets a **Retry** button that reads the same group again, keeps the card
  and its sentence while the request runs, and fills the rows in when it
  succeeds.
- **A Format column.** Each row names the medium MusicBrainz gives the release —
  `CD`, `Digital Media`, `12" Vinyl`, `Cassette` — beside its date, country and
  track count. Mixed media name each distinct format once (`CD, DVD`).
- **Picking is a load, not a write.** The album's `Albums.MBGID` still changes
  only through **Save ID**, and **Save ID** now writes straight away: the field
  exists to be saved, the write is one library column, and the line under it
  reports the result or why it failed. Apply still writes tags through
  `mbzApply.applySelectionAsync`; nothing in the chooser touches either.
- **One request per group, cached.** `mbzFetch.fetchReleaseGroupReleasesAsync`
  browses `release?release-group={id}&inc=media` through the same queue and
  1.1 s spacing as every other call, and keeps the parsed list by group ID for
  the session. The browse endpoint is used because only its rows carry the media
  that holds each pressing's track count and format. The plan does not wait for
  it: the card fills in under the busy ring.
- **An older page still shows the card.** MediaMonkey keeps the dialog page it
  loaded at start-up, so the window builds the card itself when the page has
  none, puts it first, and moves the release ID field into it.

### Upgrading from 0.5.3

Nothing changes in the tags, the library or the write path: the release lookup,
the disc/track matching, `applySelectionAsync` and the extended-tag rules are
the same. The window adds the card, and the **Album release ID** field moves into
it with **Save ID** no longer asking for confirmation — **Update library** in the
disagreement strip and the **MusicBrainz IDs…** dialog keep theirs, because they
act on a tag's value rather than on something typed in the window. A change to
the page appears after MediaMonkey is fully restarted; the card, its order and
the field's place are also applied to an older page by the script.

## 0.6.1-rc10 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The list said date,
country and track count, but not what the pressing is made of.

- **A Format column.** Each row now names the medium MusicBrainz gives for the
  release — `CD`, `Digital Media`, `12" Vinyl`, `Cassette` — beside its date,
  country and track count. A release with mixed media names each distinct
  format once (`CD, DVD`), in the order the media list them; a release whose
  media carry no format shows an empty cell.

### Upgrading from 0.6.1-rc9

Install this build over rc9 and restart MediaMonkey: the column is in the page,
and the card the window builds for an older page has it too. The lookup is
unchanged — the browse request already asked for the media, so the format costs
no extra request. The tags, the write path and **Save ID**
without a prompt are unchanged.

## 0.6.1-rc9 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The card carried a
sentence about picking that the list and the field already say themselves.

- **No helper sentence under the list.** The note about picking another release
  and the album keeping its own ID is gone; the `use this` links, the `✓` on the
  loaded release and the line under the field say it where it happens.
- **The release ID field is the first thing in the card.** It sits directly
  under the card's title, above the list, so the key is where the eye lands
  before the releases it can be replaced with.

### Upgrading from 0.6.1-rc8

Install this build over rc8. Both changes are in the page; the window also moves
the field under the card's title when the page it runs is older than the script.
The tags, the write path and **Save ID** without a prompt are unchanged.

## 0.6.1-rc8 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The release list sat
under the release block, and the field that saves the picked release lived in
that block, away from the pick that fills it.

- **The releases of the group are the first card.** Choosing the pressing is
  what the window is for, so the list now sits above the release block instead
  of under it.
- **The album release ID moved into that card.** The field, **Save ID** and the
  line under it are under the list, so the picked release and the ID it can be
  saved as are one block. The card stays on screen while the field does, even
  when the group has nothing to list or could not be read.
- **The release block now holds only the release's details.** It still hides
  itself when there is no release; with the ID field gone it no longer exists
  just to carry the lookup key.

### Upgrading from 0.6.1-rc7

Install this build over rc7. The order and the field's place are in the page, so
they show after a full MediaMonkey restart; the window also moves the field into
the card when the page it runs is older than the script, so an install without
a restart still shows it there. The tags, the write path, the **use this** links,
**Save ID** without a prompt and **Retry** on the group card are unchanged.

## 0.6.1-rc7 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. **Save ID** asked for
confirmation before writing the ID you had just typed into the field.

- **Save ID writes without asking.** It still validates the value and compares
  it with the album row, then writes `Albums.MBGID` and reloads the window; the
  line under the field reports the result, or why the write failed. The extra
  track-count request that only fed the prompt is gone with it, so the save
  happens on one request instead of two.
- **Update library still asks.** The disagreement strip writes the tag's value
  onto the album or artist row, which is not something typed in the window, so
  it keeps its confirmation. The **MusicBrainz IDs…** dialog keeps its own.

### Upgrading from 0.6.1-rc6

Install this build over rc6. The tags, the write path, the **use this** links and
**Retry** on the group card are unchanged.

## 0.6.1-rc6 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The release list was
still wider than it needed to be, and its load control read as a player button.

- **No status column.** Every row repeated the string already shown in the
  release block above ("Official", "Bootleg"), and it took width the track list
  wanted. The column is gone.
- **`use this` instead of a `▶`.** The load control is a link in the host's
  link colour, not a button with a play icon that looks like Play in
  MediaMonkey. Its tooltip and `aria-label` still name the release it loads.
- **The action column ends flush right.** The loaded release's `✓` and the
  `use this` links under it share one right edge, so the column reads as a
  column instead of a wobble of centred marks.

### Upgrading from 0.6.1-rc5

Install this build over rc5. The tags, the write path, the **Save ID** rule and
**Retry** on the group card are unchanged.

## 0.6.1-rc5 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The pick no longer
opens MediaMonkey's *Application throw an exception* box, but **Apply** and
**Save ID** still handled their failures the same late way.

- **One place decides how a failure is reported.** `handledInWindow` attaches
  the failure handler to the promise the window is already building, so no
  rejected promise ever reaches `trackWork`. **Apply** (write, then the reload
  that follows it), **Save ID** (album write, then the reload) and the pick all
  go through it and say "Could not write: …", "Could not update the album: …"
  or "Could not read that release: …" in the header.
- **A save that cannot reload still says so.** When the album write succeeds
  but the reload behind it fails, the window keeps the new ID's sentence and
  adds that the reload failed, instead of leaving the last message up or
  opening the host's error box.
- **The pick's failure flag is gone.** Its rejection is handled where the chain
  is built, so nothing needs to remember how the chain ended.

### Upgrading from 0.6.1-rc4

Install this build over rc4. The tags, the write path, the **Save ID** rule, the
glyph buttons and **Retry** on the group card are unchanged.

## 0.6.1-rc4 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. Picking a release that
MusicBrainz could not answer for showed MediaMonkey's own *Application throw an
exception* box instead of a sentence in the window.

- **A failed pick stays in the window.** The pick's failure handler now sits
  inside the window's own promise chain. Handled only after `trackWork` wrapped
  the promise, MediaMonkey's promise library had already reported the rejection
  as unhandled and opened its error box over the window. The window now says
  "Could not read that release: …" and keeps the list as it was.
- **Two glyphs instead of two words.** The action column is a `▶` button that
  loads that release and a `✓` on the release already loaded; the tooltip and
  `aria-label` carry the sentence each word used to. The list is the narrow
  part of the window, and the buttons no longer widen it.

### Upgrading from 0.6.1-rc3

Install this build over rc3. The tags, the write path, the **Save ID** rule and
**Retry** on the group card are unchanged.

## 0.6.1-rc3 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The card now appears on
an older page, but MusicBrainz answers "busy" often enough that the first
attempt regularly fails, and the card had no way to ask again.

- **Retry on the card.** A group listing that failed for a reason that can pass
  (MusicBrainz busy, a timeout, a dropped connection) now shows a **Retry**
  button next to the reason. It reads the same group again, keeps the card and
  its "Reading the releases of this group..." line while the request runs, and
  fills the rows in when it succeeds. Nothing is cached from a failed lookup, so
  the second attempt is a real request.
- **Only a failure that can pass offers retry.** A group MusicBrainz does not
  know, or a page still running an older `mbzFetch.js`, keeps its explanatory
  sentence and no button: clicking again would not change either.

### Upgrading from 0.6.1-rc2

Install this build over rc2. The tags, the write path, the **Save ID** rule and
the card's fallback are unchanged; the card only gains the button.

## 0.6.1-rc2 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The new card did not
show up after installing rc1 without a full MediaMonkey restart: the host keeps
the dialog page it loaded at start-up, so the rc1 script ran against the older
page, found no card in it, and drew nothing.

- **The card exists even on an older page.** `dialogs/dlgMBzTag.js` builds the
  **Releases in this release group** card itself when the page has none, inserts
  it under the release block, and wires its rows — the same fallback the busy
  ring already has. Installing this build over rc1 or 0.5.3 shows the section
  without restarting MediaMonkey.
- **A card that cannot read its list says why.** When the group listing fails
  (MusicBrainz busy or unreachable) or the window came with an older
  `mbzFetch.js`, the card stays on screen with a one-line reason instead of
  disappearing. A group with a single release still draws no card, because there
  is nothing to choose.

### Upgrading from 0.6.1-rc1

Install this build over rc1. Nothing else changed: the tags, the write path and
the **Save ID** rule are the same. A group listing that cannot be read now says
so in its card rather than leaving the window without that section.

## 0.6.1-rc1 (2026-11-22)

Test build for the 0.6.1 line; `info.json` says `0.6.1`. The 0.6 line has two
jobs: tag files MediaMonkey has not added to its library, and let the right
release be picked out of a release group. This build is the second one.

- **Choose the pressing, not the group.** MediaMonkey usually matches the
  release group correctly and then points the album at the group's best-known
  release, which is often not the pressing in hand. A new **Releases in this
  release group** card lists every release of the loaded release's group —
  title, date, country, status and track count — with the loaded one marked.
  **Use** on another row loads that release into the window: the release block,
  the field comparison, the track table and **Apply** all follow it.
- **One request per group, cached.** `mbzFetch.fetchReleaseGroupReleasesAsync`
  makes one `release?release-group={id}&inc=media` request, through the same
  queue and 1.1 s spacing as every other call, and keeps the parsed list by
  group ID for the session. It browses the group's releases rather than looking
  the group up, because only the browse rows carry the media that holds each
  pressing's track count. The plan does not wait for it; the card fills in under the
  busy ring. A group with one release draws no card, because there is nothing to
  choose.
- **Picking writes nothing.** The album's `Albums.MBGID` still changes only
  through **Save ID**, after its own confirmation, and Apply still writes tags
  through `mbzApply.applySelectionAsync`. The **Album release ID** field shows
  the loaded release, so a picked release's ID is one click from being saved;
  Save ID now compares the field with what the album row holds, so that click
  writes the new ID instead of saying it is already there.
- **The old release ID is not lost.** Reloading, closing the window, or picking
  the album's own release again returns to what the album points at; nothing
  was changed in between.

### Upgrading from 0.5.3

The tags, the write path and the extended-tag rules are unchanged. The window
adds one card, which appears only when the loaded release's group has more than
one release. The card is also built from script when the page is older than the
script, so it shows without a restart; the rest of a page change
(`dialogs/dlgMBzTag.html`) still appears only after MediaMonkey is fully
restarted, because the host keeps the page it loaded at start-up.

## 0.5.3 "Responsive" (2026-11-20)

The window says when it is working, and stops drawing cards it has nothing to
put in. "Responsive" because every wait in the window — saving an album release
ID, reloading after **Apply** — is now visible while it happens, instead of the
window looking stuck.

- **The window shows that it is working.** Saving a release ID starts a release
lookup in the background, and reloading after **Apply** reads the selection
again; until now the only sign of either was a sentence, and **Save ID** stayed
clickable. A small ring now turns beside the header sentence for as long as
anything is being read or written, **Save ID** is greyed for the duration, and
the window's cursor becomes the system's progress cursor. The ring is counted,
not flagged: saving an ID, the reload behind it and Apply's write run on top of
one another, so it stays up until the last of them has finished.
- **The ring does not depend on the page or the skin.** Like the italics and the
card gap, `dialogs/dlgMBzTag.js` builds it when the host is still serving an
older copy of `dialogs/dlgMBzTag.html`, and its size, border and colour are
pinned inline because MediaMonkey applies its skin sheet after the window's own:
styled only by the page, the element was there but drew nothing. A script timer
rotates it as well, so it turns even where the page's animation is ignored.
- **No release, no comparison cards.** An album without a release ID shows only
the release lookup and its existing MusicBrainz tags. **Fields to write** and
**Selected tracks** are not drawn at all until a release is loaded — including
right after **Save ID** succeeds — instead of standing there empty. The cards
start hidden and are cleared on every reload, so a failed or replaced lookup
cannot leave an old table behind. They also survive the skin: hiding sets the
declaration inline with `!important`.
- **Guidance reads as guidance.** The explanatory notes, the search and save
statuses, the pending-work line, warnings and Apply's report are italic, so a
sentence is not mistaken for a value. A release title in the header stays
upright. The notes and the gap are pinned inline too, so the result does not
depend on which copy of the page the host has loaded.
- **More air between the cards.** The gap is now `1rem` instead of 10px.

### Upgrading from 0.5.2

Nothing changes in the tags, the library or the write path. The release-ID
lookup, the disc/track matching, `applySelectionAsync` and the extended-tag rules
are the same; 0.5.3 changes what the window draws and what it shows while it
waits. A change to the window's page only appears after MediaMonkey is fully
restarted, because the host keeps the page it loaded at start-up.

## 0.5.3-rc5 (2026-11-19)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The ring is visible now.** rc4's ring was drawn only by the dialog's own
stylesheet, and the host applies its skin sheet afterwards: the element was
there, but it lost its border and size and drew nothing. Its shape, size and
colour are now pinned inline as well — the same fix the italics and the card
gap needed — so the skin cannot take them away.
- **It turns even where the page's animation is ignored.** A script timer
rotates the ring as well; the CSS animation simply wins when it does run. It is
larger and darker than before, so it reads at a glance.
- **A busy pointer while anything runs.** The window's cursor becomes the
system's progress cursor for the duration of a lookup or a write, so the wait
is visible even away from the ring.

## 0.5.3-rc4 (2026-11-19)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The window shows that it is working.** Saving a release ID starts a
release lookup in the background, and until now the only sign of it was the
sentence next to the field. A small ring now turns beside the header sentence
while anything is being read or written, and **Save ID** is greyed for the
duration. The ring is counted, not flagged: saving an ID, the reload behind it
and Apply's write run on top of each other, so it stays up until the last of
them has finished.
- **The ring does not depend on the page.** Like the italics and the card gap,
`dialogs/dlgMBzTag.js` builds it when the host is still serving an older copy
of `dialogs/dlgMBzTag.html`, so the feedback appears before MediaMonkey is
restarted.

## 0.5.3-rc3 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **Style pinned from script.** Hiding worked, but the italic notes and the
wider card gap did not change on screen: they lived in the dialog's stylesheet,
and the host was still serving the previous page while running the new script.
Both are now applied inline at start-up — `font-style: italic !important` on
every guidance label, `margin: 0 0 1rem 0 !important` on every card — so the
result no longer depends on which copy of the page the host has.
- **Every guidance line is italic.** `setSummary` treats a sentence as an aside
by default and only a loaded release title is upright, so statuses set before
the release is read ("Reading the selection…", multi-album, read errors) are
covered too.

## 0.5.3-rc2 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **The cards hide even under the skin.** MediaMonkey's stylesheet is applied
after this window's and styles `fieldset`, so `display: none` on a class was
being outranked: an album with no release ID still drew the empty **Fields to
write** and **Selected tracks** cards. Hiding now also sets the declaration
inline with `!important`, the same technique that keeps the host's `Edit`
controls in check. The field card additionally refuses to return until
`hasRelease` is true.
- **The italics and the 1rem gap survive the skin.** Both are marked
`!important` so a host rule cannot reset them.

## 0.5.3-rc1 (2026-11-18)

Test build for the 0.5.3 line; `info.json` says `0.5.3`.

- **No release, no comparison cards.** An album without a release ID now shows
only the release lookup and its existing MusicBrainz tags. **Fields to write**
and **Selected tracks** are not drawn at all until a release is loaded —
including right after **Save ID** succeeds — instead of standing there empty.
The cards also start hidden and are cleared on every reload, so a failed or
replaced lookup cannot leave an old table behind.
- **Guidance reads as guidance.** The explanatory notes, the search and save
statuses, the pending-work line, warnings and Apply's report are italic, so a
sentence is not mistaken for a value. A release title in the header stays
upright; the "Reading the release…" and no-release sentences do not.
- **More air between the cards.** The gap is now `1rem` instead of 10px.

## 0.5.2 "Prettier" (2026-11-15)

A window you can read at a glance, and an Apply button that cannot be pressed
before there is a plan or while a write is running. "Prettier" because the
release is the 0.5 line's pass over the window itself: four cards instead of one
long sheet, a preview table about the music rather than its identifiers, and a
footer that says what a click will do.

- **The window reads in cards.** **Release**, **Fields to write**, **Selected
tracks** and **MusicBrainz tags** are now drawn as the rounded, titled box
MediaMonkey's own settings panels use — a fieldset with its legend — matching
ParaDeeJay's settings UI. The release overview and the album release ID share
one card; a card with nothing in it is not drawn, and a release that disappears
no longer leaves the previous overview on screen.
- **Apply waits for a plan.** The button is greyed out, with a tooltip saying
why, until the release comparison has produced a plan and while a reload is
re-reading the selection after an apply or a **Save ID**. It can no longer
report `Updated 0 of 0 tracks` because it was pressed while the window was
still loading.
- **A write locks the window.** While **Apply** runs, the field checkboxes, tag
values, **Add** row, **Save ID**, the library suggestions and the disagreement
strip's buttons are disabled. Previously only Apply itself was greyed out, so an
edit typed during the run was silently discarded by the reload that followed.
The lock clears when the run finishes, including when a track fails; Party Mode
stays read-only as before.
- **Apply says what it will write.** The footer beside **Apply** states the
pending work — for example `Will write 9 field changes on 5 tracks · 2 tag
edits` — and updates as fields are ticked, tag values are typed and tags are
cleared. Field changes are counted per track, so a field that differs on four
tracks counts as four. With nothing staged the line says so, instead of leaving
Apply's effect to be discovered. Party Mode shows no line, because nothing can
be written there.
- **The preview table pairs artists instead of listing ISRCs.** **Selected
tracks** now shows **Library title**, **Library artist**, **Release title** and
**Release artist**, side by side, and the **ISRC** and **Recording ID** columns
are gone. ISRCs and recording IDs are still fetched and still written to the
tags; they just no longer take width in the window. An unmatched track shows a
dash where the release title and artist would be.
- **Retry a lookup that failed.** When MusicBrainz is busy, does not answer or
cannot be reached, the window offers **Retry** beside the message. It repeats
the release lookup in place, so the window no longer has to be closed and
reopened, and tag edits made before the failure survive. A release ID that
MusicBrainz does not have gets a "check the release ID" note instead, because
retrying that cannot help.

### Upgrading from 0.5.1

Nothing changes in the tags or the library. The write path, the release-ID
lookup and the extended-tag rules are the same; 0.5.2 changes how the window
presents them and when **Apply** is available.

## 0.5.1 (2026-11-12)

"Tag from MusicBrainz" as it ships: the first public build of the 0.5 line,
combining the 0.5.0 rewrite with the fixes and polish below.

- **`mbzApply.js can't be loaded! (NOT FOUND)` on Tag from MusicBrainz.** The
  action called `localRequirejs` from inside `script://actions`, where the loader
  resolves paths against MediaMonkey's own script and aborted before the window
  opened. The engine is loaded by `init.js` at start-up instead; if it is
  missing, the action now opens the window and logs the reason.
- **The toolbar button sits with the other tool icons.** 0.5.1 appended the
  action to `toolbarItems`, the *custom* toolbar, which drew it on a row of its
  own. It is now added to `righttoolbuttons` with `uitools.addToolButton`, on
  start-up, and a stale `toolbarItems` entry is removed. The one-time offer
  prompt is gone: the button is always there.
- **The window scrolls.** One scrolling column, with the summary block and the
  **Apply** footer pinned, instead of a dialog that grew past its own footer.
- **Album, release group and album artist links** — **Open in MusicBrainz**
  under the release title opens the release, its release group and the album
  artist, from the fetched release or, when the album has no release ID, from
  the library rows.
- **The album's release ID is editable in the window.** **Album release ID**
  validates the value as a MusicBrainz UUID, confirms before replacing an
  existing ID (naming the album and the number of tracks it covers), writes
  `Albums.MBGID` through `mbzMbgid.setAlbumGuidAsync`, and reloads the window on
  the new release. An empty value clears the ID and shows the no-ID state. The
  write never goes through `applySelectionAsync`.
- **Version and build stamp.** The window footer shows `Loves MBz` with the
  version and the time the package was built, so two builds of the same version
  can be told apart. `node tools/build-mmip.js` writes the time in as it
  packages; the version half is checked against `info.json` by the regression
  test. The packager runs that test first and refuses to build when it fails.
- **The window uses MediaMonkey's own controls.** Every text field and the tag
  picker are the host's skinned `Edit` and `Dropdown` controls (the dialog loads
  `commonControls.js`), so they are the same height as the rest of the
  application. Native `<input>`/`<select>` elements were drawn oversized by the
  skin and ignored every stylesheet and inline rule aimed at them. The
  **Album release ID** field takes the row's width so a 36-character UUID is
  readable, and both field rows are centred vertically.
- **Only the selected tracks are listed.** The release-wide track preview and
  its **Show all release tracks** button are gone.
- **Table headers match their data and stay out of the way.** They are
  left-aligned over their columns — the skin centres `th` — and a header row is
  hidden when its table has no rows, for example an album without a release ID.
- **Original year is no longer offered.** The native **Original year** field
  landed in the same library field as the original date and overwrote it, so the
  field is gone (the `originalyear` tag was already excluded).
- **Apply cannot hang any more.** Reading the extended tags, writing them and
  the commit each have a 30-second deadline: a stalled track is reported as
  failed and the rest still commit, instead of the window sitting on
  **Writing…** with half the selection written. The status line counts
  `Writing 3 of 8…` as it goes, and the report names every failed track with its
  error, up to six of them, then `...and N more.`.
- **The toolbar button works on a fresh start.** Opening it when MediaMonkey has
  just started and tracks are already selected used to do nothing until the
  selection changed, because the host reports no "last focused" track list yet;
  the window now looks for the selection in the main panel.

## 0.5.0 "Tag from MusicBrainz" (2026-11-11)

- **One window does the tagging.** **Edit → Tag Tools → Tag from
  MusicBrainz…**, the track-list context menu and a toolbar button all open the
  same window on the current selection. It shows the release, the selected
  tracks with the release row each one matched, the differing fields with one
  checkbox each, and the selection's MusicBrainz extended tags. Nothing is
  written until **Apply**; closing the window writes nothing.
- **The Track Properties tab is gone.** 0.4.x staged values inside
  MediaMonkey's dialog and relied on its group save, which rebuilds
  `modified`/`tagModified` from its own checkboxes and commits a proxy holding
  one value per field. Per-track titles, composers, disc numbers and recording
  IDs could not be expressed, and an abort could leave the selection half
  written. The add-on registers no `propertiesTabs` tab any more.
- **Per-track writes.** `mbzApply.applySelectionAsync` is the only write path:
  each track gets its native fields, then one read and one merged
  `ExtendedTags` write (fill tags and tag edits together), then one
  `commitAsync()`. A failing track is reported and the rest still commit, and
  the status line reads `Updated X of N tracks. Skipped S. F failed.`
- **Toolbar button.** The action is `hotkeyAble` with the add-on icon, so it is
  available under Options → Layout → Toolbar and can be hotkeyed. The add-on
  offers to add it to the toolbar once, remembers the answer, and never injects
  a DOM button into MediaMonkey's toolbar container, which is rebuilt from
  `toolbarItems` on every settings change.
- **One album at a time.** A selection spanning more than one album ID is
  refused unless the user confirms a prompt that names the album count and the
  shared release ID when there is one. Then the first album's release is used
  and every selected track is matched by disc and track number.
- **Tag table in the window.** The MusicBrainz extended-tag editor moved out of
  Track Properties: view, edit, add, delete, one row per ID for slash-joined
  artist IDs, musicbrainz.org links, **From the library** suggestions and the
  tag-vs-library disagreement strip. Every tag change is written per track by
  **Apply**.
- **Kept from 0.4.x** — lookup by release ID only with no name search, the
  website search button when an album has no ID, `discNumberInt` for Disc #, no
  `SCRIPT` write, alias collapse for release status/type/country, the Discogs
  URL from the release or its release group, and library-side ID writes only
  where they already were.

## 0.4.5 (2026-11-11)

- **Search MusicBrainz from the no-ID state** — when an album has no
  `Albums.MBGID`, the preview and the Track Properties tab now offer **Search
  MusicBrainz**. It opens the website's release search with `release:"Album"
  AND artist:"Artist"`; the add-on still makes no metadata request and does not
  choose a release. The tab checks the album's release ID as it loads — and
  each distinct album in a group selection — so the button appears before Fill
  even while the ID cache is still filling. The preview reads the loaded
  selection through `getAllValues` so it appears even when MediaMonkey has not
  exposed `firstSelected` yet.

- **Discogs URL from release groups** — a master Discogs page is usually linked
  from the release group, not the release. The fetch now follows one
  `release-group/{id}?inc=url-rels` lookup when the release itself has no
  Discogs URL, and `discogs_url` reads either level.
- **Disc # writes through the integer property** — Fill and Preview now stage
  `discNumberInt` instead of the string `discNumber`. The string property can
  trigger a group commit as soon as it is assigned, which saved only part of a
  multi-track Fill; the integer property writes the same value through the
  normal native-field staging.

## 0.4.4 (2026-11-10)

- **Release fields no longer duplicate** — Fill treats Picard's
  `MusicBrainz Album Release Country`, `MusicBrainz Album Status` and
  `MusicBrainz Album Type` as the same fields as `RELEASECOUNTRY`,
  `RELEASESTATUS` and `RELEASETYPE`. It updates the spelling already in the
  track, and collapses existing duplicate spellings when the field is next
  written, instead of adding a second copy. Add tag uses the same matching.
- **Script is no longer written** — Fill no longer offers or writes the
  `SCRIPT` extended tag. Existing values are left in place; the preview still
  shows the release's script as read-only metadata.
- **Group Fill save path unchanged** — 0.4.4 leaves the 0.4.3 per-track save
  order alone: each track's native fields are staged before its extended tags,
  and MediaMonkey's normal group save commits them. The duplicate repair changed
  only which tags Fill writes, not how the dialog saves.

## 0.4.3 (2026-11-09)

- **Composer and lyricist** — Fill now reads the work linked to each
  recording and writes MediaMonkey's native Composer and Lyricist columns.
  Multiple names are deduplicated and joined with `; `.
- **Generic writers** — works that only use MusicBrainz's generic `writer`
  relationship now fill Composer and are also written to the `WRITER` extended
  tag. Specific composer relationships win when both exist.
- **Producer and remixer** — Fill now reads release and recording
  relationships and writes `PRODUCER` and `REMIXER` extended tags. Multiple
  names are deduplicated and joined with `; `.
- **Group Fill native fields** — Composer and Lyricist are staged before the
  extended tags. MediaMonkey's normal group save then commits the native
  fields with the same model as the rest of Fill; there is no per-track
  commit loop.
- **Full group selection** — group Fill now merges the Properties dialog's
  group tracklist with the main selected tracklist. The dialog list can be
  shorter than the selection, which previously staged Composer on only the
  first few tracks while the group tag patch reached all of them.

## 0.4.2 (2026-11-09)

- **No new duplicate tag aliases** — saving a tag that already exists under
  another file-format spelling now updates that entry and keeps its raw title,
  instead of appending an uppercase `MUSICBRAINZ_*` copy. Add tag follows the
  same rule, and Fill's merge collapses aliases when it writes the field.
- **Group OK cannot hang** — group saves no longer read extended tags from the
  group proxy, whose promise never completes. The deletion-aware patch is set
  directly on the group track, and tag reads, writes and Fill stages have
  bounded waits so OK can finish or report an error instead of leaving the
  modal open.

## 0.4.1 (2026-11-09)

- **Fill saves with Track Properties OK** — the separate **Apply selected**
  button is gone. Multi-track Fill now stages the selected fields on the
  selected tracks and lets MediaMonkey's global OK commit them through the
  normal group save, so a slow track is no longer reported as a 15-second
  timeout. Opening the Fill plan marks the group dialog dirty and ticks
  **Save MusicBrainz tags**, so global OK schedules the save reliably. Cancel
  discards the pending fill.

## 0.4.0 "Foundation" (2026-11-08)

The first release of the MusicBrainz metadata work. MediaMonkey requires a
three-number version, so `info.json` says `0.4.0`; the release asset is
`LovesMBz.mmip` from tag `v0.4.0`.

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
  saves only those fields for a multi-track selection. The per-tag **All tracks**
  boxes in the MusicBrainz tab use MediaMonkey's native Checkbox control, so
  they match **Save MusicBrainz tags** instead of drawing a blue browser
  checkbox.
- **Credits and labels** — every label on the release is joined into
  `publisher` instead of only the first.
- **Multi-value artist fields** — MediaMonkey's native Artist and Album Artist
  now receive `Isaiah Rashad; SZA` rather than the joined phrase. The joined
  credit is kept in the `ARTISTS` and `ALBUMARTISTS` extended tags for
  pipelines that need it.
- **Years and original date** — Fill writes the native year and original year
  alongside date and original date, and adds Picard's `originaldate` tag. The
  `originalyear` extended tag is no longer offered or written: some libraries
  use it for a full `YYYY-MM-DD` date, and replacing that with only the year
  loses the month and day.
- **Track-count warnings** — preview warns when the MusicBrainz release and
  the local album have different numbers of tracks, and the tag-vs-library
  warning fetches both release IDs and reports when their track totals differ.
- **Preview fixes** — the preview waits for MediaMonkey's selected tracklist
  to finish loading before reading its album, so a valid selection no longer
  opens as "No album is selected"; a reopened dialog clears the previous
  release before showing the new one. The album tracklist is read under a read
  lock, so the preview no longer fails with "Read lock not acquired!"; the
  field chooser is capped at its own height with a scrollbar, and the track list
  takes the remaining height as a native scrollable list, so a 30-track release
  scrolls inside the dialog instead of expanding it. The redundant bottom-right
  Close button is removed; the window's close icon closes the preview. The
  release details are arranged as two
  label/value pairs per row, and the dialog opens at 1200×960 so more of the
  release fits without resizing. Field rows use MediaMonkey's own checkboxes and
  can be selected again. The native Date field is always offered, separately
  from Original date, so the release date can be written to MediaMonkey's own
  date.
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
