'use strict';

/*
 * Loves MBz — menu actions.
 *
 * Registered in Edit > Tag Tools and, because track lists share that menu
 * branch, in the track list context menu as well. The column cache refreshes
 * itself on MediaMonkey's change events (see init.js), so there is no manual
 * reload action here.
 */

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
 * Selected tracklists are returned before they are populated. Waiting for
 * whenLoaded() prevents the preview from opening with albumId 0 on a selection
 * that is still being delivered.
 */
function mbzSelectedIdsAsync(list) {
    if (!list) return Promise.resolve({ songId: 0, albumId: 0 });

    var loaded = null;
    try {
        if (typeof list.whenLoaded === 'function') loaded = list.whenLoaded();
    } catch (e) {
        loaded = null;
    }

    return Promise.resolve(loaded).then(function (loadedList) {
        return mbzSelectedIdsFromList(loadedList || list);
    }, function () {
        return mbzSelectedIdsFromList(list);
    });
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
 * Read-only: the dialog looks up the release behind the selected album's
 * Albums.MBGID and displays it. It never writes, and an album without that ID
 * is not looked up at all.
 */
actions.lovesMBzPreview = {
    title: _('Preview MusicBrainz metadata') + '...',
    hotkeyAble: true,
    icon: 'lovesMBz',
    disabled: uitools.notMediaListSelected,
    execute: function () {
        var list = uitools.getSelectedTracklist();
        if (!list) return;

        mbzSelectedIdsAsync(list).then(function (ids) {
            uitools.openDialog('dlgMBzPreview', {
                show: true,
                modal: false,
                title: _('MusicBrainz metadata preview'),
                albumId: ids.albumId,
                tracks: list
            });
        });
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
    action: actions.lovesMBzPreview,
    order: 140,
    grouporder: 10
});
