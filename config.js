/*
 * The add-on's configuration page.
 *
 * `info.json` names this file ("config": "config.js"), so MediaMonkey gives the
 * add-on a panel in Tools > Addons: the host calls load() when the panel opens
 * and save() when OK is pressed, passing the panel's node and the add-on.
 *
 * The whole page lives in its own function: MediaMonkey evaluates it inside the
 * Addons dialog, and a top-level name here would land on that dialog's window
 * beside MediaMonkey's own.
 *
 * It carries no field list. `tools/build-mmip.js` writes one into config.html
 * from `mbzApply.fieldCatalogue()`, so the only description of the fields is
 * the engine's, and the guard fails when the page's list is stale. The page
 * reads that list back and draws it.
 *
 * It cannot load the add-on's modules either. The host evaluates it from
 * dialogs/dlgAddonConfig.js, and `localRequirejs` there resolves against
 * MediaMonkey's own scripts — `localRequirejs('mbzApply')` asks for
 * `//mediamonkey5/mbzApply.js` and raises the host's exception dialog before
 * `window.configInfo` exists (rc1). The one rule the page needs — which keys a
 * stored set offers — is here in full, and the guard holds it to
 * `mbzApply.readFieldSet()` fixture for fixture. Where the engine happens to be
 * on this window, the page uses it instead.
 *
 * The page edits one thing: which fields the Tag from MusicBrainz window
 * offers. No track, no tag and no native field is read or written here.
 */

(function () {
    var SETTINGS_KEY = 'lovesMBzFieldSet';
    var SETTINGS_VERSION = 1;

    /** The host's localiser, or the plain sentence on a host that has none. */
    function phrase(text) {
        return typeof _ === 'function' ? _(text) : text;
    }

    /** The engine, when this window happens to have it. */
    function engine() {
        return (typeof window !== 'undefined' && window.mbzApply) || null;
    }

    /**
     * The list the package wrote into the page, as
     * `{ key, label, scope, target }`. No list, no rows: a page that lost its
     * list must say so rather than look like an add-on with no fields.
     */
    function fieldTable(host) {
        var raw = host && host.getAttribute ? host.getAttribute('data-fields') : '';

        if (!raw) return [];

        try {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    /** The same rule `mbzApply.readFieldSet` applies. */
    function offered(stored, all) {
        if (!stored || typeof stored !== 'object') return all;
        if (stored.version !== SETTINGS_VERSION || !Array.isArray(stored.keys)) return all;

        for (var i = 0; i < stored.keys.length; i++) {
            if (all.indexOf(stored.keys[i]) === -1) return all;
        }

        return stored.keys.slice();
    }

    function readSet(all) {
        var apply = engine();

        if (apply && typeof apply.readFieldSet === 'function') return apply.readFieldSet();

        var stored = null;

        try {
            if (typeof app !== 'undefined' && app.getValue) stored = app.getValue(SETTINGS_KEY, null);
        } catch (e) {
            stored = null;
        }

        return offered(stored, all);
    }

    function writeSet(keys) {
        var apply = engine();

        if (apply && typeof apply.writeFieldSet === 'function') return apply.writeFieldSet(keys);

        try {
            if (typeof app === 'undefined' || !app.setValue) return false;
            app.setValue(SETTINGS_KEY, { version: SETTINGS_VERSION, keys: keys.slice() });
        } catch (e) {
            return false;
        }

        return true;
    }

    function group(doc, title) {
        var box = doc.createElement('fieldset');
        var legend = doc.createElement('legend');

        legend.textContent = title;
        box.appendChild(legend);

        return box;
    }

    /** A checkbox the host draws, or a plain one if the host will not make it. */
    function checkbox(doc, checked) {
        var box = doc.createElement('div');

        box.setAttribute('data-control-class', 'Checkbox');

        if (typeof initializeControl === 'function') initializeControl(box);

        if (box.controlClass) {
            box.controlClass.checked = !!checked;
            return box;
        }

        var input = doc.createElement('input');
        input.type = 'checkbox';
        input.checked = !!checked;
        box.appendChild(input);

        return box;
    }

    function isChecked(box) {
        if (!box) return false;
        if (box.controlClass) return !!box.controlClass.checked;

        var input = box.querySelector ? box.querySelector('input') : null;

        return !!(input && input.checked);
    }

    /** Says why the list is not there, in the place the list would have been. */
    function drawMessage(target, message) {
        if (!target) return;

        var doc = target.ownerDocument || (typeof document === 'undefined' ? null : document);

        target.textContent = '';

        if (!doc || typeof doc.createElement !== 'function') return;

        var line = doc.createElement('div');

        line.className = 'mbzConfigError';
        line.textContent = message;
        line.style.color = '#d9534f';

        target.appendChild(line);
    }

    window.configInfo = {
        /* The list of the last draw: { key, box, text }, in catalogue order. */
        rows: [],

        /* The table the package wrote into the page, as it was read. */
        fields: [],

        load: function (pnlDiv) {
            var doc = pnlDiv && (pnlDiv.ownerDocument
                || (typeof document === 'undefined' ? null : document));
            var rows = pnlDiv && pnlDiv.querySelector
                ? pnlDiv.querySelector('[data-id="mbzConfigRows"]')
                : null;
            var host = rows || pnlDiv;

            this.rows = [];
            this.fields = [];

            if (!doc || !host) return;

            try {
                this.draw(doc, host);
            } catch (e) {
                // A control that will not initialise must not leave a blank
                // panel, and the rows it managed to draw are not a list to save.
                this.rows = [];
                drawMessage(host, phrase('The field list could not be drawn. Nothing was changed.'));
            }
        },

        draw: function (doc, host) {
            var fields = fieldTable(host);
            var all = fields.map(function (field) { return field.key; });
            var keys = readSet(all);
            var album = group(doc, phrase('Album fields'));
            var track = group(doc, phrase('Track fields'));
            var self = this;

            this.rows = [];
            this.fields = [];

            if (!fields.length) {
                drawMessage(host, phrase('This build carries no field list, so there is nothing to configure here. Nothing was changed.'));
                return;
            }

            this.fields = fields;
            host.textContent = '';

            fields.forEach(function (field) {
                var row = doc.createElement('div');
                var box = checkbox(doc, keys.indexOf(field.key) !== -1);
                var label = doc.createElement('label');

                row.className = 'mbzConfigRow';
                row.style.padding = '2px 0';

                // Where the value goes, and which kind of destination it is:
                // MediaMonkey's own field, or a tag the file carries.
                label.textContent = phrase(field.label) + '  \u2014  '
                    + phrase(field.kind === 'tag' ? 'extended tag' : 'MediaMonkey field')
                    + ': ' + field.target;

                row.appendChild(box);
                row.appendChild(label);
                (field.scope === 'album' ? album : track).appendChild(row);

                self.rows.push({ key: field.key, box: box, text: label.textContent });
            });

            host.appendChild(album);
            host.appendChild(track);
        },

        save: function () {
            var keys = [];
            var rows = this.rows || [];

            // A page that drew no rows has no answer to save: an empty list is
            // a real answer and must never be produced by a failure.
            if (!rows.length) return;

            rows.forEach(function (row) {
                if (isChecked(row.box)) keys.push(row.key);
            });

            writeSet(keys);
        }
    };
})();
