'use strict';

/*
 * Loves MBz — MusicBrainz extended tags tab for Track Properties.
 *
 * MediaMonkey keeps per-track tags it has no field for in Songs.ExtendedTags,
 * as a JSON array of { title, value }. MusicBrainz names there depend on the
 * file format: FLAC/Vorbis uses MUSICBRAINZ_TRACKID, ID3 TXXX uses
 * "MusicBrainz Track Id". mbzMbgid.normalizeExtendedTagName makes those
 * comparable, and this tab only renders names that normalize to a
 * MUSICBRAINZ* name.
 *
 * With one track selected, values are editable. With several tracks selected,
 * the tab compares every track's array and shows only tags that occur exactly
 * once on every track with the same raw title and value — typically album-level
 * tags. A group save sends a patch through MediaMonkey's group track, so
 * per-track tags such as recording IDs are left alone.
 *
 * A track with no MusicBrainz tags is not a dead end: the add row at the bottom
 * writes a new tag under its canonical MUSICBRAINZ_* name, for one track or for
 * every track of a group selection.
 *
 * Links open on musicbrainz.org; IDs that are not valid UUIDs are left in the
 * value but are not linkified.
 */

localRequirejs('mbzMbgid');
localRequirejs('mbzFetch');
localRequirejs('mbzApply');

var MBZ_EXT_ENTITY_LABELS = {
    release: _('release'),
    'release-group': _('release group'),
    artist: _('artist'),
    recording: _('recording'),
    track: _('track'),
    work: _('work'),
    label: _('label')
};

var mbzExtRows = [];
var mbzExtUI = null;
var mbzExtLoadToken = 0;
var mbzExtGroup = null;
var mbzExtSuggestions = [];
var mbzExtNative = null;
var mbzExtArtists = [];
var mbzExtGroupNative = null;
var mbzExtGroupIds = [];
var mbzExtFileSeparator = '; ';
var mbzExtGroupLookup = null;
var mbzExtGroupArtists = null;
var mbzExtFillPlanState = null;
var mbzExtCountToken = 0;

/**
 * A group edit rebuilds window.modified/window.tagModified from the checked
 * [data-control-class="Checkbox"] controls when OK is pressed, discarding the
 * flags an input handler set. Ticking the tab's own box keeps our patch in the
 * save and marks the files for a tag write; the box only exists in group mode.
 */
function mbzExtMarkChanged() {
    window.modified = true;
    window.tagModified = true;

    var check = mbzExtUI && mbzExtUI.applyCheck;
    if (mbzExtGroup && check && check.controlClass && !window.isReadOnly) {
        check.controlClass.checked = true;
    }
}

function mbzExtErrorText(error) {
    if (!error) return '';
    return error.message ? error.message : String(error);
}

/** Fails a group operation instead of leaving the fill button disabled forever. */
function mbzExtWithTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            reject(new Error(message));
        }, ms);

        Promise.resolve(promise).then(function (value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, function (error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
    });
}

function mbzExtListen(dialog, element, eventName, handler) {
    if (!element) return;
    if (dialog && typeof dialog.trackLocalListen === 'function') {
        dialog.trackLocalListen(element, eventName, handler);
    } else if (typeof window.localListen === 'function') {
        window.localListen(element, eventName, handler);
    } else {
        element.addEventListener(eventName, handler);
    }
}

function mbzExtShowEmpty(ui, text) {
    if (!ui) return;
    ui.rows.textContent = '';
    ui.table.style.display = 'none';
    ui.empty.style.display = '';
    ui.empty.textContent = text;
}

function mbzExtShowAddBar(ui, readOnly) {
    if (!ui || !ui.addBar) return;
    ui.addBar.style.display = (readOnly || !window.mbzMbgid) ? 'none' : '';
}

/**
 * A native <select> is not one of MediaMonkey's skinned controls, so it keeps
 * the browser's white control background while inheriting the skin's light
 * text. Copy the colours the skin gives the text input next to it, so the
 * picker looks like the rest of the dialog in any theme.
 */
