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

function mbzExtErrorText(error) {
    if (!error) return '';
    return error.message ? error.message : String(error);
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

function mbzExtPopulateAddChoices(ui, mbz) {
    if (!ui || !ui.addTag || !mbz || typeof mbz.musicBrainzTagChoices !== 'function') return;
    if (ui.addTag.options && ui.addTag.options.length) return;

    mbz.musicBrainzTagChoices().forEach(function (choice) {
        var option = document.createElement('option');
        option.value = choice.name;
        option.textContent = choice.label + ' \u2014 ' + choice.name;
        option.title = choice.name;
        ui.addTag.appendChild(option);
    });
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
        ui.summary.textContent = mbzExtRows.length === 1
            ? sprintf(_('1 MusicBrainz tag for all %d selected tracks.'), mbzExtGroup.trackCount)
            : sprintf(_('%d MusicBrainz tags for all %d selected tracks.'), mbzExtRows.length, mbzExtGroup.trackCount);
        return;
    }

    ui.summary.textContent = mbzExtRows.length === 1
        ? _('1 MusicBrainz extended tag.')
        : sprintf(_('%d MusicBrainz extended tags.'), mbzExtRows.length);
}

function mbzExtRowValue(row) {
    if (!row) return '';
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

    var duplicate = false;
    mbzExtRows.forEach(function (row) {
        if (row.title === title && String(mbzExtRowValue(row)) === value) duplicate = true;
    });

    if (duplicate) {
        ui.status.textContent = _('That tag and value are already listed.');
        return;
    }

    mbzExtRows.push({
        title: title,
        occurrence: mbzExtNextOccurrence(title),
        originalValue: '',
        pendingValue: value,
        isNew: true,
        info: mbz.musicBrainzTagInfo(title),
        input: null,
        linkCell: null
    });

    ui.table.style.display = '';
    ui.empty.style.display = 'none';
    if (ui.addValue) ui.addValue.value = '';

    window.modified = true;
    window.tagModified = true;

    mbzExtRenderRows(ui, false);
    mbzExtUpdateSummary(ui);
    mbzExtUpdateStatus();
}

function mbzExtEntityLabel(entity) {
    return MBZ_EXT_ENTITY_LABELS[entity] || entity;
}

function mbzExtRenderLinks(row) {
    var mbz = window.mbzMbgid;
    if (!mbz || !row || !row.linkCell || !row.input) return;

    var isIdTag = !!(row.info && row.info.entity);
    var parsed = isIdTag ? mbz.extendedTagGuids(row.input.value) : { ids: [], invalid: [] };
    var invalid = parsed.invalid.length > 0;

    if (row.input.classList) {
        if (invalid) row.input.classList.add('mbzExtInvalid');
        else row.input.classList.remove('mbzExtInvalid');
    }

    row.linkCell.textContent = '';

    if (isIdTag) {
        parsed.ids.forEach(function (guid) {
            var url = mbz.musicBrainzUrl(row.info.entity, guid);
            if (!url) return;

            var link = document.createElement('a');
            link.href = '#';
            link.className = 'hotlink mbzExtLink';
            link.setAttribute('data-url', url);
            link.title = url;
            link.textContent = mbzExtEntityLabel(row.info.entity) + ' \u2197';
            row.linkCell.appendChild(link);
        });
    }

    if (invalid && row.input.value.trim()) {
        var warning = document.createElement('span');
        warning.className = 'mbzExtWarning';
        warning.textContent = _('Not a valid MusicBrainz ID');
        warning.title = parsed.invalid.join(', ');
        row.linkCell.appendChild(warning);
    }
}

function mbzExtValueForSave(row, mbz) {
    var value = mbzExtRowValue(row);
    if (!row.info || !row.info.entity) return value;

    var parsed = mbz.extendedTagGuids(value);
    if (parsed.ids.length && !parsed.invalid.length) {
        return parsed.ids.join('; ');
    }
    return value;
}

function mbzExtGroupIntro(ui, readOnly, trackCount) {
    if (!ui) return;
    ui.intro.textContent = sprintf(
        _('Showing MusicBrainz tags that have the same value on all %d selected tracks. Per-track tags are not shown.'),
        trackCount
    ) + (readOnly ? '' : ' ' + _('Editing applies to all selected tracks.'));
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
            info: mbz.musicBrainzTagInfo(title),
            input: null,
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
        return;
    }

    ui.table.style.display = '';
    ui.empty.style.display = 'none';

    if (groupInfo) {
        mbzExtGroupIntro(ui, readOnly, groupInfo.trackCount);
    } else if (!readOnly) {
        ui.intro.textContent = _('Only MusicBrainz tags stored in this track\'s ExtendedTags are listed here. Edit a value and click OK to save it; clear a value to remove that tag.');
    }

    mbzExtUpdateSummary(ui);
    mbzExtRenderRows(ui, readOnly);
}

