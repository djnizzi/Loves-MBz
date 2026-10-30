'use strict';

/*
 * MBz loves MM5 — MusicBrainz ID access layer.
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
            ODS('MBz loves MM5: ' + message);
        } else if (window.console) {
            console.log('MBz loves MM5: ' + message);
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
     * Queries the database directly for the given song IDs. Used by the dialog
     * so it always shows current values, even for rows cache-missed above.
     *
     * @param {number[]} songIds
     * @returns {Promise<Map<number, {releaseId: string, releaseGroupId: string, artistIds: string}>>}
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
                "     AND ar.MBGID IS NOT NULL AND ar.MBGID <> '' AND ar.MBGID <> '0') AS ArtistMBGIDs" +
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
                        artistIds: joinGuids(res.fields.getValue(3))
                    });
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

    window.mbzMbgid = {
        startCacheLoad: startCacheLoad,
        reload: reload,
        lookupTracksAsync: lookupTracksAsync,
        getTrackArtistsAsync: getTrackArtistsAsync,
        countAlbumTracksAsync: countAlbumTracksAsync,
        countArtistTracksAsync: countArtistTracksAsync,
        normalizeGuid: normalizeGuid,
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
