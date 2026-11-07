'use strict';

/*
 * Loves MBz
 *
 * Startup entry point. Loads the MusicBrainz ID access layer and starts the
 * background cache that feeds the three tracklist columns.
 *
 * The cache is built once per MediaMonkey session. MediaMonkey persists MBGIDs
 * when a release/artist is matched through its own MusicBrainz lookup, so
 * restart MediaMonkey (or reload the addon) to pick up IDs added afterwards;
 * the dialog always queries the database directly and is never stale.
 */

requirejs('actions');
localRequirejs('mbzMbgid');

function startCache() {
    if (window.mbzMbgid) {
        window.mbzMbgid.startCacheLoad();
    }
}

if (typeof whenReady === 'function') {
    whenReady(startCache);
} else {
    startCache();
}
