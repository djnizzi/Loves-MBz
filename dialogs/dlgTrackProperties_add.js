'use strict';

/*
 * Loves MBz — Track Properties integration.
 *
 * MediaMonkey builds the Track Properties tabs from window.propertiesTabs. A
 * tab is a name, an order and two files with the same key under
 * dialogs/dlgTrackProperties/: tabLovesMBz.html and tabLovesMBz.js.
 *
 * The built-in Custom tab is order 60, so this one sits after it.
 */

propertiesTabs.tabLovesMBz = {
    name: _('MusicBrainz'),
    order: 65
};
