#!/usr/bin/env node
'use strict';

/*
 * Packages LovesMBz.mmip from the add-on sources.
 *
 *   node tools/build-mmip.js
 *
 * The archive is built from a temporary copy, and the build time is written
 * into the `var BUILD_TIME = '';` slot in dialogs/dlgMBzTag.js — in the copy
 * and in the source, so a dialog file copied by hand reports the same build.
 * That stamp, next to the version in the window footer, is what tells two
 * builds of the same version apart.
 *
 * The save-path regression test runs first, and nothing is packaged when it
 * fails.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var ROOT = path.resolve(__dirname, '..');
var OUTPUT = path.join(ROOT, 'LovesMBz.mmip');
var GUARD = path.join(ROOT, 'tests', 'tag-path.test.js');

/* Everything the add-on needs; the archive holds these at its root. */
var ENTRIES = [
    'info.json',
    'init.js',
    'mbzMbgid.js',
    'mbzFetch.js',
    'mbzApply.js',
    'actions_add.js',
    'controls',
    'dialogs',
    'skin',
    'loves-mbz.png'
];

function pad(value) {
    return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD HH:MM`, local time, minute precision. */
function buildTime() {
    var now = new Date();

    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
        + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
}

function copyInto(from, to) {
    if (fs.statSync(from).isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        fs.readdirSync(from).forEach(function (name) {
            copyInto(path.join(from, name), path.join(to, name));
        });
        return;
    }

    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

function stampDialog(dialogPath, stamp) {
    var source = fs.readFileSync(dialogPath, 'utf8');
    var slot = /var BUILD_TIME = '[^']*';/;

    // Test the pattern, not the result: two builds in the same minute produce
    // identical text, which must not look like a missing slot.
    if (!slot.test(source)) {
        throw new Error('No BUILD_TIME slot in ' + path.relative(ROOT, dialogPath));
    }

    fs.writeFileSync(dialogPath, source.replace(slot, "var BUILD_TIME = '" + stamp + "';"));
}

/**
 * The guard runs first: a package is only worth building from sources that pass
 * it. The test's own output is the user's, so it goes straight to the console.
 */
function runGuard() {
    try {
        execFileSync(process.execPath, [GUARD], { cwd: ROOT, stdio: 'inherit' });
    } catch (failed) {
        console.error('The regression test failed; nothing was packaged.');
        process.exit(1);
    }
}

runGuard();

var staging = fs.mkdtempSync(path.join(os.tmpdir(), 'lovesmbz-'));
var stamp = buildTime();

try {
    ENTRIES.forEach(function (entry) {
        var source = path.join(ROOT, entry);
        if (!fs.existsSync(source)) throw new Error('Missing entry: ' + entry);
        copyInto(source, path.join(staging, entry));
    });

    var dialog = path.join('dialogs', 'dlgMBzTag.js');
    stampDialog(path.join(staging, dialog), stamp);
    stampDialog(path.join(ROOT, dialog), stamp);

    if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

    try {
        execFileSync('zip', ['-qr', OUTPUT].concat(ENTRIES), { cwd: staging });
    } catch (noZip) {
        // No zip on this machine: PowerShell makes the same archive.
        var list = ENTRIES.map(function (entry) { return '.\\' + entry; }).join(',');
        execFileSync('powershell.exe', ['-NoProfile', '-Command',
            'Compress-Archive -Path ' + list + ' -DestinationPath "' + OUTPUT + '" -Force'
        ], { cwd: staging });
    }

    var files = 0;
    (function count(directory) {
        fs.readdirSync(directory).forEach(function (name) {
            var full = path.join(directory, name);
            if (fs.statSync(full).isDirectory()) count(full); else files++;
        });
    }(staging));

    console.log('Packaged ' + path.basename(OUTPUT) + ' (' + files + ' files)');
    console.log('Build time: ' + stamp);
} finally {
    fs.rmSync(staging, { recursive: true, force: true });
}
