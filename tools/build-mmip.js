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
 * The package is named after the build: `LovesMBz.mmip` for a release build,
 * `LovesMBz-0.6.1-rc1.mmip` while the dialog carries a channel, so a test
 * build does not overwrite the release package next to it.
 *
 * The save-path regression test runs first, and nothing is packaged when it
 * fails. Afterwards the archive is opened again and checked entry by entry: a
 * package that carried the dialog script but not the dialog page installs
 * cleanly and then draws the page already in the folder, which makes a CSS
 * change look like it never shipped.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var ROOT = path.resolve(__dirname, '..');
var GUARD = path.join(ROOT, 'tests', 'tag-path.test.js');
var DIALOG = path.join('dialogs', 'dlgMBzTag.js');

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

/**
 * The package name, from the dialog itself: the version and channel in the
 * window footer are the same two values `info.json` cannot express.
 */
function outputFile() {
    var source = fs.readFileSync(path.join(ROOT, DIALOG), 'utf8');
    var version = (source.match(/var ADDON_VERSION = '([^']*)';/) || [])[1] || '';
    var channel = (source.match(/var BUILD_CHANNEL = '([^']*)';/) || [])[1] || '';

    return path.join(ROOT, channel
        ? 'LovesMBz-' + version + '-' + channel + '.mmip'
        : 'LovesMBz.mmip');
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

/**
 * The archive's central directory: names normalised to `/`, mapped to the
 * uncompressed size of each file. Reading it here keeps the check free of a zip
 * dependency, and it reads both `zip` and Compress-Archive output, which differ
 * in the separator they write.
 */
function archiveEntries(file) {
    var buffer = fs.readFileSync(file);
    var end = -1;

    for (var i = buffer.length - 22; i >= 0 && i >= buffer.length - 65557; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }

    if (end < 0) throw new Error('Not a zip archive: ' + path.basename(file));

    var count = buffer.readUInt16LE(end + 10);
    var at = buffer.readUInt32LE(end + 16);
    var entries = {};

    for (var index = 0; index < count; index++) {
        if (buffer.readUInt32LE(at) !== 0x02014b50) {
            throw new Error('Damaged central directory in ' + path.basename(file));
        }

        var nameLength = buffer.readUInt16LE(at + 28);
        var extraLength = buffer.readUInt16LE(at + 30);
        var commentLength = buffer.readUInt16LE(at + 32);
        var name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

        entries[name.replace(/\\/g, '/')] = buffer.readUInt32LE(at + 24);
        at += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
}

/** Every file in the staging folder, relative and `/` separated, with its size. */
function stagedFiles(directory, prefix) {
    var files = [];

    fs.readdirSync(directory).forEach(function (name) {
        var full = path.join(directory, name);
        var relative = prefix ? prefix + '/' + name : name;

        if (fs.statSync(full).isDirectory()) files = files.concat(stagedFiles(full, relative));
        else files.push({ name: relative, size: fs.statSync(full).size });
    });

    return files;
}

/**
 * A package is only worth installing when it carries the files it was built
 * from. The dialog page is called out by name: script and page live in the same
 * folder, MediaMonkey is handed the page, and an archive that ships the script
 * alone would install over an older page without saying so.
 */
function verifyArchive(file, staging) {
    var entries = archiveEntries(file);
    var files = stagedFiles(staging, '');
    var missing = [];
    var mismatched = [];

    files.forEach(function (entry) {
        if (!Object.prototype.hasOwnProperty.call(entries, entry.name)) missing.push(entry.name);
        else if (entries[entry.name] !== entry.size) mismatched.push(entry.name);
    });

    if (missing.length) throw new Error('Not in the archive: ' + missing.join(', '));
    if (mismatched.length) throw new Error('Wrong size in the archive: ' + mismatched.join(', '));

    var page = entries['dialogs/dlgMBzTag.html'];
    if (!page) throw new Error('The archive has no dialogs/dlgMBzTag.html');

    return { files: files.length, page: page };
}

function main() {
    runGuard();

    var staging = fs.mkdtempSync(path.join(os.tmpdir(), 'lovesmbz-'));
    var stamp = buildTime();
    var output = outputFile();

    try {
        ENTRIES.forEach(function (entry) {
            var source = path.join(ROOT, entry);
            if (!fs.existsSync(source)) throw new Error('Missing entry: ' + entry);
            copyInto(source, path.join(staging, entry));
        });

        stampDialog(path.join(staging, DIALOG), stamp);
        stampDialog(path.join(ROOT, DIALOG), stamp);

        if (fs.existsSync(output)) fs.unlinkSync(output);

        try {
            execFileSync('zip', ['-qr', output].concat(ENTRIES), { cwd: staging });
        } catch (noZip) {
            // No zip on this machine: PowerShell makes the same archive.
            var list = ENTRIES.map(function (entry) { return '.\\' + entry; }).join(',');
            execFileSync('powershell.exe', ['-NoProfile', '-Command',
                'Compress-Archive -Path ' + list + ' -DestinationPath "' + output + '" -Force'
            ], { cwd: staging });
        }

        var checked = verifyArchive(output, staging);

        console.log('Packaged ' + path.basename(output) + ' (' + checked.files + ' files)');
        console.log('Dialog page: dialogs/dlgMBzTag.html (' + checked.page + ' bytes)');
        console.log('Build time: ' + stamp);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

module.exports = { archiveEntries: archiveEntries, verifyArchive: verifyArchive };

if (require.main === module) main();
