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
const fetchSource = read('mbzFetch.js');

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

require(path.join(root, 'mbzFetch.js'));
const mbzFetch = global.window.mbzFetch;

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
assert.match(dialogHtml, /<fieldset class="mbzSection mbzCard/, 'sections must be drawn as cards');
assert.match(dialogHtml, /<legend class="mbzCardTitle" data-localize>Fields to write<\/legend>/,
    'the card needs a titled legend');
assert.match(dialogHtml, /data-id="releaseCard"/, 'the release block needs its card');
assert.match(dialogCode, /function syncReleaseCard/, 'an empty release card must hide itself');
assert.match(dialogHtml, /\.mbzCard \{[^}]*margin: 0 0 1rem 0/, 'cards need room between them');
assert.match(dialogHtml, /\.mbzInfo \{[^}]*font-style: italic/,
    'guidance must read as an aside');
assert.match(dialogHtml, /<fieldset class="mbzSection mbzCard mbzHidden" data-id="trackSection"/,
    'the track card starts hidden');
assert.match(dialogCode, /show\(UI\.fieldsSection, false\);\s*show\(UI\.trackSection, false\);/,
    'a release that is not loaded hides the comparison cards');
assert.match(dialogCode, /setProperty\('display', 'none', 'important'\)/,
    'hiding must outrank the skin stylesheet, as the control sizing does');
assert.match(dialogCode, /function pinCardSpacing/,
    'the card gap must be pinned from script, not only the page stylesheet');
assert.match(dialogCode, /setProperty\('margin', '0 0 1rem 0', 'important'\)/,
    'the 1rem gap must be applied inline');
assert.match(dialogCode, /function italicizeInfo/,
    'the asides must be italicized from script');
assert.match(dialogCode, /setProperty\('font-style', 'italic', 'important'\)/,
    'italic text must outrank the host font');
assert.match(dialogCode, /show\(UI\.fieldsSection,\s*!!state\.hasRelease/,
    'the field card must not return before a release is loaded');
assert.match(dialogHtml, /\.mbzMetaTable th \{[^}]*text-align: left !important/,
    'the meta labels must be left aligned, not centred by the skin');
assert.match(dialogCode, /function syncTables/, 'empty tables must not draw their header row');
assert.match(dialogHtml, /\.mbzTable th \{[^}]*text-align: left !important/,
    'table headers must be left aligned over their data');

// The preview pairs each side's artist instead of listing ISRCs and track IDs.
assert.match(dialogHtml, /<th data-localize>Library artist<\/th>/,
    'the preview must show the library artist');
assert.match(dialogHtml, /<th data-localize>Release artist<\/th>/,
    'the preview must show the release artist');
assert.doesNotMatch(dialogHtml, /<th data-localize>ISRC<\/th>/,
    'the preview must not show an ISRC column');
assert.doesNotMatch(dialogHtml, /<th data-localize>Recording ID<\/th>/,
    'the preview must not show a recording ID column');
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

/* -------------------------------------------------------------------------- *
 * 0.6.1: the other releases of the release group
 * -------------------------------------------------------------------------- */

assert.match(dialogHtml, /data-id="groupCard"[\s\S]*?data-id="groupRows"/,
    'the window must list the releases of the loaded release group');
assert.match(dialogHtml,
    /<legend class="mbzCardTitle" data-localize>Releases in this release group<\/legend>/,
    'the group list needs a titled card');
assert.match(dialogHtml, /<th data-localize>Date<\/th>/,
    'the group list must show each release date');
assert.match(dialogHtml, /<th data-localize>Tracks<\/th>/,
    'the group list must show each release track count');
assert.match(dialogHtml, /<th data-localize>Format<\/th>/,
    'the group list must show the medium each release is');
assert.match(dialogCode, /mbzTagCell\(release\.format,[^)]*\)/,
    'the window must draw the release format from the listing');
assert.match(dialogCode, /function renderGroupReleases/, 'the group list is drawn by the window');
assert.match(dialogCode, /releases\.length < 2/,
    'a group with nothing to choose must not draw the card');
assert.match(dialogCode, /function chooseRelease/, 'a listed release must be loadable in place');
assert.match(dialogCode, /localListen\(UI\.groupRows, 'click', onGroupClick\)/,
    'the chooser must be wired to its rows');
assert.match(dialogCode, /fetch\.fetchReleaseGroupReleasesAsync\(groupId\)/,
    'the list must come from the release group lookup');
assert.match(dialogCode, /loadGroupReleasesAsync\(state\.release\)/,
    'a loaded release brings its group list, and the plan does not wait for it');
assert.match(dialogCode, /function syncGroupCard/,
    'the card follows the rows it draws and the release ID field it holds');
assert.match(dialogCode, /function relocateAlbumIdRow/,
    'a page older than this script must still get the ID field into the card');
assert.match(dialogCode, /function placeGroupCardFirst/,
    'a page older than this script must still get the group card first');
assert.ok(dialogHtml.indexOf('data-id="groupCard"') < dialogHtml.indexOf('data-id="releaseCard"'),
    'the releases of the group are the first card in the window');

const groupCardHtml = dialogHtml.slice(
    dialogHtml.indexOf('data-id="groupCard"'),
    dialogHtml.indexOf('data-id="releaseCard"')
);
assert.match(groupCardHtml, /data-id="albumIdRow"/,
    'the album release ID field belongs inside the group card');
assert.match(groupCardHtml, /data-id="btnSaveAlbumId"/,
    'Save ID lives beside the field it saves');
assert.ok(groupCardHtml.indexOf('data-id="albumIdRow"') < groupCardHtml.indexOf('data-id="groupRows"'),
    'the release ID field is the first thing in the card, above the list');
assert.doesNotMatch(dialogHtml, /Picking another release/,
    'the card carries no helper sentence the list and the field already say');
assert.doesNotMatch(dialogCode, /GROUP_CARD_NOTE/,
    'the script must not rebuild the removed helper sentence');
assert.match(dialogCode, /function ensureGroupCard/,
    'the window must build the group card when the page predates it');
assert.match(dialogCode, /ensureGroupCard\(\);/,
    'the group card must be in place before the window starts');
assert.match(dialogCode, /function renderGroupCardNote/,
    'a group that could not be read must say so instead of vanishing');
assert.match(dialogCode, /Could not read the other releases of this group: %s/,
    'the card must carry the reason it has no rows');
assert.match(dialogCode, /data-group-retry/,
    'a listing that failed must offer another attempt');
assert.match(dialogCode, /function retryGroupReleases/,
    'the retry must read the same group again');
assert.match(dialogCode, /loadGroupReleasesAsync\(state\.release, true\)/,
    'a retry keeps the card while the group is read again');
assert.match(dialogCode, /state\.groupRetryable = canRetryRelease\(error\)/,
    'only a failure that can pass may offer a retry');

// The release status is already named in the release block above the list; the
// column repeated it on every row and cost width the chooser does not have.
assert.doesNotMatch(dialogHtml, /<th data-localize>Status<\/th>/,
    'the group list must not carry a status column');
assert.doesNotMatch(dialogCode, /mbzTagCell\(release\.status/,
    'the group list must not draw the release status');

// The action column ends flush right: `use this` on the releases that can be
// loaded, one glyph on the loaded one.
assert.match(dialogCode, /GROUP_LOADED_GLYPH/, 'the loaded release needs its own mark');
assert.doesNotMatch(dialogCode, /GROUP_USE_GLYPH/,
    'the load action is a link that says so, not a glyph');

const groupRowsSlice = dialogCode.slice(
    dialogCode.indexOf('function renderGroupReleases'),
    dialogCode.indexOf('function chooseRelease')
);
assert.doesNotMatch(groupRowsSlice, /_\('Use'\)|_\('Loaded'\)/,
    'the chooser must use icons instead of the words Use and Loaded');
assert.match(groupRowsSlice, /link\.textContent = _\('use this'\)/,
    'a listed release needs a link that says what it does');
assert.match(groupRowsSlice, /link\.setAttribute\('aria-label', action\)/,
    'the link still needs its accessible name');
assert.match(groupRowsSlice, /link\.setAttribute\('data-release', release\.id\)/,
    'the link carries the release it loads');
assert.match(groupRowsSlice, /cell\.style\.textAlign = 'right'/,
    'the links must line up with the loaded release check');

// Picking a release is a load, not a write: Save ID stays the only place that
// touches Albums.MBGID, and nothing goes through the apply path.

// Picking a release is a load, not a write: Save ID stays the only place that
// touches Albums.MBGID, and nothing goes through the apply path.
const chooseSlice = dialogCode.slice(
    dialogCode.indexOf('function chooseRelease'),
    dialogCode.indexOf('function onGroupClick')
);
assert.match(chooseSlice, /fetchReleaseAsync/, 'the chooser loads the picked release');
assert.doesNotMatch(chooseSlice, /setAlbumGuidAsync|applySelectionAsync/,
    'picking a release must not write the album row or the tags');

// A failed pick is reported inside the window's promise chain. Handled only
// after trackWork wraps the promise, MediaMonkey's promise library reports the
// rejection as an unhandled exception and shows its own error box.
assert.match(chooseSlice, /trackWork\(handledInWindow\(work, function \(error\)/,
    'the pick must handle its failure inside the window promise chain');
assert.doesNotMatch(chooseSlice, /var failed/,
    'the pick needs no failure flag: its rejection is handled where it is built');
assert.strictEqual(
    (dialogSource.match(/setAlbumGuidAsync\(albumId, 'MBGID'/g) || []).length,
    1,
    'Save ID must stay the only album release ID write'
);

// The field exists to be saved: Save ID writes the value it holds and reports it
// underneath, instead of opening a modal for the value the user just typed.
const saveIdSlice = dialogCode.slice(
    dialogCode.indexOf('function saveAlbumId'),
    dialogCode.indexOf('function onAlbumIdKey')
);
assert.doesNotMatch(saveIdSlice, /messageDlg|'Confirmation'/,
    'Save ID must write without a confirmation dialog');
assert.match(saveIdSlice, /trackWork\(handledInWindow\(work, function \(error\)/,
    'Save ID must handle its failure inside the window promise chain');

// A release picked from the group is the ID the field shows, while Save ID
// compares against what the album row actually holds.
// A picked release survives the reload that follows Apply: the album row still
// points at its own release until Save ID is pressed.
assert.match(dialogCode, /state\.pickedReleaseId = release\.id/,
    'picking a release must be remembered');
assert.match(dialogCode, /fetch\.fetchReleaseAsync\(picked\)/,
    'a reload after Apply must keep the picked release loaded');
assert.match(dialogCode, /state\.pickedReleaseId = '';/,
    'Save ID ends the picking, because the album then points at it');

assert.match(dialogCode, /function storedAlbumReleaseId/, 'the album row value needs its own reader');
assert.match(dialogCode, /function shownAlbumReleaseId/, 'the shown release needs its own reader');
assert.match(dialogCode, /var current = storedAlbumReleaseId\(\);/,
    'Save ID must compare with the album row, not with a picked release');

// A failed release lookup is recoverable in the window, not by closing it.
assert.match(dialogHtml, /data-id="btnRetry"/, 'a failed lookup must offer a retry');
assert.match(dialogCode, /function retryRelease/, 'the retry must reload the release in place');
assert.match(dialogCode, /localListen\(UI\.btnRetry, 'click', retryRelease\)/,
    'the retry button must be wired to the reload');

// Apply states its pending work before it runs, and follows the table.
assert.match(dialogHtml, /data-id="pendingSummary"/,
    'the footer must state what Apply will write');
assert.match(dialogCode, /function updatePending/, 'the pending summary must be computed in the window');
assert.match(dialogCode, /localListen\(UI\.fieldRows, 'click', updatePending\)/,
    'ticking a field must update the pending summary');

// A write locks the editable surface, so no edit can be typed into a run
// that has already read its inputs.
assert.match(dialogCode, /function setBusy/, 'the window must have one busy lock');
assert.match(dialogCode, /setBusy\(true\)/, 'Apply must lock the window before writing');
assert.match(dialogCode, /values\[i\]\.disabled = state\.busy \|\| state\.readOnly/,
    'tag values must be locked while writing');
assert.match(dialogCode, /if \(state\.busy\) return;\s*\n\s*var input = event && event\.target;/,
    'tag input must be ignored while writing');
assert.match(dialogCode, /function refreshApply/, 'Apply readiness must live in one place');
assert.match(dialogCode, /!state\.readOnly && !state\.busy && !!state\.plan/,
    'Apply needs a plan and an idle window');
assert.match(dialogCode, /state\.plan = null;\s*\n\s*updatePending\(\);\s*\n\s*refreshApply/,
    'a reload must grey Apply until the new plan exists');

// Background work shows the busy ring: one counter, one toggle, and every
// lookup and write runs under it. The ring is built in the window as well as
// drawn by the page, for the same reason the italics are.
assert.match(dialogHtml, /data-id="working"/, 'the header must carry the busy ring');
assert.match(dialogHtml, /\.mbzSpinner \{[^}]*animation: mbzSpin/, 'the busy ring must turn');
assert.match(dialogCode, /working: qid\('working'\)/, 'the window must look the ring up');
assert.match(dialogCode, /function syncWorking/, 'the ring must be driven from one place');
assert.match(dialogCode, /function beginWork/, 'work must be counted, not flagged');
assert.match(dialogCode, /function trackWork/, 'lookups must run under the ring');
assert.match(dialogCode, /function endWork/, 'the ring must clear when the work ends');
assert.match(dialogCode, /trackWork\(loadTagRowsAsync/, 'a reload must show the ring');
assert.match(dialogCode, /var work = window\.localPromise\(mbz\.setAlbumGuidAsync/,
    'saving a release ID must show the ring');
assert.match(dialogCode, /var work = window\.localPromise\(apply\.applySelectionAsync/,
    'Apply must show the ring');
assert.match(dialogCode, /function handledInWindow/,
    'a failure must be reported inside the window promise chain, not after trackWork');
assert.match(dialogCode, /trackWork\(handledInWindow\(work, function \(error\)/,
    'Apply, Save ID and the pick must handle their failures before trackWork wraps them');
assert.match(dialogCode, /createElement\('style'\)/, 'a page older than the script must still get the ring');

// The ring has to survive the host's skin sheet and an engine that ignores the
// page's animation, so its shape is pinned inline and it turns from script.
assert.match(dialogCode, /function pinWorkingStyle/, 'the ring must be styled inline, like the italics');
assert.match(dialogCode, /set\('border', '3px solid/, 'the ring must draw its own border inline');
assert.match(dialogCode, /function startSpin/, 'the ring must turn from script as well');
assert.match(dialogCode, /setProperty\('transform', 'rotate\(/, 'the script spin must rotate the ring');
assert.match(dialogCode, /setProperty\('cursor', 'progress'/, 'the window must show a busy cursor');

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
assert.match(buildScript, /BUILD_CHANNEL/, 'a test build must name its channel in the package');
assert.match(buildScript, /'LovesMBz-' \+ version \+ '-' \+ channel \+ '\.mmip'/,
    'the channel belongs in the package name, beside the release package');

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

/* -------------------------------------------------------------------------- *
 * The release group listing
 * -------------------------------------------------------------------------- */

assert.match(fetchSource, /'release\?release-group=' \+ encodeURIComponent\(id\)/,
    'the group listing is one release browse by release group');
assert.match(fetchSource, /inc=media/,
    'the listing must ask for media, or it carries no track count');
assert.doesNotMatch(fetchSource, /release-group\/' \+ encodeURIComponent\(id\) \+\s*\n?\s*'\?inc=releases'/,
    'a release-group inc=releases listing has no media and no track counts');
assert.strictEqual(typeof mbzFetch.fetchReleaseGroupReleasesAsync, 'function',
    'mbzFetch must list a release group\'s releases');
assert.strictEqual(typeof mbzFetch.releaseGroupReleases, 'function',
    'the group response must be parsed into rows');

const groupFixture = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'An Album',
    releases: [{
        id: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
        title: 'An Album',
        date: '2004-05-01',
        country: 'GB',
        status: 'Official',
        media: [{ 'track-count': 10, format: 'CD' }, { 'track-count': 2, format: 'CD' }]
    }, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'An Album (remaster)',
        date: '1999-03-01',
        country: 'US',
        status: 'Official',
        disambiguation: 'remastered',
        media: [{ tracks: [{}, {}, {}], format: '12" Vinyl' }]
    }, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'An Album (remaster)',
        date: '1999-03-01'
    }, {
        title: 'No ID at all',
        date: '1970'
    }, {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'Undated',
        status: 'Bootleg'
    }]
};

const groupList = mbzFetch.releaseGroupReleases(groupFixture);
assert.strictEqual(groupList.title, 'An Album');
assert.strictEqual(groupList.id, '22222222-2222-4222-8222-222222222222');
assert.deepStrictEqual(
    groupList.releases.map((release) => release.id),
    [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    ],
    'the group is oldest first, deduplicated, canonical and skips id-less rows'
);
assert.strictEqual(groupList.releases[0].trackCount, 3, 'a medium without track-count is counted');
assert.strictEqual(groupList.releases[1].trackCount, 12, 'a medium with track-count is summed');
assert.strictEqual(groupList.releases[1].format, 'CD', 'the media format is named once, not per disc');
assert.strictEqual(groupList.releases[0].format, '12" Vinyl', 'a vinyl pressing keeps its format');
assert.strictEqual(groupList.releases[2].format, '', 'a release with no media has no format');
assert.strictEqual(groupList.releases[0].date, '1999-03-01');
assert.strictEqual(groupList.releases[0].disambiguation, 'remastered');
assert.strictEqual(groupList.releases[2].trackCount, 0, 'a release with no media has no count');
assert.strictEqual(groupList.releases[2].date, '', 'an undated release stays empty, not year zero');
assert.deepStrictEqual(mbzFetch.releaseGroupReleases(null).releases, []);
assert.deepStrictEqual(mbzFetch.releaseGroupReleases({ releases: [] }).releases, []);
assert.deepStrictEqual(
    mbzFetch.releaseGroupReleases({ releases: [{ id: 'short', title: 'bad id' }] }).releases,
    [],
    'a value that is not a UUID is not a release to offer'
);

function makeTrack(options) {
    const log = options.log;
    const tags = options.tags || { value: '[]' };

    const track = {
        id: options.id,
        idalbum: options.idalbum === undefined ? 10 : options.idalbum,
        trackNumber: String(options.number),
        title: options.title,
        album: options.album === undefined ? 'An Album' : options.album,
        path: options.path || 'C:\\music\\song.flac',
        discNumber: options.discNumber || '',
        albumArtist: '',
        artist: options.artist || '',
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

    // Files outside the library: no album row and no song row, so the album
    // name is the scope and the files' own tags are all there is to write.
    const fileOne = makeTrack({ id: 0, idalbum: 0, number: 1, title: 'One', album: 'Exact Release', log: scopeLog });
    const fileTwo = makeTrack({ id: 0, idalbum: 0, number: 2, title: 'Two', album: 'Exact Release', log: scopeLog });
    const fileOther = makeTrack({ id: 0, idalbum: 0, number: 3, title: 'Three', album: 'Another Record', log: scopeLog });
    const fileUnnamed = makeTrack({ id: 0, idalbum: 0, number: 4, title: 'Four', album: '', log: scopeLog });

    const files = await apply.resolveTagScope([fileOne, fileTwo]);
    assert.strictEqual(files.tagOnly, true, 'no album row means the tags are the only thing to write');
    assert.strictEqual(files.outOfLibrary, true);
    assert.deepStrictEqual(files.albumIds, [], 'a file outside the library has no album row');
    assert.deepStrictEqual(files.songIds, [], 'and no song row');
    assert.strictEqual(files.albumName, 'Exact Release', 'the scope is the album name the files carry');
    assert.strictEqual(files.albumNameConflict, false, 'one album name is one scope');
    assert.strictEqual(files.releaseId, '', 'a file with no ID tag starts from an empty release ID');

    const unnamed = await apply.resolveTagScope([fileUnnamed]);
    assert.strictEqual(unnamed.albumName, '');
    assert.strictEqual(unnamed.albumNameConflict, false, 'all the names being empty is allowed');

    const namesDiffer = await apply.resolveTagScope([fileOne, fileOther]);
    assert.strictEqual(namesDiffer.albumNameConflict, true, 'two album names are two albums');

    const mixed = await apply.resolveTagScope([fileOne, albumOne]);
    assert.strictEqual(mixed.outOfLibrary, true, 'one file outside the library is enough');
    assert.strictEqual(mixed.tagOnly, false, 'a library album row still makes it a library scope');

    /* ---------------------------------------------------------------------- *
     * Selection plan and aggregation
     * ---------------------------------------------------------------------- */

    const planLogOne = [];
    const planLogTwo = [];
    const tagsOne = { value: JSON.stringify([{ title: 'BARCODE', value: '111' }]) };
    const tagsTwo = { value: '[]' };

    // The library titles differ from the release titles: that is the field
    // the window exists to offer.
    const one = makeTrack({
        id: 1, number: 1, title: 'One (library)', artist: 'Library One', log: planLogOne, tags: tagsOne
    });
    const two = makeTrack({
        id: 2, number: 2, title: 'Two (library)', artist: 'Library Two', log: planLogTwo, tags: tagsTwo
    });

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

    // The preview table pairs each side's artist, not just its title.
    assert.strictEqual(plan.entries[0].artist, 'Library One', 'the preview needs the library artist');
    assert.strictEqual(plan.entries[0].pending.release.artist, 'The Artist',
        'the preview needs the release artist');

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
     * Files outside the library
     * ---------------------------------------------------------------------- */

    const fileTagsLog = [];
    const fileTags = { value: '[]' };
    const fileTrack = makeTrack({
        id: 0, idalbum: 0, number: 1, title: 'One (file)', album: 'An Album',
        log: fileTagsLog, tags: fileTags
    });

    const filePlan = await apply.buildSelectionPlanAsync([fileTrack], releaseFixture());

    assert.strictEqual(filePlan.entries.length, 1, 'a file outside the library is still planned');
    assert.strictEqual(filePlan.skipped.noLibrary, 0,
        'a track with a file is planned even without a library row');
    assert.strictEqual(filePlan.entries[0].songId, 0);
    assert.strictEqual(filePlan.work.length, 1, 'the release offers changes for the file');
    assert.ok(fileTagsLog.indexOf('getTags') >= 0, 'the tags come from the file itself');

    const fileApplied = await apply.applySelectionAsync(
        filePlan, [], [{ title: 'BARCODE', value: '999', add: true }]
    );

    assert.strictEqual(fileApplied.updated, 1, 'a file outside the library is written like any other');
    assert.strictEqual(fileApplied.tagWrites, 1);
    assert.deepStrictEqual(fileTagsLog, ['getTags', 'getTags', 'setTags', 'commit'],
        'planning reads the file once, then Apply reads, writes and commits it');

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

    /* ---------------------------------------------------------------------- *
     * 0.6.2: files outside the library, scoped by album name
     * ---------------------------------------------------------------------- */

    // The scope is resolved by name in the engine, so the entry point and the
    // window cannot disagree about what one album is.
    assert.match(applySource, /function albumNameScope/,
        'files outside the library are scoped by their album name');
    assert.match(applySource, /tagOnly: albumIds.length === 0/,
        'no album row means a tag-only scope');
    assert.match(applySource, /!\(songId > 0\) && !text\(track && track\.path\)/,
        'a file with no library row is planned from its own tags');
    assert.match(actionsCode, /scope\.outOfLibrary && scope\.albumNameConflict/,
        'the entry point refuses files that do not share one album name');

    // Outside the library there is no album row to save, so the field only
    // loads the release and Apply writes the tags. Nothing may call
    // setAlbumGuidAsync from that path.
    assert.match(dialogCode, /function loadReleaseIdIntoWindow/,
        'the ID field must load a release when there is no album row');
    assert.match(dialogCode, /albumRow \? _\('Save ID'\) : _\('Load'\)/,
        'the same field says Load when there is no album row of its own');
    assert.match(dialogCode, /function loadFileTagsAsync/,
        'the tags of a file outside the library are read from the file');
    assert.match(dialogCode, /state\.fileReleaseId = tagTextFrom\(lists\[0\], 'MUSICBRAINZ_ALBUMID'\)/,
        'a file starts from the release ID its own tags carry');
    assert.match(applySource, /function readTrackTagsAsync/,
        'reading a file\'s tags goes through the engine, under a deadline');
    assert.match(dialogCode, /apply\.readTrackTagsAsync\(track, FILE_TAGS_TIMEOUT_MS\)/,
        'the window reads a file\'s tags with a deadline');
    assert.match(dialogCode, /if \(scope\.tagOnly\) showFileLookup\(\);/,
        'the release ID field and the search link appear before the tags are read');
    assert.match(dialogCode, /scope\.tagOnly && scope\.albumNameConflict/,
        'the window refuses files that do not share one album name');

    // No release ID means no request: files outside the library are read from
    // MusicBrainz only when the user loads a release in the field.
    const tagOnlyReleaseSlice = dialogCode.slice(
        dialogCode.indexOf('if (!(scope.albumId > 0)) {'),
        dialogCode.indexOf('if (state.pickedReleaseId) {')
    );
    assert.ok(tagOnlyReleaseSlice.length > 0, 'the tag-only release branch must exist');
    assert.strictEqual(tagOnlyReleaseSlice.indexOf('fetchReleaseAsync'), -1,
        'loading the window outside the library must not read a release by itself');

    const loadIdSlice = dialogCode.slice(
        dialogCode.indexOf('function loadReleaseIdIntoWindow'),
        dialogCode.indexOf('function onAlbumIdKey')
    );
    assert.ok(loadIdSlice.length > 0, 'the loader must sit between those two functions');
    assert.strictEqual(loadIdSlice.indexOf('setAlbumGuidAsync'), -1,
        'loading a release outside the library must not write an album row');

    /* ---------------------------------------------------------------------- *
     * 0.7.0: a fetched release outlives the window that fetched it
     * ---------------------------------------------------------------------- */

    // init.js creates the container on the main window and a dialog can only
    // read it. This fake main window is that contract; a fresh module load with
    // a fresh `window` is the next dialog.
    const mainWindowValues = {};
    const cacheContainer = {};
    mainWindowValues.lovesMBzFetchCache = cacheContainer;      // what init.js does
    global.app = {
        dialogs: {
            getMainWindow: () => ({ getValue: (name) => mainWindowValues[name] })
        }
    };

    // Time is how an entry is aged without reaching into the cache's shape.
    const realNow = Date.now;
    let clock = 1700000000000;
    Date.now = () => clock;

    const releaseOne = '11111111-1111-4111-8111-111111111111';
    const releaseTwo = '22222222-2222-4222-8222-222222222222';
    const releaseThree = '33333333-3333-4333-8333-333333333333';
    const groupId = '44444444-4444-4444-8444-444444444444';
    const releaseTitles = {
        [releaseOne]: 'An Album',
        [releaseTwo]: 'Another Album',
        [releaseThree]: 'Third Album'
    };

    let releaseRequests = 0;
    let groupRequests = 0;

    function releaseBodyFor(url) {
        const id = (String(url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [''])[0];

        return JSON.stringify({
            id,
            title: releaseTitles[id] || 'Unknown',
            'artist-credit': [{ name: 'An Artist', artist: { id: '55555555-5555-4555-8555-555555555555', name: 'An Artist' } }],
            // A Discogs link keeps the extra release-group request out of the way.
            relations: [{ type: 'discogs', url: { resource: 'https://www.discogs.com/release/1' } }],
            media: [{
                position: 1,
                format: 'CD',
                'track-count': 1,
                tracks: [{
                    id: '66666666-6666-4666-8666-666666666666',
                    number: '1',
                    title: 'One',
                    recording: { id: '77777777-7777-4777-8777-777777777777', title: 'One', isrcs: [] }
                }]
            }]
        });
    }

    global.XMLHttpRequest = class FakeXhr {
        open(method, url) { this.url = url; }
        setRequestHeader() {}
        abort() {}
        send() {
            const isGroup = String(this.url).indexOf('release?release-group=') >= 0;
            if (isGroup) groupRequests++; else releaseRequests++;
            clock += 5000;          // well past the 1.1 s spacing, so no waiting

            setTimeout(() => {
                this.readyState = 4;
                this.status = 200;
                this.responseText = isGroup
                    ? JSON.stringify({
                        id: groupId,
                        title: 'An Album',
                        releases: [{
                            id: releaseOne,
                            title: 'An Album',
                            date: '2004',
                            media: [{ 'track-count': 10, format: 'CD' }]
                        }]
                    })
                    : releaseBodyFor(this.url);
                if (this.onreadystatechange) this.onreadystatechange();
            }, 0);
        }
    };

    function openWindow() {
        delete require.cache[require.resolve(path.join(root, 'mbzFetch.js'))];
        global.window = {};
        require(path.join(root, 'mbzFetch.js'));
        return global.window.mbzFetch;
    }

    // One release is one request, and the next window reuses it.
    const firstWindow = openWindow();
    const firstRelease = await firstWindow.fetchReleaseAsync(releaseOne);

    assert.strictEqual(firstRelease.title, 'An Album');
    assert.strictEqual(releaseRequests, 1);
    assert.strictEqual(mainWindowValues.lovesMBzFetchCache, cacheContainer,
        'the parsed release must go into the container the main window holds');

    const secondWindow = openWindow();
    const reusedRelease = await secondWindow.fetchReleaseAsync(releaseOne);

    assert.strictEqual(reusedRelease.title, 'An Album', 'the stored release must be usable');
    assert.strictEqual(releaseRequests, 1,
        'a second window must reuse the parsed release instead of asking again');

    // The lifetime is a rule: an entry past it is read again.
    clock += 31 * 60 * 1000;

    const thirdWindow = openWindow();
    await thirdWindow.fetchReleaseAsync(releaseOne);

    assert.strictEqual(releaseRequests, 2, 'a release past 30 minutes must be read again');

    // Bounded, oldest fetch out: eight more releases push the oldest entry away,
    // so it alone costs a request, while the newest is still served from memory.
    const fillIds = [];
    for (let i = 0; i < 8; i++) fillIds.push('88888888-8888-4888-8888-00000000000' + i);
    for (const id of fillIds) await openWindow().fetchReleaseAsync(id);

    const requestsBeforeOldest = releaseRequests;
    await openWindow().fetchReleaseAsync(releaseOne);
    assert.strictEqual(releaseRequests, requestsBeforeOldest + 1,
        'the oldest entry must be the one dropped when the bound is reached');

    const requestsAfterOldest = releaseRequests;
    await openWindow().fetchReleaseAsync(fillIds[fillIds.length - 1]);
    assert.strictEqual(releaseRequests, requestsAfterOldest,
        'the newest entry must survive the bound');

    // A container written by another build is emptied, not trusted, and it is
    // the same object afterwards.
    const otherBuildContainer = {
        version: 999,
        releases: { [releaseOne]: { at: clock, value: { title: 'Stale' } } },
        groups: {}
    };
    mainWindowValues.lovesMBzFetchCache = otherBuildContainer;

    const otherBuildWindow = openWindow();
    const freshRelease = await otherBuildWindow.fetchReleaseAsync(releaseOne);

    assert.strictEqual(freshRelease.title, 'An Album',
        "another build's entries must not be served");
    assert.strictEqual(mainWindowValues.lovesMBzFetchCache, otherBuildContainer,
        'the container must be emptied in place, not replaced');

    const requestsAfterReset = releaseRequests;
    await openWindow().fetchReleaseAsync(releaseOne);
    assert.strictEqual(releaseRequests, requestsAfterReset,
        'after the reset the next window shares again');

    // A group listing is shared the same way.
    const groupWindow = openWindow();
    const firstGroup = await groupWindow.fetchReleaseGroupReleasesAsync(groupId);
    const requestsAfterFirstGroup = groupRequests;
    const secondGroupWindow = openWindow();
    const reusedGroup = await secondGroupWindow.fetchReleaseGroupReleasesAsync(groupId);

    assert.strictEqual(groupRequests, requestsAfterFirstGroup,
        'a group listing must be reused across windows');
    assert.strictEqual(reusedGroup.releases[0].trackCount, firstGroup.releases[0].trackCount);

    // A build installed without a restart has no container: one diagnostic, and
    // the lookups still work exactly as before.
    const diagnostics = [];
    global.ODS = (message) => diagnostics.push(String(message));
    delete mainWindowValues.lovesMBzFetchCache;

    const requestsBeforeMissing = releaseRequests;
    const loneWindow = openWindow();
    const loneRelease = await loneWindow.fetchReleaseAsync(releaseTwo);
    await loneWindow.fetchReleaseGroupReleasesAsync(groupId);

    assert.strictEqual(loneRelease.title, 'Another Album',
        'a window without the container must still read the release');
    assert.strictEqual(releaseRequests, requestsBeforeMissing + 1,
        'it must fetch as before, not fail');
    assert.strictEqual(diagnostics.length, 1,
        'a missing container is reported once, not per fetch');
    assert.match(diagnostics[0], /^Loves MBz: .*no release cache yet/);

    // With the container back, the diagnostic stays quiet.
    mainWindowValues.lovesMBzFetchCache = cacheContainer;
    await openWindow().fetchReleaseAsync(releaseOne);
    assert.strictEqual(diagnostics.length, 1, 'an available container must not warn');

    // clearCache drops the shared copy, not just this window's.
    const requestsBeforeClear = releaseRequests;
    const clearingWindow = openWindow();
    await clearingWindow.fetchReleaseAsync(releaseThree);
    clearingWindow.clearCache();
    await openWindow().fetchReleaseAsync(releaseThree);

    assert.strictEqual(releaseRequests, requestsBeforeClear + 2,
        'clearCache must empty the shared cache too');

    Date.now = realNow;

    /* ---------------------------------------------------------------------- *
     * 0.7.1: the saved field set, and the two tabs
     * ---------------------------------------------------------------------- */

    // The catalogue is the field tables, in declaration order, with the name
    // each value is written as.
    const catalogue = apply.fieldCatalogue();
    const allFieldKeys = catalogue.map((field) => field.key);

    assert.deepStrictEqual(allFieldKeys, [
        'albumArtist', 'date', 'origDate', 'publisher',
        'title', 'discNumber', 'artist', 'composer', 'lyricist', 'isrc',
        'albumid', 'releasegroupid', 'albumartistid', 'albumartists', 'barcode',
        'status', 'type', 'country', 'catalognumber', 'discogs', 'originaldate',
        'recordingid', 'releasetrackid', 'artistid', 'artists', 'writer',
        'producer', 'remixer'
    ], 'the catalogue is every declared field, in table order');

    // MediaMonkey keeps one date, with the year as its first four digits;
    // writing "year" writes a year-only date over the month and day.
    assert.ok(!allFieldKeys.includes('year'),
        'year must not be a field of its own, because setting it erases the month and day');

    for (const field of catalogue) {
        assert.ok(field.label, field.key + ' must have a label');
        assert.ok(field.target, field.key + ' must name the column or tag it is written as');
        assert.ok(field.scope === 'album' || field.scope === 'track', field.key + ' must have a scope');
        assert.ok(field.kind === 'native' || field.kind === 'tag',
            field.key + ' must be a native field or a tag');
    }

    // "Supplied" is a fact about the release, not about the diff: the plan only
    // holds the fields whose value differs from the library, so reading it here
    // marked every already-matching field as not supplied.
    const supplyRelease = {
        id: '99999999-9999-4999-8999-999999999999',
        title: 'An Album',
        date: '2004-03-23',
        country: 'GB',
        'artist-credit': [{
            name: 'An Artist',
            artist: { id: '55555555-5555-4555-8555-555555555555', name: 'An Artist' }
        }],
        media: [{
            position: 1,
            tracks: [{
                id: '66666666-6666-4666-8666-666666666666',
                number: '1',
                title: 'One',
                recording: {
                    id: '77777777-7777-4777-8777-777777777777',
                    title: 'One',
                    isrcs: ['GBAYE0400001']
                }
            }]
        }]
    };

    const supplied = apply.suppliedFields(supplyRelease);

    assert.strictEqual(supplied.title, true, 'the release supplies the track title');
    assert.strictEqual(supplied.date, true, 'and the date, even when the library already has it');
    assert.strictEqual(supplied.country, true, 'and the country');
    assert.strictEqual(supplied.discNumber, true, 'the medium supplies the disc number');
    assert.strictEqual(supplied.albumid, true, 'the release supplies its own ID');
    assert.strictEqual(supplied.barcode, false, 'a release with no barcode supplies none');
    assert.strictEqual(supplied.composer, false, 'no work relation means no composer');
    assert.strictEqual(supplied.releasegroupid, false, 'this fixture carries no release group');

    // One setting, versioned, and the rules a window's read applies — driven
    // through the reader the window calls, not an internal helper.
    const settings = {};

    global.app = {
        getValue: (key, fallback) => (key in settings ? settings[key] : fallback),
        setValue: (key, value) => { settings[key] = value; }
    };

    function savedSet(stored) {
        settings.lovesMBzFieldSet = stored;
        return apply.readFieldSet();
    }

    assert.deepStrictEqual(apply.readFieldSet(), allFieldKeys,
        'a window with nothing saved offers every field');
    assert.deepStrictEqual(savedSet({ version: 99, keys: ['title'] }), allFieldKeys,
        'a set from another version falls back to every field');
    assert.deepStrictEqual(savedSet({ version: 1, keys: ['title', 'gone'] }), allFieldKeys,
        'a key this build does not know falls back too');
    assert.deepStrictEqual(savedSet({ version: 1, keys: ['title', 'barcode'] }),
        ['title', 'barcode'], 'a known set is offered as saved');
    assert.deepStrictEqual(savedSet({ version: 1, keys: [] }), [],
        'turning every field off is a saved answer, not a missing setting');

    assert.strictEqual(apply.writeFieldSet(['title', 'barcode']), true);
    assert.deepStrictEqual(settings.lovesMBzFieldSet, { version: 1, keys: ['title', 'barcode'] },
        'Save as default stores the keys under a version');
    assert.deepStrictEqual(apply.readFieldSet(), ['title', 'barcode'],
        'what was saved is what the next window offers');

    apply.writeFieldSet([]);
    assert.deepStrictEqual(apply.readFieldSet(), [], 'an empty set survives the round trip');

    // The window: two panels over the one scrolling column. The strip itself is
    // not in the page — the script hands the panels to the host's Tabs control,
    // or draws its own bar — so an installed page that predates the split gets
    // the same two panels.
    assert.doesNotMatch(dialogHtml, /data-id="tabBar"|data-tab=/,
        'the tab strip is drawn by the script, never pinned in a page an install may keep');

    const changesPanel = dialogHtml.slice(
        dialogHtml.indexOf('data-id="panelChanges"'),
        dialogHtml.indexOf('data-id="panelTagSet"')
    );

    assert.ok(changesPanel.length > 0, 'both panels must be in the page');
    for (const id of ['groupCard', 'releaseCard', 'fieldsSection', 'trackSection', 'tagSection']) {
        assert.ok(changesPanel.includes('data-id="' + id + '"'), id + ' belongs to ID and changes');
    }

    // The catalogue lives in one place only: the page is a mount point and the
    // script draws the card, so a stale install and a fresh one cannot drift.
    assert.match(dialogHtml, /data-id="panelTagSet"><\/div>/,
        'the catalogue panel is a mount point, not a second copy of the card');
    assert.doesNotMatch(dialogHtml, /fieldSetRows|btnSaveFieldSet|btnResetFieldSet/,
        'the catalogue markup must not also live in the page');

    const buildPanelCode = dialogCode.slice(
        dialogCode.indexOf('function buildFieldSetPanel'),
        dialogCode.indexOf('function buildTabBar')
    );

    assert.match(buildPanelCode, /function buildFieldSetPanel\(host\)/,
        'the builder takes the page mount point');

    for (const id of ['fieldSetRows', 'fieldSetStatus', 'btnSaveFieldSet', 'btnResetFieldSet']) {
        assert.ok(buildPanelCode.includes("'" + id + "'"),
            id + ' must be created by the one builder');
    }

    assert.match(buildPanelCode, /_\('Save as default'\)/, 'Save as default says what it does');
    assert.match(buildPanelCode, /'mbzSection mbzCard'/, 'the catalogue is a card like the others');
    assert.match(dialogCode, /var host = UI\.panelTagSet;\s*var panel = buildFieldSetPanel\(host\);/,
        'a page with the mount point and one without get the same panel');

    assert.ok(dialogHtml.indexOf('data-id="panelChanges"') < dialogHtml.indexOf('data-id="groupCard"'),
        'the cards come after the panel that holds them');

    // The strip is the host's own Tabs control, the one the properties modal
    // draws: one tab per panel, and the panels handed over as content.
    assert.match(dialogCode, /setAttribute\('data-control-class', 'Tabs'\)/,
        'the strip is the host\'s Tabs control');
    assert.match(dialogCode, /tabs\.addTab\(_\(/, 'one tab per panel');
    assert.match(dialogCode, /panels\[count - 2\]\.appendChild\(UI\.panelChanges\)/,
        'the first panel is the first tab\'s content');
    assert.match(dialogCode, /panels\[count - 1\]\.appendChild\(UI\.panelTagSet\)/,
        'the second panel is the second tab\'s content');
    assert.match(dialogCode, /while \(tabs\.length\) tabs\.closeTab\(tabs\.items\[0\]\)/,
        'a starting tab the control brings is cleared, so the window draws exactly two');

    // A host that draws no such control still gets a strip, so neither panel is
    // ever unreachable.
    assert.match(dialogCode, /if \(!UI\.tabs && !UI\.tabBar && !buildHostTabs\(\)\) buildTabBar\(\)/,
        'the drawn bar is the fallback, not the only way in');
    assert.match(dialogCode, /function buildHostTabs[\s\S]{0,900}?removeNode\(host\)[\s\S]{0,900}?return false;/,
        'a host without the control leaves the window as it was found');
    assert.match(dialogCode, /getAttribute\('data-tab'\)/,
        'the fallback bar still names the panel it shows');
    assert.match(dialogCode, /function showTab\(name\)[\s\S]{0,200}?if \(UI\.tabs\) return;/,
        'the host control shows and hides its own panels');
    assert.match(dialogCode, /function listenTabChange[\s\S]{0,500}?fitScrollColumn\(\)/,
        'a panel that is shown again is sized again');

    assert.match(dialogCode, /function renderFields\(plan\)[\s\S]*?isOffered\(field\.key\)/,
        'Fields to write offers only the saved set');
    assert.match(dialogCode, /function renderFieldSet\(\)[\s\S]*?not supplied/,
        'a field this release did not supply is still listed');

    const renderFieldSetCode = dialogCode.slice(
        dialogCode.indexOf('function renderFieldSet'),
        dialogCode.indexOf('function markFieldSetDirty')
    );

    assert.doesNotMatch(renderFieldSetCode, /plan\.fields/,
        'the plan holds only differing fields, so it cannot say what was supplied');

    // Saving the set writes a setting, never a tag: the window has one tag
    // write, and it is Apply through the engine.
    const saveFieldSetCode = dialogCode.slice(
        dialogCode.indexOf('function saveFieldSet'),
        dialogCode.indexOf('function resetFieldSet')
    );

    assert.match(saveFieldSetCode, /apply\.writeFieldSet\(keys\)/,
        'Save as default writes the setting');
    assert.doesNotMatch(saveFieldSetCode, /applySelectionAsync|setExtendedTagsAsync|commitAsync/,
        'saving the set must not write tags');

    /* ---------------------------------------------------------------------- *
     * 0.7.1: the add-on's configuration page
     * ---------------------------------------------------------------------- */

    // MediaMonkey only offers a Configure button when info.json names a config
    // script, and the packager has to carry both files or the button leads
    // nowhere.
    const infoJson = JSON.parse(read('info.json'));

    assert.strictEqual(infoJson.config, 'config.js',
        'info.json must name the configuration script');

    for (const file of ['config.js', 'config.html']) {
        assert.ok(fs.existsSync(path.join(root, file)), file + ' must exist');
        assert.ok(read(path.join('tools', 'build-mmip.js')).includes("'" + file + "'"),
            file + ' must be in the package');
    }

    const configSource = read('config.js');

    // rc1 crashed here: inside the Addons dialog `localRequirejs` resolves
    // against MediaMonkey's own scripts, so the page asked for
    // `//mediamonkey5/mbzApply.js`, raised the host's exception dialog and never
    // reached `window.configInfo`.
    assert.doesNotMatch(stripComments(configSource), /localRequirejs|requirejs\(/,
        'the page must not go through a loader that cannot see the add-on');

    // The host evaluates this file in the Addons dialog's own window, so a
    // top-level name would sit beside MediaMonkey's own; only configInfo may.
    assert.match(configSource, /\(function \(\) \{[\s\S]*\}\)\(\);/,
        'the page keeps its names to itself');

    // One description, not two: the list lives in the engine and the package
    // writes it into the page, so the page must not carry a second one.
    assert.doesNotMatch(stripComments(configSource), /albumArtist|MUSICBRAINZ_ALBUMID/,
        'the page must not carry a field list of its own');
    assert.match(read(path.join('tools', 'build-mmip.js')), /data-fields/,
        'the packager owns the page\'s field list and fills it from the engine');
    assert.doesNotMatch(configSource, /applySelectionAsync|setExtendedTagsAsync|commitAsync/,
        'the configuration page must not write tags');

    // Driven the way the host drives it: load() when the panel opens, save()
    // when OK is pressed, both with the panel's node.
    const configSettings = {};

    global.app = {
        getValue: (key, fallback) => (key in configSettings ? configSettings[key] : fallback),
        setValue: (key, value) => { configSettings[key] = value; }
    };

    // The host turns each box into a control, and the page reads it back through
    // controlClass, so the test does the same.
    global.initializeControl = (box) => { box.controlClass = { checked: false }; };

    function fakeNode(tag) {
        return {
            tag,
            className: '',
            textContent: '',
            children: [],
            style: {},
            attrs: {},
            setAttribute(name, value) { this.attrs[name] = value; },
            getAttribute(name) { return this.attrs[name]; },
            appendChild(child) { this.children.push(child); return child; },
            querySelector() { return null; }
        };
    }

    // The list the package writes into config.html. The page carries it as an
    // attribute, so the HTML parser hands getAttribute the decoded text; the
    // test decodes it the same way before standing in for that attribute.
    const pageBlob = (read('config.html').match(/data-fields="([^"]*)"/) || [])[1] || '';
    const pageJson = pageBlob
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    const pageList = JSON.parse(pageJson);

    const configDoc = { createElement: (tag) => fakeNode(tag) };
    const rowsHost = Object.assign(fakeNode('div'), { ownerDocument: configDoc });

    rowsHost.attrs['data-fields'] = pageJson;
    const configPanel = {
        ownerDocument: configDoc,
        querySelector: () => rowsHost,
        appendChild() {}
    };

    function openConfig(withEngine) {
        global.window = {};
        if (withEngine) global.window.mbzApply = apply;
        delete require.cache[require.resolve(path.join(root, 'config.js'))];
        require(path.join(root, 'config.js'));
        return global.window.configInfo;
    }

    const configInfo = openConfig(false);

    assert.ok(configInfo && typeof configInfo.load === 'function'
        && typeof configInfo.save === 'function',
        'the page defines window.configInfo with load and save');

    // The generated list is the engine's, entry by entry.
    assert.deepStrictEqual(
        pageList.map((field) => [field.key, field.label, field.target, field.scope, field.kind]),
        catalogue.map((field) => [field.key, field.label, field.target, field.scope, field.kind]),
        'the page\'s field list is the engine\'s catalogue, field for field '
        + '(run tools/build-mmip.js to regenerate it)');

    assert.strictEqual(configInfo.fields.length, 0,
        'nothing is listed before the panel is loaded');

    // The Addons dialog's skin sheet stretches body text; the note pins its own
    // leading, inline, so the three sentences do not sit a line apart.
    assert.match(read('config.html'), /line-height: 1\.35/,
        'the configuration note must pin its own line height');

    const ticks = (info) => (info.rows || [])
        .filter((row) => row.box.controlClass.checked)
        .map((row) => row.key);

    // The page's copy of the set rule and the engine's must read every stored
    // value the same way.
    for (const stored of [
        undefined,
        { version: 99, keys: ['title'] },
        { version: 1, keys: ['title', 'gone'] },
        { version: 1, keys: [] },
        { version: 1, keys: ['title', 'barcode'] }
    ]) {
        if (stored === undefined) delete configSettings.lovesMBzFieldSet;
        else configSettings.lovesMBzFieldSet = stored;

        configInfo.load(configPanel, {});

        assert.deepStrictEqual(ticks(configInfo), apply.readFieldSet(),
            'the page reads ' + JSON.stringify(stored) + ' as the engine does');
    }

    assert.deepStrictEqual(configInfo.fields.map((field) => field.key), allFieldKeys,
        'the page drew the list the package wrote into it');

    // Every row says where the value goes, and which kind of destination that
    // is: the file's own tag, or one of MediaMonkey's fields.
    for (const field of catalogue) {
        const row = configInfo.rows.find((entry) => entry.key === field.key);
        const kind = field.kind === 'tag' ? /extended tag: / : /MediaMonkey field: /;

        assert.ok(row, field.key + ' must be listed');
        assert.match(row.text, kind, field.key + ' must say which kind of destination it writes');
        assert.ok(row.text.includes(field.target), field.key + ' must name its destination');
    }

    // The box the reader clicks is the one save reads back, and only those keys
    // are written.
    configSettings.lovesMBzFieldSet = { version: 1, keys: ['title', 'barcode'] };
    configInfo.load(configPanel, {});

    configInfo.rows.find((row) => row.key === 'title').box.controlClass.checked = false;
    configInfo.rows.find((row) => row.key === 'composer').box.controlClass.checked = true;

    configInfo.save(configPanel, {});

    assert.deepStrictEqual(configSettings.lovesMBzFieldSet,
        { version: 1, keys: ['composer', 'barcode'] },
        'save writes exactly the ticks, in catalogue order, under the version');

    // The toolbar switch is the page's own: on unless the setting says off, and
    // read by init.js, which adds the button at start-up.
    delete configSettings.lovesMBzToolbarButton;
    configInfo.load(configPanel, {});

    assert.ok(configInfo.toolbar && configInfo.toolbar.box,
        'the page draws the toolbar switch');
    assert.match(configInfo.toolbar.text, /toolbar/,
        'the switch must say what it turns on');
    assert.strictEqual(configInfo.toolbar.box.controlClass.checked, true,
        'the toolbar button is on until the setting says otherwise');
    assert.match(initSource, /'lovesMBzToolbarButton'/,
        'init.js must read the setting the page writes, not one of its own');
    assert.match(initSource, /if \(!toolbarButtonWanted\(\)\) return;/,
        'init.js must skip the button when the page turned it off');

    configInfo.toolbar.box.controlClass.checked = false;
    configInfo.save(configPanel, {});

    assert.strictEqual(configSettings.lovesMBzToolbarButton, false,
        'save writes the toolbar switch');

    configSettings.lovesMBzToolbarButton = true;
    configInfo.load(configPanel, {});

    assert.strictEqual(configInfo.toolbar.box.controlClass.checked, true,
        'a stored true draws the switch ticked');

    // Where the host does have the engine on this window, the page asks it
    // rather than using its copy.
    const delegated = openConfig(true);

    configSettings.lovesMBzFieldSet = { version: 1, keys: ['title', 'barcode'] };
    delegated.load(configPanel, {});

    assert.deepStrictEqual(ticks(delegated), ['title', 'barcode'],
        'with the engine present the page draws the engine\'s answer');

    // A control that will not initialise must say so, keep no rows to save, and
    // leave the setting alone.
    configSettings.lovesMBzFieldSet = { version: 1, keys: ['title'] };
    configSettings.lovesMBzToolbarButton = false;

    const realInitialize = global.initializeControl;

    global.initializeControl = () => { throw new Error('the control would not initialise'); };
    configInfo.load(configPanel, {});
    global.initializeControl = realInitialize;

    const said = rowsHost.children[rowsHost.children.length - 1];

    assert.ok(said, 'a page that cannot draw its list must say so on the panel');
    assert.match(said.textContent, /could not be drawn/, 'and name the failure');
    assert.deepStrictEqual(ticks(configInfo), [], 'a failed draw leaves no rows to save');

    configInfo.save(configPanel, {});

    assert.deepStrictEqual(configSettings.lovesMBzFieldSet, { version: 1, keys: ['title'] },
        'a page that drew no rows keeps the setting it did not edit');
    assert.strictEqual(configSettings.lovesMBzToolbarButton, false,
        'a page that drew nothing leaves the toolbar switch alone too');

    console.log('tag-path regression test passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
