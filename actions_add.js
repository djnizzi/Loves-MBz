'use strict';

/*
 * MBz loves MM5 — menu action.
 *
 * Registered in Edit > Tag Tools and, because track lists share that menu
 * branch, in the track list context menu as well.
 */

actions.mbzLovesMM5ShowIds = {
    title: _('MusicBrainz IDs') + '...',
    hotkeyAble: true,
    icon: 'mbzLovesMM5',
    disabled: uitools.notMediaListSelected,
    execute: function () {
        var list = uitools.getSelectedTracklist();
        if (!list) return;

        uitools.openDialog('dlgMBzLovesMM5', {
            show: true,
            modal: false,
            title: _('MBz loves MM5'),
            tracks: list
        });
    }
};

// Rebuilds the column cache without restarting MediaMonkey, e.g. after using
// MediaMonkey's own MusicBrainz lookup on a batch of albums.
actions.mbzLovesMM5ReloadCache = {
    title: _('MBz loves MM5: reload MusicBrainz ID cache'),
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
    action: actions.mbzLovesMM5ShowIds,
    order: 120,
    grouporder: 10
});

window._menuItems.tools.action.submenu.push({
    action: actions.mbzLovesMM5ReloadCache,
    order: 900,
    grouporder: 90
});
