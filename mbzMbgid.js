'use strict';

/*
 * Loves MBz — MusicBrainz ID access layer.
 *
 * MediaMonkey 5 stores MusicBrainz identifiers in its SQLite database but never
 * exposes them in the UI:
 *
 *   Albums.MBGID   — MusicBrainz release ID of the track's album
 *   Albums.MBRGGID — MusicBrainz release-group ID of the track's album
 *   Artists.MBGID  — MusicBrainz artist ID of the track's artist(s)
 *
 * Tracklist cells are rendered synchronously, so the IDs are preloaded once
 * into three lookup tables. The load is paged (`ID > lastId LIMIT n`) so a
 * large library does not block the UI; values that arrive after a view has
 * been painted are shown on the next refresh at the end of the load.
 *
 * The values '0' and '' mean "not matched in MusicBrainz" and are treated as
 * empty, which is how MediaMonkey itself uses '0'.
 *
 * The module also owns the small write path used by the dialog: an explicit,
 * validated UPDATE of one ID on one album or artist row. Album and artist IDs
 * belong to those entities, not to individual tracks, so a write always affects
 * every track of that album or every track by that artist.
 *
 * Finally, it normalizes the per-track MusicBrainz extended tags and merges
 * edits to them. Those tags live in Songs.ExtendedTags as a JSON array and use
 * different names depending on the file format.
 */