function mbzExtRenderRows(ui, readOnly) {
    if (!ui) return;

    ui.rows.textContent = '';

    mbzExtRows.forEach(function (row, index) {
        var tr = document.createElement('tr');
        if (row.isNew) tr.className = 'mbzExtNew';

        var nameCell = document.createElement('td');
        var title = document.createElement('div');
        title.className = 'mbzExtTitle';
        title.textContent = row.title;
        nameCell.appendChild(title);

        var label = document.createElement('div');
        label.className = 'mbzExtLabel';
        label.textContent = (row.info ? _(row.info.label) : _('MusicBrainz tag'))
            + (row.isNew ? ' ' + _('(not saved yet)') : '');
        nameCell.appendChild(label);

        var valueCell = document.createElement('td');
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'mbzExtValue';
        input.value = row.pendingValue !== undefined ? row.pendingValue : row.originalValue;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.disabled = readOnly;
        input.setAttribute('data-row', String(index));
        valueCell.appendChild(input);
        row.input = input;

        var linkCell = document.createElement('td');
        linkCell.className = 'mbzExtLinks';
        row.linkCell = linkCell;
        mbzExtRenderLinks(row);

        tr.appendChild(nameCell);
        tr.appendChild(valueCell);
        tr.appendChild(linkCell);
        ui.rows.appendChild(tr);
    });
}

function mbzExtOnInput(event) {
    var input = event && event.target;
    if (!input || input.tagName !== 'INPUT' || !input.classList || !input.classList.contains('mbzExtValue')) return;

    var index = parseInt(input.getAttribute('data-row'), 10);
    var row = mbzExtRows[index];
    if (!row) return;

    row.pendingValue = input.value;
    window.modified = true;
    window.tagModified = true;
    mbzExtRenderLinks(row);
    mbzExtUpdateStatus();
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
    var result = { trackCount: 0, songIds: [] };
    var tracks = dialog && (dialog.tracks || window.tracks);
    if (!tracks) return result;

    function collect() {
        result.trackCount = tracks.count || 0;
        for (var i = 0; i < result.trackCount; i++) {
            var track = tracks.getValue(i);
            var id = track ? parseInt(track.id, 10) : 0;
            if (id > 0 && result.songIds.indexOf(id) < 0) result.songIds.push(id);
        }
    }

    if (typeof tracks.locked === 'function') tracks.locked(collect);
    else collect();

    return result;
}

function mbzExtLoadGroup(ui, dialog, mbz, readOnly, token) {
    var selection = mbzExtCollectGroupSelection(dialog);
    mbzExtGroup = { trackCount: selection.songIds.length };
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
    var patch = [];
    var hasDeleted = false;

    mbzExtRows.forEach(function (row) {
        if (!row.input) return;

        var value = mbzExtValueForSave(row, mbz);
        if (value === row.originalValue) return;

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
                if (row.input) row.input.value = row.originalValue;
            });
        });
    })().catch(function (error) {
        if (typeof messageDlg === 'function') {
            messageDlg(
                sprintf(_('Could not save the MusicBrainz extended tags: %s'), mbzExtErrorText(error)),
                'Error', ['btnOK'], { defaultButton: 'btnOK' });
        }
    });
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
        addBar: qeid(main, 'mbzExtAddBar'),
        addTag: qeid(main, 'mbzExtAddTag'),
        addValue: qeid(main, 'mbzExtAddValue'),
        addButton: qeid(main, 'mbzExtAddButton')
    };

    mbzExtUI = ui;
    mbzExtRows = [];
    mbzExtGroup = null;
    var token = ++mbzExtLoadToken;

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

    mbzExtListen(dialog, ui.rows, 'input', mbzExtOnInput);
    mbzExtListen(dialog, ui.rows, 'click', mbzExtOnClick);

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

    if (dialog.isGroup) {
        mbzExtLoadGroup(ui, dialog, mbz, readOnly, token);
        return;
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
                if (row.input && row.input.value !== edit.value) row.input.value = edit.value;
            });
        });

        // A row added in this session is an ordinary tag on the track now.
        mbzExtRows.forEach(function (row) {
            if (!row.isNew) return;

            var value = mbzExtValueForSave(row, mbz);
            if (!value.trim()) return;

            row.isNew = false;
            row.originalValue = value;
            row.pendingValue = value;
            if (row.input) row.input.value = value;
        });
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
