'use strict';

/*
 * Loves MBz
 *
 * Startup entry point. Loads the MusicBrainz ID access layer, starts the
 * background cache that feeds the three tracklist columns, and rebuilds that
 * cache when MediaMonkey commits a tag change, so IDs written by MediaMonkey's
 * own MusicBrainz lookup appear without restarting.
 */

requirejs('actions');
localRequirejs('mbzMbgid');

var REFRESH_DELAY_MS = 1200;
var refreshTimer = null;

/**
 * MediaMonkey raises trackModified once a track change is committed and
 * commonChange for the other cases (artist edits, new artists/genres). One
 * edit over a selection raises a burst of them, so wait for the burst to end
 * before re-reading the tables.
 */
function scheduleCacheRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(function () {
        refreshTimer = null;

        if (!window.mbzMbgid || window._cleanUpCalled) return;

        window.mbzMbgid.reload().then(function () {
            var state = window.mbzMbgid.getState();
            if (state.error && typeof ODS === 'function') {
                ODS('Loves MBz: cache refresh failed: ' + state.error);
            }
        });
    }, REFRESH_DELAY_MS);
}

function startCache() {
    if (!window.mbzMbgid) return;

    window.mbzMbgid.startCacheLoad();

    if (typeof app !== 'undefined' && app.listen) {
        app.listen(app, 'trackModified', scheduleCacheRefresh);
        app.listen(app, 'commonChange', scheduleCacheRefresh);
    }
}

if (typeof whenReady === 'function') {
    whenReady(startCache);
} else {
    startCache();
}
