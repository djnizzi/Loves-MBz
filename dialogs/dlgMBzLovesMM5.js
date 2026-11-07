'use strict';

/*
 * MBz loves MM5 — MusicBrainz ID viewer and editor.
 *
 * Lists the MusicBrainz IDs for the tracks that were selected when the action
 * was invoked, and copies them as a tab-separated table.
 *
 * Selecting a row opens the editor below the table. Editing is deliberately
 * narrow and guarded:
 *
 *   - only whole rows are written (Albums.MBGID, Albums.MBRGGID, Artists.MBGID)
 *   - values are validated as MusicBrainz UUIDs before anything runs
 *   - the confirmation dialog names the album or artist and how many tracks
 *     that row covers, because an album ID is not a per-track value
 *   - writes go through app.db, then clear MediaMonkey's DB cache and refresh
 *     the views, so the track list does not keep showing stale values
 *
 * The dialog queries the database directly (mbzMbgid.lookupTracksAsync) rather
 * than reading the start-up cache, so the numbers are always current even if
 * MusicBrainz matches were added after MediaMonkey started.
 */

localRequirejs('mbzMbgid');

var MBZ_MAX_ROWS = 1000;

function mbzDisplayArtist(track) {
    var artist = (track && track.artist) ? String(track.artist) : '';
    try {
        if (typeof utils !== 'undefined' && utils.multiString2VisualString) {
            artist = utils.multiString2VisualString(artist);
        }
    } catch (e) {
        // keep the raw value
    }
    return artist;
}

function mbzTrackEntry(track) {
    var songId = track ? parseInt(track.id, 10) : 0;
    var albumId = track ? parseInt(track.idalbum, 10) : 0;

    if (!(songId > 0)) songId = 0;
    if (!(albumId > 0)) albumId = 0;

    return {
        songId: songId,
        albumId: albumId,
        title: track ? String(track.title || '') : '',
        album: track ? String(track.album || '') : '',
        artist: mbzDisplayArtist(track)
    };
}

/**
 * Copies the fields the dialog needs while holding a read lock. MediaMonkey
 * 2024 throws "Read lock not acquired!" when a SharedList item, or a shared
 * Track property, is read outside one. The returned entries are plain objects,
 * so render() never has to touch a shared track again.
 */
function mbzCollectTracks(sourceList, limit) {
    var result = { total: 0, entries: [], songIds: [] };
    if (!sourceList) return result;

    function collect() {
        result.total = sourceList.count || 0;
        var count = Math.min(result.total, limit > 0 ? limit : result.total);

        for (var i = 0; i < count; i++) {
            var entry = mbzTrackEntry(sourceList.getValue(i));
            result.entries.push(entry);
            result.songIds.push(entry.songId);
        }
    }

    if (typeof sourceList.locked === 'function') sourceList.locked(collect);
    else collect();

    return result;
}

function mbzCell(text, className) {
    var td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
}

function mbzGuidCell(guid) {
    if (!guid) {
        var empty = mbzCell('\u2014', 'mbzGuid mbzEmpty');
        return empty;
    }
    var td = mbzCell(guid, 'mbzGuid');
    td.setAttribute('data-tip', guid);
    return td;
}

function mbzCleanCell(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[\t\r\n]+/g, ' ');
}

function mbzErrorText(error) {
    if (!error) return '';
    return (error.message) ? error.message : String(error);
}

function mbzEscape(text) {
    var value = String(text === undefined || text === null ? '' : text);
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mbzCopyText(text) {
    return new Promise(function (resolve) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();

        var copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (e) {
            copied = false;
        }
        document.body.removeChild(area);

        if (copied) {
            resolve(true);
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                resolve(true);
            }, function () {
                resolve(false);
            });
        } else {
            resolve(false);
        }
    });
}

