'use strict';

/*
 * Loves MBz — menu action.
 *
 * Registered in Edit > Tag Tools and, because track lists share that menu
 * branch, in the track list context menu as well.
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

// Rebuilds the column cache without restarting MediaMonkey, e.g. after using
// MediaMonkey's own MusicBrainz lookup on a batch of albums.
actions.lovesMBzReloadCache = {
    title: _('Loves MBz: reload MusicBrainz ID cache'),
    hotkeyAble: false,
    visible: function () {
        return !!window.mbzMbgid;
    },
    execute: function () {
        if (!window.mbzMbgid) return;

        window.mbzMbgid.reload().then(function () {
            var state = window.mbzMbgid.getState();
            var message = state.error
                ? sprintf(_('MusicBrainz IDs could not be reloaded: %s'), state.error)
                : sprintf(
                    _('MusicBrainz IDs reloaded: %d albums, %d tracks with artist IDs.'),
                    state.albumCount, state.artistSongCount
                );

            if (uitools.toastMessage && uitools.toastMessage.show) {
                uitools.toastMessage.show(message, { disableUndo: true, delay: 5000 });
            }
        });
    }
};

// Needs to be unique so that it does not interfere with other addons.
window._menuItems.editTags.action.submenu.push({
    action: actions.lovesMBzShowIds,
    order: 120,
    grouporder: 10
});

window._menuItems.tools.action.submenu.push({
    action: actions.lovesMBzReloadCache,
    order: 900,
    grouporder: 90
});
