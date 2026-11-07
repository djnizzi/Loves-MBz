'use strict';

/*
 * MBz loves MM5 — Track Properties integration.
 *
 * MediaMonkey builds the Track Properties tabs from window.propertiesTabs. A
 * tab is a name, an order and two files with the same key under
 * dialogs/dlgTrackProperties/: tabMbzLovesMM5.html and tabMbzLovesMM5.js.
 *
 * The built-in Custom tab is order 60, so this one sits after it.
 */

propertiesTabs.tabMbzLovesMM5 = {
    name: _('MusicBrainz'),
    order: 65
};
