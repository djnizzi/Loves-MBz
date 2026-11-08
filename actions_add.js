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
function mbzSelectedIds() {
    var ids = { songId: 0, albumId: 0 };
    var list = uitools.getSelectedTracklist();

    if (!list || !(list.count > 0)) return ids;

    function read() {
        var track = list.getValue(0);
        if (!track) return;

        ids.songId = parseInt(track.id, 10) || 0;
        ids.albumId = parseInt(track.idalbum, 10) || 0;
    }

    if (typeof list.locked === 'function') list.locked(read);
    else read();

    return ids;
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
    icon: 'musicBrainz',
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
