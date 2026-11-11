'use strict';

/*
 * Loves MBz
 *
 * Startup entry point. Loads the MusicBrainz ID access layer, starts the
 * background cache that feeds the three tracklist columns, keeps that cache
 * current, and adds the Tag from MusicBrainz button to the right-hand toolbar
 * strip.
 *
 * Change events queue only the tracks, albums and artists they name, and the
 * queued rows are re-read once the burst ends.
 */

requirejs('actions');
localRequirejs('mbzMbgid');
localRequirejs('mbzApply');

var REFRESH_DELAY_MS = 1200;

/*
 * The action is hotkeyAble with an icon, so it is already available under
 * Options → Layout → Toolbar. The add-on also puts a button in the right-hand
 * strip (`righttoolbuttons`) on start-up, next to MediaMonkey's own tool
 * buttons and the other add-ons' icons — not in `toolbarItems`, which is the
 * custom toolbar and would give the add-on a row of its own.
 */
var TOOLBAR_ICON = 'lovesMBz';
var TOOLBAR_ACTION_KEY = 'lovesMBzTag';
var TOOLBAR_ADD_DELAY_MS = 2000;

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

/** `toolbarItems` is an array of action keys, as the Layout page saves it. */
function readToolbarItems() {
    var value = [];

    try {
        if (typeof app !== 'undefined' && app.getValue) value = app.getValue('toolbarItems', []);
    } catch (e) {
        value = [];
    }

    if (Array.isArray(value)) {
        return value.map(function (item) {
            return String(item || '').trim();
        }).filter(function (item) {
            return !!item;
        });
    }

    return String(value || '').split(',').map(function (item) {
        return item.trim();
    }).filter(function (item) {
        return !!item;
    });
}

/**
 * The custom toolbar (`customtoolbuttons`) reads `toolbarItems` and rebuilds
 * itself on MediaMonkey's `settingschange`. The control is reachable the same
 * way the host reaches it, so it can be rebuilt at once instead of waiting for
 * the next settings change.
 */
function refreshCustomToolbar() {
    try {
        var element = typeof qid === 'function' ? qid('customtoolbuttons') : null;
        var control = element && element.controlClass;
        if (control && typeof control.refreshItems === 'function') control.refreshItems();
    } catch (e) {
        // The value is stored either way; the toolbar picks it up on its own
        // refresh if this fails.
    }
}

function findToolbarButton() {
    try {
        var parent = typeof qid === 'function' ? qid('righttoolbuttons') : null;
        return parent ? parent.querySelector('[data-icon="' + TOOLBAR_ICON + '"]') : null;
    } catch (e) {
        return null;
    }
}

/**
 * What the button runs. It resolves the selection and calls the same scope
 * prompt the menu action uses, instead of going through the action registry:
 * this script is not the actions module, and the action's own `execute` may be
 * unavailable here even though the menu works.
 */
/**
 * The first control in `container` whose own selection is non-empty. Only
 * `getSelectedTracklist` is used: `getTracklist` would hand back the whole
 * library view, not the selected tracks.
 */
function findSelectedTracklist(container) {
    if (!container || !container.querySelectorAll) return null;

    var nodes = container.querySelectorAll('[data-control-class]');

    for (var i = 0; i < nodes.length; i++) {
        var control = nodes[i].controlClass;
        if (!control) continue;

        var sources = [control, control.dataSource];

        for (var s = 0; s < sources.length; s++) {
            var source = sources[s];
            if (!source || typeof source.getSelectedTracklist !== 'function') continue;

            try {
                var list = source.getSelectedTracklist();
                if (list && list.count > 0) return list;
            } catch (e) {
                // try the next candidate
            }
        }
    }

    return null;
}

function openTagWindow() {
    var list = null;

    try {
        list = uitools && uitools.getSelectedTracklist ? uitools.getSelectedTracklist() : null;
    } catch (e) {
        list = null;
    }

    // A toolbar click on a freshly started MediaMonkey can find no "last
    // focused" list even though tracks are selected (the host only tracks the
    // last control the user touched), so look for a list that reports its own
    // selection instead of failing with nothing to act on.
    if (!list && typeof qid === 'function') {
        list = findSelectedTracklist(qid('mainpanel')) || findSelectedTracklist(document);
    }

    // actions_add.js publishes this: the button runs in a different script
    // context, where this file cannot reach `actions` or the module's helpers.
    if (list && typeof window.mbzOpenTagSelection === 'function') {
        try {
            window.mbzOpenTagSelection(list);
        } catch (error) {
            if (typeof ODS === 'function') ODS('Loves MBz: could not open the window: ' + error);
        }
        return;
    }

    if (!list) {
        if (typeof ODS === 'function') ODS('Loves MBz: the toolbar button found no track list.');
        return;
    }

    try {
        if (window.actions && window.actions.lovesMBzTag) {
            window.actions.lovesMBzTag.execute();
            return;
        }
    } catch (error) {
        if (typeof ODS === 'function') ODS('Loves MBz: toolbar action failed: ' + error);
    }

    if (typeof ODS === 'function') ODS('Loves MBz: the toolbar button has no entry point.');
}

/**
 * Adds the button to the right-hand strip (`righttoolbuttons`), next to
 * MediaMonkey's own tool buttons and the other add-ons' icons. That strip is
 * static, so the button survives settings changes, unlike the custom toolbar,
 * which is rebuilt from `toolbarItems` and would give the add-on a row of its
 * own.
 *
 * MediaMonkey's `addToolButton` is the supported way in: it builds the
 * ToolButton control, its tooltip and its click handler.
 */
function ensureToolbarButton() {
    if (window._cleanUpCalled) return;
    if (typeof uitools === 'undefined' || typeof uitools.addToolButton !== 'function') return;
    if (findToolbarButton()) return;

    try {
        uitools.addToolButton('righttoolbuttons', TOOLBAR_ICON, openTagWindow,
            _('Tag from MusicBrainz'));
    } catch (error) {
        if (typeof ODS === 'function') {
            ODS('Loves MBz: could not add the toolbar button: ' + error);
        }
    }
}

/**
 * 0.5.0 and 0.5.1 appended the action key to `toolbarItems`, which is the
 * *custom* toolbar: it gets a row of its own. Take that entry back out so the
 * stray row disappears.
 */
function removeLegacyToolbarItem() {
    var items = readToolbarItems();
    if (items.indexOf(TOOLBAR_ACTION_KEY) === -1) return;

    var kept = items.filter(function (item) {
        return item !== TOOLBAR_ACTION_KEY;
    });

    try {
        app.setValue('toolbarItems', kept);
        if (app.flushState) app.flushState();
    } catch (e) {
        return;
    }

    refreshCustomToolbar();
}

function start() {
    startCache();

    setTimeout(function () {
        removeLegacyToolbarItem();
        ensureToolbarButton();
    }, TOOLBAR_ADD_DELAY_MS);
}

if (typeof whenReady === 'function') {
    whenReady(start);
} else {
    start();
}
