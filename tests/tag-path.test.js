'use strict';

/*
 * Regression guard for the 0.5.0 write path.
 *
 * Every write goes through mbzApply.applySelectionAsync: per track, native
 * fields first, then one read and one merged ExtendedTags write, then one
 * commitAsync(). Nothing is staged inside MediaMonkey's dialogs, so the add-on
 * never depends on the group save.
 *
 * Run: node tests/tag-path.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const applyPath = path.join(root, 'mbzApply.js');
const applySource = read('mbzApply.js');
const dialogSource = read(path.join('dialogs', 'dlgMBzTag.js'));
const dialogHtml = read(path.join('dialogs', 'dlgMBzTag.html'));
const actionsSource = read('actions_add.js');
const initSource = read('init.js');

/* -------------------------------------------------------------------------- *
 * Stubs
 * -------------------------------------------------------------------------- */

global.window = {};
global._ = (value) => value;
global.sprintf = (format, ...args) => {
    let index = 0;
    return String(format).replace(/%[sd]/g, () => String(args[index++]));
};

require(applyPath);
const apply = global.window.mbzApply;

/* -------------------------------------------------------------------------- *
 * Source shape
 * -------------------------------------------------------------------------- */

for (const name of ['resolveTagScope', 'buildSelectionPlanAsync', 'aggregateFields', 'applySelectionAsync']) {
    assert.strictEqual(typeof apply[name], 'function', name + ' must be exported');
}

for (const name of ['buildPlanAsync', 'applyAsync', 'applyPendingAsync', 'applyNative', 'filterPending']) {
    assert.strictEqual(name in apply, false, name + ' must be gone from the 0.5.0 engine');
}

assert.match(
    applySource,
    /key:\s*'discNumber'[^}]*native:\s*'discNumberInt'[^}]*kind:\s*'int'/,
    'Disc # must write the integer discNumberInt property'
);
assert.doesNotMatch(applySource, /native:\s*'discNumber'/, 'Disc # must not write the string discNumber');
assert.doesNotMatch(applySource, /tag:\s*'SCRIPT'/, 'SCRIPT must never be offered or written');

// The dialog stages nothing and writes nothing itself: it asks the engine.
// Comments are stripped first, so a file may explain the contract in prose.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const dialogCode = stripComments(dialogSource);
const actionsCode = stripComments(actionsSource);

