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
 * MediaMonkey only accepts a three-number manifest version, so a test build
 * carries its channel separately and reads as 0.6.3-rc1 in the footer.
 */
var ADDON_VERSION = '0.6.2';
var BUILD_CHANNEL = '';      // '' for a release build

/* Filled in by tools/build-mmip.js; empty when the dialog runs from source. */
var BUILD_TIME = '2026-11-25 17:49';

/* Restored whenever a release finally loads, so an error note does not linger. */
var DEFAULT_NOTE = _('Nothing is written until Apply. Closing the window writes nothing.');

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

/** MediaMonkey stores multi-value artists internally; show the readable form. */
function mbzTagArtistText(value) {
    var artist = mbzTagText(value);
    try {
        if (typeof utils !== 'undefined' && utils.multiString2VisualString) {
            artist = utils.multiString2VisualString(artist);
        }
    } catch (e) {
        // keep the raw value
    }
    return artist;
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
        working: qid('working'),
        btnRetry: qid('btnRetry'),
        warning: qid('warning'),
        searchRow: qid('searchRow'),
        btnSearch: qid('btnSearch'),
        searchStatus: qid('searchStatus'),
        linksBar: qid('linksBar'),
        releaseCard: qid('releaseCard'),
        groupCard: qid('groupCard'),
        groupRows: qid('groupRows'),
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
        pendingSummary: qid('pendingSummary'),
        buildStamp: qid('buildStamp'),
        applyStatus: qid('applyStatus'),
        tabBar: qid('tabBar'),
        tabChanges: qid('tabChanges'),
        tabTagSet: qid('tabTagSet'),
        panelChanges: qid('panelChanges'),
        panelTagSet: qid('panelTagSet'),
        note: qid('note')
    };

    var state = {
        scope: null,
        release: null,
        hasRelease: false,
        groupReleases: [],
        groupMessage: '',
        groupRetryable: false,
        pickedReleaseId: '',
        plan: null,
        rows: [],
        suggestions: [],
        tagsById: null,
        tagsUnreadable: false,
        fileTagLists: null,
        fileReleaseId: '',
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
        readOnly: false,
        offered: null           // the saved set: the fields the window offers
    };

    var searchUrl = '';
    var countToken = 0;

    /**
     * Guidance is italic by default; only a loaded release title is data and
     * stays upright. The style is set inline as well as by class: the host's
     * sheet can reset a label's font, and MediaMonkey keeps the dialog page it
     * first loaded while reading this script again, so the page on screen can be
     * older than the class the markup below would give it.
     */
    function setSummary(text, info) {
        if (!UI.summary) return;
        if (typeof info === 'undefined') info = true;

        UI.summary.textContent = text;
        UI.summary.classList.toggle('mbzInfo', !!info);

        if (UI.summary.style) {
            if (info && UI.summary.style.setProperty) {
                UI.summary.style.setProperty('font-style', 'italic', 'important');
            } else if (UI.summary.style.removeProperty) {
                UI.summary.style.removeProperty('font-style');
            }
        }
    }

    /* The labels that carry sentences rather than values. */
    var INFO_LABELS = ['summary', 'warning', 'searchStatus', 'albumIdStatus', 'tagSummary',
        'tagEmpty', 'tagStatus', 'note', 'pendingSummary', 'applyStatus'];

    /**
     * Pin the asides italic, inline: the skin sheet cannot reset an inline
     * important, and a page MediaMonkey loaded before the last install still
     * ends up italic.
     */
    function italicizeInfo() {
        INFO_LABELS.forEach(function (key) {
            var element = UI[key];
            if (element && element.style && element.style.setProperty) {
                element.style.setProperty('font-style', 'italic', 'important');
            }
        });
    }

    /** Pin the gap between the cards, inline, for the same reason. */
    function pinCardSpacing() {
        if (typeof document.querySelectorAll !== 'function') return;

        var cards = document.querySelectorAll('.mbzCard');

        for (var i = 0; i < cards.length; i++) {
            if (cards[i].style && cards[i].style.setProperty) {
                cards[i].style.setProperty('margin', '0 0 1rem 0', 'important');
            }
        }
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
        if (!UI.applyStatus) return;

        // The report lists failures one per line.
        UI.applyStatus.style.whiteSpace = 'pre-line';
        UI.applyStatus.textContent = text || '';
    }

    function setTagStatus(text) {
        if (UI.tagStatus) UI.tagStatus.textContent = text || '';
    }

    function show(element, visible) {
        if (!element) return;

        if (visible) {
            element.classList.remove('mbzHidden');
            if (element.style) {
                if (element.style.removeProperty) element.style.removeProperty('display');
                else element.style.display = '';
            }
            return;
        }

        element.classList.add('mbzHidden');

        // The skin's stylesheet is applied after this document's and styles
        // fieldsets, so `display: none` on the class can lose there. An inline
        // important declaration is the one rule it cannot outrank.
        if (element.style) {
            if (element.style.setProperty) element.style.setProperty('display', 'none', 'important');
            else element.style.display = 'none';
        }
    }

    function showRetry(visible) {
        show(UI.btnRetry, !!visible);
    }

    /* ---------------------------------------------------------------- *
     * The busy ring
     * ---------------------------------------------------------------- */

    var workingCount = 0;

    /*
     * The page's own rule, repeated here for the same reason the italics and
     * the card gap are: MediaMonkey keeps the dialog document it loaded while
     * reading this script again, so right after an install the page can be
     * older than the script. A page without the ring then still gets one.
     */
    var WORKING_STYLE = '.mbzSpinner{box-sizing:border-box;flex:0 0 auto;width:16px;height:16px;'
        + 'min-width:16px;min-height:16px;padding:0;margin:0;'
        + 'border:3px solid rgba(128,128,128,0.55);border-top-color:currentColor;'
        + 'border-radius:50%;animation:mbzSpin 0.8s linear infinite}'
        + '@keyframes mbzSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';

    /**
     * The ring's size, shape and colour go inline as well as into the page.
     * The host applies its skin sheet after this document's, and a generic rule
     * there (or a page older than the install) leaves the div without a border
     * or without its size, which draws nothing at all.
     */
    function pinWorkingStyle(spinner) {
        if (!spinner || !spinner.style || !spinner.style.setProperty) return;

        var style = spinner.style;

        function set(name, value) {
            style.setProperty(name, value, 'important');
        }

        set('box-sizing', 'border-box');
        set('width', '16px');
        set('height', '16px');
        set('min-width', '16px');
        set('min-height', '16px');
        set('max-width', '16px');
        set('max-height', '16px');
        set('flex', '0 0 auto');
        set('padding', '0');
        set('margin', '0');
        set('background', 'none');
        set('border', '3px solid rgba(128,128,128,0.55)');
        set('border-top-color', 'currentColor');
        set('border-radius', '50%');
        set('animation', 'mbzSpin 0.8s linear infinite');
    }

    /*
     * The ring turns itself from script too: an inline important animation is
     * only as good as the engine's support for it, and a still ring reads as a
     * decoration rather than as "something is happening". The CSS animation
     * outranks this plain transform when it does run, so the two never fight.
     */
    var spinTimer = null;
    var spinAngle = 0;
    var spinElement = null;

    function startSpin(spinner) {
        spinElement = spinner;
        if (spinTimer || typeof setInterval !== 'function') return;

        spinAngle = 0;

        spinTimer = setInterval(function () {
            var target = spinElement;
            if (!target || !target.style) return;

            spinAngle = (spinAngle + 30) % 360;
            if (target.style.setProperty) {
                target.style.setProperty('transform', 'rotate(' + spinAngle + 'deg)');
            } else {
                target.style.transform = 'rotate(' + spinAngle + 'deg)';
            }
        }, 80);
    }

    function stopSpin(spinner) {
        if (spinTimer) {
            clearInterval(spinTimer);
            spinTimer = null;
        }

        spinElement = null;

        if (spinner && spinner.style && spinner.style.removeProperty) {
            spinner.style.removeProperty('transform');
        }
    }

    /** MediaMonkey's own busy pointer, for the eye that misses the ring. */
    function syncWorkingCursor(on) {
        if (typeof document === 'undefined' || !document.body || !document.body.style) return;

        var style = document.body.style;
        if (!style.setProperty) return;

        if (on) style.setProperty('cursor', 'progress', 'important');
        else if (style.removeProperty) style.removeProperty('cursor');
        else style.cursor = '';
    }

    function workingElement() {
        if (UI.working) return UI.working;
        if (typeof document === 'undefined' || !document.body || !document.createElement) return null;

        var existing = document.querySelector ? document.querySelector('[data-id=working]') : null;
        if (existing) {
            UI.working = existing;
            return existing;
        }

        if (!document.querySelector || !document.querySelector('[data-id=workingStyle]')) {
            var style = document.createElement('style');
            style.setAttribute('data-id', 'workingStyle');
            style.textContent = WORKING_STYLE;
            (document.head || document.body).appendChild(style);
        }

        var spinner = document.createElement('div');
        spinner.setAttribute('data-id', 'working');
        spinner.className = 'mbzSpinner';
        spinner.style.display = 'none';

        var row = UI.summary && UI.summary.parentNode;
        if (row && row.insertBefore) row.insertBefore(spinner, UI.summary);
        else document.body.appendChild(spinner);

        UI.working = spinner;
        return spinner;
    }

    /** Save ID has nothing to save while anything is being read or written. */
    function saveIdDisabled() {
        return state.busy || workingCount > 0;
    }

    /** Shows the ring while at least one lookup or write is running. */
    function syncWorking() {
        var spinner = workingElement();
        var running = workingCount > 0;

        if (spinner) {
            pinWorkingStyle(spinner);
            show(spinner, running);

            if (running && spinner.style && spinner.style.setProperty) {
                spinner.style.setProperty('display', 'block', 'important');
            }

            spinner.title = running ? _('Working...') : '';

            if (running) startSpin(spinner);
            else stopSpin(spinner);
        }

        syncWorkingCursor(running);

        if (UI.btnSaveAlbumId) UI.btnSaveAlbumId.classList.toggle('mbzDisabled', saveIdDisabled());
    }

    /**
     * Counted rather than a flag: saving an ID runs the release lookup, Apply
     * runs one again afterwards, and the ring has to stay up until the last of
     * them has finished.
     */
    function beginWork() {
        workingCount++;
        syncWorking();
    }

    function endWork() {
        if (window._cleanUpCalled) {
            workingCount = 0;
            stopSpin(null);
            syncWorkingCursor(false);
            return;
        }

        if (workingCount > 0) workingCount--;
        syncWorking();
    }

    /**
     * Reports a failure inside the window's own promise chain.
     *
     * MediaMonkey's promise library opens its Application Error box for a
     * rejection it sees as unhandled. A handler attached after `trackWork` is too
     * late, because `trackWork` adopts the promise through the native `Promise`,
     * one microtask after the rejection. Handling the work where it is built
     * keeps the failure a sentence in the header instead.
     */
    function handledInWindow(work, onError) {
        return work.then(function (value) {
            return value;
        }, function (error) {
            if (window._cleanUpCalled) return;
            onError(error);
        });
    }

    /** Runs a lookup under the ring, however the lookup ends. */
    function trackWork(promise) {
        beginWork();

        return Promise.resolve(promise).then(function (value) {
            endWork();
            return value;
        }, function (error) {
            endWork();
            throw error;
        });
    }

    /** The release card exists only while it has something in it. */
    function syncReleaseCard() {
        var metaVisible = !!UI.metaScroll && !UI.metaScroll.classList.contains('mbzHidden');

        show(UI.releaseCard, metaVisible);
    }

    /** The release ID field lives in the group card; the card follows it. */
    function idRowVisible() {
        return !!UI.albumIdRow && !UI.albumIdRow.classList.contains('mbzHidden');
    }

    /**
     * The first card holds the album's release ID and, once a release is
     * loaded, the other releases of its group. It stays on screen while either
     * has something in it: the field is the lookup key, so it is offered even
     * when the group was never read, has nothing to list, or could not be read.
     */
    function syncGroupCard() {
        var rows = 0;

        if (UI.groupRows) {
            rows = UI.groupRows.rows ? UI.groupRows.rows.length
                : (UI.groupRows.childNodes ? UI.groupRows.childNodes.length : 0);
        }

        show(UI.groupCard, rows > 0 || idRowVisible());
    }

    function mbzTagErrorCode(error) {
        return (error && error.mbzCode) ? String(error.mbzCode) : '';
    }

    /** Retrying cannot help when MusicBrainz has no release with that ID. */
    function canRetryRelease(error) {
        var code = mbzTagErrorCode(error);
        return code !== 'not-found' && code !== 'cancelled' && code !== 'missing-id';
    }

    function resetView() {
        scheduleTableSync();
        showRetry(false);

        if (UI.metaRows) UI.metaRows.textContent = '';
        if (UI.fieldRows) UI.fieldRows.textContent = '';
        if (UI.trackRows) UI.trackRows.textContent = '';
        if (UI.groupRows) UI.groupRows.textContent = '';
        if (UI.tagRows) UI.tagRows.textContent = '';
        state.groupReleases = [];
        state.groupMessage = '';
        state.groupRetryable = false;
        state.pickedReleaseId = '';
        if (UI.divergeBar) UI.divergeBar.textContent = '';
        if (UI.suggestBar) UI.suggestBar.textContent = '';
        if (UI.linksBar) UI.linksBar.textContent = '';
        if (UI.albumIdStatus) UI.albumIdStatus.textContent = '';
        state.fileTagLists = null;
        state.fileReleaseId = '';

        show(UI.linksBar, false);
        show(UI.albumIdRow, false);
        show(UI.metaScroll, false);
        show(UI.fieldsSection, false);
        show(UI.trackSection, false);
        syncGroupCard();
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
        syncReleaseCard();
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
    /**
     * The skin sizes and aligns its Edit controls from a sheet it applies after
     * this document's, so the rules in dlgMBzTag.html lose however specific
     * they are. Inline important is the only declaration that outranks it, and
     * the input inside the control has to be sized on its own as well.
     */
    /**
     * Headers sit flush left over their data, and a header row disappears when
     * there is nothing under it: column names above an empty table (no release
     * ID, no tags) are just a ruler with words on it.
     */
    function syncTables() {
        if (typeof document.querySelectorAll !== 'function') return;

        var tables = document.querySelectorAll('.mbzTable');

        for (var i = 0; i < tables.length; i++) {
            var table = tables[i];
            var body = table.tBodies && table.tBodies.length ? table.tBodies[0] : null;
            var empty = !body || body.rows.length === 0;

            if (table.tHead) table.tHead.style.display = empty ? 'none' : '';

            var heads = table.querySelectorAll('th');

            for (var h = 0; h < heads.length; h++) {
                // The skin centres `th`; an inline important beats it.
                if (heads[h].style && heads[h].style.setProperty) {
                    heads[h].style.setProperty('text-align', 'left', 'important');
                }
            }
        }

        // The field list is only its table, and only once a release is behind
        // it: no rows or no release means no section.
        show(UI.fieldsSection,
            !!state.hasRelease && !!(UI.fieldRows && UI.fieldRows.rows.length));
    }

    /* The renders fill their tables synchronously; this runs right after. */
    function scheduleTableSync() {
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(syncTables);
            return;
        }

        setTimeout(syncTables, 0);
    }

    function pinFieldLayout() {
        var idControl = mbzTagControl(UI.albumIdValue);

        if (UI.albumIdValue && UI.albumIdValue.style) {
            UI.albumIdValue.style.setProperty('display', 'flex', 'important');
            UI.albumIdValue.style.setProperty('align-items', 'center', 'important');
            UI.albumIdValue.style.setProperty('flex', '1 1 34em', 'important');
            UI.albumIdValue.style.setProperty('min-width', '30em', 'important');
        }

        if (idControl && idControl.edit && idControl.edit.style) {
            idControl.edit.setAttribute('size', '38');
            idControl.edit.style.setProperty('align-self', 'center', 'important');
            idControl.edit.style.setProperty('min-width', '30em', 'important');
            idControl.edit.style.setProperty('width', '100%', 'important');
        }

        var valueControl = mbzTagControl(UI.addValue);

        if (UI.addValue && UI.addValue.style) {
            UI.addValue.style.setProperty('display', 'flex', 'important');
            UI.addValue.style.setProperty('align-items', 'center', 'important');
        }

        if (valueControl && valueControl.edit && valueControl.edit.style) {
            valueControl.edit.style.setProperty('align-self', 'center', 'important');
            valueControl.edit.style.setProperty('width', '100%', 'important');
        }
    }

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
        syncReleaseCard();
    }

    function renderRelease(result) {
        var release = (result && result.release) || {};

        metaPairs = [];
        setSearch('');
        showRetry(false);
        setNote(DEFAULT_NOTE);

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

        setSummary(release.title || result.releaseId || '', false);
        renderLinks();
        fitScrollColumn();
    }

    function renderSkipped(result) {
        var reason = (result && result.reason) || 'no-album';
        showRetry(false);

        // A release that went away must not leave the old overview on screen.
        metaPairs = [];
        if (UI.metaRows) UI.metaRows.textContent = '';
        show(UI.metaScroll, false);
        syncReleaseCard();

        // Both cards need a release to compare with: until one is loaded, the
        // only things to show are the release lookup and the existing tags.
        if (UI.fieldRows) UI.fieldRows.textContent = '';
        if (UI.trackRows) UI.trackRows.textContent = '';
        if (UI.groupRows) UI.groupRows.textContent = '';
        state.groupReleases = [];
        state.groupMessage = '';
        state.groupRetryable = false;
        state.hasRelease = false;
        show(UI.fieldsSection, false);
        show(UI.trackSection, false);
        syncGroupCard();

        if (reason === 'no-album') {
            setSummary(_('This selection has no album, so there is no release to look up.'), true);
            setSearch('');
            return;
        }

        var files = !!(state.scope && state.scope.tagOnly);
        var fileId = files ? mbzTagText(state.fileReleaseId) : '';

        // Nothing went wrong here: the window simply has no release yet, and
        // the field is how one arrives.
        setSummary(files
            ? (fileId
                ? sprintf(_('These files carry release ID %s. Nothing was requested.'), fileId)
                : _('These files are outside the library: no release is loaded.'))
            : _('This album has no MusicBrainz release ID. Nothing was requested.'), !files);

        var info = searchTerms();
        if (info) setSearch(mbzTagSearchUrl(info.album, info.artist));

        if (files) {
            setNote(fileId
                ? _('Press Load to read that release. Apply writes it onto the files: outside the library there is no album row to keep it in.')
                : _('Paste a release ID below and press Load, or search MusicBrainz for it. Apply writes the result onto the files: outside the library there is no album row to keep it in.'));
        } else {
            setNote(_('Search MusicBrainz for this album, then add its release ID to the album. Tag from MusicBrainz still does not query MusicBrainz by name.'));
        }
    }

    /* ---------------------------------------------------------------- *
     * The album's release ID
     * ---------------------------------------------------------------- */

    /** The release ID the album row actually holds; Save ID compares to it. */
    function storedAlbumReleaseId() {
        var scope = state.scope;
        if (!scope || !(scope.albumId > 0)) return '';
        return mbzTagText(scope.releaseIds ? scope.releaseIds[scope.albumId] : '');
    }

    /**
     * The release ID to show in the field: the loaded release, which is the
     * album's own unless the user picked another one of its release group. A
     * file outside the library starts from the ID its own tags carry.
     */
    function shownAlbumReleaseId() {
        if (state.hasRelease && state.release && state.release.id) return mbzTagText(state.release.id);
        if (state.natives && state.natives.releaseId) return mbzTagText(state.natives.releaseId);
        if (state.fileReleaseId) return mbzTagText(state.fileReleaseId);

        return storedAlbumReleaseId();
    }

    function setAlbumIdStatus(text) {
        if (UI.albumIdStatus) UI.albumIdStatus.textContent = text || '';
    }

    /**
     * The field is the lookup key. It is offered while the add-on may write or
     * load, whether the selection has an album row or is files outside the
     * library: there it is the only way in to a release.
     */
    function syncAlbumIdInput() {
        var albumRow = !!(state.scope && state.scope.albumId > 0);
        var tagOnly = !!(state.scope && state.scope.tagOnly);
        var editable = !state.readOnly && !!state.scope && (albumRow || tagOnly);

        show(UI.albumIdRow, editable);
        syncGroupCard();

        if (!editable) return;

        // The button saves the album row. Outside the library there is no row,
        // so it loads the ID into the window and Apply writes the tags.
        if (UI.btnSaveAlbumId) {
            UI.btnSaveAlbumId.textContent = albumRow ? _('Save ID') : _('Load');
            UI.btnSaveAlbumId.title = albumRow
                ? _('Save this release ID on the album.')
                : _('Load this release into the window. Nothing is written until Apply.');
        }

        mbzTagSetFieldValue(UI.albumIdValue, shownAlbumReleaseId());
        syncWorking();

        pinFieldLayout();
    }

    /**
     * Writes Albums.MBGID through mbzMbgid, never through the apply path: this
     * is a library row, not a tag on the selected tracks. The release behind the
     * new ID is then loaded instead of the old one's.
     */
    function saveAlbumId() {
        if (state.readOnly || state.busy || !state.scope) return;

        // The selection is files outside the library: there is no album row to
        // save, so the field only loads the release, and Apply writes its tags
        // (the release ID tag included) onto the files.
        if (!(state.scope.albumId > 0)) {
            loadReleaseIdIntoWindow();
            return;
        }

        if (!mbz) return;

        var raw = mbzTagFieldValue(UI.albumIdValue);
        var value = raw ? mbz.normalizeGuid(raw) : '';
        var current = storedAlbumReleaseId();

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
            setSummary(_('Reading the release from MusicBrainz...'), true);

            var work = window.localPromise(mbz.setAlbumGuidAsync(albumId, 'MBGID', value || '')).then(function () {
                if (window._cleanUpCalled) return null;

                if (state.scope) {
                    if (state.scope.releaseIds) state.scope.releaseIds[albumId] = value || '';
                    state.scope.releaseId = value || '';
                }
                if (state.natives) state.natives.releaseId = value || '';

                // The album now points at the release it was showing, so there
                // is no separate picking to keep.
                state.pickedReleaseId = '';

                setAlbumIdStatus(value
                    ? sprintf(_('The album release ID is now %s.'), value)
                    : _('The album release ID was cleared.'));

                // A different release is the one to show now (or none at all).
                // A failed reload is reported here: the ID itself is saved.
                return window.localPromise(reloadAsync()).then(function () {
                    return null;
                }, function (error) {
                    if (window._cleanUpCalled) return;
                    setAlbumIdStatus(sprintf(
                        _('The release ID was saved, but the window could not reload: %s'),
                        mbzTagErrorText(error)));
                });
            });

            return trackWork(handledInWindow(work, function (error) {
                setAlbumIdStatus(sprintf(_('Could not update the album: %s'), mbzTagErrorText(error)));
            }));
        }

        // No prompt: the field exists to be saved, the write is one column, and
        // the line under it says what was written. Only **Update library** in
        // the disagreement strip still asks, because it acts on the tag's value
        // rather than on something typed here.
        write();
    }

    /**
     * A release ID typed or pasted for a selection outside the library. It is a
     * load like a pick from the group card: the files are untouched until
     * Apply, which writes the release's tags and the ID tag itself.
     */
    function loadReleaseIdIntoWindow() {
        if (!fetch || state.readOnly || state.busy) return;

        var raw = mbzTagFieldValue(UI.albumIdValue);
        var value = raw && mbz ? mbz.normalizeGuid(raw) : mbzTagText(raw);

        if (raw && mbz && !value) {
            setAlbumIdStatus(_('That is not a valid MusicBrainz release ID.'));
            return;
        }

        if (!value) {
            setAlbumIdStatus(_('Paste a release ID first.'));
            return;
        }

        var loaded = state.hasRelease && state.release && state.release.id
            ? mbzTagText(state.release.id)
            : '';

        if (value === loaded) {
            setAlbumIdStatus(_('That release is already loaded.'));
            return;
        }

        setBusy(true);
        setStatus(_('Reading the release from MusicBrainz...'));
        setAlbumIdStatus('');

        var work = window.localPromise(fetch.fetchReleaseAsync(value)).then(function (release) {
            if (window._cleanUpCalled || !release) return null;

            state.release = release;
            state.hasRelease = true;
            state.fileReleaseId = value;
            if (state.scope) state.scope.releaseId = value;

            renderRelease({ release: release, releaseId: value });
            setAlbumIdStatus(_('This release is loaded here. Apply writes its tags onto the files.'));
            syncAlbumIdInput();
            renderGroupReleases();
            loadGroupReleasesAsync(release);

            return buildPlanAsync(release).then(function () {
                if (window._cleanUpCalled) return;
                setStatus('');
            });
        });

        trackWork(handledInWindow(work, function (error) {
            setStatus(sprintf(_('Could not read that release: %s'), mbzTagErrorText(error)));
            setAlbumIdStatus(state.fileReleaseId
                ? sprintf(_('Showing release %s.'), state.fileReleaseId)
                : _('No release is loaded.'));
        })).then(function () {
            if (window._cleanUpCalled) return;
            setBusy(false);
        });
    }

    function onAlbumIdKey(event) {
        if (!event || (event.key !== 'Enter' && event.keyCode !== 13)) return;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        saveAlbumId();
    }

    /* ---------------------------------------------------------------- *
     * Releases in this release group
     * ---------------------------------------------------------------- */

    /** What a picked release does and does not change. */
    var GROUP_PICKED_NOTE = _('This release is loaded here. The album keeps its own release ID until you press Save ID.');

    /**
     * The action column ends with `use this` on every release that can be
     * loaded and a single glyph on the one already here. The glyph says "this
     * is it" without spending the room a second phrase would; the tooltip and
     * `aria-label` carry the sentence. Written as an escape so the file stays
     * plain ASCII.
     */
    var GROUP_LOADED_GLYPH = '\u2713';    // this is the release in the window

    /**
     * The card, built from script when the page does not have it. MediaMonkey
     * keeps the page it loaded when the process started, so an install that adds
     * a card shows nothing until MediaMonkey is fully restarted; creating the
     * card here means the new section exists for an old page too, the way the
     * busy ring is created when the page has none.
     */
    function ensureGroupCard() {
        if (!UI.groupCard || !UI.groupRows) buildGroupCard();
        placeGroupCardFirst();
        relocateAlbumIdRow();
    }

    /** The card is the first one; a page that predates the move has it later. */
    function placeGroupCardFirst() {
        var host = UI.scrollColumn;
        var card = UI.groupCard;

        if (!host || !card || !host.insertBefore || !host.firstElementChild) return;
        if (host.firstElementChild === card) return;

        host.insertBefore(card, host.firstElementChild);
    }

    /** Builds the card to the page's shape when the window's page predates it. */
    function buildGroupCard() {
        if (typeof document === 'undefined') return;

        var host = UI.scrollColumn;
        if (!host || !host.insertBefore || !document.createElement) return;

        var card = document.createElement('fieldset');
        card.className = 'mbzSection mbzCard mbzHidden';
        card.setAttribute('data-id', 'groupCard');

        var legend = document.createElement('legend');
        legend.className = 'mbzCardTitle';
        legend.textContent = _('Releases in this release group');
        card.appendChild(legend);

        var table = document.createElement('table');
        table.className = 'mbzTable';

        var thead = document.createElement('thead');
        var head = document.createElement('tr');
        var titles = [_('Release'), _('Date'), _('Country'), _('Format'), _('Tracks'), ''];

        for (var i = 0; i < titles.length; i++) {
            var th = document.createElement('th');
            th.textContent = titles[i];
            head.appendChild(th);
        }

        thead.appendChild(head);
        table.appendChild(thead);

        var rows = document.createElement('tbody');
        rows.setAttribute('data-id', 'groupRows');
        table.appendChild(rows);
        card.appendChild(table);

        // First card in the column, above the release block: the page's order.
        host.insertBefore(card, host.firstChild);

        UI.groupCard = card;
        UI.groupRows = rows;
    }

    /**
     * The release ID field opens the group card, above the list, so the key is
     * the first thing the card shows. A page loaded before the move still has
     * the row in the release card; moving the node, rather than rebuilding it,
     * keeps the control MediaMonkey already built on it.
     */
    function relocateAlbumIdRow() {
        var card = UI.groupCard;
        var row = UI.albumIdRow;

        if (!card || !row || !card.insertBefore) return;

        var legend = card.querySelector ? card.querySelector('legend') : null;
        if (row.parentNode === card && legend && row.previousElementSibling === legend) return;

        // The card's first content, right under its title, above the list.
        card.insertBefore(row, legend && legend.nextSibling ? legend.nextSibling : card.firstChild);
    }

    /**
     * The card says why it has no rows instead of disappearing. When the reason
     * is one that passes (MusicBrainz busy, a timeout), it offers the attempt
     * again: reading the group is a load like any other, and the lookup is not
     * cached while it fails.
     */
    function renderGroupCardNote(text) {
        if (!UI.groupRows || !text) {
            syncGroupCard();
            fitScrollColumn();
            return;
        }

        var row = document.createElement('tr');
        var cell = document.createElement('td');
        cell.className = 'mbzNote';
        cell.setAttribute('colspan', '6');
        cell.textContent = text;

        if (state.groupRetryable) {
            var button = document.createElement('div');
            button.className = 'button mbzButton';
            button.textContent = _('Retry');
            button.title = _('Read the releases of this group again.');
            button.setAttribute('data-group-retry', '1');
            // Inline, so the button keeps its gap on a page older than this script.
            button.style.marginLeft = '10px';

            if (state.busy) button.classList.add('mbzDisabled');

            cell.appendChild(button);
        }

        row.appendChild(cell);
        UI.groupRows.appendChild(row);

        syncGroupCard();
        fitScrollColumn();
    }

    /**
     * The group's other releases, so a match for the group's best-known release
     * can be swapped for the pressing the album actually is. The loaded release
     * is marked instead of offered, and a group with one release draws no card:
     * there would be nothing to choose. A group that could not be read keeps its
     * card and says so, because a missing section reads as a missing feature.
     */
    function renderGroupReleases() {
        scheduleTableSync();

        if (!UI.groupRows) return;

        UI.groupRows.textContent = '';

        var releases = state.groupReleases || [];
        var current = state.hasRelease && state.release && state.release.id
            ? mbzTagText(state.release.id)
            : '';

        if (!state.hasRelease) {
            syncGroupCard();
            fitScrollColumn();
            return;
        }

        if (!releases.length) {
            renderGroupCardNote(state.groupMessage);
            return;
        }

        if (releases.length < 2) {
            syncGroupCard();
            fitScrollColumn();
            return;
        }

        releases.forEach(function (release) {
            var row = document.createElement('tr');
            var isCurrent = release.id === current;

            if (isCurrent) row.className = 'mbzChanged';

            var title = mbzTagText(release.title) || mbzTagShortGuid(release.id);
            if (release.disambiguation) title += ' (' + release.disambiguation + ')';

            row.appendChild(mbzTagCell(title));
            row.appendChild(mbzTagCell(release.date, 'mbzNowrap'));
            row.appendChild(mbzTagCell(release.country, 'mbzNowrap'));
            row.appendChild(mbzTagCell(release.format, 'mbzNowrap'));
            row.appendChild(mbzTagCell(release.trackCount ? String(release.trackCount) : '', 'mbzNowrap'));

            var cell = document.createElement('td');
            cell.className = 'mbzNowrap';
            // Flush right, so the loaded release's check and the links under it
            // line up on one edge whatever their own width.
            cell.style.textAlign = 'right';

            if (isCurrent) {
                var loaded = _('This is the release loaded in the window.');
                cell.textContent = GROUP_LOADED_GLYPH;
                cell.title = loaded;
                cell.setAttribute('aria-label', loaded);
                cell.style.fontSize = '1.15em';
            } else {
                var action = sprintf(_('Load release %s into this window.'), release.id);
                var link = document.createElement('a');
                link.href = '#';
                link.className = 'hotlink';
                link.textContent = _('use this');
                link.title = action;
                link.setAttribute('aria-label', action);
                link.setAttribute('data-release', release.id);
                // Inline, so the link keeps its hand cursor on a page older
                // than this script.
                link.style.cursor = 'pointer';

                // The rows are rebuilt after a pick, which happens while the
                // window is locked: the new links must be drawn locked too.
                if (state.busy || state.readOnly) link.classList.add('mbzDisabled');

                cell.appendChild(link);
            }

            row.appendChild(cell);
            UI.groupRows.appendChild(row);
        });

        syncGroupCard();
        fitScrollColumn();
    }

    /**
     * Loads one release of the group into the window. It writes nothing: the
     * album's release ID changes only through Save ID, and Apply writes the
     * loaded release's tags.
     */
    function chooseRelease(release) {
        if (state.readOnly || state.busy || !fetch || !release || !release.id) return;

        var current = state.hasRelease && state.release && state.release.id
            ? mbzTagText(state.release.id)
            : '';
        if (release.id === current) return;

        setBusy(true);
        setStatus(sprintf(_('Reading release %s...'), release.id));

        var work = window.localPromise(fetch.fetchReleaseAsync(release.id)).then(function (loaded) {
            if (window._cleanUpCalled || !loaded) return null;

            state.release = loaded;
            state.hasRelease = true;
            state.pickedReleaseId = release.id;

            renderRelease({ release: loaded, releaseId: loaded.id });
            setAlbumIdStatus(GROUP_PICKED_NOTE);
            syncAlbumIdInput();
            renderGroupReleases();

            return buildPlanAsync(loaded).then(function () {
                if (window._cleanUpCalled) return;
                setStatus('');
            });
        });

        trackWork(handledInWindow(work, function (error) {
            setStatus(sprintf(_('Could not read that release: %s'), mbzTagErrorText(error)));
        })).then(function () {
            if (window._cleanUpCalled) return;
            setBusy(false);
        });
    }

    /**
     * The chooser's links carry the release ID they load. They are anchors, so
     * the press is consumed here rather than followed as a `#` link.
     */
    function onGroupClick(event) {
        var target = event && event.target;
        if (!target) return;

        var node = target;

        while (node && node !== UI.groupRows) {
            var retry = node.getAttribute && node.getAttribute('data-group-retry');
            var releaseId = node.getAttribute && node.getAttribute('data-release');

            if (retry || releaseId) {
                if (event.preventDefault) event.preventDefault();
                if (state.busy || state.readOnly) return;

                if (retry) {
                    retryGroupReleases();
                    return;
                }

                (state.groupReleases || []).forEach(function (release) {
                    if (release.id === releaseId) chooseRelease(release);
                });
                return;
            }

            node = node.parentNode;
        }
    }

    /**
     * One request for the loaded release's group, cached by group ID in
     * mbzFetch. The plan does not wait for it: the card fills in under the busy
     * ring, and a group that cannot be read costs nothing but the card.
     */
    function loadGroupReleasesAsync(release, keepCard) {
        var group = release && release['release-group'];
        var groupId = mbzTagText(group && group.id);

        state.groupReleases = [];
        state.groupRetryable = false;
        if (!keepCard) state.groupMessage = '';
        renderGroupReleases();

        // A release without a group has no list to offer; nothing is wrong.
        if (!groupId) return Promise.resolve();

        if (!fetch || typeof fetch.fetchReleaseGroupReleasesAsync !== 'function') {
            state.groupMessage = _('This window cannot list the releases of this group yet. Restart MediaMonkey so the new lookup is loaded.');
            renderGroupReleases();
            return Promise.resolve();
        }

        return trackWork(window.localPromise(fetch.fetchReleaseGroupReleasesAsync(groupId)).then(function (result) {
            if (window._cleanUpCalled) return;

            // A release picked while this was in flight must not be replaced by
            // the list of the release it replaced.
            var loaded = state.release && state.release['release-group'];
            if (mbzTagText(loaded && loaded.id) !== groupId) return;

            state.groupReleases = (result && result.releases) || [];
            state.groupMessage = '';
            state.groupRetryable = false;
            renderGroupReleases();
        }, function (error) {
            if (window._cleanUpCalled) return;

            if (typeof ODS === 'function') {
                ODS('Loves MBz: could not read the releases of the release group: '
                    + mbzTagErrorText(error));
            }

            state.groupReleases = [];
            state.groupMessage = sprintf(_('Could not read the other releases of this group: %s'),
                mbzTagErrorText(error));
            // Busy and network answers pass; a missing or unknown group does not.
            state.groupRetryable = canRetryRelease(error);
            renderGroupReleases();
        }));
    }

    /** Reads the group's releases again, keeping the card and its sentence. */
    function retryGroupReleases() {
        if (state.busy || !state.release) return;

        state.groupMessage = _('Reading the releases of this group...');
        state.groupRetryable = false;
        renderGroupReleases();
        loadGroupReleasesAsync(state.release, true);
    }

    /* ---------------------------------------------------------------- *
     * The two tabs and the saved field set (0.7.1)
     * ---------------------------------------------------------------- */

    var FIELD_SET_NOTE = _('Choose the fields the window offers. The ticks in Fields to write still decide what this Apply writes.');

    /** The saved set, read once. */
    function offeredKeys() {
        if (!state.offered) {
            state.offered = (apply && apply.readFieldSet) ? apply.readFieldSet() : [];
        }

        return state.offered;
    }

    function isOffered(key) {
        return offeredKeys().indexOf(key) !== -1;
    }

    function setFieldSetStatus(text) {
        if (UI.fieldSetStatus) UI.fieldSetStatus.textContent = text || '';
    }

    /**
     * One tab at a time. The window switches its own panels: the host's tab
     * control belongs to its properties modal, whose tabs load a track, and
     * this window loads its own selection, so the split is two panels in the
     * one scrolling column the guard pins.
     */
    function showTab(name) {
        var changes = name !== 'tagSet';

        show(UI.panelChanges, changes);
        show(UI.panelTagSet, !changes);

        if (UI.tabChanges) UI.tabChanges.classList.toggle('mbzTabActive', changes);
        if (UI.tabTagSet) UI.tabTagSet.classList.toggle('mbzTabActive', !changes);

        // The column's height is fixed, so it is measured again now that the
        // other panel is under it.
        fitScrollColumn();
    }

    function onTabClick(event) {
        var target = event && event.target;
        var name = target && target.getAttribute ? target.getAttribute('data-tab') : '';

        if (name) showTab(name);
    }

    /** The catalogue: every declared field, and what this release supplied. */
    function renderFieldSet() {
        scheduleTableSync();

        if (!UI.fieldSetRows || !apply) return;

        // What the release carries, not what the plan has left: the plan holds
        // only the fields that differ, so a match would read as "not supplied".
        var supplied = state.release ? apply.suppliedFields(state.release) : null;

        UI.fieldSetRows.textContent = '';

        apply.fieldCatalogue().forEach(function (field) {
            var row = document.createElement('tr');
            var checkCell = document.createElement('td');
            checkCell.className = 'mbzNowrap';

            var box = document.createElement('div');
            box.setAttribute('data-control-class', 'Checkbox');
            box.setAttribute('data-id', 'mbzFieldSet' + field.key);
            box.setAttribute('data-key', field.key);
            checkCell.appendChild(box);
            row.appendChild(checkCell);

            row.appendChild(mbzTagCell(field.label));
            row.appendChild(mbzTagCell(field.scope === 'album' ? _('Album') : _('Track'), 'mbzNowrap'));
            row.appendChild(mbzTagCell(field.target, 'mbzNowrap'));

            // A field this release did not supply is still listed: a missing
            // row would read as a lost setting.
            row.appendChild(mbzTagCell(supplied && !supplied[field.key]
                ? _('not supplied') : '', 'mbzNote'));

            UI.fieldSetRows.appendChild(row);

            if (typeof initializeControl === 'function') initializeControl(box);
            if (box.controlClass) box.controlClass.checked = isOffered(field.key);

            window.localListen(box, 'click', markFieldSetDirty);
            window.localListen(box, 'change', markFieldSetDirty);
        });

        lockFieldSet();
    }

    function markFieldSetDirty() {
        setFieldSetStatus(_('Not saved yet \u2014 press Save as default.'));
    }

    /**
     * Save as default writes a setting, never a tag: Apply stays the only
     * writer, and the ticks in Fields to write are untouched.
     */
    function saveFieldSet() {
        if (!apply || state.readOnly || state.busy) return;

        var keys = checkedKeysIn(UI.fieldSetRows);

        if (!apply.writeFieldSet(keys)) {
            setFieldSetStatus(_('Could not save the field set.'));
            return;
        }

        state.offered = keys;
        renderFields(state.plan);
        setFieldSetStatus(keys.length
            ? sprintf(_('Saved: %d fields offered.'), keys.length)
            : _('Saved: the window offers no field until you tick one here.'));
    }

    /** Puts the ticks back the way the setting has them. */
    function resetFieldSet() {
        if (!apply || state.readOnly || state.busy) return;

        state.offered = apply.readFieldSet();
        renderFieldSet();
        renderFields(state.plan);
        setFieldSetStatus(_('The ticks are the saved set again.'));
    }

    /** Party Mode and a running write lock the catalogue like the field rows. */
    function lockFieldSet() {
        var boxes = UI.fieldSetRows ? UI.fieldSetRows.querySelectorAll('[data-key]') : [];

        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].controlClass) boxes[i].controlClass.disabled = !!state.busy || state.readOnly;
        }

        if (UI.btnSaveFieldSet) {
            UI.btnSaveFieldSet.classList.toggle('mbzDisabled', !!state.busy || state.readOnly);
        }

        if (UI.btnResetFieldSet) {
            UI.btnResetFieldSet.classList.toggle('mbzDisabled', !!state.busy || state.readOnly);
        }
    }

    function makeNode(tag, className, id, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (id) node.setAttribute('data-id', id);
        if (text) node.textContent = text;
        return node;
    }

    /**
     * The catalogue, drawn by the window rather than written into the page: one
     * description, so an install whose page predates the tab gets the same
     * panel instead of a second, thinner copy that would drift from the page's.
     *
     * `host` is the page's mount point; a page older than the tab has none and
     * gets one built here.
     */
    function buildFieldSetPanel(host) {
        var panel = host || makeNode('div', 'mbzPanel mbzHidden', 'panelTagSet');
        var card = makeNode('fieldset', 'mbzSection mbzCard');

        card.appendChild(makeNode('legend', 'mbzCardTitle', '', _('MBZ tags to use')));
        card.appendChild(makeNode('label', 'mbzInfo', '', FIELD_SET_NOTE));

        var table = makeNode('table', 'mbzTable');
        var thead = makeNode('thead');
        var head = makeNode('tr');
        var titles = ['', _('Field'), _('Scope'), _('Written as'), _('This release')];

        for (var i = 0; i < titles.length; i++) head.appendChild(makeNode('th', '', '', titles[i]));

        thead.appendChild(head);
        table.appendChild(thead);

        var rows = makeNode('tbody', '', 'fieldSetRows');
        table.appendChild(rows);
        card.appendChild(table);

        var bar = makeNode('div', 'flex row mbzFieldSetBar');
        var save = makeNode('div', 'button mbzButton', 'btnSaveFieldSet', _('Save as default'));
        var reset = makeNode('div', 'button mbzButton', 'btnResetFieldSet', _('Reset to saved'));
        var status = makeNode('label', 'mbzNote fill', 'fieldSetStatus');

        bar.appendChild(save);
        bar.appendChild(reset);
        bar.appendChild(status);
        card.appendChild(bar);

        panel.appendChild(card);

        UI.panelTagSet = panel;
        UI.fieldSetRows = rows;
        UI.fieldSetStatus = status;
        UI.btnSaveFieldSet = save;
        UI.btnResetFieldSet = reset;

        return panel;
    }

    function buildTabBar() {
        var host = UI.scrollColumn && UI.scrollColumn.parentNode;
        if (!host || !host.insertBefore) return;

        var bar = makeNode('div', 'flex row mbzTabBar', 'tabBar');
        var changes = makeNode('div', 'button mbzButton mbzTab mbzTabActive', 'tabChanges', _('ID and changes'));
        var tagSet = makeNode('div', 'button mbzButton mbzTab', 'tabTagSet', _('MBZ tags to use'));

        changes.setAttribute('data-tab', 'changes');
        tagSet.setAttribute('data-tab', 'tagSet');

        bar.appendChild(changes);
        bar.appendChild(tagSet);
        host.insertBefore(bar, UI.scrollColumn);

        UI.tabBar = bar;
        UI.tabChanges = changes;
        UI.tabTagSet = tagSet;
    }

    /**
     * The tab bar and the first panel, built when the installed page has
     * neither, and the catalogue filled into its mount point (or into a panel
     * built here): MediaMonkey keeps the page it loaded at start-up, so a build
     * whose page is newer would otherwise look like it did not install.
     */
    function ensureTabs() {
        if (typeof document === 'undefined') return;

        if (!UI.panelChanges && UI.scrollColumn) {
            var changes = makeNode('div', 'mbzPanel', 'panelChanges');

            // The cards the page already has become the first panel.
            while (UI.scrollColumn.firstChild) changes.appendChild(UI.scrollColumn.firstChild);

            UI.scrollColumn.appendChild(changes);
            UI.panelChanges = changes;
        }

        if (!UI.fieldSetRows && UI.scrollColumn) {
            var host = UI.panelTagSet;
            var panel = buildFieldSetPanel(host);

            if (!host) UI.scrollColumn.appendChild(panel);
        }

        if (!UI.tabBar) buildTabBar();

        if (UI.tabBar) window.localListen(UI.tabBar, 'click', onTabClick);
        if (UI.btnSaveFieldSet) window.localListen(UI.btnSaveFieldSet, 'click', saveFieldSet);
        if (UI.btnResetFieldSet) window.localListen(UI.btnResetFieldSet, 'click', resetFieldSet);

        showTab('changes');
    }

    function renderFields(plan) {
        scheduleTableSync();

        if (!UI.fieldRows) return;

        UI.fieldRows.textContent = '';

        // The saved set decides which rows are offered; the ticks stay per
        // selection.
        var fields = ((plan && plan.fields) || []).filter(function (field) {
            return isOffered(field.key);
        });

        if (!fields.length) {
            show(UI.fieldsSection, false);
            updatePending();
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
                if (state.readOnly || state.busy) box.controlClass.disabled = true;
            }

            window.localListen(box, 'click', schedulePending);
            window.localListen(box, 'change', schedulePending);
        });

        show(UI.fieldsSection, true);
        updatePending();
    }

    /** The ticked keys in one table of controls: the field rows or the catalogue. */
    function checkedKeysIn(rows) {
        var keys = [];
        if (!rows) return keys;

        var boxes = rows.querySelectorAll('[data-key]');
        for (var i = 0; i < boxes.length; i++) {
            var checked = boxes[i].controlClass
                ? boxes[i].controlClass.checked
                : boxes[i].checked;
            if (checked) keys.push(boxes[i].getAttribute('data-key'));
        }

        return keys;
    }

    function checkedKeys() {
        return checkedKeysIn(UI.fieldRows);
    }

    /* ---------------------------------------------------------------- *
     * What Apply would write right now
     * ---------------------------------------------------------------- */

    function countLabel(count, singular, many) {
        return count + ' ' + (count === 1 ? singular : many);
    }

    /**
     * Ticked fields and staged tag edits, counted the way Apply writes them:
     * one field row writes on every track where it differs, and a tag edit is
     * written to every selected track.
     */
    function pendingWork() {
        var plan = state.plan;
        var keys = checkedKeys();
        var edits = collectEdits();
        var fieldChanges = 0;
        var fieldTracks = 0;

        ((plan && plan.entries) || []).forEach(function (entry) {
            var chosen = ((entry.pending && entry.pending.fields) || []).filter(function (field) {
                return keys.indexOf(field.key) >= 0;
            });

            if (!chosen.length) return;
            fieldChanges += chosen.length;
            fieldTracks++;
        });

        var removals = 0;
        edits.forEach(function (edit) {
            if (!edit.add && !mbzTagText(edit.value)) removals++;
        });

        return {
            fields: fieldChanges,
            tracks: fieldTracks,
            tags: edits.length,
            tagTracks: edits.length && plan ? (plan.entries || []).length : 0,
            removals: removals
        };
    }

    function updatePending() {
        if (!UI.pendingSummary) return;

        if (state.readOnly || !state.plan) {
            UI.pendingSummary.textContent = '';
            UI.pendingSummary.removeAttribute('title');
            return;
        }

        var work = pendingWork();

        if (!work.fields && !work.tags) {
            // A saved set that offers nothing is a setting, not a mistake: say
            // where to turn a field back on instead of asking for a tick that
            // has nowhere to go.
            var nothingOffered = !state.readOnly && !!state.plan
                && ((state.plan.fields || []).length) && !offeredKeys().length;

            UI.pendingSummary.textContent = nothingOffered
                ? _('No field is on in MBZ tags to use \u2014 turn one on, or edit a tag.')
                : _('Nothing to apply yet \u2014 tick a field or edit a tag.');
            UI.pendingSummary.removeAttribute('title');
            return;
        }

        var parts = [];

        if (work.fields) {
            parts.push(sprintf(_('Will write %s on %s'),
                countLabel(work.fields, _('field change'), _('field changes')),
                countLabel(work.tracks, _('track'), _('tracks'))));
        }

        if (work.tags) {
            var tagText = countLabel(work.tags, _('tag edit'), _('tag edits'));

            // Tag edits go to every selected track; say so when that is not
            // already the track count the field changes used.
            if (!work.fields || work.tagTracks !== work.tracks) {
                tagText += ' ' + sprintf(_('on %s'),
                    countLabel(work.tagTracks, _('track'), _('tracks')));
            }

            if (work.removals) {
                tagText += ' ' + (work.removals === 1
                    ? _('(1 removal)')
                    : sprintf(_('(%d removals)'), work.removals));
            }

            parts.push(work.fields ? tagText : sprintf(_('Will write %s'), tagText));
        }

        var text = parts.join(' \u00b7 ');
        UI.pendingSummary.textContent = text;
        UI.pendingSummary.title = text;
    }

    /**
     * A host checkbox updates its own state inside its click handler, so the
     * count is read once that handler has finished rather than beside it.
     */
    function schedulePending() {
        setTimeout(updatePending, 0);
    }

    /* ---------------------------------------------------------------- *
     * Selected tracks
     * ---------------------------------------------------------------- */

    function renderTracks(plan) {
        scheduleTableSync();

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
            row.appendChild(mbzTagCell(mbzTagArtistText(entry.artist)));
            row.appendChild(mbzTagCell(release ? release.title : '\u2014'));
            row.appendChild(mbzTagCell(release ? mbzTagArtistText(release.artist) : '\u2014'));
            row.appendChild(mbzTagCell(release ? mbzTagLength(release.length) : '', 'mbzNowrap'));

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
                input.disabled = state.readOnly || state.busy;
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
            return _('The extended tags of at least one selected track could not be read.');
        }

        if (state.scope && state.scope.tagOnly) {
            return _('These files carry no MusicBrainz extended tags. Add one below to set it on every file.');
        }

        if (state.scope && state.scope.songIds.length > 1) {
            return sprintf(_('No MusicBrainz extended tags are shared by all %d selected tracks. Add one below to set it on every selected track.'),
                state.scope.songIds.length);
        }

        return _('This track has no MusicBrainz extended tags. Add one below. The release, release-group and artist IDs live on the album and artist rows, not in ExtendedTags.');
    }

    function renderTagTable() {
        scheduleTableSync();

        if (!UI.tagRows) return;

        renderTagRows();
        setTagSummary();

        var empty = !state.rows.length;
        show(UI.tagTable, !empty);
        show(UI.tagEmpty, empty);
        if (empty && UI.tagEmpty) UI.tagEmpty.textContent = emptyTagText();

        renderSuggestions();
        updatePending();
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
        updatePending();
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
            if (state.busy) chip.classList.add('mbzDisabled');
            chip.title = item.title + ' = ' + item.value;
            chip.textContent = (item.info ? _(item.info.label) : item.title) + ' ' + mbzTagShortGuid(item.value);
            UI.suggestBar.appendChild(chip);
        });

        show(UI.suggestBar, true);
    }

    function addTagRow(title, value) {
        if (!mbz || state.readOnly || state.busy || !title || !value) return false;

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
        if (state.readOnly || state.busy || !mbz) return;

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
                if (state.busy) useNative.classList.add('mbzDisabled');
                useNative.setAttribute('data-diverge', 'tag');
                useNative.setAttribute('data-key', conflict.key);
                useNative.textContent = _('Use library ID');
                useNative.title = _('Put the library ID into the tag. Press Apply to save it.');
                item.appendChild(useNative);
            }

            if (!state.readOnly && canWrite) {
                var useTag = document.createElement('div');
                useTag.className = 'button';
                if (state.busy) useTag.classList.add('mbzDisabled');
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

        if (state.readOnly || state.busy || !mbz) return;

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
        if (state.busy) return;

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

    /**
     * The selected files' own extended tags, in selection order. Outside the
     * library this is where the tags live: there is no Songs row to read, and
     * Apply writes them back with commitAsync.
     */
    var FILE_TAGS_TIMEOUT_MS = 4000;    // one file's tags
    var FILE_TAGS_BUDGET_MS = 15000;    // the whole selection

    function loadFileTagsAsync(scope) {
        var tracks = (scope && scope.tracks) || [];
        var lists = [];
        var deadline = Date.now() + FILE_TAGS_BUDGET_MS;

        function skipRest(index) {
            while (index < tracks.length) {
                lists.push([]);
                index++;
            }

            return lists;
        }

        function next(index) {
            if (index >= tracks.length) return Promise.resolve(lists);

            var track = tracks[index];
            if (!track || typeof track.getExtendedTagsAsync !== 'function') {
                lists.push([]);
                return next(index + 1);
            }

            // A file whose tags never come back must not hold the window open:
            // the release ID field and Search MusicBrainz are already usable.
            if (Date.now() > deadline) {
                state.tagsUnreadable = true;
                return Promise.resolve(skipRest(index));
            }

            var read = apply && typeof apply.readTrackTagsAsync === 'function'
                ? apply.readTrackTagsAsync(track, FILE_TAGS_TIMEOUT_MS)
                : track.getExtendedTagsAsync();

            return window.localPromise(read).then(function (value) {
                if (window._cleanUpCalled) return lists;

                var parsed = apply && apply.parseTags ? apply.parseTags(value) : null;
                lists.push(Array.isArray(parsed) ? parsed : []);
                return next(index + 1);
            }, function () {
                // Unreadable is not the same as empty: the window says so.
                state.tagsUnreadable = true;
                lists.push([]);
                return next(index + 1);
            });
        }

        return next(0);
    }

    /** A stored tag's value, tolerating the spellings the engine collapses. */
    function tagTextFrom(tags, title) {
        var list = tags || [];

        for (var i = 0; i < list.length; i++) {
            var tag = list[i];
            if (!tag) continue;

            var matches = apply && typeof apply.tagNameMatches === 'function'
                ? apply.tagNameMatches(tag.title, title)
                : String(tag.title || '').toLowerCase() === String(title).toLowerCase();

            if (matches) return mbzTagText(tag.value);
        }

        return '';
    }

    function loadTagRowsAsync(scope) {
        state.tagsById = null;
        state.tagsUnreadable = false;

        // Files outside the library: read the tags from the files themselves,
        // because there is no Songs row to read them from.
        if (scope && scope.tagOnly) {
            return window.localPromise(loadFileTagsAsync(scope)).then(function (lists) {
                if (window._cleanUpCalled) return;

                state.fileTagLists = lists;
                state.fileReleaseId = tagTextFrom(lists[0], 'MUSICBRAINZ_ALBUMID');
                state.rows = buildRows(lists, lists.length);
            });
        }

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

    /** A failed release lookup: what the window says and whether Retry helps. */
    function reportReleaseError(error) {
        var retryable = canRetryRelease(error);

        setSummary(sprintf(_('Could not read the release: %s'), mbzTagErrorText(error)), true);
        setNote(retryable
            ? _('The release ID is unchanged and nothing was written. Press Retry to look it up again.')
            : _('The release ID is unchanged and nothing was written. Check the album release ID, or clear it and search MusicBrainz for the right release.'));
        showRetry(retryable);
        return { skipped: true, reason: 'error' };
    }

    function loadReleaseAsync(scope) {
        if (!fetch) return Promise.resolve({ skipped: true, reason: 'no-album' });

        if (!(scope.albumId > 0)) {
            // Files outside the library: nothing is read from MusicBrainz on
            // its own. The release is only ever the one the user loaded in the
            // field, so an empty release ID costs no request at all.
            if (state.hasRelease && state.release) {
                return Promise.resolve({
                    releaseId: mbzTagText(state.release.id || state.fileReleaseId),
                    release: state.release
                });
            }

            return Promise.resolve({ skipped: true, reason: 'no-release-id' });
        }

        // A release picked out of the group is the one the window is working
        // on, even though the album row still points at its own: a reload
        // after Apply must not drop the picking behind the user's back.
        if (state.pickedReleaseId) {
            var picked = state.pickedReleaseId;

            return window.localPromise(fetch.fetchReleaseAsync(picked)).then(function (release) {
                return { releaseId: picked, release: release };
            }, function (error) {
                state.pickedReleaseId = '';
                return reportReleaseError(error);
            });
        }

        return window.localPromise(fetch.previewAsync(scope.albumId)).then(function (result) {
            return result;
        }, reportReleaseError);
    }

    /**
     * Repeats the release lookup in place. The tag edits and every other value
     * in the window stay as they are: only the release is fetched again.
     */
    function retryRelease() {
        if (state.busy || !state.scope || !fetch) return;

        var scope = state.scope;

        showRetry(false);
        setSummary(_('Reading the release from MusicBrainz...'), true);

        trackWork(window.localPromise(loadReleaseAsync(scope)).then(function (result) {
            if (window._cleanUpCalled) return null;

            if (!result || result.skipped) {
                // A failed retry has already put its own message on screen.
                if (!result || result.reason !== 'error') {
                    renderSkipped(result || { reason: 'no-album' });
                    state.hasRelease = false;
                    state.release = null;
                }
                return buildPlanAsync(null);
            }

            state.release = result.release;
            state.hasRelease = true;
            renderRelease(result);
            return buildPlanAsync(result.release);
        }).then(function () {
            if (window._cleanUpCalled) return;
            syncAlbumIdInput();
            loadGroupReleasesAsync(state.release);
        }));
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
        // Outside the library there are no album, artist or song rows to read:
        // nothing to suggest, and nothing for the strip to reconcile.
        if (scope && scope.tagOnly) {
            state.suggestions = [];
            state.natives = null;
            state.groupNative = null;
            renderSuggestions();
            renderDivergence();
            renderLinks();
            return Promise.resolve();
        }

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
            refreshApply();
            renderFields(plan);
            renderFieldSet();
            renderTracks(plan);
            renderWarnings(plan);
        }, function (error) {
            if (window._cleanUpCalled) return;
            setNote(sprintf(_('Could not compare the release with the library: %s'),
                mbzTagErrorText(error)));
        });
    }

    /** The way in for files outside the library, shown before their tags. */
    function showFileLookup() {
        syncAlbumIdInput();

        var info = searchTerms();
        if (info) setSearch(mbzTagSearchUrl(info.album, info.artist));
    }

    function reloadAsync() {
        var scope = state.scope;
        if (!scope) return Promise.resolve();

        showRetry(false);
        state.plan = null;
        updatePending();
        refreshApply();
        setStatus('');
        setTagStatus('');

        // Outside the library the release ID field and the search link are the
        // only way in, so they appear before the files' tags are read: a slow
        // or missing tag read must never leave the window with nothing to use.
        if (scope.tagOnly) showFileLookup();

        return trackWork(loadTagRowsAsync(scope).then(function () {
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
            return buildPlanAsync(result.release).then(function () {
                if (window._cleanUpCalled) return;
                loadGroupReleasesAsync(result.release);
            });
        }).then(function () {
            if (window._cleanUpCalled) return null;
            syncAlbumIdInput();
            return loadLibraryContextAsync(scope);
        }));
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
        // Name the failing tracks: a run that stopped on one track has to say
        // which one and why, not just how many failed.
        var shown = Math.min(result.failed.length, 6);

        for (var failureIndex = 0; failureIndex < shown; failureIndex++) {
            message += '\n' + (result.failed[failureIndex].title || _('a track'))
                + ': ' + (result.failed[failureIndex].error || '');
        }

        if (result.failed.length > shown) {
            message += '\n' + sprintf(_('...and %d more.'), result.failed.length - shown);
        }

        return message;
    }

    function canApply() {
        return !state.readOnly && !state.busy && !!state.plan;
    }

    /**
     * Apply is grey until there is a plan to apply, and while a write runs. The
     * tooltip says why, because a grey button with no reason reads as a bug.
     */
    function refreshApply() {
        if (!UI.btnApply) return;

        UI.btnApply.classList.toggle('mbzDisabled', !canApply());

        if (!state.plan) {
            UI.btnApply.title = _('Waiting for the release comparison to finish.');
        } else {
            UI.btnApply.removeAttribute('title');
        }
    }

    /**
     * Locks the whole editable surface while a write is running. An edit typed
     * after Apply has read its inputs would otherwise be discarded by the
     * reload that follows the write.
     */
    function setBusy(on) {
        state.busy = !!on;

        if (UI.btnSaveAlbumId) UI.btnSaveAlbumId.classList.toggle('mbzDisabled', state.busy);
        if (UI.btnRetry) UI.btnRetry.classList.toggle('mbzDisabled', state.busy);
        if (UI.addButton) {
            UI.addButton.classList.toggle('mbzDisabled', state.busy || state.readOnly);
        }

        var addTag = mbzTagControl(UI.addTag);
        var addValue = mbzTagControl(UI.addValue);
        var albumId = mbzTagControl(UI.albumIdValue);

        if (addTag) addTag.disabled = state.busy || state.readOnly;
        if (addValue) addValue.disabled = state.busy || state.readOnly;
        if (albumId) albumId.disabled = state.busy;

        var values = UI.tagRows ? UI.tagRows.querySelectorAll('input.mbzValue') : [];

        for (var i = 0; i < values.length; i++) {
            values[i].disabled = state.busy || state.readOnly;
        }

        var boxes = UI.fieldRows ? UI.fieldRows.querySelectorAll('[data-key]') : [];

        for (var b = 0; b < boxes.length; b++) {
            if (boxes[b].controlClass) {
                boxes[b].controlClass.disabled = state.busy || state.readOnly;
            }
        }

        lockFieldSet();

        var chips = UI.suggestBar ? UI.suggestBar.querySelectorAll('.mbzChip') : [];

        for (var c = 0; c < chips.length; c++) {
            chips[c].classList.toggle('mbzDisabled', state.busy);
        }

        var buttons = UI.divergeBar ? UI.divergeBar.querySelectorAll('.button') : [];

        for (var d = 0; d < buttons.length; d++) {
            buttons[d].classList.toggle('mbzDisabled', state.busy);
        }

        // A release picked from the group is a load, not a write: it is locked
        // with the rest so the window cannot change under a running write.
        var picks = UI.groupRows ? UI.groupRows.querySelectorAll('[data-release], [data-group-retry]') : [];

        for (var g = 0; g < picks.length; g++) {
            picks[g].classList.toggle('mbzDisabled', state.busy || state.readOnly);
        }

        refreshApply();
    }

    function applyNow() {
        if (state.readOnly || state.busy || !state.plan || !apply) return;

        var keys = checkedKeys();
        var edits = collectEdits();

        if (!keys.length && !edits.length) {
            setStatus(_('Tick a field or change a tag to apply.'));
            return;
        }

        var plan = state.plan;

        setBusy(true);
        setStatus(_('Writing...'));

        var work = window.localPromise(apply.applySelectionAsync(plan, keys, edits, function (index, total) {
            if (window._cleanUpCalled) return;

            setStatus(sprintf(_('Writing %d of %d...'), Math.min(index + 1, total), total));
        })).then(function (result) {
            if (window._cleanUpCalled) return;

            var message = reportText(result);

            // The report is shown whether or not the reload that follows it
            // works, because the write has already happened.
            return window.localPromise(reloadAsync()).then(function () {
                if (window._cleanUpCalled) return;
                setStatus(message);
            }, function () {
                if (window._cleanUpCalled) return;
                setStatus(message);
            });
        });

        trackWork(handledInWindow(work, function (error) {
            setStatus(sprintf(_('Could not write: %s'), mbzTagErrorText(error)));
        })).then(function () {
            if (window._cleanUpCalled) return;
            setBusy(false);
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
        lockFieldSet();

        show(UI.btnApply, !state.readOnly);
        show(UI.addBar, !state.readOnly);
        refreshApply();
        if (UI.addButton) UI.addButton.classList.toggle('mbzDisabled', state.readOnly);

        var addTag = mbzTagControl(UI.addTag);
        var addValue = mbzTagControl(UI.addValue);
        if (addTag) addTag.disabled = state.readOnly;
        if (addValue) addValue.disabled = state.readOnly;

        populateAddChoices();
        pinFieldLayout();

        if (!apply || !mbz) {
            setSummary(_('The MusicBrainz modules did not load. Check debug.log for lines starting with "Loves MBz:".'));
            return;
        }

        setSummary(_('Reading the selection...'));

        trackWork(window.localPromise(apply.collectSelectionAsync(sourceList)).then(function (tracks) {
            if (window._cleanUpCalled) return null;

            if (!tracks.length) {
                setSummary(_('No library tracks are selected.'));
                return null;
            }

            state.fileSeparator = mbzTagSeparatorForFile(tracks[0].path);

            return window.localPromise(apply.resolveTagScope(tracks)).then(function (scope) {
                if (window._cleanUpCalled) return null;

                state.scope = scope;

                // Files outside the library are scoped by album name: two
                // records in one window have no release to agree on.
                if (scope.tagOnly && scope.albumNameConflict) {
                    setSummary(_('These files do not carry the same album name.'), true);
                    setNote(_('Tag from MusicBrainz works on one album at a time: select files whose album name matches, or where it is empty on all of them.'));
                    return null;
                }

                // One album at a time. The entry point already asked; this is
                // the same rule applied again, so the two cannot disagree.
                if (scope.multiAlbum && !forced) {
                    setSummary(sprintf(
                        _('This selection spans %d albums. Tag from MusicBrainz works on one album at a time.'),
                        scope.albumIds.length));
                    setNote(_('Close the window, select one album, or confirm the prompt when you open the window.'));
                    return null;
                }

                // Files outside the library have no release to read until the
                // user loads one: say what is actually being read, so an empty
                // release ID never looks like a lookup in progress.
                setSummary(scope.tagOnly
                    ? _('Reading the files\' tags...')
                    : _('Reading the release from MusicBrainz...'));
                return reloadAsync();
            });
        })).catch(function (error) {
            if (window._cleanUpCalled) return;
            setSummary(sprintf(_('Could not read the selection: %s'), mbzTagErrorText(error)));
        });
    }

    if (UI.buildStamp) {
        UI.buildStamp.textContent = 'Loves MBz ' + ADDON_VERSION
            + (BUILD_CHANNEL ? '-' + BUILD_CHANNEL : '')
            + (BUILD_TIME ? ' \u00b7 ' + BUILD_TIME : '');
    }

    if (UI.btnRetry) UI.btnRetry.title = _('Look the release up again without closing the window.');

    ensureGroupCard();
    ensureTabs();
    pinCardSpacing();
    italicizeInfo();
    resetView();
    renderFieldSet();

    if (UI.btnSearch) window.localListen(UI.btnSearch, 'click', openSearch);
    if (UI.btnRetry) window.localListen(UI.btnRetry, 'click', retryRelease);
    if (UI.fieldRows) window.localListen(UI.fieldRows, 'click', updatePending);
    if (UI.fieldRows) window.localListen(UI.fieldRows, 'change', updatePending);
    if (UI.groupRows) window.localListen(UI.groupRows, 'click', onGroupClick);
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
