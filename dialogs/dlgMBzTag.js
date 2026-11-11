'use strict';

/*
 * Loves MBz — Tag from MusicBrainz.
 *
 * One window does the whole job: it reads the release behind the selected
 * album's Albums.MBGID, compares it with the selection, and writes only what
 * the user ticks when Apply is pressed. MusicBrainz extended-tag editing lives
 * here too, ported from the old Track Properties tab.
 *
 * 0.5.0 contract: the add-on never writes inside MediaMonkey's dialogs. Every
 * write goes through mbzApply.applySelectionAsync — per track, native fields
 * first, then one merged ExtendedTags write, then commitAsync().
 */

localRequirejs('mbzFetch');
localRequirejs('mbzApply');
localRequirejs('mbzMbgid');

/*
 * The build this window belongs to, shown in the footer. Keep it equal to
 * info.json: tests/tag-path.test.js fails when the two disagree.
 */
var ADDON_VERSION = '0.5.1';

/* Filled in by tools/build-mmip.js; empty when the dialog runs from source. */
var BUILD_TIME = '2026-11-11 19:14';

var MBZ_TAG_ENTITY_LABELS = {
    release: _('release'),
    'release-group': _('release group'),
    artist: _('artist'),
    recording: _('recording'),
    track: _('track'),
    work: _('work'),
    label: _('label')
};

/* The MusicBrainz IDs that also live on the Albums and Artists rows. */
var MBZ_TAG_NATIVE_FIELDS = [
    { key: 'release', title: 'MUSICBRAINZ_ALBUMID', label: _('Release ID'), column: 'MBGID', nativeKey: 'releaseId' },
    { key: 'releaseGroup', title: 'MUSICBRAINZ_RELEASEGROUPID', label: _('Release group ID'), column: 'MBRGGID', nativeKey: 'releaseGroupId' },
    { key: 'artist', title: 'MUSICBRAINZ_ARTISTID', label: _('Artist ID') }
];

function mbzTagText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

/*
 * MediaMonkey's own dialogs never use a native <input> or <select>: those take
 * the browser's oversized generic styling, and no stylesheet can win against
 * it. `Edit` and `Dropdown` are the skinned controls, built from a plain div
 * and initialized by the host (their classes come from commonControls.js).
 */
function mbzTagControl(element) {
    if (!element) return null;

    if (!element.controlClass && typeof initializeControl === 'function') {
        try { initializeControl(element); } catch (e) { /* not a control root */ }
    }

    return element.controlClass || null;
}

function mbzTagFieldValue(element) {
    var control = mbzTagControl(element);
    if (control) return mbzTagText(control.value);
    return element ? mbzTagText(element.value) : '';
}

function mbzTagSetFieldValue(element, value) {
    var control = mbzTagControl(element);
    if (control) { control.value = value; return; }
    if (element) element.value = value;
}

function mbzTagErrorText(error) {
    if (!error) return '';
    return error.message ? error.message : String(error);
}

function mbzTagShortGuid(value) {
    var text = String(value || '');
    return text.length > 14 ? text.slice(0, 8) + '\u2026' : text;
}

function mbzTagEntityLabel(entity) {
    return MBZ_TAG_ENTITY_LABELS[entity] || entity;
}

function mbzTagLength(ms) {
    var total = parseInt(ms, 10);
    if (!(total > 0)) return '';

    var seconds = Math.round(total / 1000);
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;

    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
}

function mbzTagCell(value, className) {
    var td = document.createElement('td');
    td.textContent = mbzTagText(value);
    if (className) td.className = className;
    return td;
}

function mbzTagCredit(release) {
    var credit = (release && release['artist-credit']) ? release['artist-credit'] : [];
    var text = '';

    for (var i = 0; i < credit.length; i++) {
        var item = credit[i];
        if (!item) continue;
        text += mbzTagText(item.name || (item.artist && item.artist.name));
        text += item.joinphrase === undefined || item.joinphrase === null
            ? ''
            : String(item.joinphrase);
    }

    return text;
}

function mbzTagType(release) {
    var group = (release && release['release-group']) ? release['release-group'] : {};
    var types = [];

    if (group['primary-type']) types.push(group['primary-type']);

    var secondary = group['secondary-types'] || [];
    for (var i = 0; i < secondary.length; i++) {
        if (secondary[i]) types.push(secondary[i]);
    }

    return types.join(' + ');
}

function mbzTagScript(release) {
    var text = (release && release['text-representation']) ? release['text-representation'] : {};
    var parts = [];

    if (text.script) parts.push(text.script);
    if (text.language) parts.push(text.language);

    return parts.join(' / ');
}

function mbzTagLabel(release) {
    var info = (release && release['label-info']) ? release['label-info'] : [];
    var parts = [];

    for (var i = 0; i < info.length; i++) {
        var item = info[i] || {};
        var name = mbzTagText(item.label && item.label.name);
        var catalog = mbzTagText(item['catalog-number']);

        if (name && catalog) parts.push(name + ' (' + catalog + ')');
        else if (name) parts.push(name);
        else if (catalog) parts.push(catalog);
    }

    return parts.join(', ');
}

function mbzTagReleaseTrackCount(release) {
    var total = 0;
    var media = (release && release.media) || [];

    for (var i = 0; i < media.length; i++) {
        total += (media[i].tracks || []).length;
    }

    return total;
}

/** Escapes a value for the quoted Lucene phrase of the MusicBrainz search. */
function mbzTagSearchEscape(value) {
    var text = String(value === undefined || value === null ? '' : value);
    var slash = String.fromCharCode(92);
    return text.split(slash).join(slash + slash).split('"').join(slash + '"');
}

function mbzTagSearchUrl(album, artist) {
    var title = mbzTagText(album);
    var credit = mbzTagText(artist);
    var parts = [];

    credit = credit.split(';')[0].trim();

    if (title) parts.push('release:"' + mbzTagSearchEscape(title) + '"');
    if (credit) parts.push('artist:"' + mbzTagSearchEscape(credit) + '"');
    if (!parts.length) return '';

    return 'https://musicbrainz.org/search?query=' +
        encodeURIComponent(parts.join(' AND ')) +
        '&type=release&method=advanced';
}

/** MP3 keeps several artists in one ID3v2.3 frame joined with '/'. */
function mbzTagSeparatorForFile(path) {
    var text = String(path || '').toLowerCase();
    var dot = text.lastIndexOf('.');
    var ext = dot >= 0 ? text.slice(dot + 1) : '';
    return (ext === 'mp3') ? '/' : '; ';
}

