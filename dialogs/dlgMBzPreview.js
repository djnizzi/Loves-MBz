'use strict';

/*
 * Loves MBz — MusicBrainz release preview and apply.
 *
 * Opens for one album and asks mbzFetch for its release. mbzFetch reads
 * Albums.MBGID first and makes no request at all when the album has no release
 * ID; this dialog reports that outcome and offers a manual MusicBrainz web
 * search for the album, without querying the API or choosing a release.
 *
 * When the release arrives, mbzApply compares it with the album's library
 * tracks and returns only the fields that would change. Each field gets a
 * checkbox; nothing is written until Apply, and the album's ID columns are
 * never touched.
 */

localRequirejs('mbzFetch');
localRequirejs('mbzApply');

function mbzPreviewText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function mbzPreviewCredit(release) {
    var credit = (release && release['artist-credit']) ? release['artist-credit'] : [];
    var text = '';

    for (var i = 0; i < credit.length; i++) {
        var item = credit[i];
        if (!item) continue;
        text += mbzPreviewText(item.name || (item.artist && item.artist.name));
        text += item.joinphrase === undefined || item.joinphrase === null
            ? ''
            : String(item.joinphrase);
    }

    return text;
}

function mbzPreviewLabel(release) {
    var info = (release && release['label-info']) ? release['label-info'] : [];
    var parts = [];

    for (var i = 0; i < info.length; i++) {
        var item = info[i] || {};
        var name = mbzPreviewText(item.label && item.label.name);
        var catalog = mbzPreviewText(item['catalog-number']);

        if (name && catalog) parts.push(name + ' (' + catalog + ')');
        else if (name) parts.push(name);
        else if (catalog) parts.push(catalog);
    }

    return parts.join(', ');
}

function mbzPreviewType(release) {
    var group = (release && release['release-group']) ? release['release-group'] : {};
    var types = [];

    if (group['primary-type']) types.push(group['primary-type']);

    var secondary = group['secondary-types'] || [];
    for (var i = 0; i < secondary.length; i++) {
        if (secondary[i]) types.push(secondary[i]);
    }

    return types.join(' + ');
}

function mbzPreviewScript(release) {
    var text = (release && release['text-representation']) ? release['text-representation'] : {};
    var parts = [];

    if (text.script) parts.push(text.script);
    if (text.language) parts.push(text.language);

    return parts.join(' / ');
}

function mbzPreviewLength(ms) {
    var total = parseInt(ms, 10);
    if (!(total > 0)) return '';

    var seconds = Math.round(total / 1000);
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;

    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
}

function mbzPreviewCell(text, className) {
    var td = document.createElement('td');
    td.textContent = mbzPreviewText(text);
    if (className) td.className = className;
    return td;
}

function mbzPreviewErrorText(error) {
    if (!error) return '';
    return error.message ? error.message : String(error);
}

