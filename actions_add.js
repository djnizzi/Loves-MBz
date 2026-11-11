'use strict';

/*
 * Loves MBz — menu actions.
 *
 * Registered in Edit > Tag Tools and, because track lists share that menu
 * branch, in the track list context menu as well. The same action is what the
 * toolbar button runs (see init.js). The column cache refreshes itself on
 * MediaMonkey's change events, so there is no manual reload action here.
 */

/*
 * The toolbar button (init.js) runs in another script context, so it can see
 * neither this module's functions nor the action registry. Publish the one
 * entry point it needs: the same scope prompt and window the menu action uses.
 */
window.mbzOpenTagSelection = function (list) {
    list = list || (uitools.getSelectedTracklist ? uitools.getSelectedTracklist() : null);
    if (!list) {
        if (typeof ODS === 'function') ODS('Loves MBz: no track list to open the window on.');
        return false;
    }

    mbzTagScopeAsync(list).then(function (scope) {
        if (scope) mbzOpenTagDialog(scope);
    }, function (error) {
        if (typeof ODS === 'function') ODS('Loves MBz: could not open the window: ' + error);
    });

    return true;
};

actions.lovesMBzShowIds = {
    title: _('MusicBrainz IDs') + '...',
    hotkeyAble: true,
    icon: 'lovesMBz',
    disabled: uitools.notMediaListSelected,
    execute: function () {
        var list = uitools.getSelectedTracklist();
        if (!list) return;

        uitools.openDialog('dlgLovesMBz', {
            show: true,
            modal: false,
            title: _('Loves MBz'),
            tracks: list
        });
    }
};

/**
 * The first selected track's song and album ids. MediaMonkey 2024 throws
 * "Read lock not acquired!" when a shared Track property is read outside a
 * read lock, so the two values are copied while the list is locked.
 */
function mbzSelectedIdsFromList(list) {
    var ids = { songId: 0, albumId: 0 };

    if (!list) return ids;

    // firstSelected is the least fragile way to read the selection while the
    // list is loading; locked() may defer its callback.
    try {
        var track = list.firstSelected;
        if (track) {
            ids.songId = parseInt(track.id, 10) || 0;
            ids.albumId = parseInt(track.idalbum, 10) || 0;
            return ids;
        }
    } catch (e) {
        // fall through to the value helpers
    }

    try {
        var albumIds = list.getAllValues ? list.getAllValues('idalbum') : [];
        var songIds = list.getAllValues ? list.getAllValues('id') : [];
        ids.albumId = albumIds && albumIds.length ? parseInt(albumIds[0], 10) || 0 : 0;
        ids.songId = songIds && songIds.length ? parseInt(songIds[0], 10) || 0 : 0;
        if (ids.albumId > 0 || ids.songId > 0) return ids;
    } catch (e) {
        // fall back to a read lock below
    }

    function read() {
        var first = list.getValue ? list.getValue(0) : null;
        if (!first) return;

        ids.songId = parseInt(first.id, 10) || 0;
        ids.albumId = parseInt(first.idalbum, 10) || 0;
    }

    if (typeof list.locked === 'function') list.locked(read);
    else read();

    return ids;
}

function mbzSelectedIds() {
    return mbzSelectedIdsFromList(uitools.getSelectedTracklist());
}

/**
 * Links the cached ids make possible for the selection, in menu order. An
 * artist can store several MBIDs in one value; the page for the first one is
 * offered, which is the artist MediaMonkey matched.
 */
function mbzSelectionLinks() {
    var mbz = window.mbzMbgid;
    if (!mbz) return [];

    var ids = mbzSelectedIds();
    var links = [];

    var releaseId = ids.albumId ? mbz.releaseIdForAlbum(ids.albumId) : '';
    var releaseGroupId = ids.albumId ? mbz.releaseGroupIdForAlbum(ids.albumId) : '';
    var artistId = ids.songId
        ? String(mbz.artistIdsForSong(ids.songId) || '').split(';')[0].trim()
        : '';

    if (releaseId) {
        links.push({
            title: _('Open release in MusicBrainz'),
            url: mbz.musicBrainzUrl('release', releaseId)
        });
    }

    if (releaseGroupId) {
        links.push({
            title: _('Open release group in MusicBrainz'),
            url: mbz.musicBrainzUrl('release-group', releaseGroupId)
        });
    }

    if (artistId) {
        links.push({
            title: _('Open artist in MusicBrainz'),
            url: mbz.musicBrainzUrl('artist', artistId)
        });
    }

    return links;
}

