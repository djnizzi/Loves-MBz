'use strict';

/*
 * Regression guard for the 0.4.3 group Fill save order.
 *
 * Track Properties Fill stages values; MediaMonkey's OK commits them.
 * setExtendedTagsAsync can trigger that group commit, so one track's native
 * fields must be set before its own extended tags, and the group loop must not
 * stage every track's native fields in a separate pass first.
 *
 * Run: node tests/save-path.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const applyPath = path.join(root, 'mbzApply.js');
const tabPath = path.join(root, 'dialogs', 'dlgTrackProperties', 'tabLovesMBz.js');
const applySource = fs.readFileSync(applyPath, 'utf8');
const tabSource = fs.readFileSync(tabPath, 'utf8');

function functionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notStrictEqual(start, -1, name + ' must exist');

    const open = source.indexOf('{', start);
    assert.notStrictEqual(open, -1, name + ' must have a body');

    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let i = open; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];

        if (lineComment) {
            if (ch === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '/' && next === '/') {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }

    assert.fail(name + ' has no closing brace');
}

// The group loop must keep the 0.4.3 per-track call: one track's native fields
// and tags are staged together, in work order, with no separate native pass.
const stage = functionSource(tabSource, 'mbzExtStageFillOnSaveAsync');
assert.match(
    stage,
    /for\s*\([^)]*work\.length[^)]*\)[\s\S]*apply\.applyPendingAsync\s*\(/,
    'group Fill must call applyPendingAsync inside the work loop'
);
assert.match(
    stage,
    /apply\.applyPendingAsync\s*\(\s*track\s*,\s*work\[i\]\.pending\s*,\s*tagsText\s*\)/,
    'group Fill must hand each track its own pending fields and tag snapshot'
);
assert.doesNotMatch(
    stage,
    /apply\.applyNative\s*\(/,
    'group Fill must not stage native fields in a separate pass'
);
assert.doesNotMatch(
    stage,
    /applyPendingTagsAsync/,
    'group Fill must not use a tag-only staging helper'
);
assert.doesNotMatch(
    stage,
    /Promise\.all/,
    'group Fill must not stage tracks in parallel'
);

// applyPendingAsync itself must keep native fields before ExtendedTags, and it
// must remain a staging function rather than committing each track.
const pending = functionSource(applySource, 'applyPendingAsync');
assert.match(
    pending,
    /var\s+written\s*=\s*applyNative\s*\(\s*track\s*,\s*pending\s*\)\s*;/,
    'applyPendingAsync must stage native fields first'
);
assert.doesNotMatch(
    pending,
    /applyPendingTagsAsync/,
    'applyPendingAsync must not delegate tags to a separate pass'
);
assert.ok(
    pending.indexOf('applyNative(track, pending)') <
        pending.indexOf('await track.setExtendedTagsAsync'),
    'native fields must be set before extended tags are written'
);
assert.doesNotMatch(
    pending,
    /commitAsync/,
    'Fill stages values; it must not commit each track itself'
);
assert.doesNotMatch(
    applySource,
    /tag:\s*'SCRIPT'/,
    'Fill must not offer or write a SCRIPT tag'
);
assert.match(
    applySource,
    /key:\s*'discNumber'[^}]*native:\s*'discNumberInt'[^}]*kind:\s*'int'/,
    'Disc # must stage the integer discNumberInt property'
);
assert.doesNotMatch(
    applySource,
    /native:\s*'discNumber'/,
    'Disc # must not write the string discNumber property'
);

// Behavior check: a track stages native fields, then reads and writes tags.
global.window = {};
global._ = (value) => value;
require(applyPath);
const apply = global.window.mbzApply;

assert.strictEqual(
    apply.tagNameMatches('MusicBrainz Album Release Country', 'RELEASECOUNTRY'),
    true
);
assert.strictEqual(
    apply.tagNameMatches('MusicBrainz Album Status', 'RELEASESTATUS'),
    true
);
assert.strictEqual(
    apply.tagNameMatches('MusicBrainz Album Type', 'RELEASETYPE'),
    true
);
assert.strictEqual('applyPendingTagsAsync' in apply, false);

const merged = apply.mergeTags([
    { title: 'MusicBrainz Album Release Country', value: 'GB' },
    { title: 'RELEASECOUNTRY', value: 'GB' },
    { title: 'X', value: 'y' }
], [{ title: 'RELEASECOUNTRY', value: 'US' }]);

assert.deepStrictEqual(merged, [
    { title: 'MusicBrainz Album Release Country', value: 'US' },
    { title: 'X', value: 'y' }
]);

function makeTrack(label, log, tags) {
    return {
        beginUpdate() {
            log.push(label + ':begin');
        },
        endUpdate() {
            log.push(label + ':end');
        },
        set composer(value) {
            log.push(label + ':composer:' + value);
        },
        getExtendedTagsAsync() {
            log.push(label + ':getTags');
            return Promise.resolve(tags.value);
        },
        setExtendedTagsAsync(value) {
            log.push(label + ':setTags');
            tags.value = value;
            return Promise.resolve();
        }
    };
}

(async () => {
    const discPending = await apply.buildPendingAsync({
        discNumber: '',
        discNumberInt: 0,
        trackNumber: '3',
        title: '',
        getExtendedTagsAsync() {
            return Promise.resolve('[]');
        },
        setExtendedTagsAsync() {
            return Promise.resolve();
        }
    }, {
        title: 'Disc release',
        media: [{
            position: '1',
            tracks: [{ number: '3', title: 'Song', recording: {} }]
        }]
    }, '[]');

    assert.strictEqual(discPending.matched, true);
    assert.strictEqual(discPending.native.discNumberInt, 1);
    assert.strictEqual('discNumber' in discPending.native, false);

    const log = [];
    const tags = {
        value: JSON.stringify([{ title: 'RELEASECOUNTRY', value: 'GB' }])
    };
    const track = makeTrack('one', log, tags);

    const written = await apply.applyPendingAsync(track, {
        matched: true,
        native: { composer: 'A' },
        tags: [{ title: 'RELEASECOUNTRY', value: 'US' }]
    });

    assert.strictEqual(written, 2);
    assert.deepStrictEqual(log, [
        'one:begin',
        'one:composer:A',
        'one:end',
        'one:getTags',
        'one:setTags'
    ]);
    assert.deepStrictEqual(JSON.parse(tags.value), [
        { title: 'RELEASECOUNTRY', value: 'US' }
    ]);

    // A group Fill stages each track through the same call. Both tracks must
    // keep their own tags; the second track must not depend on the first.
    const groupLog = [];
    const first = { value: JSON.stringify([]) };
    const second = { value: JSON.stringify([]) };
    const tracks = [
        makeTrack('first', groupLog, first),
        makeTrack('second', groupLog, second)
    ];

    for (const item of tracks) {
        await apply.applyPendingAsync(item, {
            matched: true,
            native: { composer: 'Writer' },
            tags: [{ title: 'RELEASECOUNTRY', value: 'US' }]
        });
    }

    assert.deepStrictEqual(JSON.parse(first.value), [
        { title: 'RELEASECOUNTRY', value: 'US' }
    ]);
    assert.deepStrictEqual(JSON.parse(second.value), [
        { title: 'RELEASECOUNTRY', value: 'US' }
    ]);
    assert.deepStrictEqual(groupLog, [
        'first:begin',
        'first:composer:Writer',
        'first:end',
        'first:getTags',
        'first:setTags',
        'second:begin',
        'second:composer:Writer',
        'second:end',
        'second:getTags',
        'second:setTags'
    ]);

    console.log('save-path regression test passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
