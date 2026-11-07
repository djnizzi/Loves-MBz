'use strict';

/*
 * Loves MBz — three read-only tracklist columns backed by the MusicBrainz
 * IDs MediaMonkey keeps in its database but does not show:
 *
 *   Albums.MBGID   -> MusicBrainz Release ID
 *   Albums.MBRGGID -> MusicBrainz Release Group ID
 *   Artists.MBGID  -> MusicBrainz Artist ID
 *
 * The values come from window.mbzMbgid (mbzMbgid.js), which preloads them once
 * per session. Cells render empty until that cache is ready, then the view is
 * refreshed. Nothing here writes to the database.
 */

(function () {
    if (!window.uitools || !window.uitools.tracklistFieldDefs) {
        if (typeof ODS === 'function') {
            ODS('Loves MBz: uitools.tracklistFieldDefs is not available');
        }
        return;
    }

    var loadAttempted = false;

    // Normally init.js has already loaded the module. The lazy fallback keeps
    // the columns working in secondary windows that load this control but not
    // the addon's init.js (e.g. an undocked track list).
    function api() {
        if (!window.mbzMbgid && !loadAttempted) {
            loadAttempted = true;
            try {
                if (typeof localRequirejs === 'function') {
                    localRequirejs('mbzMbgid');
                    if (window.mbzMbgid) window.mbzMbgid.startCacheLoad();
                }
            } catch (e) {
                if (typeof ODS === 'function') {
                    ODS('Loves MBz: could not load mbzMbgid.js: ' + (e && e.message ? e.message : e));
                }
            }
        }
        return window.mbzMbgid;
    }

    function albumIdOf(item) {
        return (item && item.idalbum !== undefined) ? item.idalbum : 0;
    }

    function releaseIdOf(item) {
        var mbz = api();
        return mbz ? mbz.releaseIdForAlbum(albumIdOf(item)) : '';
    }

    function releaseGroupIdOf(item) {
        var mbz = api();
        return mbz ? mbz.releaseGroupIdForAlbum(albumIdOf(item)) : '';
    }

    function artistIdsOf(item) {
        var mbz = api();
        return (mbz && item) ? mbz.artistIdsForSong(item.id) : '';
    }

    function makeColumn(title, getter, width) {
        return {
            title: title,
            disabled: false,
            checked: false,
            width: width,
            minWidth: '5em',
            notForAlbum: true, // every ID is per track, not an album summary value
            bindData: function (div, item) {
                var value = getter(item);
                div.textContent = value;

                if (value) {
                    div.setAttribute('data-tip', value);
                } else {
                    div.removeAttribute('data-tip');
                }
            },
            getValue: function (item) {
                return getter(item);
            }
        };
    }

    // Keys are prefixed with mbz to stay unique in MediaMonkey's global field registry.
    window.uitools.tracklistFieldDefs.mbzReleaseId = makeColumn(
        _('MusicBrainz Release ID'),
        releaseIdOf,
        '19em'
    );

    window.uitools.tracklistFieldDefs.mbzReleaseGroupId = makeColumn(
        _('MusicBrainz Release Group ID'),
        releaseGroupIdOf,
        '22em'
    );

    window.uitools.tracklistFieldDefs.mbzArtistId = makeColumn(
        _('MusicBrainz Artist ID'),
        artistIdsOf,
        '19em'
    );

    // Put the columns in their own group in the column chooser instead of "Other".
    var groups = window.uitools.tracklistFieldGroups;
    if (groups && groups.push) {
        var groupTitle = _('MusicBrainz IDs');
        var exists = false;

        for (var i = 0; i < groups.length; i++) {
            if (groups[i] && (String(resolveToValue(groups[i].group, '')) === groupTitle)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            groups.push({
                group: groupTitle,
                fields: ['mbzReleaseId', 'mbzReleaseGroupId', 'mbzArtistId']
            });
        }
    }
})();