function mbzExtApplyPickerSkin(ui) {
    if (!ui || !ui.addTag || typeof window.getComputedStyle !== 'function') return;

    var refs = [ui.addValue, ui.addBar, ui.rows, document.body];
    var background = '';
    var color = '';

    for (var i = 0; i < refs.length; i++) {
        if (!refs[i]) continue;

        var style = window.getComputedStyle(refs[i]);
        if (!style) continue;

        if (!color && style.color) color = style.color;

        var bg = style.backgroundColor;
        if (!background && bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') background = bg;
    }

    if (background) ui.addTag.style.backgroundColor = background;
    if (color) ui.addTag.style.color = color;
}

function mbzExtPopulateAddChoices(ui, mbz) {
    if (!ui || !ui.addTag || !mbz || typeof mbz.musicBrainzTagChoices !== 'function') return;
    if (ui.addTag.options && ui.addTag.options.length) return;

    mbz.musicBrainzTagChoices().forEach(function (choice) {
        var option = document.createElement('option');
        option.value = choice.name;
        option.textContent = choice.name;
        option.title = choice.label || choice.name;
        ui.addTag.appendChild(option);
    });

    mbzExtApplyPickerSkin(ui);
}

function mbzExtShortGuid(value) {
    var text = String(value || '');
    return text.length > 14 ? text.slice(0, 8) + '\u2026' : text;
}

function mbzExtTagPresent(title) {
    var mbz = window.mbzMbgid;
    if (!mbz) return false;

    var name = mbz.normalizeExtendedTagName(title);

    for (var i = 0; i < mbzExtRows.length; i++) {
        if (mbz.normalizeExtendedTagName(mbzExtRows[i].title) === name) return true;
    }

    return false;
}

function mbzExtRenderSuggestions(ui, readOnly) {
    if (!ui || !ui.suggest) return;

    ui.suggest.textContent = '';

    var mbz = window.mbzMbgid;
    var items = (mbzExtSuggestions || []).filter(function (item) {
        return item && item.value && !mbzExtTagPresent(item.title);
    });

    if (readOnly || !mbz || !items.length) {
        ui.suggest.style.display = 'none';
        return;
    }

    ui.suggest.style.display = '';

    var label = document.createElement('label');
    label.className = 'mbzExtLabel';
    label.textContent = _('From the library:');
    ui.suggest.appendChild(label);

    items.forEach(function (item) {
        var chip = document.createElement('div');
        chip.className = 'button mbzExtChip';
        chip.setAttribute('data-title', item.title);
        chip.setAttribute('data-value', item.value);
        chip.title = item.title + ' = ' + item.value;
        chip.textContent = (item.info ? _(item.info.label) : item.title) + ' ' + mbzExtShortGuid(item.value);
        ui.suggest.appendChild(chip);
    });
}

/*
 * MediaMonkey keeps the release, release-group and artist IDs on Albums and
 * Artists rows, not in ExtendedTags, so a tag and the library can disagree.
 * The strip drawn here names that disagreement and lets the user copy either
 * value over the other, so the two cannot drift apart unnoticed.
 */
var MBZ_EXT_NATIVE_FIELDS = [
    { key: 'release', title: 'MUSICBRAINZ_ALBUMID', label: _('Release ID'), column: 'MBGID', nativeKey: 'releaseId' },
    { key: 'releaseGroup', title: 'MUSICBRAINZ_RELEASEGROUPID', label: _('Release group ID'), column: 'MBRGGID', nativeKey: 'releaseGroupId' },
    { key: 'artist', title: 'MUSICBRAINZ_ARTISTID', label: _('Artist ID') }
];

function mbzExtPromise(promise) {
    if (typeof window.localPromise === 'function') return window.localPromise(promise);
    return Promise.resolve(promise);
}

function mbzExtTrackCount(count) {
    return count === 1 ? _('1 track') : sprintf(_('%d tracks'), count);
}

/** The one row holding this tag, or null when it occurs twice (ambiguous). */
function mbzExtRowForTag(title) {
    var mbz = window.mbzMbgid;
    if (!mbz) return null;

    var name = mbz.normalizeExtendedTagName(title);
    var found = null;

    for (var i = 0; i < mbzExtRows.length; i++) {
        if (mbz.normalizeExtendedTagName(mbzExtRows[i].title) !== name) continue;
        if (found) return null;
        found = mbzExtRows[i];
    }

    return found;
}

/** A single valid MBID, or '' for empty, invalid or semicolon lists. */
function mbzExtSingleGuid(value) {
    var mbz = window.mbzMbgid;
    if (!mbz || typeof mbz.extendedTagGuids !== 'function') return '';

    var parsed = mbz.extendedTagGuids(value);
    if (parsed.invalid.length || parsed.ids.length !== 1) return '';
    return parsed.ids[0];
}

function mbzExtDistinctValues(list) {
    var seen = {};
    var values = [];

    (list || []).forEach(function (value) {
        var text = String(value === undefined || value === null ? '' : value);
        if (seen[text]) return;
        seen[text] = true;
        values.push(text);
    });

    return values;
}

/**
 * What the library knows about a whole selection: the album rows its tracks
 * belong to, the distinct values those rows hold, and the artist row when every
 * track has exactly one. A field can only be compared when every track has a
 * row and the rows agree, because otherwise the selection has no single library
 * value.
 *
 * @param {number[]} ids
 * @param {Map} map  lookupTracksAsync result
 * @param {Map|null} artistsMap  lookupTrackArtistsAsync result, once loaded
 * @returns {Object|null} null when a track has no album row
 */
function mbzExtGroupNativeFrom(ids, map, artistsMap) {
    var native = {
        trackCount: ids.length,
        albumIds: [],
        albumNames: {},
        releaseIds: [],
        releaseGroupIds: [],
        artistIds: [],
        artistGuids: [],
        artistNames: {},
        artistsLoaded: !!artistsMap
    };

    var releaseValues = [];
    var groupValues = [];

    for (var i = 0; i < ids.length; i++) {
        var entry = map && map.get(ids[i]);
        if (!entry || !(entry.albumId > 0)) return null;

        if (native.albumIds.indexOf(entry.albumId) < 0) {
            native.albumIds.push(entry.albumId);
            native.albumNames[entry.albumId] = String(entry.album || '');
        }

        releaseValues.push(entry.releaseId);
        groupValues.push(entry.releaseGroupId);
    }

    native.releaseIds = mbzExtDistinctValues(releaseValues);
    native.releaseGroupIds = mbzExtDistinctValues(groupValues);

    if (artistsMap) {
        var artistIds = [];
        var artistGuids = [];
        var artistNames = {};
        var usable = true;

        for (var j = 0; j < ids.length; j++) {
            var artists = artistsMap.get(ids[j]);

            // A featured or multi-artist credit has no single Artists row a
            // tag ID could belong to.
            if (!artists || artists.length !== 1) {
                usable = false;
                break;
            }

            var artist = artists[0];
            if (artistIds.indexOf(artist.id) < 0) {
                artistIds.push(artist.id);
                artistGuids.push(String(artist.mbgid || ''));
                artistNames[artist.id] = String(artist.name || '');
            }
        }

        if (usable) {
            native.artistIds = artistIds;
            native.artistGuids = artistGuids;
            native.artistNames = artistNames;
        }
    }

    return native;
}

function mbzExtSingleConflicts() {
    if (!mbzExtNative) return [];

    var conflicts = [];

    MBZ_EXT_NATIVE_FIELDS.forEach(function (field) {
        var row = mbzExtRowForTag(field.title);
        if (!row) return;

        var tagValue = mbzExtSingleGuid(mbzExtRowValue(row));
        if (!tagValue) return;

        var isArtist = field.key === 'artist';
        var artist = isArtist ? mbzExtArtists[0] : null;

        // An artist ID belongs to exactly one Artists row; a featured or
        // multi-artist credit has no safe target, so stay silent.
        if (isArtist && mbzExtArtists.length !== 1) return;

        var nativeValue = isArtist
            ? String(artist.mbgid || '')
            : String(mbzExtNative[field.nativeKey] || '');

        if (nativeValue === tagValue) return;

        conflicts.push({
            key: field.key,
            label: field.label,
            column: field.column,
            tagValue: tagValue,
            nativeValue: nativeValue,
            row: row,
            albumIds: isArtist ? [] : (mbzExtNative.albumId > 0 ? [mbzExtNative.albumId] : []),
            artistIds: isArtist ? [artist.id] : [],
            albumName: isArtist ? '' : String(mbzExtNative.album || ''),
            artistName: isArtist ? String(artist.name || '') : ''
        });
    });

    return conflicts;
}

function mbzExtGroupConflicts() {
    var native = mbzExtGroupNative;
    if (!native) return [];

    var conflicts = [];

    MBZ_EXT_NATIVE_FIELDS.forEach(function (field) {
        var row = mbzExtRowForTag(field.title);
        if (!row) return;

        var tagValue = mbzExtSingleGuid(mbzExtRowValue(row));
        if (!tagValue) return;

        var isArtist = field.key === 'artist';
        var values = isArtist ? native.artistGuids : native[field.nativeKey + 's'];

        // The albums or artists of the selection have to agree on a value;
        // otherwise there is nothing to compare the shared tag with.
        if (!values || values.length !== 1) return;

        var nativeValue = String(values[0] || '');
        if (nativeValue === tagValue) return;

        conflicts.push({
            key: field.key,
            label: field.label,
            column: field.column,
            tagValue: tagValue,
            nativeValue: nativeValue,
            row: row,
            albumIds: isArtist ? [] : native.albumIds.slice(),
            artistIds: isArtist ? native.artistIds.slice() : [],
            albumName: isArtist ? '' : String(native.albumNames[native.albumIds[0]] || ''),
            artistName: isArtist ? String(native.artistNames[native.artistIds[0]] || '') : ''
        });
    });

    return conflicts;
}

/**
 * Tags whose stored value contradicts the value MediaMonkey keeps in its own
 * library columns. A group selection compares the shared tag with the library
 * rows of its tracks; the library write is only offered when those rows resolve
 * to one album or one artist.
 */
function mbzExtConflicts() {
    return mbzExtGroup ? mbzExtGroupConflicts() : mbzExtSingleConflicts();
}

function mbzExtReleaseTrackCount(release) {
    var total = 0;
    var media = (release && release.media) || [];

    for (var i = 0; i < media.length; i++) {
        total += (media[i].tracks || []).length;
    }

    return total;
}

/** The tag and library release IDs can name editions with different track counts. */
function mbzExtLoadReleaseCounts(conflicts, token) {
    var conflict = null;

    (conflicts || []).forEach(function (item) {
        if (item.key === 'release' && item.tagValue && item.nativeValue) conflict = item;
    });

    if (!conflict) return;

    var fetch = window.mbzFetch;
    if (!fetch || typeof fetch.fetchReleaseAsync !== 'function') return;

    return mbzExtPromise(Promise.all([
        fetch.fetchReleaseAsync(conflict.nativeValue),
        fetch.fetchReleaseAsync(conflict.tagValue)
    ])).then(function (releases) {
        if (window._cleanUpCalled || token !== mbzExtCountToken || !conflict.countLabel) return;

        var libraryCount = mbzExtReleaseTrackCount(releases[0]);
        var tagCount = mbzExtReleaseTrackCount(releases[1]);

        if (!(libraryCount > 0) || !(tagCount > 0) || libraryCount === tagCount) return;

        conflict.countLabel.textContent = sprintf(
            _('The tag release has %d tracks; the library release has %d.'),
            tagCount, libraryCount);
        conflict.countLabel.title =
            'Tag: ' + conflict.tagValue + ' / library: ' + conflict.nativeValue;
        conflict.countLabel.style.display = '';
    }, function () {
        // A stale or invalid tag ID must not break the warning strip.
    });
}

function mbzExtRenderDivergence(ui, readOnly) {
    if (!ui || !ui.diverge) return;

    ui.diverge.textContent = '';

    var countToken = ++mbzExtCountToken;
    var conflicts = mbzExtConflicts();

    if (!conflicts.length) {
        ui.diverge.style.display = 'none';
        return;
    }

    ui.diverge.style.display = '';

    var head = document.createElement('label');
    head.className = 'mbzExtLabel';
    head.textContent = _('The library ID and the tag disagree:');
    ui.diverge.appendChild(head);

    conflicts.forEach(function (conflict) {
        var item = document.createElement('div');
        item.className = 'flex row mbzExtDivergeItem';

        var text = document.createElement('label');
        text.className = 'mbzExtDivergeText';
        text.textContent = sprintf(_('%s \u2014 library %s, tag %s'),
            conflict.label,
            conflict.nativeValue ? mbzExtShortGuid(conflict.nativeValue) : _('(empty)'),
            mbzExtShortGuid(conflict.tagValue));
        text.title = conflict.label + ': ' + (conflict.nativeValue || '(empty)') +
            ' / ' + conflict.tagValue;
        item.appendChild(text);

        var targetCount = (conflict.albumIds || []).length + (conflict.artistIds || []).length;
        var canWrite = targetCount === 1;

        // Copying the library value into the tag needs no library target, only
        // a value to copy; writing the tag back needs exactly one row.
        if (!readOnly && conflict.nativeValue) {
            var useNative = document.createElement('div');
            useNative.className = 'button';
            useNative.setAttribute('data-diverge', 'tag');
            useNative.setAttribute('data-key', conflict.key);
            useNative.textContent = _('Use library ID');
            useNative.title = mbzExtGroup
                ? _('Put the library ID into the tag for every selected track. Click OK to save the tags.')
                : _('Put the library ID into the tag. Click OK to save the tag.');
            item.appendChild(useNative);
        }

        if (!readOnly && canWrite) {
            var useTag = document.createElement('div');
            useTag.className = 'button';
            useTag.setAttribute('data-diverge', 'library');
            useTag.setAttribute('data-key', conflict.key);
            useTag.textContent = _('Update library');
            useTag.title = _('Write the ID stored in the tag into the album or artist row.');
            item.appendChild(useTag);
        }

        // The selection touches several albums or artists: writing one tag ID
        // to all of them is not what "update the library" should mean.
        if (!readOnly && targetCount > 1) {
            var note = document.createElement('label');
            note.className = 'mbzExtLabel';
            note.textContent = _('Select tracks from one album or artist to update the library.');
            item.appendChild(note);
        }

        if (conflict.key === 'release') {
            var countLabel = document.createElement('label');
            countLabel.className = 'mbzExtLabel';
            countLabel.setAttribute('data-release-count', conflict.key);
            countLabel.style.display = 'none';
            conflict.countLabel = countLabel;
            item.appendChild(countLabel);
        }

        ui.diverge.appendChild(item);
    });

    mbzExtLoadReleaseCounts(conflicts, countToken);
}

function mbzExtOnDivergeClick(event) {
    var node = event && event.target;
    while (node && !(node.getAttribute && node.getAttribute('data-diverge'))) node = node.parentNode;
    if (!node) return;

    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();

    if (window.isReadOnly || !window.mbzMbgid) return;

    var action = node.getAttribute('data-diverge');
    var key = node.getAttribute('data-key');
    var conflict = null;

    mbzExtConflicts().forEach(function (item) {
        if (item.key === key) conflict = item;
    });

    if (!conflict) return;

    if (action === 'tag') mbzExtUseNativeId(conflict);
    else mbzExtConfirmLibraryUpdate(conflict);
}

/** Library -> tag: fill the row in, so the normal save writes it. */
function mbzExtUseNativeId(conflict) {
    var row = conflict && conflict.row;
    if (!row || !row.input) return;

    row.input.value = conflict.nativeValue;
    row.pendingValue = conflict.nativeValue;

    mbzExtMarkChanged();

    mbzExtRenderLinks(row);
    mbzExtUpdateStatus();
    mbzExtRenderDivergence(mbzExtUI, false);
}

/** Tag -> library: an UPDATE on the album or artist row, never on the track. */
function mbzExtConfirmLibraryUpdate(conflict) {
    var mbz = window.mbzMbgid;
    if (!mbz || !conflict) return;

    var isArtist = (conflict.artistIds || []).length > 0;
    var targetId = isArtist ? conflict.artistIds[0] : (conflict.albumIds || [])[0];

    if (!(targetId > 0)) {
        if (mbzExtUI) {
            mbzExtUI.status.textContent = isArtist
                ? _('This track has no artist row in the library to update.')
                : _('This track has no album in the library to update.');
        }
        return;
    }

    // Filling an empty library field overwrites nothing, so it does not need
    // the dialog the replace case uses.
    if (!conflict.nativeValue) {
        mbzExtWriteLibrary(conflict, mbz);
        return;
    }

    var countPromise = isArtist
        ? mbz.countArtistTracksAsync(targetId)
        : mbz.countAlbumTracksAsync(targetId);

    mbzExtPromise(countPromise).then(function (count) {
        if (window._cleanUpCalled) return;

        var scope = isArtist
            ? sprintf(_('artist "%s" (%s)'), conflict.artistName || ('#' + targetId), mbzExtTrackCount(count))
            : sprintf(_('album "%s" (%s)'), conflict.albumName || ('#' + targetId), mbzExtTrackCount(count));

        var message = sprintf(_('Write the tag\'s %s into the library?'), conflict.label)
            + '<br><br>' + sprintf(_('%s will be set to <b>%s</b> for your whole %s.'),
                conflict.label, conflict.tagValue, scope)
            + '<br>' + _('The tag keeps its value. MediaMonkey\'s own MusicBrainz lookup can overwrite this library value the next time it re-matches.');

        if (typeof messageDlg !== 'function') return;

        messageDlg(message, 'Confirmation', ['btnYes', 'btnNo'],
            { defaultButton: 'btnNo', title: _('Loves MBz') },
            function (result) {
                if (!result || result.btnID !== 'btnYes' || window._cleanUpCalled) return;
                mbzExtWriteLibrary(conflict, mbz);
            });
    }, function (error) {
        if (window._cleanUpCalled) return;
        if (mbzExtUI) {
            mbzExtUI.status.textContent = sprintf(
                _('Could not check how many tracks the library change covers: %s'), mbzExtErrorText(error));
        }
    });
}

function mbzExtWriteLibrary(conflict, mbz) {
    if (mbzExtUI) mbzExtUI.status.textContent = _('Updating the library...');

    var isArtist = (conflict.artistIds || []).length > 0;
    var work = isArtist
        ? mbz.setArtistGuidAsync(conflict.artistIds[0], conflict.tagValue)
        : mbz.setAlbumGuidAsync((conflict.albumIds || [])[0], conflict.column, conflict.tagValue);

    mbzExtPromise(work).then(function () {
        if (window._cleanUpCalled) return;

        if (mbzExtNative) {
            if (conflict.key === 'artist') {
                mbzExtArtists.forEach(function (artist) {
                    if (artist.id === conflict.artistIds[0]) artist.mbgid = conflict.tagValue;
                });
            } else if (conflict.column === 'MBGID') {
                mbzExtNative.releaseId = conflict.tagValue;
            } else {
                mbzExtNative.releaseGroupId = conflict.tagValue;
            }
        }

        if (mbzExtGroupNative) {
            if (conflict.key === 'artist') mbzExtGroupNative.artistGuids = [conflict.tagValue];
            else if (conflict.column === 'MBGID') mbzExtGroupNative.releaseIds = [conflict.tagValue];
            else mbzExtGroupNative.releaseGroupIds = [conflict.tagValue];
        }

        if (mbzExtUI) {
            mbzExtUI.status.textContent = sprintf(
                _('The library %s is now %s.'), conflict.label, conflict.tagValue);
        }

        mbzExtRenderDivergence(mbzExtUI, window.isReadOnly);
    }, function (error) {
        if (window._cleanUpCalled) return;
        if (mbzExtUI) {
            mbzExtUI.status.textContent = sprintf(
                _('Could not update the library: %s'), mbzExtErrorText(error));
        }
    });
}

function mbzExtLoadSuggestions(ui, mbz, songIds, readOnly, token) {
    if (!ui || !ui.suggest || !mbz || typeof mbz.lookupTracksAsync !== 'function') return;

    var ids = [];
    (songIds || []).forEach(function (id) {
        var value = parseInt(id, 10);
        if (value > 0 && ids.indexOf(value) < 0) ids.push(value);
    });

    if (!ids.length) {
        mbzExtRenderDivergence(ui, readOnly);
        return;
    }

    // Read even in read-only mode: the divergence strip is information, and
    // only its buttons are suppressed.
    mbz.lookupTracksAsync(ids).then(function (map) {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;

        // One entry per track: a group suggestion is only offered when every
        // selected track carries the same native ID.
        var natives = ids.map(function (id) { return map.get(id); });

        mbzExtSuggestions = mbz.suggestNativeExtendedTags(natives).map(function (item) {
            return {
                title: item.title,
                value: item.value,
                info: mbz.musicBrainzTagInfo(item.title)
            };
        });

        if (ids.length === 1) {
            var entry = map.get(ids[0]);
            mbzExtNative = entry ? {
                releaseId: String(entry.releaseId || ''),
                releaseGroupId: String(entry.releaseGroupId || ''),
                albumId: parseInt(entry.albumId, 10) || 0,
                album: String(entry.album || '')
            } : null;
            mbzExtGroupNative = null;
        } else {
            mbzExtNative = null;
            mbzExtGroupIds = ids.slice();
            mbzExtGroupLookup = map;
            mbzExtGroupNative = mbzExtGroupNativeFrom(ids, map, mbzExtGroupArtists);
        }

        mbzExtRenderSuggestions(ui, readOnly);
        mbzExtRenderDivergence(ui, readOnly);
    }, function () {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
        mbzExtSuggestions = [];
        mbzExtNative = null;
        mbzExtRenderSuggestions(ui, readOnly);
        mbzExtRenderDivergence(ui, readOnly);
    });
}

function mbzExtOnSuggestClick(event) {
    var node = event && event.target;

    while (node && !(node.getAttribute && node.getAttribute('data-title'))) node = node.parentNode;
    if (!node) return;

    var title = node.getAttribute('data-title');
    var value = node.getAttribute('data-value');
    if (!title || !value) return;

    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();

    mbzExtAddTagRow(mbzExtUI, window.mbzMbgid, title, value);
}

function mbzExtNextOccurrence(title) {
    var count = 0;
    mbzExtRows.forEach(function (row) {
        if (row.title === title) count++;
    });
    return count;
}

function mbzExtUpdateSummary(ui) {
    if (!ui || !mbzExtRows.length) return;

    if (mbzExtGroup) {
        var partial = 0;
        mbzExtRows.forEach(function (row) {
            if (row.missingCount > 0) partial++;
        });

        var text = mbzExtRows.length === 1
            ? sprintf(_('1 MusicBrainz tag for all %d selected tracks.'), mbzExtGroup.trackCount)
            : sprintf(_('%d MusicBrainz tags for all %d selected tracks.'), mbzExtRows.length, mbzExtGroup.trackCount);

        if (partial) {
            text += ' ' + (partial === 1
                ? _('1 of them is missing on some selected tracks.')
                : sprintf(_('%d of them are missing on some selected tracks.'), partial));
        }

        ui.summary.textContent = text;
        return;
    }

    ui.summary.textContent = mbzExtRows.length === 1
        ? _('1 MusicBrainz extended tag.')
        : sprintf(_('%d MusicBrainz extended tags.'), mbzExtRows.length);
}

/**
 * A stored ID tag can hold several IDs in one value — 'id1/id2' is how an
 * ID3v2.3 file keeps several artists. Those are shown as one editable row per
 * ID and merged back into the single stored value when the tab is saved.
 */
function mbzExtSplitValue(mbz, title, value) {
    if (!mbz || typeof mbz.extendedTagGuids !== 'function') return null;

    var info = mbz.musicBrainzTagInfo(title);
    if (!info || !info.entity) return null;

    var parsed = mbz.extendedTagGuids(value);
    if (parsed.invalid.length || parsed.ids.length < 2) return null;

    return {
        ids: parsed.ids,
        separator: typeof mbz.extendedTagSeparator === 'function'
            ? mbz.extendedTagSeparator(value)
            : '; '
    };
}

function mbzExtRowValue(row) {
    if (!row) return '';

    // The split rows are the live source; a cleared row simply drops its ID
    // from the value that the remaining rows join back into.
    if (row.parts && row.parts.length) {
        var values = [];

        row.parts.forEach(function (part) {
            var text = String(part.input
                ? part.input.value
                : (part.value === undefined ? '' : part.value));
            if (text.trim()) values.push(text.trim());
        });

        return values.join(row.partsSeparator || '; ');
    }

    if (row.input) return row.input.value;
    return row.pendingValue !== undefined ? row.pendingValue : row.originalValue;
}

function mbzExtHasChanges() {
    for (var i = 0; i < mbzExtRows.length; i++) {
        var row = mbzExtRows[i];
        var value = mbzExtRowValue(row);

        if (row.isNew) {
            // A pending row with no value is a cancelled add, not a change.
            if (String(value).trim()) return true;
            continue;
        }

        if (row.applyToAll) return true;
        if (value !== row.originalValue) return true;
    }

    return false;
}

function mbzExtUpdateStatus() {
    if (!mbzExtUI) return;

    mbzExtUI.status.textContent = mbzExtHasChanges()
        ? (mbzExtGroup
            ? _('Unsaved changes. Click OK to apply them to all selected tracks.')
            : _('Unsaved changes. Click OK to save.'))
        : '';
}

/**
 * The separator a file uses for several artists: an MP3 keeps them in one
 * ID3v2.3 frame joined with '/', other formats are written with the library's
 * own separator.
 */
function mbzExtSeparatorForFile(path) {
    var text = String(path || '').toLowerCase();
    var dot = text.lastIndexOf('.');
    var ext = dot >= 0 ? text.slice(dot + 1) : '';
    return (ext === 'mp3') ? '/' : '; ';
}

/** Artist IDs are the tag names several rows legitimately share. */
function mbzExtAppendsToExisting(title) {
    var name = String(title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return name === 'MUSICBRAINZARTISTID' || name === 'MUSICBRAINZALBUMARTISTID';
}

function mbzExtAddTagRow(ui, mbz, title, value) {
    if (!ui || !mbz || window.isReadOnly) return false;
    if (!title || !value) return false;

    // Several artists share one MusicBrainz tag name, so adding another one
    // appends to that tag instead of creating a second entry with the same
    // name. Existing IDs keep their order and the new one goes last.
    if (mbzExtAppendsToExisting(title)) {
        var target = null;
        var wanted = mbz.normalizeExtendedTagName(title);

        mbzExtRows.forEach(function (row) {
            if (!target && mbz.normalizeExtendedTagName(row.title) === wanted) target = row;
        });

        if (target) {
            var current = mbzExtRowValue(target);
            var parsedCurrent = mbz.extendedTagGuids(current);
            var parsedAdd = mbz.extendedTagGuids(value);
            var raw = String(target.originalValue || '');
            var separator = target.partsSeparator
                || (/[;,\/]/.test(raw) ? mbz.extendedTagSeparator(raw) : (mbzExtFileSeparator || '; '));

            var ids = parsedCurrent.ids.slice();
            var added = 0;

            parsedAdd.ids.forEach(function (id) {
                if (ids.indexOf(id) < 0) {
                    ids.push(id);
                    added++;
                }
            });

            if (!added && !parsedAdd.invalid.length) {
                ui.status.textContent = _('That ID is already in the tag.');
                return false;
            }

            // Invalid text in either value is kept verbatim, so appending never
            // silently drops a part of the tag.
            target.pendingValue = (parsedCurrent.invalid.length || parsedAdd.invalid.length)
                ? current + (current ? separator : '') + value
                : ids.join(separator);

            mbzExtMarkChanged();
            mbzExtRenderRows(ui, false);
            mbzExtUpdateSummary(ui);
            mbzExtUpdateStatus();
            mbzExtRenderDivergence(ui, false);
            return true;
        }
    }

    var duplicate = false;
    mbzExtRows.forEach(function (row) {
        if (row.title === title && String(mbzExtRowValue(row)) === value) duplicate = true;
    });

    if (duplicate) {
        ui.status.textContent = _('That tag and value are already listed.');
        return false;
    }

    mbzExtRows.push({
        title: title,
        occurrence: mbzExtNextOccurrence(title),
        originalValue: '',
        pendingValue: value,
        isNew: true,
        // A tag added in group mode is written to every selected track.
        missingCount: 0,
        presentCount: mbzExtGroup ? mbzExtGroup.trackCount : 1,
        applyToAll: false,
        info: mbz.musicBrainzTagInfo(title),
        input: null,
        applyInput: null,
        linkCell: null
    });

    ui.table.style.display = '';
    ui.empty.style.display = 'none';

    mbzExtMarkChanged();

    mbzExtRenderRows(ui, false);
    mbzExtUpdateSummary(ui);
    mbzExtUpdateStatus();
    mbzExtRenderDivergence(ui, false);
    return true;
}

function mbzExtAddPending(ui, mbz) {
    if (!ui || !mbz || window.isReadOnly) return;

    var title = ui.addTag ? String(ui.addTag.value || '') : '';
    var value = ui.addValue ? String(ui.addValue.value || '').trim() : '';

    if (!title) {
        ui.status.textContent = _('Choose a MusicBrainz tag to add.');
        return;
    }

    if (!value) {
        ui.status.textContent = _('Enter a value for the tag you want to add.');
        return;
    }

    if (mbzExtAddTagRow(ui, mbz, title, value) && ui.addValue) ui.addValue.value = '';
}

function mbzExtEntityLabel(entity) {
    return MBZ_EXT_ENTITY_LABELS[entity] || entity;
}

function mbzExtRenderLinkCell(input, linkCell, info) {
    var mbz = window.mbzMbgid;
    if (!mbz || !linkCell || !input) return;

    var isIdTag = !!(info && info.entity);
    var parsed = isIdTag ? mbz.extendedTagGuids(input.value) : { ids: [], invalid: [] };
    var invalid = parsed.invalid.length > 0;

    if (input.classList) {
        if (invalid) input.classList.add('mbzExtInvalid');
        else input.classList.remove('mbzExtInvalid');
    }

    linkCell.textContent = '';

    if (isIdTag) {
        // One link per ID: a value such as 'id1/id2' (ID3v2.3 stores several
        // artists that way) would otherwise draw identical links the user
        // cannot tell apart.
        var many = parsed.ids.length > 1;

        parsed.ids.forEach(function (guid, index) {
            var url = mbz.musicBrainzUrl(info.entity, guid);
            if (!url) return;

            if (many && index > 0) linkCell.appendChild(document.createElement('br'));

            var link = document.createElement('a');
            link.href = '#';
            link.className = 'hotlink mbzExtLink';
            link.setAttribute('data-url', url);
            link.title = url;
            link.textContent = many
                ? mbzExtShortGuid(guid) + ' \u2197'
                : mbzExtEntityLabel(info.entity) + ' \u2197';
            linkCell.appendChild(link);
        });
    }

    if (invalid && input.value.trim()) {
        var warning = document.createElement('span');
        warning.className = 'mbzExtWarning';
        warning.textContent = _('Not a valid MusicBrainz ID');
        warning.title = parsed.invalid.join(', ');
        linkCell.appendChild(warning);
    }
}

function mbzExtRenderLinks(row) {
    if (!row) return;
    mbzExtRenderLinkCell(row.input, row.linkCell, row.info);
}

function mbzExtValueForSave(row, mbz) {
    var value = mbzExtRowValue(row);
    if (!row.info || !row.info.entity) return value;

    var parsed = mbz.extendedTagGuids(value);
    if (parsed.ids.length && !parsed.invalid.length) {
        // Keep the shape the file already uses: MediaMonkey writes an ID3v2.3
        // multi-artist value joined with '/', and converting it to '; ' would
        // turn two artists into one unreadable ID for other players.
        var separator = parsed.ids.length > 1 && typeof mbz.extendedTagSeparator === 'function'
            ? mbz.extendedTagSeparator(row.originalValue)
            : '; ';
        return parsed.ids.join(separator);
    }
    return value;
}

function mbzExtGroupIntro(ui) {
    if (!ui || !ui.intro) return;

    // The table is self-explanatory; the hint only pushed the rows down.
    ui.intro.textContent = '';
    ui.intro.style.display = 'none';
}

function mbzExtRender(ui, tags, readOnly, mbz, groupInfo) {
    var counts = {};
    mbzExtRows = [];

    tags.forEach(function (tag) {
        if (!tag || !mbz.isMusicBrainzExtendedTag(tag.title)) return;

        var title = String(tag.title || '');
        var occurrence = counts[title] || 0;
        counts[title] = occurrence + 1;

        mbzExtRows.push({
            title: title,
            occurrence: occurrence,
            originalValue: String(tag.value === undefined || tag.value === null ? '' : tag.value),
            missingCount: tag.missingCount || 0,
            presentCount: tag.presentCount || 0,
            applyToAll: false,
            info: mbz.musicBrainzTagInfo(title),
            input: null,
            applyInput: null,
            linkCell: null
        });
    });

    ui.rows.textContent = '';

    if (!mbzExtRows.length) {
        ui.summary.textContent = '';
        if (groupInfo) {
            mbzExtShowEmpty(ui, sprintf(
                _('No MusicBrainz extended tags have the same value on all %d selected tracks. Select a single track to see all of its tags, or add one below to set it on every selected track.'),
                groupInfo.trackCount));
        } else {
            mbzExtShowEmpty(ui, _('This track has no MusicBrainz extended tags. Add one below. The MusicBrainz release, release-group and artist IDs are stored on the album and artist rows, not in ExtendedTags.'));
        }
        mbzExtRenderSuggestions(ui, readOnly);
        mbzExtRenderDivergence(ui, readOnly);
        return;
    }

    ui.table.style.display = '';
    ui.empty.style.display = 'none';

    ui.intro.style.display = '';

    if (groupInfo) {
        mbzExtGroupIntro(ui);
    } else if (!readOnly) {
        ui.intro.textContent = _('Only MusicBrainz tags stored in this track\'s ExtendedTags are listed here. Edit a value and click OK to save it; clear a value to remove that tag.');
    }

    mbzExtUpdateSummary(ui);
    mbzExtRenderRows(ui, readOnly);

    // The library lookup usually finishes before the tags are rendered, so the
    // strip has to be computed again now that the rows exist.
    mbzExtRenderDivergence(ui, readOnly);
}

function mbzExtRenderRows(ui, readOnly) {
    if (!ui) return;

    var mbz = window.mbzMbgid;

    ui.rows.textContent = '';

    // The All tracks column only means something for a group selection.
    var showApply = !!mbzExtGroup;
    if (ui.applyHead) ui.applyHead.style.display = showApply ? '' : 'none';

    mbzExtRows.forEach(function (row, index) {
        var sourceValue = row.pendingValue !== undefined ? row.pendingValue : row.originalValue;
        var split = mbzExtSplitValue(mbz, row.title, sourceValue);
        var partCount = split ? split.ids.length : 1;

        // Reset the per-render handles first: a row that is no longer split
        // must not keep pointing at an input from the previous render.
        row.parts = split ? [] : null;
        row.partsSeparator = split ? split.separator : '';
        row.input = null;
        row.linkCell = null;
        row.applyInput = null;

        for (var part = 0; part < partCount; part++) {
            var first = part === 0;
            var tr = document.createElement('tr');
            if (first && row.isNew) tr.className = 'mbzExtNew';

            if (showApply) {
                var applyCell = document.createElement('td');
                applyCell.className = 'mbzExtApplyCell';

                // The box belongs to the tag, not to one of its artists, so
                // only the first of a split tag carries it.
                if (first) {
                    var apply = document.createElement('input');
                    apply.type = 'checkbox';
                    apply.className = 'mbzExtApply';
                    apply.checked = !row.isNew && row.missingCount === 0;
                    apply.disabled = readOnly || row.isNew || row.missingCount === 0;
                    apply.setAttribute('data-row', String(index));
                    apply.title = row.isNew
                        ? _('A new tag is written to every selected track.')
                        : (row.missingCount > 0
                            ? sprintf(_('Apply this value to the %d selected tracks that have no such tag.'), row.missingCount)
                            : _('Every selected track already has this tag with this value.'));

                    applyCell.appendChild(apply);
                    row.applyInput = apply;
                }

                tr.appendChild(applyCell);
            }

            var nameCell = document.createElement('td');

            if (first) {
                var title = document.createElement('div');
                title.className = 'mbzExtTitle';
                title.textContent = row.title;
                nameCell.appendChild(title);

                // The raw tag name is self-explanatory, so only the state of a
                // row is spelled out under it; a plain row is a single line.
                var notes = [];
                if (row.isNew) notes.push(_('(not saved yet)'));
                if (!row.isNew && row.missingCount > 0 && mbzExtGroup) {
                    notes.push(sprintf(_('(missing on %d of %d tracks)'), row.missingCount, mbzExtGroup.trackCount));
                }

                if (notes.length) {
                    var label = document.createElement('div');
                    label.className = 'mbzExtLabel';
                    label.textContent = notes.join(' ');
                    nameCell.appendChild(label);
                }
            }

            tr.appendChild(nameCell);

            var valueCell = document.createElement('td');
            var input = document.createElement('input');
            input.type = 'text';
            input.className = 'mbzExtValue';
            input.value = split
                ? split.ids[part]
                : String(sourceValue === undefined || sourceValue === null ? '' : sourceValue);
            input.spellcheck = false;
            input.autocomplete = 'off';
            input.disabled = readOnly;
            input.setAttribute('data-row', String(index));
            if (partCount > 1) input.setAttribute('data-part', String(part));
            valueCell.appendChild(input);
            tr.appendChild(valueCell);

            var linkCell = document.createElement('td');
            linkCell.className = 'mbzExtLinks';
            mbzExtRenderLinkCell(input, linkCell, row.info);
            tr.appendChild(linkCell);

            if (split) row.parts.push({ input: input, linkCell: linkCell });

            if (first) {
                row.input = input;
                row.linkCell = linkCell;
            }

            ui.rows.appendChild(tr);
        }
    });

    mbzExtRenderSuggestions(ui, readOnly);
}

function mbzExtOnApplyChange(event) {
    var input = event && event.target;
    if (!input || input.type !== 'checkbox' || !input.classList || !input.classList.contains('mbzExtApply')) return;

    var index = parseInt(input.getAttribute('data-row'), 10);
    var row = mbzExtRows[index];
    if (!row) return;

    row.applyToAll = !!input.checked;
    mbzExtMarkChanged();
    mbzExtUpdateStatus();
}

function mbzExtOnInput(event) {
    var input = event && event.target;
    if (!input || input.tagName !== 'INPUT' || !input.classList || !input.classList.contains('mbzExtValue')) return;

    var index = parseInt(input.getAttribute('data-row'), 10);
    var row = mbzExtRows[index];
    if (!row) return;

    var part = parseInt(input.getAttribute('data-part'), 10);

    if (row.parts && part >= 0 && row.parts[part]) {
        row.parts[part].value = input.value;
        // The merged value is what the status line and the save compare.
        row.pendingValue = mbzExtRowValue(row);
        mbzExtMarkChanged();
        mbzExtRenderLinkCell(input, row.parts[part].linkCell, row.info);
        mbzExtUpdateStatus();
        mbzExtRenderDivergence(mbzExtUI, false);
        return;
    }

    row.pendingValue = input.value;
    mbzExtMarkChanged();
    mbzExtRenderLinks(row);
    mbzExtUpdateStatus();
    mbzExtRenderDivergence(mbzExtUI, false);
}

function mbzExtOnClick(event) {
    var node = event && event.target;
    while (node && node.tagName !== 'A') node = node.parentNode;
    if (!node || !node.getAttribute) return;

    var url = node.getAttribute('data-url');
    if (!url) return;

    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();

    if (window.uitools && typeof window.uitools.openWeb === 'function') {
        window.uitools.openWeb(url);
    } else {
        window.open(url, '_blank');
    }
}

function mbzExtCollectGroupSelection(dialog) {
    var result = { trackCount: 0, songIds: [], tracks: [] };
    var tracks = dialog && (dialog.tracks || window.tracks);
    if (!tracks) return result;

    function collect() {
        result.trackCount = tracks.count || 0;
        for (var i = 0; i < result.trackCount; i++) {
            var track = tracks.getValue(i);
            var id = track ? parseInt(track.id, 10) : 0;
            if (id > 0 && result.songIds.indexOf(id) < 0) {
                result.songIds.push(id);
                result.tracks.push(track);
            }
        }
    }

    if (typeof tracks.locked === 'function') tracks.locked(collect);
    else collect();

    return result;
}

function mbzExtLoadGroup(ui, dialog, mbz, readOnly, token) {
    var selection = mbzExtCollectGroupSelection(dialog);
    mbzExtGroup = { trackCount: selection.songIds.length };
    mbzExtNative = null;
    mbzExtArtists = [];
    mbzExtGroupNative = null;
    mbzExtGroupIds = [];
    mbzExtGroupLookup = null;
    mbzExtGroupIntro(ui, readOnly, selection.trackCount);

    if (!selection.trackCount) {
        ui.summary.textContent = '';
        mbzExtShowEmpty(ui, _('No tracks are selected.'));
        return;
    }

    if (selection.songIds.length !== selection.trackCount) {
        ui.summary.textContent = '';
        mbzExtShowEmpty(ui, _('Group editing needs every selected track to be in the library. Select only library tracks, or edit a single track.'));
        return;
    }

    mbzExtLoadSuggestions(ui, mbz, selection.songIds, readOnly, token);

    // One query for the whole selection: the strip needs to know whether the
    // tracks resolve to a single Artists row before offering a library write.
    if (typeof mbz.lookupTrackArtistsAsync === 'function') {
        dialog.localPromise(mbz.lookupTrackArtistsAsync(selection.songIds)).then(function (artists) {
            if (window._cleanUpCalled || token !== mbzExtLoadToken) return;

            mbzExtGroupArtists = artists || null;
            if (mbzExtGroupLookup) {
                mbzExtGroupNative = mbzExtGroupNativeFrom(
                    mbzExtGroupIds, mbzExtGroupLookup, mbzExtGroupArtists);
            }
            mbzExtRenderDivergence(ui, readOnly);
        }, function () {
            if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
            mbzExtGroupArtists = null;
        });
    }

    ui.summary.textContent = sprintf(_('Reading %d selected tracks...'), selection.trackCount);
    ui.status.textContent = readOnly ? _('Read-only mode: links work, editing is disabled.') : '';

    dialog.localPromise(mbz.lookupExtendedTagsAsync(selection.songIds)).then(function (values) {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;

        var lists = [];
        for (var i = 0; i < selection.songIds.length; i++) {
            var parsed = mbz.parseExtendedTags(values.get(selection.songIds[i]) || '');
            if (parsed === null) {
                ui.summary.textContent = '';
                mbzExtShowEmpty(ui, _('At least one selected track has extended tags that could not be read as JSON.'));
                return;
            }
            lists.push(parsed);
        }

        mbzExtRender(ui, mbz.commonExtendedTags(lists), readOnly, mbz, {
            trackCount: selection.songIds.length
        });
    }, function (error) {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
        ui.summary.textContent = '';
        mbzExtShowEmpty(ui, sprintf(_('Could not read the selected tracks: %s'), mbzExtErrorText(error)));
    });
}

function mbzExtSaveGroupAsync(track, mbz) {
    // The box is unticked only when the user cleared it, which discards the
    // tab's pending changes even if another field triggered the save.
    var check = mbzExtUI && mbzExtUI.applyCheck;
    if (check && check.controlClass && !check.controlClass.checked) return Promise.resolve();

    var patch = [];
    var hasDeleted = false;

    mbzExtRows.forEach(function (row) {
        if (!row.input) return;

        var value = mbzExtValueForSave(row, mbz);

        // A checked All tracks box writes the value even though this tab did
        // not change it: that is the whole point of the box.
        if (value === row.originalValue && !row.applyToAll) return;

        var entry = { title: row.title, value: value };
        if (!value.trim()) {
            entry.deleted = true;
            hasDeleted = true;
        }
        patch.push(entry);
    });

    if (!patch.length) return Promise.resolve();

    window.modified = true;
    window.tagModified = true;
    if (hasDeleted) window.extendedTagsDeleted = true;

    return (async function () {
        // The group track holds a deletion-aware patch, not a full replacement.
        // Merge with whatever the built-in Custom tab queued before us.
        var currentText = await track.getExtendedTagsAsync();
        var merged = mbz.mergeExtendedTagPatch(currentText, patch);
        await track.setExtendedTagsAsync(JSON.stringify(merged));

        patch.forEach(function (entry) {
            mbzExtRows.forEach(function (row) {
                if (row.title !== entry.title) return;
                row.originalValue = entry.deleted ? '' : entry.value;
                row.pendingValue = row.originalValue;
                row.isNew = false;
                row.applyToAll = false;
                if (!entry.deleted) row.missingCount = 0;
            });
        });

        // Rebuilding re-splits a merged artist value, so a row the user cleared
        // is gone and the remaining IDs are one row each again.
        if (mbzExtUI) {
            mbzExtRenderRows(mbzExtUI, false);
            mbzExtUpdateStatus();
        }

        mbzExtRenderDivergence(mbzExtUI, false);
    })().catch(function (error) {
        if (typeof messageDlg === 'function') {
            messageDlg(
                sprintf(_('Could not save the MusicBrainz extended tags: %s'), mbzExtErrorText(error)),
                'Error', ['btnOK'], { defaultButton: 'btnOK' });
        }
    });
}

/**
 * Builds the fill work for a multi-track selection. Every selected track is
 * matched by disc and track number against the release behind its own album;
 * albums are fetched once each and the fetch cache covers albums that share a
 * release ID.
 */
async function mbzExtBuildGroupFillAsync(tracks, onProgress) {
    var fetch = window.mbzFetch;
    var apply = window.mbzApply;
    var mbz = window.mbzMbgid;
    var albumIds = [];
    var counts = { noAlbum: 0, noRelease: 0, unmatched: 0, same: 0 };

    function report(phase, current, total) {
        if (typeof onProgress !== 'function') return;
        try {
            onProgress(phase, current, total);
        } catch (e) {
            // progress text is cosmetic; never fail the fill for it
        }
    }

    tracks.forEach(function (track) {
        var albumId = parseInt(track && track.idalbum, 10);
        if (!(albumId > 0)) {
            counts.noAlbum++;
            return;
        }
        if (albumIds.indexOf(albumId) === -1) albumIds.push(albumId);
    });

    var work = [];
    if (!albumIds.length) return { work: work, counts: counts, tagsById: null };

    // Group tracks expose only a common tag patch, so read each selected
    // track's own ExtendedTags in one database query. Passing these values to
    // buildPendingAsync also avoids waiting on a group proxy track's
    // getExtendedTagsAsync(), which never completes.
    var tagsById = null;
    if (mbz && typeof mbz.lookupExtendedTagsAsync === 'function') {
        var songIds = [];
        tracks.forEach(function (track) {
            var id = parseInt(track && track.id, 10);
            if (id > 0 && songIds.indexOf(id) === -1) songIds.push(id);
        });

        report('tags', 1, 1);
        try {
            tagsById = await mbz.lookupExtendedTagsAsync(songIds);
        } catch (e) {
            tagsById = null;
        }
    }

    if (window._cleanUpCalled) return { work: work, counts: counts, tagsById: tagsById };

    for (var a = 0; a < albumIds.length; a++) {
        if (window._cleanUpCalled) break;

        var albumId = albumIds[a];
        var albumTracks = tracks.filter(function (track) {
            return parseInt(track && track.idalbum, 10) === albumId;
        });

        report('release', a + 1, albumIds.length);
        var result = await fetch.previewAsync(albumId);

        if (window._cleanUpCalled) break;

        if (result.skipped) {
            counts.noRelease += albumTracks.length;
            continue;
        }

        for (var i = 0; i < albumTracks.length; i++) {
            var track = albumTracks[i];
            var trackId = parseInt(track && track.id, 10);
            var tagsText = tagsById && tagsById.has(trackId) ? tagsById.get(trackId) : '';

            report('track', i + 1, albumTracks.length);
            var pending = await apply.buildPendingAsync(track, result.release, tagsText);

            if (window._cleanUpCalled) break;

            if (!pending.matched) {
                counts.unmatched++;
                continue;
            }

            if (!pending.labels.length) {
                counts.same++;
                continue;
            }

            work.push({ track: track, pending: pending });
        }
    }

    return { work: work, counts: counts, tagsById: tagsById };
}

function mbzExtGroupFillSkipText(counts) {
    var parts = [];

    if (counts.noAlbum) parts.push(sprintf(_('%d without an album'), counts.noAlbum));
    if (counts.noRelease) parts.push(sprintf(_('%d with no release ID'), counts.noRelease));
    if (counts.unmatched) parts.push(sprintf(_('%d with no matching disc/track'), counts.unmatched));
    if (counts.same) parts.push(sprintf(_('%d already matching'), counts.same));

    return parts.length ? ' ' + sprintf(_('Skipped: %s.'), parts.join(', ')) : '';
}

async function mbzExtCommitGroupFillAsync(work, tagsById) {
    var apply = window.mbzApply;
    var written = 0;
    var failed = [];

    for (var i = 0; i < work.length; i++) {
        if (window._cleanUpCalled) break;

        try {
            var trackId = parseInt(work[i].track && work[i].track.id, 10);
            var tagsText = tagsById && tagsById.has(trackId) ? tagsById.get(trackId) : '';

            await mbzExtWithTimeout(
                apply.applyPendingAsync(work[i].track, work[i].pending, tagsText),
                15000,
                _('Timed out saving this track.'));
            if (work[i].track.commitAsync) {
                await mbzExtWithTimeout(work[i].track.commitAsync(), 15000,
                    _('Timed out saving this track.'));
            }
            written++;
        } catch (error) {
            failed.push({
                title: work[i].track && work[i].track.title,
                error: mbzExtErrorText(error)
            });
        }
    }

    try {
        if (app.db.clearCache) app.db.clearCache();
        if (typeof uitools !== 'undefined' && uitools.refreshView) uitools.refreshView();
    } catch (e) {
        // best effort; the writes above are already committed
    }

    return { written: written, failed: failed };
}

function mbzExtFillAggregateFields(work) {
    var byKey = {};
    var order = [];

    work.forEach(function (item) {
        (item.pending.fields || []).forEach(function (field) {
            var entry = byKey[field.key];

            if (!entry) {
                entry = byKey[field.key] = {
                    key: field.key,
                    label: field.label,
                    kind: field.kind,
                    values: []
                };
                order.push(entry);
            }

            if (entry.values.indexOf(field.display) === -1) entry.values.push(field.display);
        });
    });

    order.forEach(function (entry) {
        entry.display = entry.values.slice(0, 3).join(' / ') +
            (entry.values.length > 3 ? ' \u2026' : '');
    });

    return order;
}

function mbzExtShowFillPlan(ui, state) {
    if (!ui || !ui.fillPlan || !ui.fillFields) return;

    mbzExtFillPlanState = state;
    ui.fillPlan.style.display = '';
    ui.fillPlanTitle.textContent = state.title || '';
    ui.fillPlanStatus.textContent = '';
    ui.fillFields.textContent = '';

    (state.fields || []).forEach(function (field, index) {
        var row = document.createElement('div');
        row.className = 'flex row mbzExtFillField';

        // Use MediaMonkey's own Checkbox control, the same one as
        // "Save MusicBrainz tags", instead of a browser checkbox.
        var box = document.createElement('div');
        box.setAttribute('data-control-class', 'Checkbox');
        box.setAttribute('data-id', 'mbzExtFillField' + index);
        box.setAttribute('data-fill-index', String(index));
        box.textContent = field.label;

        var value = document.createElement('span');
        value.className = 'mbzExtFillFieldValue';
        value.textContent = field.display || field.value || '';

        row.appendChild(box);
        row.appendChild(value);
        ui.fillFields.appendChild(row);

        if (typeof initializeControl === 'function') initializeControl(box);
        if (box.controlClass) box.controlClass.checked = true;
    });
}

function mbzExtHideFillPlan(ui) {
    mbzExtFillPlanState = null;
    if (!ui || !ui.fillPlan) return;

    ui.fillPlan.style.display = 'none';
    if (ui.fillFields) ui.fillFields.textContent = '';
    if (ui.fillPlanTitle) ui.fillPlanTitle.textContent = '';
    if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = '';
}

function mbzExtFillSelectedKeys(ui) {
    var keys = [];
    var state = mbzExtFillPlanState;
    if (!ui || !ui.fillFields || !state) return keys;

    var boxes = ui.fillFields.querySelectorAll('[data-fill-index]');
    for (var i = 0; i < boxes.length; i++) {
        var checked = boxes[i].controlClass
            ? boxes[i].controlClass.checked
            : boxes[i].checked;
        if (!checked) continue;

        var index = parseInt(boxes[i].getAttribute('data-fill-index'), 10);
        if (state.fields[index]) keys.push(state.fields[index].key);
    }

    return keys;
}

function mbzExtApplyFillPlan(ui, dialog) {
    var state = mbzExtFillPlanState;
    var apply = window.mbzApply;
    if (!ui || !state || !apply) return;

    var keys = mbzExtFillSelectedKeys(ui);
    if (!keys.length) {
        if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = _('Tick at least one field.');
        return;
    }

    if (state.mode === 'single') {
        var pending = apply.filterPending(state.pending, keys);
        if (!pending || !pending.fields.length) {
            if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = _('Nothing selected.');
            return;
        }

        if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = _('Staging...');

        dialog.localPromise(apply.applyPendingAsync(state.track, pending)).then(function (written) {
            if (window._cleanUpCalled) return;

            mbzExtMarkChanged();
            mbzExtHideFillPlan(ui);

            if (ui.fillStatus) {
                ui.fillStatus.textContent = sprintf(_('Staged %d field(s). Click OK to save.'), written);
            }

            return state.track.getExtendedTagsAsync().then(function (text) {
                var tags = window.mbzMbgid.parseExtendedTags(text);
                if (tags) mbzExtRender(ui, tags, false, window.mbzMbgid);
            });
        }, function (error) {
            if (window._cleanUpCalled) return;
            if (ui.fillPlanStatus) {
                ui.fillPlanStatus.textContent = sprintf(_('Could not stage the release: %s'), mbzExtErrorText(error));
            }
        });
        return;
    }

    var work = [];
    state.work.forEach(function (item) {
        var filtered = apply.filterPending(item.pending, keys);
        if (filtered && filtered.fields.length) work.push({ track: item.track, pending: filtered });
    });

    if (!work.length) {
        if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = _('Nothing selected applies to these tracks.');
        return;
    }

    if (ui.fillButton) ui.fillButton.classList.add('mbzExtBusy');
    if (ui.fillPlanStatus) ui.fillPlanStatus.textContent = _('Saving tracks...');

    dialog.localPromise(mbzExtCommitGroupFillAsync(work, state.tagsById)).then(function (result) {
        if (window._cleanUpCalled) return;

        mbzExtHideFillPlan(ui);

        var text = sprintf(_('Filled and saved %d track(s).'), result.written) +
            mbzExtGroupFillSkipText(state.counts);

        if (result.failed.length) {
            text += ' ' + sprintf(_('%d track(s) failed: %s'),
                result.failed.length, result.failed[0].error);
        }

        if (ui.fillStatus) ui.fillStatus.textContent = text;
    }, function (error) {
        if (window._cleanUpCalled) return;
        if (ui.fillPlanStatus) {
            ui.fillPlanStatus.textContent = sprintf(_('Could not fill the selected tracks: %s'), mbzExtErrorText(error));
        }
    }).then(function () {
        if (ui.fillButton) ui.fillButton.classList.remove('mbzExtBusy');
    }, function () {
        if (ui.fillButton) ui.fillButton.classList.remove('mbzExtBusy');
    });
}

/**
 * Fills every selected track from the release behind its album and saves the
 * changed tracks immediately. Group Track Properties cannot commit native
 * fields staged by a tab, so this path cannot leave the work to OK; the
 * checkbox list is the confirmation.
 */
function mbzExtFillGroupFromRelease(ui, dialog) {
    var fetch = window.mbzFetch;
    var apply = window.mbzApply;

    if (!ui || !ui.fillButton) return;

    if (!fetch || !apply) {
        if (ui.fillStatus) {
            ui.fillStatus.textContent = _('The MusicBrainz modules did not load. Check debug.log for lines starting with "Loves MBz:".');
        }
        return;
    }

    if (ui.fillButton.classList.contains('mbzExtBusy')) return;

    var selection = mbzExtCollectGroupSelection(dialog);
    if (!selection.tracks.length) {
        if (ui.fillStatus) ui.fillStatus.textContent = _('No library tracks are selected.');
        return;
    }

    function finish() {
        if (ui.fillButton) ui.fillButton.classList.remove('mbzExtBusy');
    }

    ui.fillButton.classList.add('mbzExtBusy');
    if (ui.fillStatus) ui.fillStatus.textContent = _('Reading the release...');

    dialog.localPromise(mbzExtWithTimeout(
        mbzExtBuildGroupFillAsync(selection.tracks, function (phase, current, total) {
            if (!ui.fillStatus || window._cleanUpCalled) return;

            if (phase === 'tags') {
                ui.fillStatus.textContent = _('Reading the selected tracks...');
            } else if (phase === 'release') {
                ui.fillStatus.textContent = sprintf(_('Reading release %d of %d...'), current, total);
            } else {
                ui.fillStatus.textContent = sprintf(_('Matching track %d of %d...'), current, total);
            }
        }),
        60000,
        _('Reading the release took too long. Try again.')
    )).then(function (plan) {
        if (window._cleanUpCalled) return;

        if (!plan.work.length) {
            if (ui.fillStatus) {
                ui.fillStatus.textContent = _('Nothing to fill.') + mbzExtGroupFillSkipText(plan.counts);
            }
            return;
        }

        mbzExtShowFillPlan(ui, {
            mode: 'group',
            work: plan.work,
            counts: plan.counts,
            fields: mbzExtFillAggregateFields(plan.work),
            tagsById: plan.tagsById,
            title: sprintf(_('Choose what to overwrite on %d selected track(s). Applying saves them immediately.'), plan.work.length)
        });
        if (ui.fillStatus) {
            ui.fillStatus.textContent = _('Choose the fields, then click Apply selected. Cancel in Track Properties will not undo the save.');
        }
    }, function (error) {
        if (!window._cleanUpCalled && ui.fillStatus) {
            ui.fillStatus.textContent = sprintf(_('Could not read the release: %s'), mbzExtErrorText(error));
        }
    }).then(finish, finish);
}

/**
 * Fills the open dialog's track from the release behind its album ID. The
 * fetched values are staged on the track: native fields are assigned and the
 * extended tags are merged into its current array, but nothing is committed.
 * The dialog's own OK button performs the save.
 *
 * Matching is by disc and track number, and values that already match are left
 * out. An album without Albums.MBGID is reported without a request.
 */
function mbzExtFillFromRelease(ui, track, dialog) {
    var fetch = window.mbzFetch;
    var apply = window.mbzApply;
    var mbz = window.mbzMbgid;

    if (!ui || !ui.fillButton) return;

    if (dialog && dialog.isGroup) {
        mbzExtFillGroupFromRelease(ui, dialog);
        return;
    }

    if (!fetch || !apply || !mbz) {
        if (ui.fillStatus) {
            ui.fillStatus.textContent = _('The MusicBrainz modules did not load. Check debug.log for lines starting with "Loves MBz:".');
        }
        return;
    }

    if (ui.fillButton.classList.contains('mbzExtBusy')) return;
    ui.fillButton.classList.add('mbzExtBusy');
    if (ui.fillStatus) ui.fillStatus.textContent = _('Reading the release...');

    function finish() {
        if (ui.fillButton) ui.fillButton.classList.remove('mbzExtBusy');
    }

    var albumId = parseInt(track.idalbum, 10);

    dialog.localPromise(fetch.previewAsync(albumId)).then(function (result) {
        if (window._cleanUpCalled) return;

        if (result.skipped) {
            if (ui.fillStatus) {
                ui.fillStatus.textContent = result.reason === 'no-album'
                    ? _('This track has no album, so there is nothing to look up.')
                    : _('This album has no MusicBrainz release ID. Nothing was requested.');
            }
            return;
        }

        return apply.buildPendingAsync(track, result.release).then(function (pending) {
            if (window._cleanUpCalled) return;

            if (!pending.matched) {
                if (ui.fillStatus) ui.fillStatus.textContent = _('This track has no matching disc and track number in the release.');
                return;
            }

            if (!pending.labels.length) {
                if (ui.fillStatus) ui.fillStatus.textContent = _('MusicBrainz already matches this track.');
                return;
            }

            mbzExtShowFillPlan(ui, {
                mode: 'single',
                track: track,
                pending: pending,
                fields: pending.fields,
                title: sprintf(_('Choose what to overwrite on this track from "%s". Nothing is saved until OK.'), pending.releaseTitle || '')
            });
            if (ui.fillStatus) {
                ui.fillStatus.textContent = _('Choose the fields, then click Apply selected.');
            }
        });
    }, function (error) {
        if (!window._cleanUpCalled && ui.fillStatus) {
            ui.fillStatus.textContent = sprintf(_('Could not read the release: %s'), mbzExtErrorText(error));
        }
    }).then(finish, finish);
}

propertiesTabs.tabLovesMBz.load = function (track, dialog) {
    var mbz = window.mbzMbgid;
    var main = qid('tabLovesMBzContent');
    if (!main) return;

    var ui = {
        intro: qeid(main, 'mbzExtIntro'),
        summary: qeid(main, 'mbzExtSummary'),
        table: qeid(main, 'mbzExtTable'),
        rows: qeid(main, 'mbzExtRows'),
        empty: qeid(main, 'mbzExtEmpty'),
        status: qeid(main, 'mbzExtStatus'),
        fillBar: qeid(main, 'mbzExtFillBar'),
        fillButton: qeid(main, 'mbzExtFillButton'),
        fillStatus: qeid(main, 'mbzExtFillStatus'),
        fillPlan: qeid(main, 'mbzExtFillPlan'),
        fillPlanTitle: qeid(main, 'mbzExtFillPlanTitle'),
        fillFields: qeid(main, 'mbzExtFillFields'),
        fillApply: qeid(main, 'mbzExtFillApply'),
        fillCancel: qeid(main, 'mbzExtFillCancel'),
        fillPlanStatus: qeid(main, 'mbzExtFillPlanStatus'),
        addBar: qeid(main, 'mbzExtAddBar'),
        suggest: qeid(main, 'mbzExtSuggestBar'),
        diverge: qeid(main, 'mbzExtDivergeBar'),
        applyHead: qeid(main, 'mbzExtApplyHead'),
        addTag: qeid(main, 'mbzExtAddTag'),
        addValue: qeid(main, 'mbzExtAddValue'),
        addButton: qeid(main, 'mbzExtAddButton'),
        applyBar: qeid(main, 'mbzExtApplyBar'),
        applyCheck: qeid(main, 'chb_mbzExtTags')
    };

    mbzExtUI = ui;
    mbzExtFillPlanState = null;
    mbzExtHideFillPlan(ui);
    mbzExtRows = [];
    mbzExtGroup = null;
    mbzExtSuggestions = [];
    mbzExtNative = null;
    mbzExtArtists = [];
    mbzExtGroupNative = null;
    mbzExtGroupIds = [];
    mbzExtGroupLookup = null;
    var token = ++mbzExtLoadToken;

    mbzExtFileSeparator = mbzExtSeparatorForFile(track && track.path);

    ui.intro.textContent = _('Only MusicBrainz tags stored in this track\'s ExtendedTags are listed here. The album and artist MBIDs are separate fields.');
    ui.summary.textContent = '';
    ui.status.textContent = '';
    ui.rows.textContent = '';
    ui.empty.style.display = 'none';
    ui.table.style.display = '';

    if (!mbz) {
        mbzExtShowEmpty(ui, _('The MusicBrainz module did not load. Check debug.log for lines starting with "Loves MBz:".'));
        return;
    }

    var readOnly = !!window.isReadOnly;
    if (readOnly) ui.status.textContent = _('Read-only mode: links work, editing is disabled.');
    if (ui.applyBar) ui.applyBar.style.display = (dialog.isGroup && !readOnly) ? '' : 'none';

    if (ui.fillBar) ui.fillBar.style.display = readOnly ? 'none' : '';
    if (ui.fillStatus) ui.fillStatus.textContent = '';
    mbzExtListen(dialog, ui.fillButton, 'click', function () {
        mbzExtFillFromRelease(ui, track, dialog);
    });
    mbzExtListen(dialog, ui.fillApply, 'click', function () {
        mbzExtApplyFillPlan(ui, dialog);
    });
    mbzExtListen(dialog, ui.fillCancel, 'click', function () {
        mbzExtHideFillPlan(ui);
    });

    mbzExtListen(dialog, ui.rows, 'input', mbzExtOnInput);
    mbzExtListen(dialog, ui.rows, 'click', mbzExtOnClick);
    mbzExtListen(dialog, ui.rows, 'change', mbzExtOnApplyChange);
    mbzExtListen(dialog, ui.diverge, 'click', mbzExtOnDivergeClick);

    if (ui.diverge) ui.diverge.style.display = 'none';

    mbzExtPopulateAddChoices(ui, mbz);
    mbzExtShowAddBar(ui, readOnly);

    mbzExtListen(dialog, ui.addButton, 'click', function () {
        mbzExtAddPending(ui, window.mbzMbgid);
    });

    mbzExtListen(dialog, ui.addValue, 'keydown', function (event) {
        if (!event || (event.key !== 'Enter' && event.keyCode !== 13)) return;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        mbzExtAddPending(ui, window.mbzMbgid);
    });

    mbzExtListen(dialog, ui.suggest, 'click', mbzExtOnSuggestClick);
    mbzExtLoadSuggestions(ui, mbz, [parseInt(track.id, 10)], readOnly, token);

    if (dialog.isGroup) {
        mbzExtLoadGroup(ui, dialog, mbz, readOnly, token);
        return;
    }

    // One artist row is the only case where the artist ID has an unambiguous
    // destination; the strip stays quiet for multi-artist credits.
    if (typeof mbz.getTrackArtistsAsync === 'function') {
        dialog.localPromise(mbz.getTrackArtistsAsync(parseInt(track.id, 10))).then(function (artists) {
            if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
            mbzExtArtists = artists || [];
            mbzExtRenderDivergence(ui, readOnly);
        }, function () {
            if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
            mbzExtArtists = [];
        });
    }

    dialog.localPromise(track.getExtendedTagsAsync()).then(function (text) {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;

        var tags = mbz.parseExtendedTags(text);
        if (tags === null) {
            mbzExtShowEmpty(ui, _('The extended tags of this track could not be read as JSON.'));
            return;
        }

        mbzExtRender(ui, tags, readOnly, mbz);
    }, function (error) {
        if (window._cleanUpCalled || token !== mbzExtLoadToken) return;
        mbzExtShowEmpty(ui, sprintf(_('Could not read extended tags: %s'), mbzExtErrorText(error)));
    });
};

propertiesTabs.tabLovesMBz.saveAsync = function (track, dialog) {
    var mbz = window.mbzMbgid;
    if (!mbz || !mbzExtRows.length || window.isReadOnly) {
        return Promise.resolve();
    }

    if (dialog && dialog.isGroup) {
        return mbzExtSaveGroupAsync(track, mbz);
    }

    var edits = [];
    mbzExtRows.forEach(function (row) {
        if (!row.input) return;

        var value = mbzExtValueForSave(row, mbz);

        if (row.isNew) {
            // A cleared pending row is a cancelled add, not a deletion.
            if (!value.trim()) return;
            edits.push({ title: row.title, add: true, value: value });
            return;
        }

        if (value === row.originalValue) return;
        edits.push({ title: row.title, occurrence: row.occurrence, value: value });
    });

    if (!edits.length) return Promise.resolve();

    return (async function () {
        // tabCustom is registered before this tab, so MediaMonkey has already
        // queued its setExtendedTagsAsync. Reading now merges its changes
        // instead of overwriting them with the array loaded when the tab opened.
        var text = await track.getExtendedTagsAsync();
        var tags = mbz.parseExtendedTags(text);
        if (tags === null) throw new Error(_('The extended tags could not be read as JSON.'));

        var result = mbz.applyExtendedTagEdits(tags, edits);
        if (!result.applied) return;

        await track.setExtendedTagsAsync(result.tags.length ? JSON.stringify(result.tags) : '');

        // Record exactly what was written, so a later save does not treat
        // canonicalized or removed values as dirty again.
        result.appliedEdits.forEach(function (edit) {
            if (edit.added) return; // new rows are updated below

            mbzExtRows.forEach(function (row) {
                if (row.title !== edit.title || row.occurrence !== edit.occurrence) return;
                row.originalValue = edit.value;
                row.pendingValue = edit.value;
            });
        });

        mbzExtRenderDivergence(mbzExtUI, false);

        // A row added in this session is an ordinary tag on the track now.
        mbzExtRows.forEach(function (row) {
            if (!row.isNew) return;

            var value = mbzExtValueForSave(row, mbz);
            if (!value.trim()) return;

            row.isNew = false;
            row.originalValue = value;
            row.pendingValue = value;
        });

        // Re-split what was written, so the rows match the stored value.
        if (mbzExtUI) {
            mbzExtRenderRows(mbzExtUI, false);
            mbzExtUpdateStatus();
        }
    })().catch(function (error) {
        // The properties dialog has no rejection path for saveAsync. Report the
        // failure and resolve so the modal cannot be left in a stuck state.
        if (typeof messageDlg === 'function') {
            messageDlg(
                sprintf(_('Could not save the MusicBrainz extended tags: %s'), mbzExtErrorText(error)),
                'Error', ['btnOK'], { defaultButton: 'btnOK' });
        }
    });
};