/** Escapes a value for a quoted Lucene phrase on the MusicBrainz site. */
function mbzPreviewSearchEscape(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

/**
 * MusicBrainz's release index searches the release title with the `release`
 * field and the credited artist with `artist`. Quoted values keep multi-word
 * titles together; the website's advanced indexed method enables the fields.
 */
function mbzPreviewSearchUrl(album, artist) {
    var title = mbzPreviewText(album);
    var credit = mbzPreviewText(artist);
    var parts = [];

    // MediaMonkey stores a multi-artist credit as "A; B". The first name is
    // enough to narrow the release title, and avoids a phrase that cannot match
    // MusicBrainz's combined artist field.
    credit = credit.split(';')[0].trim();

    if (title) parts.push('release:"' + mbzPreviewSearchEscape(title) + '"');
    if (credit) parts.push('artist:"' + mbzPreviewSearchEscape(credit) + '"');
    if (!parts.length) return '';

    return 'https://musicbrainz.org/search?query=' +
        encodeURIComponent(parts.join(' AND ')) +
        '&type=release&method=advanced';
}

function init(params) {
    var wnd = this;
    wnd.title = (params && params.title) ? params.title : _('MusicBrainz preview');
    wnd.resizeable = true;

    var albumId = (params && params.albumId) ? parseInt(params.albumId, 10) : 0;
    var sourceList = params && params.tracks;
    var fetch = window.mbzFetch;
    var apply = window.mbzApply;
    var currentPlan = null;
    var lastResult = null;
    var metaPairs = [];
    var searchUrl = '';

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
        warning: qid('warning'),
        fields: qid('fields'),
        fieldRows: qid('fieldRows'),
        btnApply: qid('btnApply'),
        applyStatus: qid('applyStatus'),
        searchRow: qid('searchRow'),
        btnSearch: qid('btnSearch'),
        searchStatus: qid('searchStatus'),
        meta: qid('meta'),
        metaScroll: qid('metaScroll'),
        metaRows: qid('metaRows'),
        tracks: qid('tracks'),
        trackRows: qid('trackRows'),
        note: qid('note')
    };

    function setSummary(text) {
        if (UI.summary) UI.summary.textContent = text;
    }

    function setWarning(text) {
        if (!UI.warning) return;
        UI.warning.textContent = text || '';
        UI.warning.style.display = text ? '' : 'none';
    }

    function setNote(text) {
        if (UI.note) UI.note.textContent = text;
    }

    function setStatus(text) {
        if (UI.applyStatus) UI.applyStatus.textContent = text;
    }

    /** Album title and artist for the manual MusicBrainz search. */
    function searchTerms(list) {
        var track = null;

        try {
            track = list && list.firstSelected;
        } catch (e) {
            track = null;
        }

        if (track) {
            var firstAlbum = mbzPreviewText(track.album);
            var firstArtist = mbzPreviewText(track.albumArtist || track.artist);
            if (firstAlbum || firstArtist) {
                return { album: firstAlbum, artist: firstArtist };
            }
        }

        // getAllValues reads the loaded list without taking an index and does
        // not depend on locked(), whose callback MediaMonkey may defer. This is
        // the same fallback the album ID reader uses.
        function listValue(key) {
            try {
                var values = list && list.getAllValues ? list.getAllValues(key) : null;
                return mbzPreviewText(values && values.length ? values[0] : '');
            } catch (e) {
                return '';
            }
        }

        var album = listValue('album');
        var artist = listValue('albumArtist');
        if (!artist) artist = listValue('artist');
        if (album || artist) return { album: album, artist: artist };

        if (list && typeof list.getValue === 'function') {
            if (typeof list.locked === 'function') {
                list.locked(function () {
                    track = list.getValue(0);
                });
            } else {
                track = list.getValue(0);
            }
        }

        if (!track) return null;

        var album = mbzPreviewText(track.album);
        var artist = mbzPreviewText(track.albumArtist || track.artist);
        return (album || artist) ? { album: album, artist: artist } : null;
    }

    function setSearch(url) {
        searchUrl = url || '';

        if (UI.searchRow) UI.searchRow.style.display = searchUrl ? '' : 'none';
        if (UI.searchStatus) {
            UI.searchStatus.textContent = searchUrl
                ? _('Search MusicBrainz for this album, then add its release ID.')
                : '';
        }
    }

    function showSearch() {
        var info = searchTerms(sourceList);

        if (info) {
            setSearch(mbzPreviewSearchUrl(info.album, info.artist));
            return;
        }

        // The dialog can open with albumId before the selected list is loaded.
        if (sourceList && typeof sourceList.whenLoaded === 'function') {
            window.localPromise(sourceList.whenLoaded()).then(function (list) {
                if (window._cleanUpCalled) return;

                var loaded = searchTerms(list || sourceList);
                if (loaded) setSearch(mbzPreviewSearchUrl(loaded.album, loaded.artist));
            }, function () {
                // No list means no search terms; the message above is enough.
            });
        }
    }

    function openSearch() {
        if (!searchUrl) return;

        if (window.uitools && typeof window.uitools.openWeb === 'function') {
            window.uitools.openWeb(searchUrl);
        } else {
            window.open(searchUrl, '_blank');
        }
    }

    /** A reused dialog must not keep the previous release's rows or sections. */
    function resetView() {
        metaPairs = [];
        if (UI.metaRows) UI.metaRows.textContent = '';
        if (UI.fieldRows) UI.fieldRows.textContent = '';
        if (UI.trackRows) UI.trackRows.textContent = '';
        if (UI.applyStatus) UI.applyStatus.textContent = '';

        if (UI.fields) UI.fields.classList.add('mbzHidden');
        if (UI.btnApply) UI.btnApply.classList.add('mbzHidden');
        if (UI.tracks) UI.tracks.classList.add('mbzHidden');
        if (UI.metaScroll) UI.metaScroll.classList.add('mbzHidden');
        else if (UI.meta) UI.meta.classList.add('mbzHidden');

        setWarning('');
        setSearch('');
    }

    function addMeta(label, value) {
        if (!value) return;
        metaPairs.push({ label: label, value: value });
    }

    function appendMetaPair(row, pair) {
        var th = document.createElement('th');
        th.textContent = pair.label;
        row.appendChild(th);

        var td = document.createElement('td');
        td.textContent = pair.value;
        row.appendChild(td);
    }

    function renderMeta() {
        if (!UI.metaRows) return;

        UI.metaRows.textContent = '';
        for (var i = 0; i < metaPairs.length; i += 2) {
            var row = document.createElement('tr');
            appendMetaPair(row, metaPairs[i]);
            if (metaPairs[i + 1]) appendMetaPair(row, metaPairs[i + 1]);
            UI.metaRows.appendChild(row);
        }
    }

    function addTrack(medium, track) {
        var recording = track.recording || {};
        var row = document.createElement('tr');

        row.appendChild(mbzPreviewCell(medium.position, 'mbzNowrap'));
        row.appendChild(mbzPreviewCell(track.number, 'mbzNowrap'));
        row.appendChild(mbzPreviewCell(track.title || recording.title));
        row.appendChild(mbzPreviewCell(mbzPreviewLength(track.length), 'mbzNowrap'));

        var isrcs = recording.isrcs || [];
        row.appendChild(mbzPreviewCell(isrcs.join(', ')));

        var guid = mbzPreviewCell(recording.id, 'mbzGuid');
        if (recording.id) guid.setAttribute('data-tip', recording.id);
        row.appendChild(guid);

        UI.trackRows.appendChild(row);
    }

    function renderSkipped(result) {
        if (result.reason === 'no-album') {
            setSummary(_('No album is selected, so there is nothing to look up.'));
            setSearch('');
        } else {
            setSummary(_('This album has no MusicBrainz release ID. Nothing was requested.'));
            setNote(_('Search MusicBrainz for this album, then add its release ID to the album. Loves MBz still does not query MusicBrainz by name.'));
            showSearch();
        }
    }

    function renderRelease(result) {
        var release = result.release || {};
        var trackTotal = 0;
        var media = release.media || [];

        setSearch('');

        for (var i = 0; i < media.length; i++) {
            trackTotal += (media[i].tracks || []).length;
        }

        setSummary(release.title || result.releaseId);

        addMeta(_('Artist'), mbzPreviewCredit(release));
        addMeta(_('Date'), mbzPreviewText(release.date));
        addMeta(_('Country'), mbzPreviewText(release.country));
        addMeta(_('Status'), mbzPreviewText(release.status));
        addMeta(_('Type'), mbzPreviewType(release));
        addMeta(_('Label'), mbzPreviewLabel(release));
        addMeta(_('Barcode'), mbzPreviewText(release.barcode));
        addMeta(_('Discogs'), fetch.discogsUrls(release).join(', '));
        addMeta(_('Script'), mbzPreviewScript(release));
        addMeta(_('Release ID'), result.releaseId);
        addMeta(_('Tracks'), trackTotal ? String(trackTotal) : '');
        renderMeta();

        for (var m = 0; m < media.length; m++) {
            var tracks = media[m].tracks || [];
            for (var t = 0; t < tracks.length; t++) {
                addTrack(media[m], tracks[t]);
            }
        }

        if (UI.metaScroll) UI.metaScroll.classList.remove('mbzHidden');
        else if (UI.meta) UI.meta.classList.remove('mbzHidden');
        if (UI.tracks) UI.tracks.classList.remove('mbzHidden');
    }

    function renderFields(plan) {
        UI.fieldRows.textContent = '';
        currentPlan = plan;

        var releaseTracks = plan ? plan.matches.length + plan.unmatched : 0;
        if (plan && plan.libraryCount > 0 && releaseTracks > 0 &&
            releaseTracks !== plan.libraryCount) {
            setWarning(sprintf(_('Warning: the MusicBrainz release has %d tracks, but this album has %d.'),
                releaseTracks, plan.libraryCount));
        } else {
            setWarning('');
        }

        if (!plan || !plan.fields.length) {
            UI.fields.classList.add('mbzHidden');
            if (UI.btnApply) UI.btnApply.classList.add('mbzHidden');

            if (plan && plan.libraryCount && !plan.matches.length) {
                setNote(_('No library tracks match this release by disc and track number, so there is nothing to write.'));
            } else if (plan) {
                setNote(_('MusicBrainz matches the library; there is nothing to apply.'));
            }
            return;
        }

        plan.fields.forEach(function (field) {
            var row = document.createElement('tr');

            var checkCell = document.createElement('td');
            checkCell.className = 'mbzNowrap';
            var box = document.createElement('div');
            box.setAttribute('data-control-class', 'Checkbox');
            box.setAttribute('data-id', 'mbzPreviewField' + field.key);
            box.setAttribute('data-key', field.key);
            checkCell.appendChild(box);
            row.appendChild(checkCell);

            if (typeof initializeControl === 'function') initializeControl(box);
            if (box.controlClass) {
                box.controlClass.checked = true;
                if (!canEdit) box.controlClass.disabled = true;
            }

            row.appendChild(mbzPreviewCell(field.label));
            row.appendChild(mbzPreviewCell(field.current || '\u2014'));
            row.appendChild(mbzPreviewCell(field.value || _('per track')));
            row.appendChild(mbzPreviewCell(field.changes + ' / ' + field.total, 'mbzNowrap'));

            UI.fieldRows.appendChild(row);
        });

        UI.fields.classList.remove('mbzHidden');
        if (UI.btnApply) UI.btnApply.classList.toggle('mbzHidden', !canEdit);

        var note = _('Ticked fields are written to the album\'s library tracks; nothing is written until Apply.');
        if (plan.unmatched) {
            note += ' ' + sprintf(_('%d release track(s) have no library counterpart and will be ignored.'), plan.unmatched);
        }
        setNote(note);
    }

    function loadPlan(result) {
        if (!apply) {
            setNote(_('The apply module did not load. Check debug.log for lines starting with "Loves MBz:".'));
            return;
        }

        window.localPromise(apply.buildPlanAsync(albumId, result.release)).then(function (plan) {
            if (window._cleanUpCalled) return;
            renderFields(plan);
        }, function (error) {
            if (window._cleanUpCalled) return;
            setNote(sprintf(_('Could not compare the release with the library: %s'), mbzPreviewErrorText(error)));
        });
    }

    function applySelected() {
        if (!canEdit || !currentPlan || !apply) return;

        var boxes = UI.fieldRows.querySelectorAll('[data-key]');
        var keys = [];

        for (var i = 0; i < boxes.length; i++) {
            var checked = boxes[i].controlClass
                ? boxes[i].controlClass.checked
                : boxes[i].checked;
            if (checked) keys.push(boxes[i].getAttribute('data-key'));
        }

        if (!keys.length) {
            setStatus(_('Tick at least one field to apply.'));
            return;
        }

        if (UI.btnApply) UI.btnApply.classList.add('mbzDisabled');
        setStatus(_('Writing...'));

        window.localPromise(apply.applyAsync(currentPlan, keys)).then(function (result) {
            if (window._cleanUpCalled) return;

            if (UI.btnApply) UI.btnApply.classList.remove('mbzDisabled');

            var message = sprintf(_('Updated %d track(s).'), result.tracks);
            if (result.failed.length) {
                message += ' ' + sprintf(_('%d track(s) failed: %s'),
                    result.failed.length, result.failed[0].error);
            }
            setStatus(message);

            // Re-read the library so the fields show what is left to change.
            if (lastResult) loadPlan(lastResult);
        }, function (error) {
            if (window._cleanUpCalled) return;

            if (UI.btnApply) UI.btnApply.classList.remove('mbzDisabled');
            setStatus(sprintf(_('Could not write: %s'), mbzPreviewErrorText(error)));
        });
    }

    resetView();

    if (UI.btnSearch) window.localListen(UI.btnSearch, 'click', openSearch);

    if (!fetch) {
        setSummary(_('The MusicBrainz fetch module did not load. Check debug.log for lines starting with "Loves MBz:".'));
        return;
    }

    if (albumId > 0) {
        startPreview();
    } else if (sourceList) {
        loadSelectedAlbum();
    } else {
        renderSkipped({ reason: 'no-album' });
    }

    /** Read the album from the loaded list copy, not from the still-loading list. */
    function albumIdFromList(list) {
        var track = null;

        try {
            track = list && list.firstSelected;
            if (track) return parseInt(track.idalbum, 10) || 0;
        } catch (e) {
            track = null;
        }

        try {
            var albumIds = list && list.getAllValues ? list.getAllValues('idalbum') : [];
            if (albumIds && albumIds.length) return parseInt(albumIds[0], 10) || 0;
        } catch (e) {
            // fall back to a locked read
        }

        var id = 0;
        function read() {
            var first = list && list.getValue ? list.getValue(0) : null;
            id = first ? parseInt(first.idalbum, 10) || 0 : 0;
        }

        if (list && typeof list.locked === 'function') list.locked(read);
        else read();
        return id;
    }

    function loadSelectedAlbum() {
        var loaded = null;
        try {
            if (typeof sourceList.whenLoaded === 'function') loaded = sourceList.whenLoaded();
        } catch (e) {
            loaded = null;
        }

        window.localPromise(loaded).then(function (loadedList) {
            if (window._cleanUpCalled) return;

            albumId = albumIdFromList(loadedList || sourceList);
            if (albumId > 0) startPreview();
            else renderSkipped({ reason: 'no-album' });
        }, function () {
            if (!window._cleanUpCalled) renderSkipped({ reason: 'no-album' });
        });
    }

    function startPreview() {
        window.localListen(UI.btnApply, 'click', applySelected);
        setSummary(_('Reading the release from MusicBrainz...'));

        window.localPromise(fetch.previewAsync(albumId)).then(function (result) {
            if (window._cleanUpCalled) return;

            if (result.skipped) {
                renderSkipped(result);
                return;
            }

            lastResult = result;
            renderRelease(result);
            loadPlan(result);
        }, function (error) {
            if (window._cleanUpCalled) return;

            setSummary(sprintf(_('Could not read the release: %s'), mbzPreviewErrorText(error)));
            setNote(_('The release ID is unchanged and nothing was written.'));
        });
    }
}