assert.match(dialogCode, /apply\.applySelectionAsync\s*\(/, 'the window must apply through the engine');
assert.doesNotMatch(dialogCode, /commitAsync/, 'the window must not commit tracks itself');
assert.doesNotMatch(dialogCode, /setExtendedTagsAsync/, 'the window must not write extended tags itself');

// Every lookup in the window must exist in its markup; a renamed data-id used
// to fail silently at run time.
const declaredIds = new Set([...dialogHtml.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]));
const lookedUpIds = [...dialogSource.matchAll(/qid\('([^']+)'\)/g)].map((m) => m[1]);
assert.deepStrictEqual(
    lookedUpIds.filter((id) => !declaredIds.has(id)),
    [],
    'every qid() must exist in the dialog markup'
);

// The three IDs the Track Properties tab linked must stay reachable: the
// release, its release group and the album artist.
assert.match(dialogCode, /musicBrainzUrl\(entity, guid\)/, 'the window must build MusicBrainz links');
assert.match(dialogCode, /buildLinkEntries/, 'links must be collected for the album, group and artist');
assert.match(dialogCode, /_\('Release group'\)[^;]*'release-group'/, 'the release group must be linked');
assert.match(dialogCode, /_\('Album artist'\)[^;]*'artist'/, 'the album artist must be linked');
assert.match(dialogCode, /linksBar/, 'the links must be rendered in the window');
assert.match(dialogCode, /createElement\('a'\)/, 'the MusicBrainz links must be text links, not buttons');

// One scrolling column with a cap the host's content-sized dialog cannot grow.
assert.match(dialogHtml, /\.mbzTagRoot > \.mbzTagScroll/, 'the window must have one scrolling column');

assert.doesNotMatch(dialogHtml, /max-height: 560px/, 'the column must fill the dialog, not a fixed cap');
assert.match(dialogHtml, /overflow-y: auto/, 'the scrolling column must scroll');
assert.doesNotMatch(dialogHtml, /releaseSection/,
    'the window must not preview the whole release, only the selected tracks');
assert.doesNotMatch(dialogCode, /releaseRows/,
    'the release listing rows are gone with the preview');
assert.match(dialogCode, /fitScrollColumn/, 'the column must be sized in pixels, not viewport units');
assert.match(dialogHtml, /data-id="scrollColumn"/, 'the scrolling column needs a handle');
assert.match(dialogHtml, /\.mbzSection \{ padding-top: 10px/, 'sections must keep the 0.4.5 rhythm');
assert.match(dialogHtml, /\.mbzMetaTable th \{[^}]*text-align: left !important/,
    'the meta labels must be left aligned, not centred by the skin');
assert.match(dialogCode, /function syncTables/, 'empty tables must not draw their header row');
assert.match(dialogHtml, /\.mbzTable th \{[^}]*text-align: left !important/,
    'table headers must be left aligned over their data');
assert.match(dialogCode, /result\.failed\[failureIndex\]\.title/,
    'the apply report must name the failing track, not just count them');
assert.match(dialogHtml, /commonControls\.js/,
    'the dialog must load the skinned control classes');
assert.match(dialogHtml, /data-control-class="Edit"/,
    'text fields must be skinned Edit controls, not native inputs');
assert.match(dialogHtml, /data-control-class="Dropdown"/,
    'the tag picker must be a skinned Dropdown control');
assert.doesNotMatch(dialogHtml, /<select|<input/,
    'native form controls take the oversized generic styling');
assert.match(dialogCode, /basis \* 0\.68/, 'the column must be sized from the screen, not the growing dialog');
assert.doesNotMatch(dialogCode, /root\.clientHeight/,
    'the host grows the dialog with its content, so the root cannot be the basis');
assert.match(dialogHtml, /\.mbzLinks a \{ margin-right: 10px/, 'the bar links must be spaced like the tag rows');
assert.match(dialogCode, /'mbzTextLink hotlink'/, 'the bar links must use the host link class');
assert.match(dialogCode, /\\u00a0\\u00a0\\u00a0/, 'the links need a real whitespace gap');
assert.doesNotMatch(dialogHtml, /\.mbzTextLink[^{]*\{[^}]*color:/,
    'the links must keep the skin link colour');
assert.match(dialogHtml, /\.mbzButton \{ padding: 0 14px; line-height: 24px/, 'the buttons must keep the 0.4.5 size');
assert.match(initSource, /function openTagWindow/, 'the toolbar button must open the window itself');
assert.match(actionsCode, /window\.mbzOpenTagSelection/, 'the actions module must publish the toolbar entry point');
assert.match(initSource, /findSelectedTracklist/, 'the button must fall back to any list with a selection');
assert.doesNotMatch(initSource, /control\.getTracklist\(\)/,
    'the fallback must use the selection, never the whole list');
assert.match(actionsCode, /mbzOpenTagSelection = function \(list\)/, 'the entry point must accept the list it is given');
assert.match(initSource, /mbzOpenTagSelection/, 'the toolbar button must call that entry point');

// The album's release ID is the lookup key and is editable in the window, but
// it is a library row: it must not travel through the apply path.
assert.match(dialogCode, /setAlbumGuidAsync\(albumId, 'MBGID'/, 'the window must write the album release ID');
assert.doesNotMatch(applySource, /setAlbumGuidAsync|setArtistGuidAsync/,
    'the write engine must never touch the album or artist ID columns');

// The build the window reports must be the build that was packaged.
const infoVersion = JSON.parse(read('info.json')).version;
const declaredVersion = (dialogCode.match(/var ADDON_VERSION = '([0-9.]+)'/) || [])[1];
assert.strictEqual(declaredVersion, infoVersion, 'the window build stamp must match info.json');
assert.match(dialogSource, /buildStamp/, 'the window must render the build stamp');

// The stamp must carry a real build time, written by the packager, so two
// builds of the same version can be told apart.
assert.match(dialogCode, /var BUILD_TIME = '[^']*';/, 'the dialog needs a slot the packager can stamp');
assert.match(dialogCode, /textContent = 'Loves MBz ' \+ ADDON_VERSION/, 'the footer must show the version');
assert.match(dialogCode, /\+ \(BUILD_TIME \?/, 'the footer must show the build time with it');
const buildScript = read(path.join('tools', 'build-mmip.js'));
assert.match(buildScript, /BUILD_TIME/, 'the packager must stamp the build time into the dialog');
assert.match(buildScript, /tag-path\.test\.js/, 'the packager must run this guard');
assert.match(buildScript, /process\.exit\(1\)/, 'a failed guard must stop the build');
assert.doesNotMatch(buildScript, /stamped === source/,
    'stamping twice in the same minute must not look like a missing slot');

// No MediaMonkey dialog integration survives.
assert.strictEqual(fs.existsSync(path.join(root, 'dialogs', 'dlgTrackProperties')), false,
    'the Track Properties tab must be gone');
assert.strictEqual(fs.existsSync(path.join(root, 'dialogs', 'dlgTrackProperties_add.js')), false,
    'the Track Properties registration must be gone');
assert.strictEqual(fs.existsSync(path.join(root, 'dialogs', 'dlgMBzPreview.js')), false,
    'the preview dialog must be replaced by dlgMBzTag');
assert.strictEqual(fs.existsSync(path.join(root, 'tests', 'save-path.test.js')), false,
    'the 0.4.x group-save guard must be replaced');

const sources = [applySource, dialogSource, actionsSource, initSource].join('\n');
assert.doesNotMatch(sources, /propertiesTabs/, 'no module may register a Track Properties tab');

// One action, one window, one toolbar button.
assert.match(actionsCode, /actions\.lovesMBzTag\s*=/, 'the action must be named lovesMBzTag');
assert.doesNotMatch(actionsCode, /lovesMBzPreview/, 'the old preview action must be gone');
assert.match(actionsCode, /resolveTagScope/, 'the action must resolve the scope through the engine');

// actions_add.js is concatenated into MediaMonkey's `actions` module, where
// localRequirejs has no script context: it aborts the host with
// "mbzApply.js can't be loaded! (NOT FOUND)". The engine is loaded by init.js.
assert.doesNotMatch(actionsCode, /localRequirejs/,
    'the action must not load modules through localRequirejs');
assert.match(initSource, /localRequirejs\('mbzApply'\)/, 'init.js must load the write engine');

assert.match(initSource, /addToolButton\('righttoolbuttons'/,
    'the button must sit in the right-hand toolbar strip');
assert.match(initSource, /removeLegacyToolbarItem/,
    'the old toolbarItems entry must be removed');
assert.doesNotMatch(initSource, /items\.push\(TOOLBAR_ACTION_KEY\)/,
    'the add-on must not append itself to the custom toolbar');
assert.doesNotMatch(initSource, /Add Tag from MusicBrainz to your toolbar/,
    'the button must not need a prompt');
assert.doesNotMatch(initSource, /customtoolbuttons[^']*appendChild/,
    'the add-on must not inject a toolbar DOM button');

/* -------------------------------------------------------------------------- *
 * Fixtures
 * -------------------------------------------------------------------------- */

function releaseFixture() {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'An Album',
        'artist-credit': [{ name: 'The Artist', artist: { id: 'artist-1' } }],
        date: '1999-03-01',
        country: 'US',
        status: 'Official',
        barcode: '123456',
        'label-info': [{ label: { name: 'A Label' }, 'catalog-number': 'CAT-1' }],
        'release-group': {
            id: 'release-group-1',
            'primary-type': 'Album',
            'first-release-date': '1998'
        },
        media: [{
            position: '1',
            tracks: [{
                id: 'release-track-1',
                number: '1',
                title: 'One',
                length: '180000',
                recording: {
                    id: 'recording-1',
                    isrcs: ['ISRC1'],
                    relations: [{
                        type: 'performance',
                        work: { relations: [{ type: 'composer', artist: { name: 'Writer One' } }] }
                    }]
                }
            }, {
                id: 'release-track-2',
                number: '2',
                title: 'Two',
                length: '200000',
                recording: {
                    id: 'recording-2',
                    isrcs: ['ISRC2'],
                    relations: [{
                        type: 'performance',
                        work: { relations: [{ type: 'composer', artist: { name: 'Writer Two' } }] }
                    }]
                }
            }]
        }]
    };
}

function makeTrack(options) {
    const log = options.log;
    const tags = options.tags || { value: '[]' };

    const track = {
        id: options.id,
        idalbum: options.idalbum === undefined ? 10 : options.idalbum,
        trackNumber: String(options.number),
        title: options.title,
        path: options.path || 'C:\\music\\song.flac',
        discNumber: options.discNumber || '',
        albumArtist: '',
        artist: '',
        year: '',
        date: 0,
        origDate: 0,
        origYear: 0,
        lyricist: '',
        isrc: '',
        publisher: '',
        beginUpdate() {
            log.push('begin');
        },
        endUpdate() {
            log.push('end');
        },
        getExtendedTagsAsync() {
            log.push('getTags');
            return Promise.resolve(tags.value);
        },
        setExtendedTagsAsync(value) {
            log.push('setTags');
            if (options.tagsFail) return Promise.reject(new Error('tag write failed'));
            tags.value = value;
            return Promise.resolve();
        },
        commitAsync() {
            log.push('commit');
            if (options.commitFail) return Promise.reject(new Error('commit failed'));
            return Promise.resolve();
        }
    };

    Object.defineProperty(track, 'composer', {
        configurable: true,
        get: () => '',
        set: (value) => log.push('composer:' + value)
    });

    Object.defineProperty(track, 'discNumberInt', {
        configurable: true,
        get: () => 0,
        set: (value) => log.push('disc:' + value)
    });

    return track;
}

/* -------------------------------------------------------------------------- *
 * Tag edits
 * -------------------------------------------------------------------------- */

const edited = apply.applyTagEdits(
    [
        { title: 'BARCODE', value: '111' },
        { title: 'MUSICBRAINZ_ALBUMID', value: 'old' },
        { title: 'PRODUCER', value: 'Someone' }
    ],
    [
        { title: 'BARCODE', occurrence: 0, value: '999' },
        { title: 'MUSICBRAINZ_ALBUMID', occurrence: 0, value: '' },
        { title: 'PRODUCER', add: true, value: 'Someone Else' }
    ]
);

assert.strictEqual(edited.applied, 3);
assert.deepStrictEqual(edited.tags, [
    { title: 'BARCODE', value: '999' },
    { title: 'PRODUCER', value: 'Someone Else' }
]);

// An add never creates a second entry with the same name.
const added = apply.applyTagEdits([{ title: 'CATALOGNUMBER', value: 'OLD' }], [
    { title: 'CATALOGNUMBER', add: true, value: 'NEW' }
]);
assert.deepStrictEqual(added.tags, [{ title: 'CATALOGNUMBER', value: 'NEW' }]);

// A cleared pending row cancels the add instead of writing an empty tag.
const cancelled = apply.applyTagEdits([], [{ title: 'BARCODE', add: true, value: '' }]);
assert.deepStrictEqual(cancelled.tags, []);
assert.strictEqual(cancelled.applied, 0);

/* -------------------------------------------------------------------------- *
 * Alias handling kept from 0.4.x
 * -------------------------------------------------------------------------- */

assert.strictEqual(apply.tagNameMatches('MusicBrainz Album Release Country', 'RELEASECOUNTRY'), true);
assert.strictEqual(apply.tagNameMatches('MusicBrainz Album Status', 'RELEASESTATUS'), true);
assert.strictEqual(apply.tagNameMatches('MusicBrainz Album Type', 'RELEASETYPE'), true);

assert.deepStrictEqual(
    apply.mergeTags([
        { title: 'MusicBrainz Album Release Country', value: 'GB' },
        { title: 'RELEASECOUNTRY', value: 'GB' },
        { title: 'X', value: 'y' }
    ], [{ title: 'RELEASECOUNTRY', value: 'US' }]),
    [
        { title: 'MusicBrainz Album Release Country', value: 'US' },
        { title: 'X', value: 'y' }
    ]
);

/* -------------------------------------------------------------------------- *
 * Scope resolution
 * -------------------------------------------------------------------------- */

const albumReleaseIds = { 10: 'release-a', 11: 'release-a', 12: 'release-b' };

global.app = {
    db: {
        clearCache() {},
        getQueryResultAsync(sql) {
            const match = /ID = (\d+)/.exec(sql);
            const albumId = match ? Number(match[1]) : 0;
            return Promise.resolve({
                eof: false,
                fields: { getValue: () => albumReleaseIds[albumId] || '' }
            });
        }
    }
};

(async () => {
    const scopeLog = [];
    const albumOne = makeTrack({ id: 1, number: 1, title: 'One', log: scopeLog });
    const albumTwo = makeTrack({ id: 2, number: 1, title: 'One', idalbum: 11, log: scopeLog });
    const albumThree = makeTrack({ id: 3, number: 1, title: 'One', idalbum: 12, log: scopeLog });

    const single = await apply.resolveTagScope([albumOne]);
    assert.strictEqual(single.multiAlbum, false);
    assert.deepStrictEqual(single.albumIds, [10]);
    assert.strictEqual(single.releaseId, 'release-a');
    assert.deepStrictEqual(single.songIds, [1]);

    const shared = await apply.resolveTagScope([albumOne, albumTwo]);
    assert.strictEqual(shared.multiAlbum, true, 'two album IDs must trip the guardrail');
    assert.strictEqual(shared.sharedRelease, true, 'a shared release must be named');
    assert.strictEqual(shared.releaseId, 'release-a');
    assert.strictEqual(shared.albumId, 10, 'the first selected album is the release to use');

    const different = await apply.resolveTagScope([albumOne, albumTwo, albumThree]);
    assert.strictEqual(different.sharedRelease, false);
    assert.strictEqual(different.releaseId, '', 'nothing is shared when three albums differ');

    // A shared tracklist is copied under a read lock.
    const listTracks = [albumOne, albumTwo];
    const list = {
        count: 2,
        getValue: (index) => listTracks[index],
        locked: (callback) => callback()
    };
    const fromList = await apply.resolveTagScope(list);
    assert.deepStrictEqual(fromList.songIds, [1, 2]);

    /* ---------------------------------------------------------------------- *
     * Selection plan and aggregation
     * ---------------------------------------------------------------------- */

    const planLogOne = [];
    const planLogTwo = [];
    const tagsOne = { value: JSON.stringify([{ title: 'BARCODE', value: '111' }]) };
    const tagsTwo = { value: '[]' };

    // The library titles differ from the release titles: that is the field
    // the window exists to offer.
    const one = makeTrack({ id: 1, number: 1, title: 'One (library)', log: planLogOne, tags: tagsOne });
    const two = makeTrack({ id: 2, number: 2, title: 'Two (library)', log: planLogTwo, tags: tagsTwo });

    const plan = await apply.buildSelectionPlanAsync(
        [one, two],
        releaseFixture(),
        new Map([[1, tagsOne.value], [2, tagsTwo.value]])
    );

    assert.strictEqual(plan.total, 2);
    assert.strictEqual(plan.entries.length, 2);
    assert.strictEqual(plan.work.length, 2);
    assert.deepStrictEqual(plan.skipped, { noLibrary: 0, noAlbum: 0, unmatched: 0, same: 0 });
    assert.deepStrictEqual(planLogOne, [], 'planning must not read or write a track');

    // A 2-CD release. A per-disc rip often has no DISC tag, so the number has
    // to decide — but only when exactly one medium carries it.
    const multiDisc = releaseFixture();
    multiDisc.media.push({
        position: '2',
        tracks: [{
            id: 'release-track-3',
            number: '3',
            title: 'Three',
            length: '210000',
            recording: { id: 'recording-3', isrcs: [] }
        }]
    });

    const noDiscTag = await apply.buildPendingAsync(
        makeTrack({ id: 5, number: 3, title: 'Three (library)' }), multiDisc);
    assert.strictEqual(noDiscTag.matched, true, 'a number on only one medium matches it');
    assert.strictEqual(noDiscTag.release.disc, 2, 'it matches the second medium, not the first');

    const taggedDiscTwo = await apply.buildPendingAsync(
        makeTrack({ id: 6, number: 3, title: 'Three (library)', discNumber: '2' }), multiDisc);
    assert.strictEqual(taggedDiscTwo.release.disc, 2, 'a disc tag picks its own medium');

    const ambiguous = releaseFixture();
    ambiguous.media.push({
        position: '2',
        tracks: [{
            id: 'release-track-4',
            number: '1',
            title: 'One again',
            length: '190000',
            recording: { id: 'recording-4', isrcs: [] }
        }]
    });

    const ambiguousMatch = await apply.buildPendingAsync(
        makeTrack({ id: 7, number: 1, title: 'One (library)' }), ambiguous);
    assert.strictEqual(ambiguousMatch.matched, false,
        'a number on both discs is not guessed onto either one');

    const fieldByKey = {};
    plan.fields.forEach((field) => { fieldByKey[field.key] = field; });

    assert.ok(fieldByKey.title, 'a differing title is a field');
    assert.strictEqual(fieldByKey.title.perTrack, true, 'titles that differ read per track');
    assert.strictEqual(fieldByKey.title.value, '');
    assert.strictEqual(fieldByKey.title.changes, 2);
    assert.strictEqual(fieldByKey.title.total, 2);

    assert.strictEqual(fieldByKey.isrc.perTrack, true);
    assert.strictEqual(fieldByKey.composer.perTrack, true);

    assert.ok(fieldByKey.albumid, 'album-wide tags are offered once');
    assert.strictEqual(fieldByKey.albumid.perTrack, false);
    assert.strictEqual(fieldByKey.albumid.value, '11111111-1111-4111-8111-111111111111');

    // BARCODE already holds 111 on the first track and nothing on the second,
    // so it is offered and both the per-track value and the library's own
    // value are reported.
    assert.strictEqual(fieldByKey.barcode.currentText, 'Mixed');
    assert.strictEqual(fieldByKey.barcode.perTrack, false, 'an album-wide value is the same for every track');
    assert.strictEqual(fieldByKey.barcode.value, '123456');
    assert.strictEqual(
        plan.work[0].pending.fields.find((field) => field.key === 'barcode').current,
        '111'
    );

    // Disc # is the integer property, never the string one.
    assert.ok(fieldByKey.discNumber, 'the missing Disc # is offered');
    assert.strictEqual(fieldByKey.discNumber.kind, 'native');
    assert.strictEqual(fieldByKey.discNumber.native, 'discNumberInt');
    assert.strictEqual(plan.work[0].pending.native.discNumberInt, 1);
    assert.strictEqual('discNumber' in plan.work[0].pending.native, false);

    const aggregate = apply.aggregateFields([plan.work[0]]);
    const aggregateTitle = aggregate.find((field) => field.key === 'title');
    assert.strictEqual(aggregateTitle.perTrack, false, 'one track has one value');
    assert.strictEqual(aggregateTitle.value, 'One');
    assert.strictEqual(aggregateTitle.total, 1);

    const emptyAggregate = apply.aggregateFields([]);
    assert.deepStrictEqual(emptyAggregate, []);

    /* ---------------------------------------------------------------------- *
     * Write order: native fields, one tag write, one commit
     * ---------------------------------------------------------------------- */

    planLogOne.length = 0;
    planLogTwo.length = 0;

    const writeResult = await apply.applySelectionAsync(plan, ['composer', 'discNumber', 'artistid'], []);

    assert.strictEqual(writeResult.updated, 2);
    assert.strictEqual(writeResult.failed.length, 0);
    assert.strictEqual(writeResult.tagWrites, 2, 'one tag write per track');

    // Native fields follow the engine's field order, then the one tag write,
    // then the one commit.
    assert.deepStrictEqual(planLogOne, [
        'begin',
        'disc:1',
        'composer:Writer One',
        'end',
        'getTags',
        'setTags',
        'commit'
    ]);

    assert.ok(
        planLogOne.indexOf('composer:Writer One') < planLogOne.indexOf('getTags'),
        'native fields must be set before the extended tags are read and written'
    );
    assert.ok(
        planLogOne.indexOf('end') < planLogOne.indexOf('getTags'),
        'the native update block must close before the tag write'
    );
    assert.strictEqual(
        planLogOne.filter((entry) => entry === 'getTags').length,
        1,
        'a track is read once'
    );

    const writtenTags = JSON.parse(tagsOne.value);
    assert.deepStrictEqual(
        writtenTags.find((tag) => tag.title === 'MUSICBRAINZ_ARTISTID'),
        { title: 'MUSICBRAINZ_ARTISTID', value: 'artist-1' }
    );
    assert.deepStrictEqual(
        writtenTags.find((tag) => tag.title === 'BARCODE'),
        { title: 'BARCODE', value: '111' },
        'untouched tags survive the merged write'
    );

    /* ---------------------------------------------------------------------- *
     * Fill and a tag edit share one tag write
     * ---------------------------------------------------------------------- */

    planLogOne.length = 0;

    const editResult = await apply.applySelectionAsync(plan, ['albumid'], [
        { title: 'PRODUCER', add: true, value: 'A Producer' },
        { title: 'BARCODE', occurrence: 0, value: '999' }
    ]);

    assert.strictEqual(editResult.updated, 2);
    assert.strictEqual(editResult.tagWrites, 2);
    assert.strictEqual(
        planLogOne.filter((entry) => entry === 'setTags').length,
        1,
        'the fill and the tag edit are written together'
    );

    const mergedOnce = JSON.parse(tagsOne.value);
    assert.deepStrictEqual(mergedOnce.find((tag) => tag.title === 'MUSICBRAINZ_ALBUMID'),
        { title: 'MUSICBRAINZ_ALBUMID', value: '11111111-1111-4111-8111-111111111111' });
    assert.deepStrictEqual(mergedOnce.find((tag) => tag.title === 'PRODUCER'),
        { title: 'PRODUCER', value: 'A Producer' });
    assert.deepStrictEqual(mergedOnce.find((tag) => tag.title === 'BARCODE'),
        { title: 'BARCODE', value: '999' });

    /* ---------------------------------------------------------------------- *
     * Per-track failure isolation
     * ---------------------------------------------------------------------- */

    planLogOne.length = 0;
    planLogTwo.length = 0;

    const healthy = makeTrack({
        id: 1,
        number: 1,
        title: 'One (library)',
        log: planLogOne,
        tags: { value: '[]' }
    });
    const failing = makeTrack({
        id: 2,
        number: 2,
        title: 'Two',
        log: planLogTwo,
        tags: { value: '[]' },
        tagsFail: true
    });
    const failingPlan = await apply.buildSelectionPlanAsync(
        [healthy, failing],
        releaseFixture(),
        new Map([[1, '[]'], [2, '[]']])
    );

    planLogOne.length = 0;

    const partial = await apply.applySelectionAsync(failingPlan, ['albumid'], []);
    assert.strictEqual(partial.updated, 1, 'the healthy track still commits');
    assert.strictEqual(partial.failed.length, 1);
    assert.strictEqual(partial.failed[0].title, 'Two');
    assert.ok(planLogOne.indexOf('commit') !== -1, 'the first track is not abandoned');
    assert.strictEqual(planLogTwo.indexOf('commit'), -1, 'a failed track is not committed');

    /* ---------------------------------------------------------------------- *
     * Tracks without a release are still counted, and tag edits still apply
     * ---------------------------------------------------------------------- */

    const tagsOnlyLog = [];
    const tagsOnlyTags = { value: JSON.stringify([{ title: 'BARCODE', value: '1' }]) };
    const tagsOnly = makeTrack({
        id: 5,
        number: 1,
        title: 'Five',
        log: tagsOnlyLog,
        tags: tagsOnlyTags
    });

    const noRelease = await apply.buildSelectionPlanAsync(
        [tagsOnly],
        null,
        new Map([[5, JSON.stringify([{ title: 'BARCODE', value: '1' }])]])
    );

    assert.strictEqual(noRelease.work.length, 0);
    assert.strictEqual(noRelease.skipped.unmatched, 1);
    assert.strictEqual(noRelease.fields.length, 0);

    const tagsOnlyResult = await apply.applySelectionAsync(noRelease, [], [
        { title: 'BARCODE', occurrence: 0, value: '2' }
    ]);

    assert.strictEqual(tagsOnlyResult.updated, 1);
    assert.deepStrictEqual(JSON.parse(tagsOnlyTags.value), [{ title: 'BARCODE', value: '2' }]);
    assert.deepStrictEqual(tagsOnlyLog, ['getTags', 'setTags', 'commit']);

    /* ---------------------------------------------------------------------- *
     * Nothing to do
     * ---------------------------------------------------------------------- */

    const idleLog = [];
    const idle = makeTrack({ id: 9, number: 1, title: 'Nine', log: idleLog });
    const idlePlan = await apply.buildSelectionPlanAsync(
        [idle], null, new Map([[9, '[]']])
    );
    const idleResult = await apply.applySelectionAsync(idlePlan, ['albumid'], []);

    assert.strictEqual(idleResult.updated, 0);
    assert.strictEqual(idleResult.noMatch, 1);
    assert.deepStrictEqual(idleLog, [], 'an unmatched track is never read or written');

    console.log('tag-path regression test passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
