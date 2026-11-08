'use strict';

/*
 * Loves MBz
 *
 * Startup entry point. Loads the MusicBrainz ID access layer, starts the
 * background cache that feeds the three tracklist columns, and keeps that cache
 * current: change events queue only the tracks, albums and artists they name,
 * and the queued rows are re-read once the burst ends.
 */

requirejs('actions');
localRequirejs('mbzMbgid');

var REFRESH_DELAY_MS = 1200;
var refreshTimer = null;

var pendingSongIds = {};
var pendingAlbumIds = {};
var pendingArtistIds = {};

function addId(map, value) {
    var id = parseInt(value, 10);
    if (id > 0) map[id] = true;
}

function takeIds(map) {
    var ids = Object.keys(map).map(Number);
    Object.keys(map).forEach(function (key) {
        delete map[key];
    });
    return ids;
}

function scheduleCacheRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(flushCacheRefresh, REFRESH_DELAY_MS);
}

/**
 * One edit over a selection raises a burst of events; the timer above waits for
 * the burst to end, then this re-reads whatever it collected.
 */
function flushCacheRefresh() {
    refreshTimer = null;

    if (!window.mbzMbgid || window._cleanUpCalled) return;

    var change = {
        songIds: takeIds(pendingSongIds),
        albumIds: takeIds(pendingAlbumIds),
        artistIds: takeIds(pendingArtistIds)
    };

    if (!change.songIds.length && !change.albumIds.length && !change.artistIds.length) return;

    window.mbzMbgid.refreshAsync(change).then(function () {
        var state = window.mbzMbgid.getState();
        if (state.error && typeof ODS === 'function') {
            ODS('Loves MBz: cache refresh failed: ' + state.error);
        }
    });
}

/**
 * A committed track change. The album is resolved from the database by
 * mbzMbgid, since the track may have moved to another album.
 */
function onTrackModified(track) {
    if (!track) return;

    addId(pendingSongIds, track.id);
    addId(pendingAlbumIds, track.albumId);
    scheduleCacheRefresh();
}

/**
 * commonChange reports (`what`, `how`, `instance`): 'artist' and 'album' cover
 * the IDs MediaMonkey writes from its own MusicBrainz lookup, 'track' is a
 * track edit. Everything else (playlists, devices, genres) is ignored rather
 * than triggering a reload of tables it cannot affect.
 */
function onCommonChange(what, how, instance) {
    if (!instance) return;

    if (what === 'artist') {
        addId(pendingArtistIds, instance.id);
    } else if (what === 'album') {
        addId(pendingAlbumIds, instance.id);
    } else if (what === 'track' || what === 'song') {
        addId(pendingSongIds, instance.id);
        addId(pendingAlbumIds, instance.albumId);
    } else {
        return;
    }

    scheduleCacheRefresh();
}

function startCache() {
    if (!window.mbzMbgid) return;

    window.mbzMbgid.startCacheLoad();

    if (typeof app !== 'undefined' && app.listen) {
        app.listen(app, 'trackModified', onTrackModified);
        app.listen(app, 'commonChange', onCommonChange);
    }
}

if (typeof whenReady === 'function') {
    whenReady(startCache);
} else {
    startCache();
}
