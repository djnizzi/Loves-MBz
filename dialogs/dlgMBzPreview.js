'use strict';

/*
 * Loves MBz — read-only MusicBrainz release preview.
 *
 * Opens for one album and asks mbzFetch for its release. mbzFetch reads
 * Albums.MBGID first and makes no request at all when the album has no release
 * ID; this dialog only reports that outcome.
 *
 * Nothing here writes: the window ends at "this is what MusicBrainz says".
 * Tag writing is a separate, later step.
 */

localRequirejs('mbzFetch');

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
        text += mbzPreviewText(item.joinphrase);
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

function init(params) {
    var wnd = this;
    wnd.title = (params && params.title) ? params.title : _('MusicBrainz preview');
    wnd.resizeable = true;

    var albumId = (params && params.albumId) ? parseInt(params.albumId, 10) : 0;
    var fetch = window.mbzFetch;

    var UI = {
        summary: qid('summary'),
        meta: qid('meta'),
        metaRows: qid('metaRows'),
        tracks: qid('tracks'),
        trackRows: qid('trackRows'),
        note: qid('note')
    };

    function setSummary(text) {
        if (UI.summary) UI.summary.textContent = text;
    }

    function setNote(text) {
        if (UI.note) UI.note.textContent = text;
    }

    function addMeta(label, value) {
        if (!value) return;

        var row = document.createElement('tr');
        var th = document.createElement('th');
        th.textContent = label;

        var td = document.createElement('td');
        td.textContent = value;

        row.appendChild(th);
        row.appendChild(td);
        UI.metaRows.appendChild(row);
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
        } else {
            setSummary(_('This album has no MusicBrainz release ID. Nothing was requested.'));
            setNote(_('Add a release ID to the album first; Loves MBz never searches MusicBrainz by name.'));
        }
    }

    function renderRelease(result) {
        var release = result.release || {};
        var trackTotal = 0;
        var media = release.media || [];

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

        for (var m = 0; m < media.length; m++) {
            var tracks = media[m].tracks || [];
            for (var t = 0; t < tracks.length; t++) {
                addTrack(media[m], tracks[t]);
            }
        }

        if (UI.meta) UI.meta.classList.remove('mbzHidden');
        if (UI.tracks) UI.tracks.classList.remove('mbzHidden');
    }

    if (!fetch) {
        setSummary(_('The MusicBrainz fetch module did not load. Check debug.log for lines starting with "Loves MBz:".'));
        return;
    }

    if (!(albumId > 0)) {
        renderSkipped({ reason: 'no-album' });
        return;
    }

    setSummary(_('Reading the release from MusicBrainz...'));

    window.localPromise(fetch.previewAsync(albumId)).then(function (result) {
        if (window._cleanUpCalled) return;

        if (result.skipped) renderSkipped(result);
        else renderRelease(result);
    }, function (error) {
        if (window._cleanUpCalled) return;

        setSummary(sprintf(_('Could not read the release: %s'), mbzPreviewErrorText(error)));
        setNote(_('The release ID is unchanged and nothing was written.'));
    });
}