/** Artist IDs are the tag names several rows legitimately share. */
function mbzTagAppendsToExisting(title) {
    var name = String(title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return name === 'MUSICBRAINZARTISTID' || name === 'MUSICBRAINZALBUMARTISTID';
}

function init(params) {
    var wnd = this;
    wnd.title = (params && params.title) ? params.title : _('Tag from MusicBrainz');
    wnd.resizeable = true;

    var apply = window.mbzApply;
    var fetch = window.mbzFetch;
    var mbz = window.mbzMbgid;

    var sourceList = (params && params.tracks) || null;
    var forced = !!(params && params.treatAsOneRelease);

    var UI = {
        summary: qid('summary'),
        warning: qid('warning'),
        searchRow: qid('searchRow'),
        btnSearch: qid('btnSearch'),
        searchStatus: qid('searchStatus'),
        linksBar: qid('linksBar'),
        metaScroll: qid('metaScroll'),
        scrollColumn: qid('scrollColumn'),
        meta: qid('meta'),
        metaRows: qid('metaRows'),
        albumIdRow: qid('albumIdRow'),
        albumIdValue: qid('albumIdValue'),
        btnSaveAlbumId: qid('btnSaveAlbumId'),
        albumIdStatus: qid('albumIdStatus'),
        fieldsSection: qid('fieldsSection'),
        fieldRows: qid('fieldRows'),
        trackSection: qid('trackSection'),
        trackRows: qid('trackRows'),
        tagSummary: qid('tagSummary'),
        tagTable: qid('tagTable'),
        tagRows: qid('tagRows'),
        tagEmpty: qid('tagEmpty'),
        tagStatus: qid('tagStatus'),
        suggestBar: qid('suggestBar'),
        divergeBar: qid('divergeBar'),
        addBar: qid('addBar'),
        addTag: qid('addTag'),
        addValue: qid('addValue'),
        addButton: qid('addButton'),
        btnApply: qid('btnApply'),
        buildStamp: qid('buildStamp'),
        applyStatus: qid('applyStatus'),
        note: qid('note')
    };

    var state = {
        scope: null,
        release: null,
        hasRelease: false,
        plan: null,
        rows: [],
        suggestions: [],
        tagsById: null,
        tagsUnreadable: false,
        lookup: null,
        natives: null,
        groupIds: [],
        groupNative: null,
        groupArtists: null,
        artists: [],
        albumTracks: 0,
        fileSeparator: '; ',
        addTagChoices: false,
        busy: false,
        readOnly: false
    };

    var searchUrl = '';
    var countToken = 0;

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
        if (UI.applyStatus) UI.applyStatus.textContent = text || '';
    }

    function setTagStatus(text) {
        if (UI.tagStatus) UI.tagStatus.textContent = text || '';
    }

    function show(element, visible) {
        if (!element) return;
        if (visible) element.classList.remove('mbzHidden');
        else element.classList.add('mbzHidden');
    }

    function resetView() {
        if (UI.metaRows) UI.metaRows.textContent = '';
        if (UI.fieldRows) UI.fieldRows.textContent = '';
        if (UI.trackRows) UI.trackRows.textContent = '';
        if (UI.tagRows) UI.tagRows.textContent = '';
        if (UI.divergeBar) UI.divergeBar.textContent = '';
        if (UI.suggestBar) UI.suggestBar.textContent = '';
        if (UI.linksBar) UI.linksBar.textContent = '';
        if (UI.albumIdStatus) UI.albumIdStatus.textContent = '';

        show(UI.linksBar, false);
        show(UI.albumIdRow, false);
        show(UI.metaScroll, false);
        show(UI.fieldsSection, false);
        show(UI.divergeBar, false);
        show(UI.suggestBar, false);
        show(UI.tagTable, true);
        show(UI.tagEmpty, false);

        fitScrollColumn();

        setStatus('');
        setTagStatus('');
        setWarning('');
        setTagSummary('');
        setSearch('');
    }

    /* ---------------------------------------------------------------- *
     * MusicBrainz web search for an album without a release ID
     * ---------------------------------------------------------------- */

    function setSearch(url) {
        searchUrl = url || '';
        if (UI.searchRow) UI.searchRow.style.display = searchUrl ? '' : 'none';
        if (UI.searchStatus) {
            UI.searchStatus.textContent = searchUrl
                ? _('Search MusicBrainz for this album, then add its release ID.')
                : '';
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

    function searchTerms() {
        var scope = state.scope;
        var track = scope && scope.tracks && scope.tracks[0];
        if (!track) return null;

        var album = mbzTagText(track.album);
        var artist = mbzTagText(track.albumArtist || track.artist);
        return (album || artist) ? { album: album, artist: artist } : null;
    }

    /* ---------------------------------------------------------------- *
     * MusicBrainz links for the album, its release group and its artist
     * ---------------------------------------------------------------- */

    /** A canonical MBID URL, or '' when the value is not a MusicBrainz ID. */
    function linkUrl(entity, id) {
        if (!mbz) return '';

        var value = mbzTagText(id);
        var guid = typeof mbz.normalizeGuid === 'function' ? mbz.normalizeGuid(value) : value;
        if (!guid) return '';

        return typeof mbz.musicBrainzUrl === 'function' ? mbz.musicBrainzUrl(entity, guid) : '';
    }

    /**
     * The three IDs the Track Properties tab linked: the release, its release
     * group and the album artist. They come from the fetched release, and from
     * the library rows when there is no release to read, so the links exist
     * even for an album whose release ID is missing.
     */
    function buildLinkEntries() {
        var entries = [];
        var release = state.release;

        function add(label, entity, id) {
            var url = linkUrl(entity, id);
            if (url) entries.push({ label: label, url: url });
        }

        var releaseId = release && release.id ? release.id : '';
        if (!releaseId && state.natives) releaseId = state.natives.releaseId;
        if (!releaseId && state.scope) releaseId = state.scope.releaseId;
        add(_('Release'), 'release', releaseId);

        var groupId = release && release['release-group'] ? release['release-group'].id : '';
        if (!groupId && state.natives) groupId = state.natives.releaseGroupId;
        add(_('Release group'), 'release-group', groupId);

        var artistIds = [];

        function addArtistId(id) {
            var value = mbzTagText(id);
            if (value && artistIds.indexOf(value) === -1) artistIds.push(value);
        }

        if (release) {
            (release['artist-credit'] || []).forEach(function (credit) {
                addArtistId(credit && credit.artist && credit.artist.id);
            });
        } else {
            (state.artists || []).forEach(function (artist) {
                addArtistId(artist && artist.mbgid);
            });
            ((state.groupNative && state.groupNative.artistGuids) || []).forEach(addArtistId);
        }

        artistIds.forEach(function (id) {
            add(release ? _('Album artist') : _('Artist'), 'artist', id);
        });

        return entries;
    }

    function renderLinks() {
        if (!UI.linksBar) return;

        UI.linksBar.textContent = '';

        var entries = buildLinkEntries();
        if (!entries.length) {
            show(UI.linksBar, false);
            return;
        }

        // The skin resets anchor margins inside this dialog, so the gap is real
        // whitespace: non-breaking spaces cannot be collapsed away or styled.
        function gap() {
            return document.createTextNode('\u00a0\u00a0\u00a0');
        }

        var label = document.createElement('label');
        label.className = 'mbzLabel';
        label.textContent = _('Open in MusicBrainz:');
        UI.linksBar.appendChild(label);
        UI.linksBar.appendChild(gap());

        entries.forEach(function (entry, index) {
            var link = document.createElement('a');
            // Same construction as the tag-row links: `hotlink` is the host's
            // own link class, so the skin colours these too.
            link.className = 'mbzTextLink hotlink';
            link.href = '#';
            link.setAttribute('data-url', entry.url);
            link.title = entry.url;
            link.textContent = entry.label + ' \u2197';
            UI.linksBar.appendChild(link);

            if (index < entries.length - 1) UI.linksBar.appendChild(gap());
        });

        show(UI.linksBar, true);
    }

    /**
     * The host sizes the dialog to its content, so a viewport-relative CSS cap
     * inside it resolves to the content height and limits nothing. Give the
     * column a real pixel height from the monitor instead, once the header and
     * footer are laid out.
     */
    function fitScrollColumn() {
        if (!UI.scrollColumn || !UI.scrollColumn.parentNode) return;

        var monitor = 0;
        try {
            monitor = (window.screen && (window.screen.availHeight || window.screen.height)) || 0;
        } catch (e) {
            monitor = 0;
        }

        var viewport = 0;
        try { viewport = window.innerHeight || 0; } catch (e) { viewport = 0; }

        var basis = monitor || viewport;
        if (!basis) return;

        var root = UI.scrollColumn.parentNode;

        var gap = 0;
        try {
            var style = window.getComputedStyle ? window.getComputedStyle(root) : null;
            gap = style ? (parseFloat(style.rowGap || style.gap) || 0) : 0;
        } catch (e) {
            gap = 0;
        }

        // Measure the blocks above and below the column; they are laid out
        // already and their heights do not depend on this column.
        var fixed = 0;
        var count = 0;

        for (var node = root.firstElementChild; node; node = node.nextElementSibling) {
            if (node === UI.scrollColumn || !node.offsetHeight) continue;
            fixed += node.offsetHeight;
            count++;
        }

        // The host sizes the dialog to its content, so `innerHeight` and the
        // root's own height grow with this column: measuring either turns the
        // fit into a no-op, which is why the column stayed short. Size it from
        // the monitor instead, keeping room for the surrounding blocks and a
        // margin so the whole window still fits the screen.
        var available = basis - fixed - gap * (count + 1) - 120;
        var height = Math.min(Math.round(basis * 0.68), available);
        height = Math.max(360, height);

        UI.scrollColumn.style.height = height + 'px';
        UI.scrollColumn.style.maxHeight = height + 'px';
        UI.scrollColumn.style.minHeight = height + 'px';
        UI.scrollColumn.style.overflowY = 'auto';
    }

    /* ---------------------------------------------------------------- *
     * Release overview and the release track listing
     * ---------------------------------------------------------------- */

    var metaPairs = [];

    function addMeta(label, value) {
        if (!value) return;
        metaPairs.push({ label: label, value: value });
    }

    function appendMetaPair(row, pair) {
        var th = document.createElement('th');
        th.textContent = pair.label;
        // The skin centres `th` on its own; an inline important beats it.
        if (th.style && th.style.setProperty) th.style.setProperty('text-align', 'left', 'important');
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

        show(UI.metaScroll, !!metaPairs.length);
    }

    function renderRelease(result) {
        var release = (result && result.release) || {};

        metaPairs = [];
        setSearch('');

        addMeta(_('Artist'), mbzTagCredit(release));
        addMeta(_('Date'), mbzTagText(release.date));
        addMeta(_('Country'), mbzTagText(release.country));
        addMeta(_('Status'), mbzTagText(release.status));
        addMeta(_('Type'), mbzTagType(release));
        addMeta(_('Label'), mbzTagLabel(release));
        addMeta(_('Barcode'), mbzTagText(release.barcode));
        addMeta(_('Discogs'), fetch && fetch.discogsUrls ? fetch.discogsUrls(release).join(', ') : '');
        addMeta(_('Script'), mbzTagScript(release));
        addMeta(_('Release ID'), result.releaseId);
        addMeta(_('Tracks'), String(mbzTagReleaseTrackCount(release) || ''));
        renderMeta();

        setSummary(release.title || result.releaseId || '');
        renderLinks();
        fitScrollColumn();
    }

    function renderSkipped(result) {
        var reason = (result && result.reason) || 'no-album';

        if (reason === 'no-album') {
            setSummary(_('This selection has no album, so there is no release to look up.'));
            setSearch('');
            return;
        }

        setSummary(_('This album has no MusicBrainz release ID. Nothing was requested.'));
        var info = searchTerms();
        if (info) setSearch(mbzTagSearchUrl(info.album, info.artist));
        setNote(_('Search MusicBrainz for this album, then add its release ID to the album. Tag from MusicBrainz still does not query MusicBrainz by name.'));
    }

    /* ---------------------------------------------------------------- *
     * The album's release ID
     * ---------------------------------------------------------------- */

    /** The release ID the album currently points at, fetched or stored. */
    function currentAlbumReleaseId() {
        if (state.release && state.release.id) return mbzTagText(state.release.id);
        if (state.natives && state.natives.releaseId) return mbzTagText(state.natives.releaseId);

        var scope = state.scope;
        if (!scope) return '';
        return mbzTagText(scope.releaseIds ? scope.releaseIds[scope.albumId] : '');
    }

    function setAlbumIdStatus(text) {
        if (UI.albumIdStatus) UI.albumIdStatus.textContent = text || '';
    }

    /**
     * The field is the lookup key, so it is only offered when there is one
     * album behind the window and the add-on may write.
     */
    function syncAlbumIdInput() {
        var editable = !state.readOnly && !!(state.scope && state.scope.albumId > 0);
        show(UI.albumIdRow, editable);

        if (!editable) return;

        mbzTagSetFieldValue(UI.albumIdValue, currentAlbumReleaseId());
        if (UI.btnSaveAlbumId) UI.btnSaveAlbumId.classList.toggle('mbzDisabled', state.busy);
    }

    function albumName() {
        var track = state.scope && state.scope.tracks ? state.scope.tracks[0] : null;
        return mbzTagText(track && track.album) || _('this album');
    }

    /**
     * Writes Albums.MBGID through mbzMbgid, never through the apply path: this
     * is a library row, not a tag on the selected tracks. The release behind the
     * new ID is then loaded instead of the old one's.
     */
    function saveAlbumId() {
        if (state.readOnly || !mbz || !state.scope || !(state.scope.albumId > 0)) return;

        var raw = mbzTagFieldValue(UI.albumIdValue);
        var value = raw ? mbz.normalizeGuid(raw) : '';
        var current = currentAlbumReleaseId();

        if (raw && !value) {
            setAlbumIdStatus(_('That is not a valid MusicBrainz release ID.'));
            return;
        }

        if (value === current) {
            setAlbumIdStatus(_('The album already has that release ID.'));
            return;
        }

        var albumId = state.scope.albumId;

        function write() {
            setAlbumIdStatus(_('Updating the album...'));

            window.localPromise(mbz.setAlbumGuidAsync(albumId, 'MBGID', value || '')).then(function () {
                if (window._cleanUpCalled) return null;

                if (state.scope) {
                    if (state.scope.releaseIds) state.scope.releaseIds[albumId] = value || '';
                    state.scope.releaseId = value || '';
                }
                if (state.natives) state.natives.releaseId = value || '';

                setAlbumIdStatus(value
                    ? sprintf(_('The album release ID is now %s.'), value)
                    : _('The album release ID was cleared.'));

                // A different release is the one to show now (or none at all).
                return window.localPromise(reloadAsync());
            }, function (error) {
                if (window._cleanUpCalled) return;
                setAlbumIdStatus(sprintf(_('Could not update the album: %s'), mbzTagErrorText(error)));
            });
        }

        // Filling an empty field overwrites nothing, so it needs no prompt.
        if (!current) {
            write();
            return;
        }

        window.localPromise(mbz.countAlbumTracksAsync(albumId)).then(function (count) {
            if (window._cleanUpCalled) return;

            var message = _('Change the release ID of this album?')
                + '<br><br>' + sprintf(_('Album \u201c%s\u201d (%s) will point at <b>%s</b>.'),
                    albumName(), trackCountText(count), value || _('(no release ID)'))
                + '<br>' + _('Every track of that album uses this ID for lookup and matching. MediaMonkey\'s own MusicBrainz lookup can overwrite it the next time it re-matches.');

            if (typeof messageDlg !== 'function') {
                write();
                return;
            }

            messageDlg(message, 'Confirmation', ['btnYes', 'btnNo'],
                { defaultButton: 'btnNo', title: _('Loves MBz') },
                function (result) {
                    if (!result || result.btnID !== 'btnYes' || window._cleanUpCalled) return;
                    write();
                });
        }, function (error) {
            if (window._cleanUpCalled) return;
            setAlbumIdStatus(sprintf(
                _('Could not check how many tracks the change covers: %s'), mbzTagErrorText(error)));
        });
    }

    function onAlbumIdKey(event) {
        if (!event || (event.key !== 'Enter' && event.keyCode !== 13)) return;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        saveAlbumId();
    }

    /* ---------------------------------------------------------------- *
     * Fields to write
     * ---------------------------------------------------------------- */

    function renderFields(plan) {
        if (!UI.fieldRows) return;

        UI.fieldRows.textContent = '';

        var fields = (plan && plan.fields) || [];
        if (!fields.length) {
            show(UI.fieldsSection, false);
            return;
        }

        fields.forEach(function (field) {
            var row = document.createElement('tr');

            var checkCell = document.createElement('td');
            checkCell.className = 'mbzNowrap';

            var box = document.createElement('div');
            box.setAttribute('data-control-class', 'Checkbox');
            box.setAttribute('data-id', 'mbzTagField' + field.key);
            box.setAttribute('data-key', field.key);
            checkCell.appendChild(box);
            row.appendChild(checkCell);

            row.appendChild(mbzTagCell(field.label));
            row.appendChild(mbzTagCell(field.currentText || '\u2014'));
            row.appendChild(mbzTagCell(field.perTrack ? _('per track') : field.value, field.perTrack ? 'mbzNote' : ''));
            row.appendChild(mbzTagCell(field.changes + ' / ' + field.total, 'mbzNowrap'));

            UI.fieldRows.appendChild(row);

            if (typeof initializeControl === 'function') initializeControl(box);
            if (box.controlClass) {
                box.controlClass.checked = true;
                if (state.readOnly) box.controlClass.disabled = true;
            }
        });

        show(UI.fieldsSection, true);
    }

    function checkedKeys() {
        var keys = [];
        if (!UI.fieldRows) return keys;

        var boxes = UI.fieldRows.querySelectorAll('[data-key]');
        for (var i = 0; i < boxes.length; i++) {
            var checked = boxes[i].controlClass
                ? boxes[i].controlClass.checked
                : boxes[i].checked;
            if (checked) keys.push(boxes[i].getAttribute('data-key'));
        }

        return keys;
    }

    /* ---------------------------------------------------------------- *
     * Selected tracks
     * ---------------------------------------------------------------- */

    function renderTracks(plan) {
        if (!UI.trackRows) return;

        UI.trackRows.textContent = '';

        var entries = (plan && plan.entries) || [];
        if (!state.hasRelease || !entries.length) {
            show(UI.trackSection, false);
            return;
        }

        entries.forEach(function (entry) {
            var release = entry.pending && entry.pending.release;
            var row = document.createElement('tr');

            if (entry.changed) row.className = 'mbzChanged';

            row.appendChild(mbzTagCell(String(entry.disc || (release && release.disc) || ''), 'mbzNowrap'));
            row.appendChild(mbzTagCell(String(entry.number || ''), 'mbzNowrap'));
            row.appendChild(mbzTagCell(entry.title));
            row.appendChild(mbzTagCell(release ? release.title : '\u2014'));
            row.appendChild(mbzTagCell(release ? mbzTagLength(release.length) : '', 'mbzNowrap'));
            row.appendChild(mbzTagCell(release ? release.isrc : ''));

            var guid = mbzTagCell(release ? release.recordingId : '', 'mbzGuid');
            if (release && release.recordingId) guid.setAttribute('data-tip', release.recordingId);
            row.appendChild(guid);

            row.appendChild(mbzTagCell(
                entry.changed ? String(entry.changes)
                    : (entry.matched ? '' : sprintf(_('no match (disc %s, track %s)'),
                        entry.disc || '?', entry.number || '?')),
                'mbzNowrap'));

            UI.trackRows.appendChild(row);
        });

        show(UI.trackSection, true);
    }

    function renderWarnings(plan) {
        var parts = [];

        if (state.scope && state.scope.multiAlbum) {
            parts.push(sprintf(_('This selection spans %d albums and is treated as one release.'),
                state.scope.albumIds.length));
        }

        var releaseTracks = plan && plan.release ? plan.release.trackCount : 0;
        if (state.albumTracks > 0 && releaseTracks > 0 && state.albumTracks !== releaseTracks) {
            parts.push(sprintf(_('The MusicBrainz release has %d tracks, but this album has %d.'),
                releaseTracks, state.albumTracks));
        }

        var byNumber = 0;
        ((plan && plan.entries) || []).forEach(function (entry) {
            if (entry.matched && entry.pending && entry.pending.matchedByNumberOnly) byNumber++;
        });
        if (byNumber) parts.push(sprintf(_('%d track(s) matched by track number only.'), byNumber));

        setWarning(parts.join(' '));
    }

    /* ---------------------------------------------------------------- *
     * MusicBrainz tag table
     * ---------------------------------------------------------------- */

    function isMusicBrainzTag(title) {
        return !!mbz && typeof mbz.isMusicBrainzExtendedTag === 'function' &&
            mbz.isMusicBrainzExtendedTag(title);
    }

    function buildRows(lists, trackCount) {
        var rows = [];
        if (!mbz) return rows;

        if (trackCount <= 1) {
            var counts = {};

            (lists[0] || []).forEach(function (tag) {
                if (!tag || !isMusicBrainzTag(tag.title)) return;

                var title = String(tag.title || '');
                var occurrence = counts[title] || 0;
                counts[title] = occurrence + 1;

                rows.push({
                    title: title,
                    occurrence: occurrence,
                    originalValue: mbzTagText(tag.value),
                    trackCount: 1,
                    presentCount: 1,
                    missingCount: 0,
                    isNew: false,
                    info: mbz.musicBrainzTagInfo(title),
                    input: null,
                    linkCell: null,
                    parts: null,
                    partsSeparator: ''
                });
            });

            return rows;
        }

        mbz.commonExtendedTags(lists).forEach(function (tag) {
            rows.push({
                title: tag.title,
                occurrence: 0,
                originalValue: mbzTagText(tag.value),
                trackCount: tag.trackCount || trackCount,
                presentCount: tag.presentCount || 0,
                missingCount: tag.missingCount || 0,
                isNew: false,
                info: mbz.musicBrainzTagInfo(tag.title),
                input: null,
                linkCell: null,
                parts: null,
                partsSeparator: ''
            });
        });

        return rows;
    }

    /** A stored ID tag can hold several IDs in one value; show one row per ID. */
    function splitValue(title, value) {
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

    function rowValue(row) {
        if (!row) return '';

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

    /**
     * What is written for a row. A value made only of valid IDs is stored in
     * the shape the file already uses, so an ID3v2.3 multi-artist value keeps
     * its '/'.
     */
    function valueForSave(row) {
        var value = rowValue(row);
        if (!row.info || !row.info.entity) return value;

        var parsed = mbz.extendedTagGuids(value);
        if (parsed.ids.length && !parsed.invalid.length) {
            var separator = parsed.ids.length > 1 && typeof mbz.extendedTagSeparator === 'function'
                ? mbz.extendedTagSeparator(row.originalValue)
                : '; ';
            return parsed.ids.join(separator);
        }

        return value;
    }

    function renderLinkCell(input, linkCell, info) {
        if (!mbz || !linkCell || !input) return;

        var isIdTag = !!(info && info.entity);
        var parsed = isIdTag ? mbz.extendedTagGuids(input.value) : { ids: [], invalid: [] };
        var invalid = parsed.invalid.length > 0;

        if (input.classList) {
            if (invalid) input.classList.add('mbzInvalid');
            else input.classList.remove('mbzInvalid');
        }

        linkCell.textContent = '';

        if (isIdTag) {
            var many = parsed.ids.length > 1;

            parsed.ids.forEach(function (guid, index) {
                var url = mbz.musicBrainzUrl(info.entity, guid);
                if (!url) return;

                if (many && index > 0) linkCell.appendChild(document.createElement('br'));

                var link = document.createElement('a');
                link.href = '#';
                link.className = 'hotlink mbzLinks';
                link.setAttribute('data-url', url);
                link.title = url;
                link.textContent = many
                    ? mbzTagShortGuid(guid) + ' \u2197'
                    : mbzTagEntityLabel(info.entity) + ' \u2197';
                linkCell.appendChild(link);
            });
        }

        if (invalid && input.value.trim()) {
            var warning = document.createElement('span');
            warning.className = 'mbzWarning';
            warning.textContent = _('Not a valid MusicBrainz ID');
            warning.title = parsed.invalid.join(', ');
            linkCell.appendChild(warning);
        }
    }

    function renderTagRows() {
        if (!UI.tagRows) return;

        UI.tagRows.textContent = '';

        state.rows.forEach(function (row, index) {
            var sourceValue = row.pendingValue !== undefined ? row.pendingValue : row.originalValue;
            var split = splitValue(row.title, sourceValue);
            var partCount = split ? split.ids.length : 1;

            row.parts = split ? [] : null;
            row.partsSeparator = split ? split.separator : '';
            row.input = null;
            row.linkCell = null;

            for (var part = 0; part < partCount; part++) {
                var first = part === 0;
                var tr = document.createElement('tr');
                if (first && row.isNew) tr.className = 'mbzNew';

                var nameCell = document.createElement('td');
                nameCell.className = 'mbzNowrap';

                if (first) {
                    var title = document.createElement('div');
                    title.textContent = row.title;
                    nameCell.appendChild(title);

                    var notes = [];
                    if (row.isNew) notes.push(_('(not saved yet)'));
                    if (!row.isNew && row.missingCount > 0) {
                        notes.push(sprintf(_('on %d of %d tracks'), row.presentCount, row.trackCount));
                    }

                    if (notes.length) {
                        var label = document.createElement('div');
                        label.className = 'mbzLabel';
                        label.textContent = notes.join(' ');
                        nameCell.appendChild(label);
                    }
                }

                tr.appendChild(nameCell);

                var valueCell = document.createElement('td');
                var input = document.createElement('input');
                input.type = 'text';
                input.className = 'mbzValue';
                input.value = split
                    ? split.ids[part]
                    : String(sourceValue === undefined || sourceValue === null ? '' : sourceValue);
                input.spellcheck = false;
                input.autocomplete = 'off';
                input.disabled = state.readOnly;
                input.setAttribute('data-row', String(index));
                if (partCount > 1) input.setAttribute('data-part', String(part));
                valueCell.appendChild(input);
                tr.appendChild(valueCell);

                var linkCell = document.createElement('td');
                linkCell.className = 'mbzLinks';
                renderLinkCell(input, linkCell, row.info);
                tr.appendChild(linkCell);

                if (split) row.parts.push({ input: input, linkCell: linkCell });

                if (first) {
                    row.input = input;
                    row.linkCell = linkCell;
                }

                UI.tagRows.appendChild(tr);
            }
        });
    }

    function setTagSummary() {
        if (!UI.tagSummary) return;

        var count = state.rows.length;
        var tracks = state.scope ? state.scope.songIds.length : 0;

        if (!count) {
            UI.tagSummary.textContent = '';
            return;
        }

        if (tracks > 1) {
            var text = count === 1
                ? sprintf(_('1 MusicBrainz tag for all %d selected tracks.'), tracks)
                : sprintf(_('%d MusicBrainz tags for all %d selected tracks.'), count, tracks);

            var partial = 0;
            state.rows.forEach(function (row) {
                if (row.missingCount > 0) partial++;
            });

            if (partial) {
                text += ' ' + (partial === 1
                    ? _('1 of them is missing on some selected tracks.')
                    : sprintf(_('%d of them are missing on some selected tracks.'), partial));
            }

            UI.tagSummary.textContent = text;
            return;
        }

        UI.tagSummary.textContent = count === 1
            ? _('1 MusicBrainz extended tag.')
            : sprintf(_('%d MusicBrainz extended tags.'), count);
    }

    function emptyTagText() {
        if (state.tagsUnreadable) {
            return _('The extended tags of at least one selected track could not be read as JSON.');
        }

        if (state.scope && state.scope.songIds.length > 1) {
            return sprintf(_('No MusicBrainz extended tags are shared by all %d selected tracks. Add one below to set it on every selected track.'),
                state.scope.songIds.length);
        }

        return _('This track has no MusicBrainz extended tags. Add one below. The release, release-group and artist IDs live on the album and artist rows, not in ExtendedTags.');
    }

    function renderTagTable() {
        if (!UI.tagRows) return;

        renderTagRows();
        setTagSummary();

        var empty = !state.rows.length;
        show(UI.tagTable, !empty);
        show(UI.tagEmpty, empty);
        if (empty && UI.tagEmpty) UI.tagEmpty.textContent = emptyTagText();

        renderSuggestions();
    }

    function hasTagChanges() {
        for (var i = 0; i < state.rows.length; i++) {
            var row = state.rows[i];
            var value = rowValue(row);

            if (row.isNew) {
                if (mbzTagText(value)) return true;
                continue;
            }

            if (value !== row.originalValue) return true;
        }

        return false;
    }

    function updateTagStatus() {
        setTagStatus(hasTagChanges()
            ? _('Tag changes are written when you press Apply.')
            : '');
    }

    function collectEdits() {
        var edits = [];

        state.rows.forEach(function (row) {
            if (!row.input) return;

            var value = valueForSave(row);

            if (row.isNew) {
                // A cleared pending row is a cancelled add, not a deletion.
                if (!mbzTagText(value)) return;
                edits.push({ title: row.title, add: true, value: value });
                return;
            }

            if (value === row.originalValue) return;
            edits.push({ title: row.title, occurrence: row.occurrence, value: value });
        });

        return edits;
    }

    function tagPresent(title) {
        if (!mbz) return false;

        for (var i = 0; i < state.rows.length; i++) {
            if (mbzApplyTagMatches(state.rows[i].title, title)) return true;
        }

        return false;
    }

    function mbzApplyTagMatches(name, wanted) {
        if (apply && typeof apply.tagNameMatches === 'function') return apply.tagNameMatches(name, wanted);
        return !!mbz && mbz.normalizeExtendedTagName(name) === mbz.normalizeExtendedTagName(wanted);
    }

    /* ---------------------------------------------------------------- *
     * Suggestions from the library
     * ---------------------------------------------------------------- */

    function renderSuggestions() {
        if (!UI.suggestBar) return;

        UI.suggestBar.textContent = '';

        var items = (state.suggestions || []).filter(function (item) {
            return item && item.value && !tagPresent(item.title);
        });

        if (state.readOnly || !mbz || !items.length) {
            show(UI.suggestBar, false);
            return;
        }

        var label = document.createElement('label');
        label.className = 'mbzLabel';
        label.textContent = _('From the library:');
        UI.suggestBar.appendChild(label);

        items.forEach(function (item) {
            var chip = document.createElement('div');
            chip.className = 'button mbzChip';
            chip.setAttribute('data-title', item.title);
            chip.setAttribute('data-value', item.value);
            chip.title = item.title + ' = ' + item.value;
            chip.textContent = (item.info ? _(item.info.label) : item.title) + ' ' + mbzTagShortGuid(item.value);
            UI.suggestBar.appendChild(chip);
        });

        show(UI.suggestBar, true);
    }

    function addTagRow(title, value) {
        if (!mbz || state.readOnly || !title || !value) return false;

        var target = null;
        state.rows.forEach(function (row) {
            if (!target && mbzApplyTagMatches(row.title, title)) target = row;
        });

        // Several artists share one MusicBrainz tag name, so adding another one
        // appends to that tag instead of creating a second entry with the same
        // name. Existing IDs keep their order and the new one goes last.
        if (target && mbzTagAppendsToExisting(title)) {
            var current = rowValue(target);
            var parsedCurrent = mbz.extendedTagGuids(current);
            var parsedAdd = mbz.extendedTagGuids(value);
            var raw = String(target.originalValue || '');
            var separator = target.partsSeparator ||
                (/[;,\/]/.test(raw) ? mbz.extendedTagSeparator(raw) : (state.fileSeparator || '; '));

            var ids = parsedCurrent.ids.slice();
            var added = 0;

            parsedAdd.ids.forEach(function (id) {
                if (ids.indexOf(id) < 0) {
                    ids.push(id);
                    added++;
                }
            });

            if (!added && !parsedAdd.invalid.length) {
                setTagStatus(_('That ID is already in the tag.'));
                return false;
            }

            // Invalid text in either value is kept verbatim, so appending never
            // silently drops a part of the tag.
            target.pendingValue = (parsedCurrent.invalid.length || parsedAdd.invalid.length)
                ? current + (current ? separator : '') + value
                : ids.join(separator);

            renderTagTable();
            updateTagStatus();
            renderDivergence();
            return true;
        }

        // An existing entry may use another file-format spelling. Update that
        // entry and keep its raw title instead of adding a duplicate alias.
        if (target) {
            if (rowValue(target) === value) {
                setTagStatus(_('That tag and value are already listed.'));
                return false;
            }

            target.pendingValue = value;
            renderTagTable();
            updateTagStatus();
            renderDivergence();
            return true;
        }

        state.rows.push({
            title: title,
            occurrence: 0,
            originalValue: '',
            pendingValue: value,
            isNew: true,
            trackCount: state.scope ? state.scope.songIds.length : 1,
            presentCount: state.scope ? state.scope.songIds.length : 1,
            missingCount: 0,
            info: mbz.musicBrainzTagInfo(title),
            input: null,
            linkCell: null,
            parts: null,
            partsSeparator: ''
        });

        renderTagTable();
        updateTagStatus();
        renderDivergence();
        return true;
    }

    function addPending() {
        if (state.readOnly || !mbz) return;

        var title = mbzTagFieldValue(UI.addTag);
        var value = mbzTagFieldValue(UI.addValue);

        if (!title) {
            setTagStatus(_('Choose a MusicBrainz tag to add.'));
            return;
        }

        if (!value) {
            setTagStatus(_('Enter a value for the tag you want to add.'));
            return;
        }

        if (addTagRow(title, value)) mbzTagSetFieldValue(UI.addValue, '');
    }

    function populateAddChoices() {
        if (!UI.addTag || !mbz || typeof mbz.musicBrainzTagChoices !== 'function') return;
        if (state.addTagChoices || typeof newStringList !== 'function') return;

        var control = mbzTagControl(UI.addTag);
        if (!control) return;

        var list = newStringList();
        var first = '';

        mbz.musicBrainzTagChoices().forEach(function (choice) {
            if (!first) first = choice.name;
            list.add(choice.name);
        });

        state.addTagChoices = true;
        control.dataSource = list;
        if (first) control.value = first;
    }

    /* ---------------------------------------------------------------- *
     * Tag vs library divergence
     * ---------------------------------------------------------------- */

    function rowForTag(title) {
        if (!mbz) return null;

        var name = mbz.normalizeExtendedTagName(title);
        var found = null;

        for (var i = 0; i < state.rows.length; i++) {
            if (mbz.normalizeExtendedTagName(state.rows[i].title) !== name) continue;
            if (found) return null;
            found = state.rows[i];
        }

        return found;
    }

    /** A single valid MBID, or '' for empty, invalid or multi-ID values. */
    function singleGuid(value) {
        if (!mbz || typeof mbz.extendedTagGuids !== 'function') return '';

        var parsed = mbz.extendedTagGuids(value);
        if (parsed.invalid.length || parsed.ids.length !== 1) return '';
        return parsed.ids[0];
    }

    function distinctValues(list) {
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
     * belong to, the distinct values those rows hold, and the artist row when
     * every track has exactly one.
     */
    function groupNativeFrom(ids, map, artistsMap) {
        var native = {
            trackCount: ids.length,
            albumIds: [],
            albumNames: {},
            releaseIds: [],
            releaseGroupIds: [],
            artistIds: [],
            artistGuids: [],
            artistNames: {}
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

        native.releaseIds = distinctValues(releaseValues);
        native.releaseGroupIds = distinctValues(groupValues);

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

    function singleConflicts() {
        var native = state.natives;
        if (!native) return [];

        var conflicts = [];

        MBZ_TAG_NATIVE_FIELDS.forEach(function (field) {
            var row = rowForTag(field.title);
            if (!row) return;

            var tagId = singleGuid(rowValue(row));
            if (!tagId) return;

            var isArtist = field.key === 'artist';
            if (isArtist && state.artists.length !== 1) return;

            var nativeValue = isArtist
                ? mbzTagText(state.artists[0].mbgid)
                : mbzTagText(native[field.nativeKey]);

            if (nativeValue === tagId) return;

            conflicts.push({
                key: field.key,
                label: field.label,
                column: field.column,
                tagValue: tagId,
                nativeValue: nativeValue,
                row: row,
                albumIds: isArtist ? [] : (native.albumId > 0 ? [native.albumId] : []),
                artistIds: isArtist ? [state.artists[0].id] : [],
                albumName: isArtist ? '' : String(native.album || ''),
                artistName: isArtist ? String(state.artists[0].name || '') : ''
            });
        });

        return conflicts;
    }

    function groupConflicts() {
        var native = state.groupNative;
        if (!native) return [];

        var conflicts = [];

        MBZ_TAG_NATIVE_FIELDS.forEach(function (field) {
            var row = rowForTag(field.title);
            if (!row) return;

            var tagId = singleGuid(rowValue(row));
            if (!tagId) return;

            var isArtist = field.key === 'artist';
            var values = isArtist ? native.artistGuids : native[field.nativeKey + 's'];

            // The albums or artists of the selection have to agree on a value;
            // otherwise there is nothing to compare the shared tag with.
            if (!values || values.length !== 1) return;

            var nativeValue = String(values[0] || '');
            if (nativeValue === tagId) return;

            conflicts.push({
                key: field.key,
                label: field.label,
                column: field.column,
                tagValue: tagId,
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

    function conflicts() {
        var tracks = state.scope ? state.scope.tracks.length : 0;
        return tracks > 1 ? groupConflicts() : singleConflicts();
    }

    /** The tag and library release IDs can name editions with different counts. */
    function loadReleaseCounts(list) {
        var conflict = null;

        (list || []).forEach(function (item) {
            if (item.key === 'release' && item.tagValue && item.nativeValue) conflict = item;
        });

        if (!conflict || !fetch || typeof fetch.fetchReleaseAsync !== 'function') return;

        var token = ++countToken;

        window.localPromise(Promise.all([
            fetch.fetchReleaseAsync(conflict.nativeValue),
            fetch.fetchReleaseAsync(conflict.tagValue)
        ])).then(function (releases) {
            if (window._cleanUpCalled || token !== countToken || !conflict.countLabel) return;

            var libraryCount = mbzTagReleaseTrackCount(releases[0]);
            var tagCount = mbzTagReleaseTrackCount(releases[1]);

            if (!(libraryCount > 0) || !(tagCount > 0) || libraryCount === tagCount) return;

            conflict.countLabel.textContent = sprintf(
                _('The tag release has %d tracks; the library release has %d.'),
                tagCount, libraryCount);
            conflict.countLabel.title =
                'Tag: ' + conflict.tagValue + ' / library: ' + conflict.nativeValue;
            conflict.countLabel.style.display = '';
        }, function () {
            // A stale or invalid tag ID must not break the strip.
        });
    }

    function renderDivergence() {
        if (!UI.divergeBar) return;

        UI.divergeBar.textContent = '';

        var list = conflicts();
        if (!list.length) {
            show(UI.divergeBar, false);
            return;
        }

        var head = document.createElement('label');
        head.className = 'mbzLabel';
        head.textContent = _('The library ID and the tag disagree:');
        UI.divergeBar.appendChild(head);

        list.forEach(function (conflict) {
            var item = document.createElement('div');
            item.className = 'flex row mbzDivergeItem';

            var text = document.createElement('label');
            text.className = 'mbzDivergeText';
            text.textContent = sprintf(_('%s \u2014 library %s, tag %s'),
                conflict.label,
                conflict.nativeValue ? mbzTagShortGuid(conflict.nativeValue) : _('(empty)'),
                mbzTagShortGuid(conflict.tagValue));
            text.title = conflict.label + ': ' + (conflict.nativeValue || '(empty)') +
                ' / ' + conflict.tagValue;
            item.appendChild(text);

            var targetCount = (conflict.albumIds || []).length + (conflict.artistIds || []).length;
            var canWrite = targetCount === 1;

            // Copying the library value into the tag needs no target, only a
            // value to copy; writing the tag back needs exactly one row.
            if (!state.readOnly && conflict.nativeValue) {
                var useNative = document.createElement('div');
                useNative.className = 'button';
                useNative.setAttribute('data-diverge', 'tag');
                useNative.setAttribute('data-key', conflict.key);
                useNative.textContent = _('Use library ID');
                useNative.title = _('Put the library ID into the tag. Press Apply to save it.');
                item.appendChild(useNative);
            }

            if (!state.readOnly && canWrite) {
                var useTag = document.createElement('div');
                useTag.className = 'button';
                useTag.setAttribute('data-diverge', 'library');
                useTag.setAttribute('data-key', conflict.key);
                useTag.textContent = _('Update library');
                useTag.title = _('Write the ID stored in the tag into the album or artist row.');
                item.appendChild(useTag);
            }

            if (!state.readOnly && targetCount > 1) {
                var note = document.createElement('label');
                note.className = 'mbzLabel';
                note.textContent = _('Select tracks from one album or artist to update the library.');
                item.appendChild(note);
            }

            if (conflict.key === 'release') {
                var countLabel = document.createElement('label');
                countLabel.className = 'mbzLabel';
                countLabel.setAttribute('data-release-count', conflict.key);
                countLabel.style.display = 'none';
                conflict.countLabel = countLabel;
                item.appendChild(countLabel);
            }

            UI.divergeBar.appendChild(item);
        });

        show(UI.divergeBar, true);
        loadReleaseCounts(list);
    }

    function onDivergeClick(event) {
        var node = event && event.target;
        while (node && !(node.getAttribute && node.getAttribute('data-diverge'))) node = node.parentNode;
        if (!node) return;

        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();

        if (state.readOnly || !mbz) return;

        var action = node.getAttribute('data-diverge');
        var key = node.getAttribute('data-key');
        var conflict = null;

        conflicts().forEach(function (item) {
            if (item.key === key) conflict = item;
        });

        if (!conflict) return;

        if (action === 'tag') useNativeId(conflict);
        else confirmLibraryUpdate(conflict);
    }

    /** Library -> tag: fill the row in, so Apply writes it. */
    function useNativeId(conflict) {
        var row = conflict && conflict.row;
        if (!row || !row.input) return;

        row.input.value = conflict.nativeValue;
        row.pendingValue = conflict.nativeValue;

        renderLinkCell(row.input, row.linkCell, row.info);
        updateTagStatus();
        renderDivergence();
    }

    /** Tag -> library: an UPDATE on the album or artist row, never on a track. */
    function confirmLibraryUpdate(conflict) {
        if (!mbz || !conflict) return;

        var isArtist = (conflict.artistIds || []).length > 0;
        var targetId = isArtist ? conflict.artistIds[0] : (conflict.albumIds || [])[0];

        if (!(targetId > 0)) {
            setTagStatus(isArtist
                ? _('This track has no artist row in the library to update.')
                : _('This track has no album in the library to update.'));
            return;
        }

        // Filling an empty library field overwrites nothing, so it does not
        // need the confirmation the replace case uses.
        if (!conflict.nativeValue) {
            writeLibrary(conflict);
            return;
        }

        var countPromise = isArtist
            ? mbz.countArtistTracksAsync(targetId)
            : mbz.countAlbumTracksAsync(targetId);

        window.localPromise(countPromise).then(function (count) {
            if (window._cleanUpCalled) return;

            var scope = isArtist
                ? sprintf(_('artist "%s" (%s)'), conflict.artistName || ('#' + targetId), trackCountText(count))
                : sprintf(_('album "%s" (%s)'), conflict.albumName || ('#' + targetId), trackCountText(count));

            var message = sprintf(_('Write the tag\'s %s into the library?'), conflict.label)
                + '<br><br>' + sprintf(_('%s will be set to <b>%s</b> for your whole %s.'),
                    conflict.label, conflict.tagValue, scope)
                + '<br>' + _('The tag keeps its value. MediaMonkey\'s own MusicBrainz lookup can overwrite this library value the next time it re-matches.');

            if (typeof messageDlg !== 'function') return;

            messageDlg(message, 'Confirmation', ['btnYes', 'btnNo'],
                { defaultButton: 'btnNo', title: _('Loves MBz') },
                function (result) {
                    if (!result || result.btnID !== 'btnYes' || window._cleanUpCalled) return;
                    writeLibrary(conflict);
                });
        }, function (error) {
            if (window._cleanUpCalled) return;
            setTagStatus(sprintf(
                _('Could not check how many tracks the library change covers: %s'),
                mbzTagErrorText(error)));
        });
    }

    function trackCountText(count) {
        return count === 1 ? _('1 track') : sprintf(_('%d tracks'), count);
    }

    function writeLibrary(conflict) {
        setTagStatus(_('Updating the library...'));

        var isArtist = (conflict.artistIds || []).length > 0;
        var work = isArtist
            ? mbz.setArtistGuidAsync(conflict.artistIds[0], conflict.tagValue)
            : mbz.setAlbumGuidAsync((conflict.albumIds || [])[0], conflict.column, conflict.tagValue);

        window.localPromise(work).then(function () {
            if (window._cleanUpCalled) return;

            if (state.natives) {
                if (conflict.key === 'artist') {
                    state.artists.forEach(function (artist) {
                        if (artist.id === conflict.artistIds[0]) artist.mbgid = conflict.tagValue;
                    });
                } else if (conflict.column === 'MBGID') {
                    state.natives.releaseId = conflict.tagValue;
                } else {
                    state.natives.releaseGroupId = conflict.tagValue;
                }
            }

            if (state.groupNative) {
                if (conflict.key === 'artist') state.groupNative.artistGuids = [conflict.tagValue];
                else if (conflict.column === 'MBGID') state.groupNative.releaseIds = [conflict.tagValue];
                else state.groupNative.releaseGroupIds = [conflict.tagValue];
            }

            setTagStatus(sprintf(_('The library %s is now %s.'), conflict.label, conflict.tagValue));
            renderDivergence();
            renderLinks();
        }, function (error) {
            if (window._cleanUpCalled) return;
            setTagStatus(sprintf(_('Could not update the library: %s'), mbzTagErrorText(error)));
        });
    }

    /* ---------------------------------------------------------------- *
     * Table events
     * ---------------------------------------------------------------- */

    function onTagInput(event) {
        var input = event && event.target;
        if (!input || input.tagName !== 'INPUT' || !input.classList ||
            !input.classList.contains('mbzValue')) return;

        var index = parseInt(input.getAttribute('data-row'), 10);
        var row = state.rows[index];
        if (!row) return;

        var part = parseInt(input.getAttribute('data-part'), 10);

        if (row.parts && part >= 0 && row.parts[part]) {
            row.parts[part].value = input.value;
            row.pendingValue = rowValue(row);
            renderLinkCell(input, row.parts[part].linkCell, row.info);
            updateTagStatus();
            renderDivergence();
            return;
        }

        row.pendingValue = input.value;
        renderLinkCell(input, row.linkCell, row.info);
        updateTagStatus();
        renderDivergence();
    }

    /** Tag rows and the links row both carry a `data-url`; one handler serves both. */
    function onLinkClick(event) {
        var node = event && event.target;
        while (node && !(node.getAttribute && node.getAttribute('data-url'))) node = node.parentNode;
        if (!node) return;

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

    function onSuggestClick(event) {
        var node = event && event.target;
        while (node && !(node.getAttribute && node.getAttribute('data-title'))) node = node.parentNode;
        if (!node) return;

        var title = node.getAttribute('data-title');
        var value = node.getAttribute('data-value');
        if (!title || !value) return;

        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();

        addTagRow(title, value);
    }

    function onAddKey(event) {
        if (!event || (event.key !== 'Enter' && event.keyCode !== 13)) return;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        addPending();
    }

    /* ---------------------------------------------------------------- *
     * Loading
     * ---------------------------------------------------------------- */

    function loadTagRowsAsync(scope) {
        state.tagsById = null;
        state.tagsUnreadable = false;

        if (!mbz || !scope.songIds.length || typeof mbz.lookupExtendedTagsAsync !== 'function') {
            state.rows = [];
            return Promise.resolve();
        }

        return window.localPromise(mbz.lookupExtendedTagsAsync(scope.songIds)).then(function (values) {
            if (window._cleanUpCalled) return;

            state.tagsById = values;

            var lists = [];
            for (var i = 0; i < scope.songIds.length; i++) {
                var parsed = mbz.parseExtendedTags(values.get(scope.songIds[i]) || '');
                if (!Array.isArray(parsed)) state.tagsUnreadable = true;
                lists.push(Array.isArray(parsed) ? parsed : []);
            }

            state.rows = buildRows(lists, scope.songIds.length);
        }, function () {
            state.rows = [];
        });
    }

    function loadReleaseAsync(scope) {
        if (!fetch || !(scope.albumId > 0)) {
            return Promise.resolve({ skipped: true, reason: 'no-album' });
        }

        return window.localPromise(fetch.previewAsync(scope.albumId)).then(function (result) {
            return result;
        }, function (error) {
            setSummary(sprintf(_('Could not read the release: %s'), mbzTagErrorText(error)));
            setNote(_('The release ID is unchanged and nothing was written.'));
            return { skipped: true, reason: 'error' };
        });
    }

    function loadAlbumCountAsync(scope) {
        state.albumTracks = 0;
        if (!mbz || !(scope.albumId > 0) || typeof mbz.countAlbumTracksAsync !== 'function') {
            return Promise.resolve();
        }

        return window.localPromise(mbz.countAlbumTracksAsync(scope.albumId)).then(function (count) {
            state.albumTracks = parseInt(count, 10) || 0;
        }, function () {
            state.albumTracks = 0;
        });
    }

    function loadSuggestionsAsync(scope) {
        if (!mbz || typeof mbz.lookupTracksAsync !== 'function') return Promise.resolve();

        return window.localPromise(mbz.lookupTracksAsync(scope.songIds)).then(function (map) {
            if (window._cleanUpCalled) return;

            state.lookup = map;

            var natives = scope.songIds.map(function (id) { return map.get(id); });
            state.suggestions = mbz.suggestNativeExtendedTags(natives).map(function (item) {
                return {
                    title: item.title,
                    value: item.value,
                    info: mbz.musicBrainzTagInfo(item.title)
                };
            });

            if (scope.songIds.length > 1) {
                state.natives = null;
                state.groupIds = scope.songIds.slice();
                state.groupNative = groupNativeFrom(state.groupIds, map, state.groupArtists);
            } else {
                var entry = map.get(scope.songIds[0]);
                state.natives = entry ? {
                    releaseId: String(entry.releaseId || ''),
                    releaseGroupId: String(entry.releaseGroupId || ''),
                    albumId: parseInt(entry.albumId, 10) || 0,
                    album: String(entry.album || '')
                } : null;
                state.groupNative = null;
            }

            renderSuggestions();
            renderDivergence();
            renderLinks();
        }, function () {
            if (window._cleanUpCalled) return;
            state.suggestions = [];
            state.natives = null;
            renderSuggestions();
            renderDivergence();
            renderLinks();
        });
    }

    /** Library rows for the selection, then the suggestions and the strip. */
    function loadLibraryContextAsync(scope) {
        if (!mbz) return Promise.resolve();

        var artists = Promise.resolve();

        if (scope.songIds.length > 1 && typeof mbz.lookupTrackArtistsAsync === 'function') {
            artists = window.localPromise(mbz.lookupTrackArtistsAsync(scope.songIds)).then(function (map) {
                state.groupArtists = map || null;
            }, function () {
                state.groupArtists = null;
            });
        } else if (scope.songIds.length === 1 && typeof mbz.getTrackArtistsAsync === 'function') {
            artists = window.localPromise(mbz.getTrackArtistsAsync(scope.songIds[0])).then(function (list) {
                state.artists = list || [];
            }, function () {
                state.artists = [];
            });
        }

        return artists.then(function () {
            if (window._cleanUpCalled) return;
            return loadSuggestionsAsync(scope);
        }, function () {
            // reading artist rows is best effort
        });
    }

    function buildPlanAsync(release) {
        if (!apply) return Promise.resolve();

        return window.localPromise(
            apply.buildSelectionPlanAsync(state.scope.tracks, release, state.tagsById)
        ).then(function (plan) {
            if (window._cleanUpCalled) return;

            state.plan = plan;
            renderFields(plan);
            renderTracks(plan);
            renderWarnings(plan);
        }, function (error) {
            if (window._cleanUpCalled) return;
            setNote(sprintf(_('Could not compare the release with the library: %s'),
                mbzTagErrorText(error)));
        });
    }

    function reloadAsync() {
        var scope = state.scope;
        if (!scope) return Promise.resolve();

        setStatus('');
        setTagStatus('');

        return loadTagRowsAsync(scope).then(function () {
            if (window._cleanUpCalled) return null;

            renderTagTable();
            return Promise.all([loadReleaseAsync(scope), loadAlbumCountAsync(scope)]);
        }).then(function (values) {
            if (window._cleanUpCalled || !values) return null;

            var result = values[0];
            if (!result || result.skipped) {
                if (!result || result.reason !== 'error') renderSkipped(result || { reason: 'no-album' });
                state.hasRelease = false;
                state.release = null;
                return buildPlanAsync(null);
            }

            state.release = result.release;
            state.hasRelease = true;
            renderRelease(result);
            return buildPlanAsync(result.release);
        }).then(function () {
            if (window._cleanUpCalled) return null;
            syncAlbumIdInput();
            return loadLibraryContextAsync(scope);
        });
    }

    /* ---------------------------------------------------------------- *
     * Apply
     * ---------------------------------------------------------------- */

    function reportText(result) {
        var message = sprintf(_('Updated %d of %d tracks.'), result.updated, result.total);

        var reasons = [];
        if (result.noMatch) reasons.push(sprintf(_('%d with no matching disc and track number'), result.noMatch));
        if (result.unchanged) reasons.push(sprintf(_('%d with nothing to change'), result.unchanged));

        if (result.skipped) {
            message += ' ' + (reasons.length
                ? sprintf(_('Skipped %d (%s).'), result.skipped, reasons.join(', '))
                : sprintf(_('Skipped %d.'), result.skipped));
        }

        message += ' ' + sprintf(_('%d failed.'), result.failed.length);
        if (result.failed.length) message += ' ' + result.failed[0].error;

        return message;
    }

    function applyNow() {
        if (state.readOnly || state.busy || !apply) return;

        var keys = checkedKeys();
        var edits = collectEdits();

        if (!keys.length && !edits.length) {
            setStatus(_('Tick a field or change a tag to apply.'));
            return;
        }

        var plan = state.plan || { entries: [], work: [], fields: [], skipped: {} };

        state.busy = true;
        if (UI.btnApply) UI.btnApply.classList.add('mbzDisabled');
        setStatus(_('Writing...'));

        window.localPromise(apply.applySelectionAsync(plan, keys, edits)).then(function (result) {
            if (window._cleanUpCalled) return;

            state.busy = false;
            if (UI.btnApply) UI.btnApply.classList.remove('mbzDisabled');

            var message = reportText(result);

            return window.localPromise(reloadAsync()).then(function () {
                if (window._cleanUpCalled) return;
                setStatus(message);
            }, function () {
                setStatus(message);
            });
        }, function (error) {
            if (window._cleanUpCalled) return;

            state.busy = false;
            if (UI.btnApply) UI.btnApply.classList.remove('mbzDisabled');
            setStatus(sprintf(_('Could not write: %s'), mbzTagErrorText(error)));
        });
    }

    /* ---------------------------------------------------------------- *
     * Start
     * ---------------------------------------------------------------- */

    function start() {
        var canEdit = true;
        try {
            if (typeof uitools !== 'undefined' && uitools.getCanEdit) canEdit = !!uitools.getCanEdit();
        } catch (e) {
            canEdit = true;
        }
        state.readOnly = !canEdit || !!window.isReadOnly;

        show(UI.btnApply, !state.readOnly);
        show(UI.addBar, !state.readOnly);
        if (UI.addButton) UI.addButton.classList.toggle('mbzDisabled', state.readOnly);

        var addTag = mbzTagControl(UI.addTag);
        var addValue = mbzTagControl(UI.addValue);
        if (addTag) addTag.disabled = state.readOnly;
        if (addValue) addValue.disabled = state.readOnly;

        populateAddChoices();

        if (!apply || !mbz) {
            setSummary(_('The MusicBrainz modules did not load. Check debug.log for lines starting with "Loves MBz:".'));
            return;
        }

        setSummary(_('Reading the selection...'));

        window.localPromise(apply.collectSelectionAsync(sourceList)).then(function (tracks) {
            if (window._cleanUpCalled) return null;

            if (!tracks.length) {
                setSummary(_('No library tracks are selected.'));
                return null;
            }

            state.fileSeparator = mbzTagSeparatorForFile(tracks[0].path);

            return window.localPromise(apply.resolveTagScope(tracks)).then(function (scope) {
                if (window._cleanUpCalled) return null;

                state.scope = scope;

                // One album at a time. The entry point already asked; this is
                // the same rule applied again, so the two cannot disagree.
                if (scope.multiAlbum && !forced) {
                    setSummary(sprintf(
                        _('This selection spans %d albums. Tag from MusicBrainz works on one album at a time.'),
                        scope.albumIds.length));
                    setNote(_('Close the window, select one album, or confirm the prompt when you open the window.'));
                    return null;
                }

                setSummary(_('Reading the release from MusicBrainz...'));
                return reloadAsync();
            });
        }).catch(function (error) {
            if (window._cleanUpCalled) return;
            setSummary(sprintf(_('Could not read the selection: %s'), mbzTagErrorText(error)));
        });
    }

    if (UI.buildStamp) {
        UI.buildStamp.textContent = 'Loves MBz ' + ADDON_VERSION
            + (BUILD_TIME ? ' \u00b7 ' + BUILD_TIME : '');
    }

    resetView();

    if (UI.btnSearch) window.localListen(UI.btnSearch, 'click', openSearch);
    if (UI.btnSaveAlbumId) window.localListen(UI.btnSaveAlbumId, 'click', saveAlbumId);
    if (UI.albumIdValue) window.localListen(UI.albumIdValue, 'keydown', onAlbumIdKey);
    if (UI.linksBar) window.localListen(UI.linksBar, 'click', onLinkClick);
    if (UI.tagRows) window.localListen(UI.tagRows, 'input', onTagInput);
    if (UI.tagRows) window.localListen(UI.tagRows, 'click', onLinkClick);
    if (UI.suggestBar) window.localListen(UI.suggestBar, 'click', onSuggestClick);
    if (UI.divergeBar) window.localListen(UI.divergeBar, 'click', onDivergeClick);
    if (UI.addButton) window.localListen(UI.addButton, 'click', addPending);
    if (UI.addValue) window.localListen(UI.addValue, 'keydown', onAddKey);
    if (UI.btnApply) window.localListen(UI.btnApply, 'click', applyNow);

    start();
}