(function () {
    var PAGE_SIZE = 2000;
    var LOOKUP_CHUNK_SIZE = 400;

    var releaseIds = new Map();          // album id  -> release MBID
    var releaseGroupIds = new Map();     // album id  -> release-group MBID
    var artistIdsBySong = new Map();     // song id   -> "mbid; mbid"

    var state = {
        loading: false,
        loaded: false,
        albumCount: 0,
        artistSongCount: 0,
        error: ''
    };

    var loadPromise = null;

    function log(message) {
        if (typeof ODS === 'function') {
            ODS('Loves MBz: ' + message);
        } else if (window.console) {
            console.log('Loves MBz: ' + message);
        }
    }

    function cleanGuid(value) {
        if (value === undefined || value === null) return '';
        var guid = String(value).trim();
        if (!guid || guid === '0') return '';
        return guid;
    }

    var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    /**
     * Normalises a MusicBrainz ID typed by the user.
     *
     * @param {*} value
     * @returns {string|null} '' when the value means "no ID", the canonical
     *   lower-case UUID when it is valid, or null when it is not a MBID at all.
     */
    function normalizeGuid(value) {
        var guid = String(value === undefined || value === null ? '' : value)
            .replace(/\s+/g, '')
            .toLowerCase();

        if (!guid || guid === '0') return '';

        // MusicBrainz also accepts the bare 32-hex form; store the canonical one.
        if (/^[0-9a-f]{32}$/.test(guid)) {
            guid = guid.slice(0, 8) + '-' + guid.slice(8, 12) + '-' + guid.slice(12, 16) +
                '-' + guid.slice(16, 20) + '-' + guid.slice(20);
        }

        return GUID_RE.test(guid) ? guid : null;
    }

    function quoteSql(value) {
        return "'" + String(value).replace(/'/g, "''") + "'";
    }

    async function singleIntAsync(sql) {
        var res = await app.db.getQueryResultAsync(sql);
        var value = res.eof ? 0 : parseInt(res.fields.getValue(0), 10);
        return value > 0 ? value : 0;
    }

    async function clearDbCacheAsync() {
        try {
            if (app.db.clearCache) await app.db.clearCache();
        } catch (e) {
            log('clearCache failed: ' + (e && e.message ? e.message : e));
        }
    }

    function yieldToUI() {
        return new Promise(function (resolve) {
            if (typeof requestTimeout === 'function') {
                requestTimeout(resolve, 0);
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    function joinGuids(concatenated) {
        var parts = String(concatenated || '').split(',');
        var seen = {};
        var result = [];

        for (var i = 0; i < parts.length; i++) {
            var guid = cleanGuid(parts[i]);
            if (guid && !seen[guid]) {
                seen[guid] = true;
                result.push(guid);
            }
        }

        return result.join('; ');
    }

    async function loadAlbumIds() {
        var lastId = 0;

        releaseIds.clear();
        releaseGroupIds.clear();
        state.albumCount = 0;

        for (;;) {
            if (window._cleanUpCalled) return;

            var sql =
                'SELECT ID, MBGID, MBRGGID FROM Albums' +
                ' WHERE ID > ' + lastId +
                " AND ((MBGID IS NOT NULL AND MBGID <> '' AND MBGID <> '0')" +
                " OR (MBRGGID IS NOT NULL AND MBRGGID <> '' AND MBRGGID <> '0'))" +
                ' ORDER BY ID LIMIT ' + PAGE_SIZE;

            var res = await app.db.getQueryResultAsync(sql);
            var rows = 0;
            var pageLastId = lastId;

            while (!res.eof) {
                var albumId = parseInt(res.fields.getValue(0), 10);

                if (albumId > 0) {
                    var releaseId = cleanGuid(res.fields.getValue(1));
                    var releaseGroupId = cleanGuid(res.fields.getValue(2));

                    if (releaseId) releaseIds.set(albumId, releaseId);
                    if (releaseGroupId) releaseGroupIds.set(albumId, releaseGroupId);

                    pageLastId = albumId;
                    rows++;
                }

                res.next();
            }

            state.albumCount += rows;

            if (rows < PAGE_SIZE || pageLastId === lastId) break;

            lastId = pageLastId;
            await yieldToUI();
        }
    }

    async function loadArtistIds() {
        var lastId = 0;

        artistIdsBySong.clear();
        state.artistSongCount = 0;

        for (;;) {
            if (window._cleanUpCalled) return;

            var sql =
                'SELECT s.ID AS SongID, group_concat(DISTINCT a.MBGID) AS MBGIDs' +
                ' FROM Songs s' +
                ' JOIN ArtistsSongs asg ON asg.IDSong = s.ID AND asg.PersonType = 1' +
                ' JOIN Artists a ON a.ID = asg.IDArtist' +
                ' WHERE s.ID > ' + lastId +
                " AND a.MBGID IS NOT NULL AND a.MBGID <> '' AND a.MBGID <> '0'" +
                ' GROUP BY s.ID ORDER BY s.ID LIMIT ' + PAGE_SIZE;

            var res = await app.db.getQueryResultAsync(sql);
            var rows = 0;
            var pageLastId = lastId;

            while (!res.eof) {
                var songId = parseInt(res.fields.getValue(0), 10);

                if (songId > 0) {
                    var guids = joinGuids(res.fields.getValue(1));
                    if (guids) {
                        artistIdsBySong.set(songId, guids);
                        state.artistSongCount++;
                    }
                    pageLastId = songId;
                    rows++;
                }

                res.next();
            }

            if (rows < PAGE_SIZE || pageLastId === lastId) break;

            lastId = pageLastId;
            await yieldToUI();
        }
    }

    function refreshViews() {
        try {
            if ((typeof uitools !== 'undefined') && uitools.refreshView) {
                uitools.refreshView();
            }
        } catch (e) {
            log('refreshView failed: ' + (e && e.message ? e.message : e));
        }
    }

    function startCacheLoad() {
        if (loadPromise) return loadPromise;

        state.loading = true;
        state.error = '';

        loadPromise = (async function () {
            var errors = [];

            // Load the two stages independently: a schema difference in one
            // table must not take the other column group down with it.
            try {
                await loadAlbumIds();
            } catch (e) {
                errors.push('albums: ' + (e && e.message ? e.message : e));
            }

            try {
                await loadArtistIds();
            } catch (e) {
                errors.push('artists: ' + (e && e.message ? e.message : e));
            }

            state.error = errors.join('; ');
            state.loaded = (errors.length === 0);
            state.loading = false;

            if (errors.length) {
                log('cache load failed: ' + state.error);
            } else {
                log('cache ready: ' + releaseIds.size + ' releases, ' +
                    releaseGroupIds.size + ' release groups, ' +
                    artistIdsBySong.size + ' tracks with artist IDs');
            }

            if (!window._cleanUpCalled) refreshViews();
        })();

        return loadPromise;
    }

    function reload() {
        var previous = loadPromise;

        loadPromise = null;
        state.loaded = false;
        state.albumCount = 0;
        state.artistSongCount = 0;

        // Let an in-flight load finish first: both loads clear the same tables.
        return (async function () {
            if (previous) {
                try {
                    await previous;
                } catch (e) {
                    // a failed previous load is not the caller's problem
                }
            }
            return startCacheLoad();
        })();
    }

    function releaseIdForAlbum(albumId) {
        return releaseIds.get(Number(albumId)) || '';
    }

    function releaseGroupIdForAlbum(albumId) {
        return releaseGroupIds.get(Number(albumId)) || '';
    }

    function artistIdsForSong(songId) {
        return artistIdsBySong.get(Number(songId)) || '';
    }

    /**
     * Turns the native MBGID columns into extended-tag suggestions for the
     * properties tab: the release, release-group and artist IDs the library
     * already holds. With several tracks, only values that are identical on
     * every track are offered, so a suggestion never writes one album's ID to
     * another album's tracks.
     *
     * @param {Array<{releaseId: string, releaseGroupId: string, artistIds: string}>} natives
     *   one entry per selected track, as returned by lookupTracksAsync
     * @returns {Array<{title: string, value: string}>}
     */
    function suggestNativeExtendedTags(natives) {
        var list = (natives || []).filter(function (entry) { return !!entry; });
        if (!list.length) return [];

        var fields = [
            { title: 'MUSICBRAINZ_ALBUMID', key: 'releaseId' },
            { title: 'MUSICBRAINZ_RELEASEGROUPID', key: 'releaseGroupId' },
            { title: 'MUSICBRAINZ_ARTISTID', key: 'artistIds' }
        ];
        var result = [];

        fields.forEach(function (field) {
            var first = String(list[0][field.key] || '').trim();
            if (!first) return;

            for (var i = 1; i < list.length; i++) {
                if (String(list[i][field.key] || '').trim() !== first) return;
            }

            result.push({ title: field.title, value: first });
        });

        return result;
    }

    /**
     * Queries the database directly for the given song IDs. Used by the dialog
     * so it always shows current values, even for rows cache-missed above.
     *
     * @param {number[]} songIds
     * @returns {Promise<Map<number, {releaseId: string, releaseGroupId: string,
     *   artistIds: string, albumId: number, album: string}>>}
     */
    async function lookupTracksAsync(songIds) {
        var ids = [];
        var seen = {};
        var result = new Map();

        for (var i = 0; i < (songIds || []).length; i++) {
            var id = parseInt(songIds[i], 10);
            if (id > 0 && !seen[id]) {
                seen[id] = true;
                ids.push(id);
            }
        }

        for (var start = 0; start < ids.length; start += LOOKUP_CHUNK_SIZE) {
            var chunk = ids.slice(start, start + LOOKUP_CHUNK_SIZE);

            var sql =
                'SELECT s.ID AS SongID, al.MBGID AS AlbumMBGID,' +
                ' al.MBRGGID AS AlbumMBRGGID,' +
                ' (SELECT group_concat(DISTINCT ar.MBGID)' +
                '    FROM ArtistsSongs asg' +
                '    JOIN Artists ar ON ar.ID = asg.IDArtist' +
                '   WHERE asg.IDSong = s.ID AND asg.PersonType = 1' +
                "     AND ar.MBGID IS NOT NULL AND ar.MBGID <> '' AND ar.MBGID <> '0') AS ArtistMBGIDs," +
                ' al.ID AS AlbumID, al.Album AS AlbumName' +
                ' FROM Songs s' +
                ' LEFT JOIN Albums al ON al.ID = s.IDAlbum' +
                ' WHERE s.ID IN (' + chunk.join(',') + ')';

            var res = await app.db.getQueryResultAsync(sql);

            while (!res.eof) {
                var songId = parseInt(res.fields.getValue(0), 10);

                if (songId > 0) {
                    result.set(songId, {
                        releaseId: cleanGuid(res.fields.getValue(1)),
                        releaseGroupId: cleanGuid(res.fields.getValue(2)),
                        artistIds: joinGuids(res.fields.getValue(3)),
                        // The properties tab needs the album row to name it
                        // and to write a release ID back to the library.
                        albumId: parseInt(res.fields.getValue(4), 10) || 0,
                        album: String(res.fields.getValue(5) || '')
                    });
                }

                res.next();
            }

            if (start + LOOKUP_CHUNK_SIZE < ids.length) await yieldToUI();
        }

        return result;
    }

    /**
     * Reads Songs.ExtendedTags for the given song IDs. Group editing needs
     * every track's own array to find the tags that are identical across the
     * selection; the group track only exposes a common patch.
     *
     * @param {number[]} songIds
     * @returns {Promise<Map<number, string>>}
     */
    async function lookupExtendedTagsAsync(songIds) {
        var ids = [];
        var seen = {};
        var result = new Map();

        for (var i = 0; i < (songIds || []).length; i++) {
            var id = parseInt(songIds[i], 10);
            if (id > 0 && !seen[id]) {
                seen[id] = true;
                ids.push(id);
            }
        }

        for (var start = 0; start < ids.length; start += LOOKUP_CHUNK_SIZE) {
            var chunk = ids.slice(start, start + LOOKUP_CHUNK_SIZE);
            var res = await app.db.getQueryResultAsync(
                'SELECT ID, ExtendedTags FROM Songs WHERE ID IN (' + chunk.join(',') + ')');

            while (!res.eof) {
                var songId = parseInt(res.fields.getValue(0), 10);
                if (songId > 0) {
                    result.set(songId, String(res.fields.getValue(1) || ''));
                }
                res.next();
            }

            if (start + LOOKUP_CHUNK_SIZE < ids.length) await yieldToUI();
        }

        return result;
    }

    /**
     * Artists of one track, with their current MBIDs. The dialog needs the
     * artist rows (not just the joined string) because an artist ID always
     * belongs to exactly one Artists row.
     *
     * @param {number} songId
     * @returns {Promise<Array<{id: number, name: string, mbgid: string}>>}
     */
    async function getTrackArtistsAsync(songId) {
        var id = parseInt(songId, 10);
        var artists = [];

        if (!(id > 0)) return artists;

        var res = await app.db.getQueryResultAsync(
            'SELECT ar.ID, ar.Artist, ar.MBGID' +
            ' FROM ArtistsSongs asg' +
            ' JOIN Artists ar ON ar.ID = asg.IDArtist' +
            ' WHERE asg.IDSong = ' + id + ' AND asg.PersonType = 1' +
            ' ORDER BY ar.Artist'
        );

        while (!res.eof) {
            var artistId = parseInt(res.fields.getValue(0), 10);

            if (artistId > 0) {
                artists.push({
                    id: artistId,
                    name: String(res.fields.getValue(1) || ''),
                    mbgid: cleanGuid(res.fields.getValue(2))
                });
            }

            res.next();
        }

        return artists;
    }

    async function countAlbumTracksAsync(albumId) {
        var id = parseInt(albumId, 10);
        if (!(id > 0)) return 0;
        return singleIntAsync('SELECT COUNT(*) FROM Songs WHERE IDAlbum = ' + id);
    }

    async function countArtistTracksAsync(artistId) {
        var id = parseInt(artistId, 10);
        if (!(id > 0)) return 0;
        return singleIntAsync(
            'SELECT COUNT(*) FROM ArtistsSongs WHERE IDArtist = ' + id + ' AND PersonType = 1');
    }

    /**
     * Writes one identifier on one album row.
     *
     * The album's release and release-group IDs are shared by every track of
     * that album, so this is deliberately album-scoped: there is no per-track
     * variant, because the database has none.
     *
     * @param {number} albumId
     * @param {'MBGID'|'MBRGGID'} field
     * @param {string} value  MBID, or '' to clear
     */
    async function setAlbumGuidAsync(albumId, field, value) {
        var id = parseInt(albumId, 10);
        var column = String(field || '').toUpperCase();
        var guid = normalizeGuid(value);

        if (!(id > 0)) throw new Error(_('This track has no album in the library database.'));
        if (column !== 'MBGID' && column !== 'MBRGGID') {
            throw new Error('Unsupported album field: ' + field);
        }
        if (guid === null) throw new Error(_('This is not a valid MusicBrainz ID.'));

        await app.db.executeQueryAsync(
            'UPDATE Albums SET ' + column + ' = ' + quoteSql(guid) + ' WHERE ID = ' + id);

        if (column === 'MBGID') {
            if (guid) releaseIds.set(id, guid); else releaseIds.delete(id);
        } else {
            if (guid) releaseGroupIds.set(id, guid); else releaseGroupIds.delete(id);
        }

        await clearDbCacheAsync();
        refreshViews();

        return guid;
    }

    /**
     * Writes the identifier on one artist row. Every track by that artist is
     * affected, including credits where the artist is not the main performer.
     *
     * @param {number} artistId
     * @param {string} value  MBID, or '' to clear
     */
    async function setArtistGuidAsync(artistId, value) {
        var id = parseInt(artistId, 10);
        var guid = normalizeGuid(value);

        if (!(id > 0)) throw new Error(_('This track has no artist in the library database.'));
        if (guid === null) throw new Error(_('This is not a valid MusicBrainz ID.'));

        await app.db.executeQueryAsync(
            'UPDATE Artists SET MBGID = ' + quoteSql(guid) + ' WHERE ID = ' + id);

        await clearDbCacheAsync();

        // The artist column is keyed by song, so it has to be rebuilt.
        try {
            await reload();
        } catch (e) {
            log('reload after artist update failed: ' + (e && e.message ? e.message : e));
            refreshViews();
        }

        return guid;
    }

    /**
     * Extended tags are stored as JSON in Songs.ExtendedTags. Their names come
     * from the file tag that produced them, so the same MusicBrainz tag can be
     * "MUSICBRAINZ_ALBUMID" (Vorbis), "MusicBrainz Album Id" (ID3 TXXX) or
     * something else. Comparing names therefore ignores case, spaces,
     * underscores and hyphens.
     */
    function normalizeExtendedTagName(title) {
        return String(title === undefined || title === null ? '' : title)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    var MUSICBRAINZ_ENTITIES = {
        MUSICBRAINZALBUMID: { entity: 'release', label: 'Release ID' },
        MUSICBRAINZRELEASEGROUPID: { entity: 'release-group', label: 'Release group ID' },
        MUSICBRAINZARTISTID: { entity: 'artist', label: 'Artist ID' },
        MUSICBRAINZALBUMARTISTID: { entity: 'artist', label: 'Album artist ID' },
        MUSICBRAINZTRACKID: { entity: 'recording', label: 'Recording ID' },
        MUSICBRAINZRELEASETRACKID: { entity: 'track', label: 'Release track ID' },
        MUSICBRAINZWORKID: { entity: 'work', label: 'Work ID' },
        MUSICBRAINZLABELID: { entity: 'label', label: 'Label ID' },
        MUSICBRAINZORIGINALALBUMID: { entity: 'release', label: 'Original release ID' },
        MUSICBRAINZORIGINALARTISTID: { entity: 'artist', label: 'Original artist ID' },
        MUSICBRAINZCOMPOSERID: { entity: 'artist', label: 'Composer ID' },
        MUSICBRAINZLYRICISTID: { entity: 'artist', label: 'Lyricist ID' },
        MUSICBRAINZPRODUCERID: { entity: 'artist', label: 'Producer ID' },
        MUSICBRAINZENGINEERID: { entity: 'artist', label: 'Engineer ID' },
        MUSICBRAINZMIXERID: { entity: 'artist', label: 'Mixer ID' },
        MUSICBRAINZARRANGERID: { entity: 'artist', label: 'Arranger ID' },
        MUSICBRAINZREMIXERID: { entity: 'artist', label: 'Remixer ID' },
        MUSICBRAINZDJMIXERID: { entity: 'artist', label: 'DJ-mixer ID' },
        MUSICBRAINZCONDUCTORID: { entity: 'artist', label: 'Conductor ID' },
        MUSICBRAINZPERFORMERID: { entity: 'artist', label: 'Performer ID' },
        MUSICBRAINZALBUMSTATUS: { entity: '', label: 'Album status' },
        MUSICBRAINZRELEASESTATUS: { entity: '', label: 'Release status' },
        MUSICBRAINZALBUMTYPE: { entity: '', label: 'Album type' },
        MUSICBRAINZRELEASETYPE: { entity: '', label: 'Release type' },
        MUSICBRAINZALBUMCOUNTRY: { entity: '', label: 'Album country' },
        MUSICBRAINZRELEASECOUNTRY: { entity: '', label: 'Release country' },
        MUSICBRAINZALBUMRELEASEDATE: { entity: '', label: 'Album release date' },
        MUSICBRAINZRELEASEDATE: { entity: '', label: 'Release date' },
        MUSICBRAINZDISCID: { entity: '', label: 'Disc ID' },
        MUSICBRAINZTRMID: { entity: '', label: 'TRM ID' }
    };

    /**
     * Tags the properties tab can add. Writing the Vorbis-style
     * MUSICBRAINZ_* name keeps one spelling for every file format.
     */
    var MUSICBRAINZ_TAG_NAMES = [
        'MUSICBRAINZ_ALBUMID',
        'MUSICBRAINZ_RELEASEGROUPID',
        'MUSICBRAINZ_ALBUMARTISTID',
        'MUSICBRAINZ_ARTISTID',
        'MUSICBRAINZ_TRACKID',
        'MUSICBRAINZ_RELEASETRACKID',
        'MUSICBRAINZ_WORKID',
        'MUSICBRAINZ_LABELID',
        'MUSICBRAINZ_ORIGINALALBUMID',
        'MUSICBRAINZ_ORIGINALARTISTID',
        'MUSICBRAINZ_COMPOSERID',
        'MUSICBRAINZ_LYRICISTID',
        'MUSICBRAINZ_CONDUCTORID',
        'MUSICBRAINZ_ARRANGERID',
        'MUSICBRAINZ_PERFORMERID',
        'MUSICBRAINZ_PRODUCERID',
        'MUSICBRAINZ_ENGINEERID',
        'MUSICBRAINZ_MIXERID',
        'MUSICBRAINZ_REMIXERID',
        'MUSICBRAINZ_DJMIXERID',
        'MUSICBRAINZ_DISCID',
        'MUSICBRAINZ_ALBUMSTATUS',
        'MUSICBRAINZ_ALBUMTYPE',
        'MUSICBRAINZ_ALBUMCOUNTRY',
        'MUSICBRAINZ_ALBUMRELEASEDATE'
    ];

    function musicBrainzTagInfo(title) {
        return MUSICBRAINZ_ENTITIES[normalizeExtendedTagName(title)] || null;
    }

    /**
     * @returns {Array<{name: string, label: string, entity: string}>}
     */
    function musicBrainzTagChoices() {
        return MUSICBRAINZ_TAG_NAMES.map(function (name) {
            var info = musicBrainzTagInfo(name);
            return {
                name: name,
                label: info ? info.label : name,
                entity: info ? info.entity : ''
            };
        });
    }

    function isMusicBrainzExtendedTag(title) {
        return normalizeExtendedTagName(title).indexOf('MUSICBRAINZ') === 0;
    }

    /**
     * Splits an extended-tag value into canonical MBIDs. Picard can write
     * several IDs into one value, separated by ';', ',' or whitespace.
     *
     * @param {*} value
     * @returns {{ids: string[], invalid: string[]}}
     */
    function extendedTagGuids(value) {
        var parts = String(value === undefined || value === null ? '' : value)
            .split(/[\s;,]+/);
        var ids = [];
        var invalid = [];
        var seen = {};

        for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue;
            var guid = normalizeGuid(parts[i]);
            if (guid === null) {
                invalid.push(parts[i]);
            } else if (guid && !seen[guid]) {
                seen[guid] = true;
                ids.push(guid);
            }
        }

        return { ids: ids, invalid: invalid };
    }

    function musicBrainzUrl(entity, guid) {
        var id = normalizeGuid(guid);
        if (!entity || !id) return '';
        return 'https://musicbrainz.org/' + entity + '/' + encodeURIComponent(id);
    }

    /**
     * Parses Songs.ExtendedTags. Returns [] when there are none, null when the
     * value cannot be read or is the '-' marker MediaMonkey uses for differing
     * values in a group edit.
     */
    function parseExtendedTags(text) {
        var value = String(text === undefined || text === null ? '' : text).trim();
        if (!value) return [];
        if (value === '-') return null;

        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            log('could not parse ExtendedTags: ' + (e && e.message ? e.message : e));
            return null;
        }
    }

    /**
     * Applies edits from the properties tab to a freshly read ExtendedTags
     * array. Edits are matched by exact title plus occurrence, so duplicate
     * titles (usually artist IDs) are handled without relying on array indexes
     * that another tab may have shifted.
     *
     * @param {Array<{title: string, value: string}>} tags
     * @param {Array<{title: string, occurrence: number, value: string}>} edits
     * @returns {{tags: Array, applied: number, appliedEdits: Array}}
     */
    function applyExtendedTagEdits(tags, edits) {
        var source = Array.isArray(tags) ? tags : [];
        var positions = {};
        var remove = {};
        var result = source.slice();
        var appliedEdits = [];

        source.forEach(function (tag, index) {
            var title = String(tag && tag.title !== undefined ? tag.title : '');
            if (!positions[title]) positions[title] = [];
            positions[title].push(index);
        });

        (edits || []).forEach(function (edit) {
            var title = String(edit && edit.title !== undefined ? edit.title : '');
            var newValue = String(edit && edit.value !== undefined && edit.value !== null ? edit.value : '');

            // add:true appends a tag the track does not have yet. An empty
            // value cancels the add instead of writing an empty tag.
            if (edit && edit.add) {
                if (!title || !newValue.trim()) return;
                result.push({ title: title, value: newValue });
                appliedEdits.push({ title: title, value: newValue, added: true });
                return;
            }

            var occurrence = parseInt(edit && edit.occurrence, 10);
            if (!title || !(occurrence >= 0)) return;

            var indexes = positions[title];
            var index = indexes ? indexes[occurrence] : undefined;
            if (index === undefined) return;

            var value = String(edit.value === undefined || edit.value === null ? '' : edit.value);
            var current = source[index] && typeof source[index] === 'object' ? source[index] : {};
            var currentValue = String(current.value === undefined || current.value === null ? '' : current.value);

            if (!value.trim()) {
                remove[index] = true;
                appliedEdits.push({ title: title, occurrence: occurrence, value: '' });
                return;
            }

            if (currentValue === value) return;

            result[index] = Object.assign({}, current, { value: value });
            appliedEdits.push({ title: title, occurrence: occurrence, value: value });
        });

        return {
            tags: result.filter(function (tag, index) { return !remove[index]; }),
            applied: appliedEdits.length,
            appliedEdits: appliedEdits
        };
    }

    /**
     * Returns the MusicBrainz tags the group editor can show: every tag whose
     * value is identical on each selected track that stores it. A tag that some
     * tracks do not have at all is still returned, with missingCount telling the
     * tab how many tracks would receive it if the user applies it.
     *
     * Cases that cannot be patched safely through the group track are dropped:
     * a normalized name stored twice on one track, or the same name under
     * different raw titles or different values across the selection.
     *
     * @param {Array<Array<{title: string, value: string}>>} tagLists
     * @returns {Array<{title: string, value: string, trackCount: number,
     *   presentCount: number, missingCount: number}>}
     */
    function commonExtendedTags(tagLists) {
        var lists = (tagLists || []).map(function (list) {
            return Array.isArray(list) ? list : [];
        });
        if (!lists.length) return [];

        var order = [];
        var seen = {};

        // Union of names, so a tag missing from the first selected track is
        // still offered when the rest of the selection carries it.
        lists.forEach(function (list) {
            list.forEach(function (tag) {
                if (!tag || !isMusicBrainzExtendedTag(tag.title)) return;

                var name = normalizeExtendedTagName(tag.title);
                if (!name || seen[name]) return;

                seen[name] = true;
                order.push(name);
            });
        });

        var common = [];

        order.forEach(function (name) {
            var title = '';
            var value = '';
            var present = 0;
            var missing = 0;
            var ambiguous = false;

            for (var i = 0; i < lists.length && !ambiguous; i++) {
                var matches = [];

                for (var j = 0; j < lists[i].length; j++) {
                    var candidate = lists[i][j];
                    if (candidate && normalizeExtendedTagName(candidate.title) === name) {
                        matches.push(candidate);
                    }
                }

                if (matches.length > 1) {
                    // Two entries with the same name on one track: an
                    // occurrence based patch cannot say which one is meant.
                    ambiguous = true;
                    break;
                }

                if (!matches.length) {
                    missing++;
                    continue;
                }

                var rawTitle = String(matches[0].title || '');
                var rawValue = String(
                    matches[0].value === undefined || matches[0].value === null ? '' : matches[0].value);

                if (!present) {
                    title = rawTitle;
                    value = rawValue;
                } else if (rawTitle !== title || rawValue !== value) {
                    ambiguous = true;
                    break;
                }

                present++;
            }

            if (ambiguous || !present) return;

            common.push({
                title: title,
                value: value,
                trackCount: lists.length,
                presentCount: present,
                missingCount: missing
            });
        });

        return common;
    }

    /**
     * Merges changed tags into MediaMonkey's group-edit patch. The group track's
     * ExtendedTags is a patch, not a full replacement: an entry with
     * deleted:true removes the tag from every selected track. Preserve a patch
     * already queued by the built-in Custom tab.
     *
     * @param {*} currentText
     * @param {Array<{title: string, value: string, deleted?: boolean}>} patch
     * @returns {Array}
     */
    function mergeExtendedTagPatch(currentText, patch) {
        var current = parseExtendedTags(currentText);
        var result = Array.isArray(current) ? current.slice() : [];

        (patch || []).forEach(function (entry) {
            var title = String(entry && entry.title !== undefined ? entry.title : '');
            if (!title) return;

            var index = -1;
            for (var i = 0; i < result.length; i++) {
                if (result[i] && String(result[i].title || '') === title) {
                    index = i;
                    break;
                }
            }

            var merged = (index >= 0 && result[index] && typeof result[index] === 'object')
                ? Object.assign({}, result[index])
                : {};

            merged.title = title;
            merged.value = String(entry.value === undefined || entry.value === null ? '' : entry.value);

            if (entry.deleted) merged.deleted = true;
            else delete merged.deleted;

            if (index >= 0) result[index] = merged;
            else result.push(merged);
        });

        return result;
    }

    window.mbzMbgid = {
        startCacheLoad: startCacheLoad,
        reload: reload,
        lookupTracksAsync: lookupTracksAsync,
        lookupExtendedTagsAsync: lookupExtendedTagsAsync,
        getTrackArtistsAsync: getTrackArtistsAsync,
        countAlbumTracksAsync: countAlbumTracksAsync,
        countArtistTracksAsync: countArtistTracksAsync,
        normalizeGuid: normalizeGuid,
        normalizeExtendedTagName: normalizeExtendedTagName,
        musicBrainzTagInfo: musicBrainzTagInfo,
        musicBrainzTagChoices: musicBrainzTagChoices,
        suggestNativeExtendedTags: suggestNativeExtendedTags,
        isMusicBrainzExtendedTag: isMusicBrainzExtendedTag,
        extendedTagGuids: extendedTagGuids,
        musicBrainzUrl: musicBrainzUrl,
        parseExtendedTags: parseExtendedTags,
        applyExtendedTagEdits: applyExtendedTagEdits,
        commonExtendedTags: commonExtendedTags,
        mergeExtendedTagPatch: mergeExtendedTagPatch,
        setAlbumGuidAsync: setAlbumGuidAsync,
        setArtistGuidAsync: setArtistGuidAsync,
        releaseIdForAlbum: releaseIdForAlbum,
        releaseGroupIdForAlbum: releaseGroupIdForAlbum,
        artistIdsForSong: artistIdsForSong,
        getState: function () {
            return {
                loading: state.loading,
                loaded: state.loaded,
                albumCount: state.albumCount,
                artistSongCount: state.artistSongCount,
                error: state.error
            };
        }
    };
})();