function init(params) {
    var wnd = this;
    wnd.title = (params && params.title) ? params.title : _('MBz loves MM5');
    wnd.resizeable = true;

    var sourceList = params && params.tracks;
    var mbz = window.mbzMbgid;

    var rowsData = [];
    var editIndex = -1;
    var artistToken = 0;
    var loadId = 0;

    var canEdit = true;
    try {
        if (typeof uitools !== 'undefined' && uitools.getCanEdit) {
            canEdit = !!uitools.getCanEdit();
        }
    } catch (e) {
        canEdit = true;
    }

    var UI = {
        summary: qid('summary'),
        rows: qid('rows'),
        copyStatus: qid('copyStatus'),
        editPanel: qid('editPanel'),
        editTarget: qid('editTarget'),
        edtRelease: qid('edtRelease'),
        edtGroup: qid('edtGroup'),
        cboArtist: qid('cboArtist'),
        edtArtist: qid('edtArtist'),
        editStatus: qid('editStatus')
    };

    function setSummary(text) {
        if (UI.summary) UI.summary.textContent = text;
    }

    function setCopyStatus(text) {
        if (UI.copyStatus) UI.copyStatus.textContent = text;
    }

    function setEditStatus(text) {
        if (UI.editStatus) UI.editStatus.textContent = text;
    }

    function trackCount(count) {
        return (count === 1) ? _('1 track') : sprintf(_('%d tracks'), count);
    }

    function currentArtist() {
        var row = rowsData[editIndex];
        if (!row || !row.artists || !row.artists.length) return null;

        var index = parseInt(UI.cboArtist.value, 10);
        if (!(index >= 0 && index < row.artists.length)) index = 0;

        return row.artists[index];
    }

    // ---------------------------------------------------------------------
    // Table
    // ---------------------------------------------------------------------

    function render(result, selectSongId) {
        if (window._cleanUpCalled) return;

        UI.rows.textContent = '';
        rowsData = [];
        editIndex = -1;
        artistToken++;

        var withRelease = 0;
        var withGroup = 0;
        var withArtist = 0;

        result.entries.forEach(function (entry, index) {
            var trackId = entry.songId;
            var ids = result.ids.get(trackId) || { releaseId: '', releaseGroupId: '', artistIds: '' };
            var row = {
                songId: trackId,
                albumId: entry.albumId,
                title: entry.title,
                album: entry.album,
                artist: entry.artist,
                releaseId: ids.releaseId,
                releaseGroupId: ids.releaseGroupId,
                artistIds: ids.artistIds,
                artists: []
            };

            rowsData.push(row);
            if (row.releaseId) withRelease++;
            if (row.releaseGroupId) withGroup++;
            if (row.artistIds) withArtist++;

            var tr = document.createElement('tr');
            tr.setAttribute('data-index', String(index));
            tr.appendChild(mbzCell(row.title, 'mbzText'));
            tr.appendChild(mbzCell(row.album, 'mbzText'));
            tr.appendChild(mbzCell(row.artist, 'mbzText'));
            tr.appendChild(mbzGuidCell(row.releaseId));
            tr.appendChild(mbzGuidCell(row.releaseGroupId));
            tr.appendChild(mbzGuidCell(row.artistIds));
            UI.rows.appendChild(tr);
        });

        if (!result.entries.length) {
            setSummary(_('No tracks are selected. Select tracks in a track list and run the action again.'));
            hideEditor();
            return;
        }

        var summary = sprintf(
            _('Showing %d of %d selected tracks. %d have a release ID, %d a release group ID and %d an artist ID.'),
            rowsData.length, result.total, withRelease, withGroup, withArtist
        );

        if (result.total > MBZ_MAX_ROWS) {
            summary += ' ' + sprintf(_('Only the first %d tracks are shown and copied.'), MBZ_MAX_ROWS);
        }

        summary += ' ' + _('IDs are read live from the Albums and Artists tables.');

        setSummary(summary);

        if (selectSongId) {
            for (var i = 0; i < rowsData.length; i++) {
                if (rowsData[i].songId === selectSongId) {
                    selectRow(i);
                    break;
                }
            }
        }
    }

    function onRowClick(event) {
        var node = event && event.target;
        while (node && node !== UI.rows && node.tagName !== 'TR') {
            node = node.parentNode;
        }
        if (!node || node.tagName !== 'TR' || !UI.rows.contains(node)) return;

        var index = parseInt(node.getAttribute('data-index'), 10);
        if (index >= 0 && index < rowsData.length) selectRow(index);
    }

    function hideEditor() {
        if (!UI.editPanel) return;
        UI.editPanel.style.display = 'none';
    }

    // ---------------------------------------------------------------------
    // Editor
    // ---------------------------------------------------------------------

    function selectRow(index) {
        var row = rowsData[index];
        if (!row) return;

        editIndex = index;

        for (var i = 0; i < UI.rows.children.length; i++) {
            var tr = UI.rows.children[i];
            if (i === index) tr.classList.add('mbzSelected');
            else tr.classList.remove('mbzSelected');
        }

        UI.edtRelease.value = row.releaseId || '';
        UI.edtGroup.value = row.releaseGroupId || '';
        UI.edtRelease.disabled = !(row.albumId > 0);
        UI.edtGroup.disabled = !(row.albumId > 0);
        UI.edtArtist.value = '';
        UI.edtArtist.disabled = true;
        UI.cboArtist.textContent = '';
        UI.cboArtist.style.display = 'none';

        setEditStatus('');
        UI.editTarget.textContent = _('Reading the album and artist...');

        var token = ++artistToken;

        window.localPromise(mbz.getTrackArtistsAsync(row.songId)).then(function (artists) {
            if (window._cleanUpCalled || token !== artistToken) return;

            row.artists = artists;
            fillArtists(artists);
            refreshTarget(row, token);
        }, function (error) {
            if (window._cleanUpCalled || token !== artistToken) return;
            UI.editTarget.textContent = sprintf(
                _('Could not read the track artists: %s'), mbzErrorText(error));
        });
    }

    function fillArtists(artists) {
        UI.cboArtist.textContent = '';

        for (var i = 0; i < artists.length; i++) {
            var option = document.createElement('option');
            option.value = String(i);
            option.textContent = artists[i].name || sprintf(_('Artist %d'), artists[i].id);
            UI.cboArtist.appendChild(option);
        }

        UI.cboArtist.style.display = (artists.length > 1) ? '' : 'none';
        UI.edtArtist.disabled = (artists.length === 0);

        if (!artists.length) return;

        UI.cboArtist.value = '0';
        UI.edtArtist.value = artists[0].mbgid || '';
    }

    // Shows which album and artist row the three fields write to, and how many
    // tracks each of those rows covers — the size of the side effect.
    function refreshTarget(row, token) {
        var artist = currentArtist();

        var pending = [
            (row.albumId > 0) ? mbz.countAlbumTracksAsync(row.albumId) : Promise.resolve(0),
            artist ? mbz.countArtistTracksAsync(artist.id) : Promise.resolve(0)
        ];

        window.localPromise(Promise.all(pending)).then(function (counts) {
            if (window._cleanUpCalled || token !== artistToken) return;

            var parts = [];

            if (row.albumId > 0) {
                parts.push(sprintf(_('Album "%s" \u2014 %s'),
                    row.album || ('#' + row.albumId), trackCount(counts[0])));
            }
            if (artist) {
                parts.push(sprintf(_('Artist "%s" \u2014 %s'),
                    artist.name || ('#' + artist.id), trackCount(counts[1])));
            }

            UI.editTarget.textContent = parts.length
                ? parts.join('    \u2022    ')
                : _('This track is not linked to an album or artist in the library database.');
        }, function () {
            if (window._cleanUpCalled || token !== artistToken) return;
            UI.editTarget.textContent = _('The album or artist could not be counted.');
        });
    }

    function collectChanges(row) {
        var release = mbz.normalizeGuid(UI.edtRelease.value);
        var group = mbz.normalizeGuid(UI.edtGroup.value);
        var artistId = mbz.normalizeGuid(UI.edtArtist.value);

        if (release === null || group === null || artistId === null) {
            return {
                error: _('A MusicBrainz ID is 36 characters long, like 8d1a1d1e-1c1a-4d1e-9c1a-1d1e1c1a4d1e. Leave the field empty to clear it.')
            };
        }

        var changes = [];

        if (row.albumId > 0 && release !== (row.releaseId || '')) {
            changes.push({
                kind: 'album', field: 'MBGID', id: row.albumId, old: row.releaseId || '',
                label: _('Release ID'), value: release
            });
        }

        if (row.albumId > 0 && group !== (row.releaseGroupId || '')) {
            changes.push({
                kind: 'album', field: 'MBRGGID', id: row.albumId, old: row.releaseGroupId || '',
                label: _('Release group ID'), value: group
            });
        }

        var artist = currentArtist();
        if (artist && artistId !== (artist.mbgid || '')) {
            changes.push({
                kind: 'artist', id: artist.id, artistName: artist.name, old: artist.mbgid || '',
                label: _('Artist ID'), value: artistId
            });
        }

        return { changes: changes };
    }

    function buildConfirmMessage(row, changes, albumCount, artistCount) {
        var lines = [];

        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            var scope = (change.kind === 'album')
                ? sprintf(_('album "%s" (%s)'), row.album || ('#' + row.albumId), trackCount(albumCount))
                : sprintf(_('artist "%s" (%s)'), change.artistName, trackCount(artistCount));

            var previous = change.old ? mbzEscape(change.old) : '<i>' + _('(empty)') + '</i>';
            var next = change.value ? '<b>' + mbzEscape(change.value) + '</b>' : '<i>' + _('(cleared)') + '</i>';

            lines.push(sprintf(_('%s for %s:'), change.label, scope) + ' ' +
                previous + ' \u2192 ' + next);
        }

        return sprintf(_('Apply %d MusicBrainz ID change(s)?'), changes.length) + '<br><br>' +
            lines.join('<br>') + '<br><br>' +
            _('Album and artist IDs belong to the album or artist row, not to this track, so the change applies to every track listed above.') + '<br>' +
            _('MediaMonkey\'s own MusicBrainz lookup can overwrite these values the next time it re-matches the release or artist.');
    }

    function save() {
        var row = rowsData[editIndex];
        if (!row) {
            setEditStatus(_('Select a track in the table first.'));
            return;
        }

        var collected = collectChanges(row);
        if (collected.error) {
            setEditStatus(collected.error);
            return;
        }
        if (!collected.changes.length) {
            setEditStatus(_('Nothing has changed.'));
            return;
        }

        var artist = currentArtist();
        var pending = [
            (row.albumId > 0) ? mbz.countAlbumTracksAsync(row.albumId) : Promise.resolve(0),
            artist ? mbz.countArtistTracksAsync(artist.id) : Promise.resolve(0)
        ];

        window.localPromise(Promise.all(pending)).then(function (counts) {
            if (window._cleanUpCalled) return;

            messageDlg(
                buildConfirmMessage(row, collected.changes, counts[0], counts[1]),
                'Confirmation',
                ['btnYes', 'btnNo'],
                { defaultButton: 'btnNo', title: _('MBz loves MM5') },
                function (result) {
                    if (window._cleanUpCalled) return;
                    if (result && result.btnID === 'btnYes') {
                        applyChanges(row, collected.changes);
                    }
                }
            );
        }, function (error) {
            if (window._cleanUpCalled) return;
            setEditStatus(sprintf(_('Could not check the album and artist: %s'), mbzErrorText(error)));
        });
    }

    function applyChanges(row, changes) {
        setEditStatus(_('Saving...'));

        var work = (async function () {
            var applied = 0;

            try {
                for (var i = 0; i < changes.length; i++) {
                    var change = changes[i];

                    if (change.kind === 'album') {
                        await mbz.setAlbumGuidAsync(change.id, change.field, change.value);
                    } else {
                        await mbz.setArtistGuidAsync(change.id, change.value);
                    }

                    applied++;
                }
            } catch (e) {
                e.mbzApplied = applied;
                throw e;
            }
        })();

        window.localPromise(work).then(function () {
            if (window._cleanUpCalled) return;

            var saved = sprintf(_('Saved %d change(s).'), changes.length);
            setEditStatus(saved);
            load(row.songId, saved);
        }, function (error) {
            if (window._cleanUpCalled) return;

            var applied = (error && error.mbzApplied) ? error.mbzApplied : 0;
            var message = applied
                ? sprintf(_('Saved %d change(s), then failed: %s'), applied, mbzErrorText(error))
                : sprintf(_('Could not save: %s'), mbzErrorText(error));

            setEditStatus(message);
            if (applied) load(row.songId, message);
        });
    }

    function clearAll() {
        if (!rowsData[editIndex]) {
            setEditStatus(_('Select a track in the table first.'));
            return;
        }

        UI.edtRelease.value = '';
        UI.edtGroup.value = '';
        UI.edtArtist.value = '';

        save();
    }

    // ---------------------------------------------------------------------
    // Loading and copying
    // ---------------------------------------------------------------------

    async function readRows() {
        if (!sourceList) {
            return { total: 0, entries: [], ids: new Map() };
        }

        if (sourceList.whenLoaded) {
            await sourceList.whenLoaded();
        }
        if (window._cleanUpCalled) return { total: 0, entries: [], ids: new Map() };

        var collected = mbzCollectTracks(sourceList, MBZ_MAX_ROWS);
        var values = await mbz.lookupTracksAsync(collected.songIds);
        return { total: collected.total, entries: collected.entries, ids: values };
    }

    function load(selectSongId, statusAfterLoad) {
        var thisLoad = ++loadId;

        setSummary(_('Reading MusicBrainz IDs...'));
        setCopyStatus('');

        window.localPromise(readRows()).then(function (result) {
            if (window._cleanUpCalled || (thisLoad !== loadId)) return;
            render(result, selectSongId);
            // Re-selecting the row clears the editor status, so a caller that
            // has something to report sets it again after the render.
            if (statusAfterLoad) setEditStatus(statusAfterLoad);
        }, function (error) {
            if (window._cleanUpCalled || (thisLoad !== loadId)) return;
            setSummary(sprintf(_('Could not read MusicBrainz IDs: %s'), mbzErrorText(error)));
        });
    }

    function buildTableText() {
        var lines = [[
            'Title',
            'Album',
            'Artist',
            'MusicBrainz Release ID',
            'MusicBrainz Release Group ID',
            'MusicBrainz Artist ID'
        ].join('\t')];

        rowsData.forEach(function (row) {
            lines.push([
                mbzCleanCell(row.title),
                mbzCleanCell(row.album),
                mbzCleanCell(row.artist),
                mbzCleanCell(row.releaseId),
                mbzCleanCell(row.releaseGroupId),
                mbzCleanCell(row.artistIds)
            ].join('\t'));
        });

        return lines.join('\r\n');
    }

    function copyTable() {
        if (!rowsData.length) {
            setCopyStatus(_('Nothing to copy.'));
            return;
        }

        mbzCopyText(buildTableText()).then(function (copied) {
            if (window._cleanUpCalled) return;
            if (copied) {
                setCopyStatus(sprintf(_('Copied %d rows to the clipboard.'), rowsData.length));
            } else {
                setCopyStatus(_('The clipboard is not available. Select the table text and press Ctrl+C.'));
            }
        });
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    if (!mbz) {
        setSummary(_('The MusicBrainz ID module did not load. Check debug.log for lines starting with "MBz loves MM5:".'));
        hideEditor();
        return;
    }

    if (!canEdit) {
        hideEditor();
    }

    window.localListen(UI.rows, 'click', onRowClick);
    window.localListen(qid('btnCopy'), 'click', copyTable);
    window.localListen(qid('btnReload'), 'click', function () { load(); });
    window.localListen(qid('btnSave'), 'click', save);
    window.localListen(qid('btnClear'), 'click', clearAll);

    window.localListen(UI.cboArtist, 'change', function () {
        var row = rowsData[editIndex];
        var artist = currentArtist();

        if (artist) UI.edtArtist.value = artist.mbgid || '';
        if (row) refreshTarget(row, artistToken);

        setEditStatus('');
    });

    load();
}
