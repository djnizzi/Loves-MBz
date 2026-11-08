'use strict';

/*
 * Loves MBz — menu action.
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

// Needs to be unique so that it does not interfere with other addons.
window._menuItems.editTags.action.submenu.push({
    action: actions.lovesMBzShowIds,
    order: 120,
    grouporder: 10
});