/**
 * Built when the menu opens, so it always reflects the current selection and
 * the ids the cache holds at that moment. Entries with no id are left out
 * rather than shown disabled; with none at all the submenu says so once.
 */
actions.lovesMBzLinks = {
    title: _('MusicBrainz links'),
    icon: 'lovesMBz',
    submenu: function () {
        var links = mbzSelectionLinks();

        if (!links.length) {
            return [{
                action: {
                    title: _('No MusicBrainz IDs for this track'),
                    disabled: true
                },
                order: 10,
                grouporder: 10
            }];
        }

        return links.map(function (link, index) {
            return {
                action: {
                    title: link.title,
                    execute: function () {
                        uitools.openWeb(link.url);
                    }
                },
                order: (index + 1) * 10,
                grouporder: 10
            };
        });
    }
};

/**
 * One album at a time is the guardrail, and the rule itself lives in
 * mbzApply.resolveTagScope so the action and the window cannot disagree. This
 * only asks the user what to do with a multi-album selection.
 *
 * @returns {Promise<Object|null>} the scope, or null when the user cancelled
 */
function mbzTagScopeAsync(scope) {
    if (!scope || !scope.multiAlbum) return Promise.resolve(scope);
    if (typeof messageDlg !== 'function') return Promise.resolve(null);

    var message = sprintf(
        _('This selection spans %d albums. Tag from MusicBrainz works on one album at a time. Continue and treat the selection as one release?'),
        scope.albumIds.length);

    if (scope.sharedRelease) {
        message += '<br><br>' + sprintf(
            _('These albums share release %s.'), scope.sharedRelease);
    }

    return new Promise(function (resolve) {
        messageDlg(message, 'Confirmation', ['btnYes', 'btnNo'],
            { defaultButton: 'btnNo', title: _('Loves MBz') },
            function (result) {
                if (!result || result.btnID !== 'btnYes') {
                    resolve(null);
                    return;
                }

                resolve(Object.assign({}, scope, { forced: true }));
            });
    });
}

function mbzOpenTagDialog(list, forced) {
    uitools.openDialog('dlgMBzTag', {
        show: true,
        modal: false,
        title: _('Tag from MusicBrainz'),
        tracks: list,
        treatAsOneRelease: !!forced
    });
}

/**
 * Tag from MusicBrainz — the one window that does the tagging. It opens on the
 * current selection and writes only what the user ticks there.
 *
 * Do not call localRequirejs here. MediaMonkey concatenates this file into its
 * own `actions` module, so that loader has no script context and aborts the
 * host with "mbzApply.js can't be loaded! (NOT FOUND)". init.js loads the write
 * engine at startup from the add-on folder; the window loads its own modules.
 */
actions.lovesMBzTag = {
    title: _('Tag from MusicBrainz') + '...',
    hotkeyAble: true,
    icon: 'lovesMBz',
    disabled: uitools.notMediaListSelected,
    execute: function () {
        var list = uitools.getSelectedTracklist();
        if (!list) return;

        var apply = window.mbzApply;
        if (!apply) {
            // The engine did not load at start-up; the window can still try.
            mbzOpenTagDialog(list, false);
            return;
        }

        try {
            Promise.resolve(apply.resolveTagScope(list))
                .then(mbzTagScopeAsync)
                .then(function (scope) {
                    if (!scope) return;
                    mbzOpenTagDialog(list, scope.forced);
                })
                .catch(function (error) {
                    if (typeof ODS === 'function') {
                        ODS('Loves MBz: could not resolve the selection: ' + error);
                    }
                    mbzOpenTagDialog(list, false);
                });
        } catch (error) {
            if (typeof ODS === 'function') {
                ODS('Loves MBz: could not open Tag from MusicBrainz: ' + error);
            }
            mbzOpenTagDialog(list, false);
        }
    }
};

// Needs to be unique so that it does not interfere with other addons.
window._menuItems.editTags.action.submenu.push({
    action: actions.lovesMBzShowIds,
    order: 120,
    grouporder: 10
});

window._menuItems.editTags.action.submenu.push({
    action: actions.lovesMBzLinks,
    order: 130,
    grouporder: 10
});

window._menuItems.editTags.action.submenu.push({
    action: actions.lovesMBzTag,
    order: 140,
    grouporder: 10
});
