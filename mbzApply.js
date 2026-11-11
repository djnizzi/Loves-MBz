'use strict';

/*
 * Loves MBz — turn a MusicBrainz release into library writes.
 *
 * 0.5.0 contract: this module is the only write path. The Tag from
 * MusicBrainz window stages nothing inside MediaMonkey's dialogs and never
 * relies on the group save. applySelectionAsync writes each selected track
 * itself, in this order:
 *
 *   1. the selected native fields
 *   2. one read of Songs.ExtendedTags, one merged write (fill tags and tag
 *      edits together)
 *   3. one commitAsync() per track
 *
 * Library tracks are matched to the release by disc and track number, never by
 * title, because titles are exactly what is being changed. Albums.MBGID and the
 * artist rows are never written here: the release ID is the input, not an
 * output.
 */

(function () {
    var NATIVE_FIELDS = [
        { key: 'albumArtist', label: _('Album artist'), scope: 'album', native: 'albumArtist' },
        { key: 'date', label: _('Date'), scope: 'album', native: 'date', kind: 'date', force: true },
        { key: 'year', label: _('Year'), scope: 'album', native: 'year', kind: 'year' },
        { key: 'origDate', label: _('Original date'), scope: 'album', native: 'origDate', kind: 'date' },
        { key: 'origYear', label: _('Original year'), scope: 'album', native: 'origYear', kind: 'year' },
        { key: 'publisher', label: _('Labels'), scope: 'album', native: 'publisher' },
        { key: 'title', label: _('Title'), scope: 'track', native: 'title' },
        // Write the integer property. Assigning the string discNumber used to
        // make MediaMonkey commit a dialog early, before the later tracks had
        // their fields staged.
        { key: 'discNumber', label: _('Disc #'), scope: 'track', native: 'discNumberInt', kind: 'int' },
        { key: 'artist', label: _('Artist'), scope: 'track', native: 'artist' },
        { key: 'composer', label: _('Composer'), scope: 'track', native: 'composer' },
        { key: 'lyricist', label: _('Lyricist'), scope: 'track', native: 'lyricist' },
        { key: 'isrc', label: _('ISRC'), scope: 'track', native: 'isrc' }
    ];

    var TAG_FIELDS = [
        { key: 'albumid', label: _('MusicBrainz release ID'), scope: 'album', tag: 'MUSICBRAINZ_ALBUMID' },
        { key: 'releasegroupid', label: _('MusicBrainz release group ID'), scope: 'album', tag: 'MUSICBRAINZ_RELEASEGROUPID' },
        { key: 'albumartistid', label: _('MusicBrainz album artist ID'), scope: 'album', tag: 'MUSICBRAINZ_ALBUMARTISTID' },
        { key: 'albumartists', label: _('Album artist credit'), scope: 'album', tag: 'ALBUMARTISTS' },
        { key: 'barcode', label: _('Barcode'), scope: 'album', tag: 'BARCODE' },
        { key: 'status', label: _('Release status'), scope: 'album', tag: 'RELEASESTATUS' },
        { key: 'type', label: _('Release type'), scope: 'album', tag: 'RELEASETYPE' },
        { key: 'country', label: _('Release country'), scope: 'album', tag: 'RELEASECOUNTRY' },
        { key: 'catalognumber', label: _('Catalogue number'), scope: 'album', tag: 'CATALOGNUMBER' },
        { key: 'discogs', label: _('Discogs URL'), scope: 'album', tag: 'discogs_url' },
        { key: 'originaldate', label: _('Original date (tag)'), scope: 'album', tag: 'originaldate' },
        { key: 'recordingid', label: _('MusicBrainz recording ID'), scope: 'track', tag: 'MUSICBRAINZ_TRACKID' },
        { key: 'releasetrackid', label: _('MusicBrainz release track ID'), scope: 'track', tag: 'MUSICBRAINZ_RELEASETRACKID' },
        { key: 'artistid', label: _('MusicBrainz artist ID'), scope: 'track', tag: 'MUSICBRAINZ_ARTISTID' },
        { key: 'artists', label: _('Artists'), scope: 'track', tag: 'ARTISTS' },
        { key: 'writer', label: _('Writer'), scope: 'track', tag: 'WRITER' },
        { key: 'producer', label: _('Producer'), scope: 'track', tag: 'PRODUCER' },
        { key: 'remixer', label: _('Remixer'), scope: 'track', tag: 'REMIXER' }
    ];

    function text(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function normalizeText(value) {
        return text(value).toLowerCase();
    }

    function normalizeTagName(name) {
        return String(name === undefined || name === null ? '' : name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    /**
     * Picard writes release status, type and country under different names for
     * different file formats. They describe the same value, so they are one
     * field; otherwise writing RELEASECOUNTRY beside an existing
     * "MusicBrainz Album Release Country" creates a duplicate tag.
     */
    var TAG_ALIASES = {
        releasecountry: [
            'musicbrainzalbumcountry',
            'musicbrainzalbumreleasecountry',
            'musicbrainzreleasecountry'
        ],
        releasestatus: [
            'musicbrainzalbumstatus',
            'musicbrainzreleasestatus'
        ],
        releasetype: [
            'musicbrainzalbumtype',
            'musicbrainzreleasetype'
        ]
    };

    function tagNames(name) {
        var wanted = normalizeTagName(name);
        var aliases = TAG_ALIASES[wanted];
        return aliases ? [wanted].concat(aliases) : [wanted];
    }

    function tagMatches(name, wanted) {
        return tagNames(wanted).indexOf(normalizeTagName(name)) !== -1;
    }

    function leadingInt(value) {
        var match = /^\s*(\d+)/.exec(text(value));
        return match ? parseInt(match[1], 10) : 0;
    }

    /**
     * Names without join phrases, in MediaMonkey's multi-value form:
     * "Isaiah Rashad; SZA". The joined credit stays in ARTISTS/ALBUMARTISTS.
     */
    function creditNames(credit) {
        var names = [];

        (credit || []).forEach(function (item) {
            var name = text(item && (item.name || (item.artist && item.artist.name)));
            if (name && names.indexOf(name) === -1) names.push(name);
        });

        return names.join('; ');
    }

    function creditText(credit) {
        var result = '';

        (credit || []).forEach(function (item) {
            if (!item) return;
            result += text(item.name || (item.artist && item.artist.name));
            result += item.joinphrase === undefined || item.joinphrase === null
                ? ''
                : String(item.joinphrase);
        });

        return result.trim();
    }

    function creditIds(credit) {
        var ids = [];

        (credit || []).forEach(function (item) {
            var id = text(item && item.artist && item.artist.id);
            if (id && ids.indexOf(id) === -1) ids.push(id);
        });

        return ids;
    }

    /** Artist names from matching relationship types, without duplicates. */
    function relationNames(relations, types) {
        var names = [];

        (relations || []).forEach(function (relation) {
            if (!relation || types.indexOf(relation.type) === -1) return;

            var name = text(relation.artist && relation.artist.name);
            if (name && names.indexOf(name) === -1) names.push(name);
        });

        return names;
    }

    /**
     * Composer, lyricist and generic writer are work credits, reached from the
     * recording's performance relation. A direct recording relation is accepted
     * too.
     */
    function workRelationNames(recording, types) {
        var names = [];

        function add(relation) {
            if (!relation || types.indexOf(relation.type) === -1) return;

            var name = text(relation.artist && relation.artist.name);
            if (name && names.indexOf(name) === -1) names.push(name);
        }

        ((recording && recording.relations) || []).forEach(function (relation) {
            if (!relation) return;

            add(relation);

            if (!relation.work) return;
            (relation.work.relations || []).forEach(add);
        });

        return names;
    }

    /** Producer and remixer credits can be on the release or the recording. */
    function trackRelationNames(release, recording, type) {
        var names = relationNames(release && release.relations, [type]);

        relationNames(recording && recording.relations, [type]).forEach(function (name) {
            if (names.indexOf(name) === -1) names.push(name);
        });

        return names;
    }

    /** Every label on the release, in order, without duplicates. */
    function labelText(release) {
        var info = (release && release['label-info']) || [];
        var names = [];

        info.forEach(function (item) {
            var name = text(item && item.label && item.label.name);
            if (name && names.indexOf(name) === -1) names.push(name);
        });

        return names.join('; ');
    }

    function catalogNumbers(release) {
        var info = (release && release['label-info']) || [];
        var numbers = [];

        info.forEach(function (item) {
            var catalog = text(item && item['catalog-number']);
            if (catalog && numbers.indexOf(catalog) === -1) numbers.push(catalog);
        });

        return numbers.join(', ');
    }

    function releaseType(release) {
        var group = (release && release['release-group']) || {};
        var types = [];

        if (group['primary-type']) types.push(group['primary-type']);

        (group['secondary-types'] || []).forEach(function (type) {
            if (type) types.push(type);
        });

        return types.join(' + ');
    }

    function yearOf(date) {
        var match = /^(\d{4})/.exec(text(date));
        return match ? match[1] : '';
    }

    function discogsUrls(release) {
        if (window.mbzFetch && window.mbzFetch.discogsUrls) {
            return window.mbzFetch.discogsUrls(release);
        }

        return [];
    }

    /** Everything the release supplies, before comparison with the library. */
    function describeRelease(release) {
        release = release || {};

        var group = release['release-group'] || {};
        var credit = release['artist-credit'] || [];
        var albumArtist = creditNames(credit);
        var albumArtistCredit = creditText(credit);
        var albumArtistIds = creditIds(credit).join('; ');
        var date = text(release.date);
        var origDate = text(group['first-release-date']);

        var albumTags = {
            MUSICBRAINZ_ALBUMID: text(release.id),
            MUSICBRAINZ_RELEASEGROUPID: text(group.id),
            MUSICBRAINZ_ALBUMARTISTID: albumArtistIds,
            ALBUMARTISTS: albumArtistCredit,
            BARCODE: text(release.barcode),
            RELEASESTATUS: text(release.status),
            RELEASETYPE: releaseType(release),
            RELEASECOUNTRY: text(release.country),
            CATALOGNUMBER: catalogNumbers(release),
            discogs_url: discogsUrls(release).join(', '),
            originaldate: origDate
        };

        var tracks = [];
        var media = release.media || [];

        media.forEach(function (medium) {
            var disc = leadingInt(medium.position);

            (medium.tracks || []).forEach(function (item) {
                var recording = item.recording || {};
                var trackCredit = item['artist-credit'] || credit;
                var composerNames = workRelationNames(recording, ['composer']);
                var writerNames = workRelationNames(recording, ['writer']);

                tracks.push({
                    disc: disc,
                    track: leadingInt(item.number) || leadingInt(item.position),
                    values: {
                        albumArtist: albumArtist,
                        date: date,
                        year: yearOf(date),
                        origDate: origDate,
                        origYear: yearOf(origDate),
                        publisher: labelText(release),
                        title: text(item.title || recording.title),
                        // Read-only metadata for the track table.
                        length: text(item.length),
                        discNumber: disc ? String(disc) : '',
                        artist: creditNames(trackCredit),
                        // A generic writer is the only author information on many
                        // works. Fill Composer from it when no composer exists.
                        composer: (composerNames.length ? composerNames : writerNames).join('; '),
                        lyricist: workRelationNames(recording, ['lyricist']).join('; '),
                        isrc: text((recording.isrcs || [])[0])
                    },
                    albumTags: albumTags,
                    trackTags: {
                        MUSICBRAINZ_TRACKID: text(recording.id),
                        MUSICBRAINZ_RELEASETRACKID: text(item.id),
                        MUSICBRAINZ_ARTISTID: creditIds(trackCredit).join('; '),
                        ARTISTS: creditText(trackCredit),
                        WRITER: writerNames.join('; '),
                        PRODUCER: trackRelationNames(release, recording, 'producer').join('; '),
                        REMIXER: trackRelationNames(release, recording, 'remixer').join('; ')
                    }
                });
            });
        });

        return {
            id: text(release.id),
            title: text(release.title),
            artist: creditText(credit),
            albumTags: albumTags,
            tracks: tracks,
            mediaCount: media.length,
            firstDisc: leadingInt(media[0] && media[0].position) || 1
        };
    }

    function parseTags(value) {
        var raw = text(value);
        if (!raw) return [];

        try {
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function tagValue(tags, name) {
        if (!Array.isArray(tags)) return '';

        var matches = [];
        for (var i = 0; i < tags.length; i++) {
            if (!tags[i]) continue;
            if (tagMatches(tags[i].title, name)) matches.push(tags[i]);
        }

        if (!matches.length) return '';

        // One entry is the current value, whichever spelling the file uses.
        // Several spellings of a release field are the duplicate this module
        // has to repair, so report no current value and offer the field again.
        // Repeated entries of other tags are left as they were.
        if (matches.length > 1 && tagNames(name).length > 1) return '';
        return text(matches[0].value);
    }

    function fetchValue(def, match) {
        if (def.native) return text(match.values[def.key]);

        var tags = def.scope === 'album' ? match.albumTags : match.trackTags;
        return text(tags[def.tag]);
    }

    /** MediaMonkey stores dates as YYYYMMDD, with 00 for an absent month or day. */
    function isoFromMmDate(value) {
        var digits = /^(\d{4})(\d{2})(\d{2})$/.exec(text(value));
        if (!digits) return '';

        var iso = digits[1];
        if (digits[2] !== '00') iso += '-' + digits[2];
        if (digits[2] !== '00' && digits[3] !== '00') iso += '-' + digits[3];

        return iso;
    }

    function mmDateFromIso(value) {
        var match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text(value));
        if (!match) return -1;

        return parseInt(match[1] + (match[2] || '00') + (match[3] || '00'), 10);
    }

    function currentValue(def, match) {
        if (def.native) {
            var raw = text(match.track[def.native]);

            if (def.kind === 'date') return isoFromMmDate(raw);

            if (def.kind === 'int' || def.kind === 'year') {
                var number = parseInt(raw, 10);
                return number > 0 ? String(number) : '';
            }

            return raw;
        }

        return tagValue(match.tags, def.tag);
    }

    function summarise(values) {
        var unique = [];

        values.forEach(function (value) {
            var normalized = normalizeText(value);
            if (!unique.some(function (item) { return item.normalized === normalized; })) {
                unique.push({ normalized: normalized, value: value });
            }
        });

        if (!unique.length) return '';
        if (unique.length === 1) return unique[0].value;
        return _('Mixed');
    }

    function collectTracks(list) {
        var tracks = [];
        if (!list) return tracks;

        // SharedList.getValue() requires a read lock; without one MediaMonkey
        // raises "Read lock not acquired!" and the window never loads.
        function collect() {
            var count = list.count || 0;

            for (var i = 0; i < count; i++) {
                var track = list.getValue(i);
                if (track) tracks.push(track);
            }
        }

        if (typeof list.locked === 'function') list.locked(collect);
        else collect();

        return tracks;
    }

    /**
     * The selected tracks as a plain array. A shared tracklist is returned
     * before it is populated, so wait for whenLoaded() first and copy the
     * values under a read lock.
     */
    async function collectSelectionAsync(source) {
        if (Array.isArray(source)) return source.filter(function (track) { return !!track; });

        var list = source;
        if (list && typeof list.whenLoaded === 'function') {
            try {
                list = (await list.whenLoaded()) || list;
            } catch (e) {
                // keep the list we were given
            }
        }

        return collectTracks(list);
    }

    function albumReleaseIdAsync(albumId) {
        var id = parseInt(albumId, 10);
        if (!(id > 0)) return Promise.resolve('');

        var mbz = window.mbzMbgid;
        if (mbz && typeof mbz.releaseIdForAlbum === 'function') {
            var cached = text(mbz.releaseIdForAlbum(id));
            if (cached) return Promise.resolve(cached);
        }

        if (typeof app === 'undefined' || !app.db || !app.db.getQueryResultAsync) {
            return Promise.resolve('');
        }

        return Promise.resolve(app.db.getQueryResultAsync(
            'SELECT MBGID FROM Albums WHERE ID = ' + id
        )).then(function (res) {
            var value = res && !res.eof ? text(res.fields.getValue(0)) : '';
            return value === '0' ? '' : value;
        }, function () {
            return '';
        });
    }

    /**
     * The one place that decides what Tag from MusicBrainz works on. The entry
     * point and the window both call it, so they cannot disagree.
     *
     * @param {Object|Array} source selected tracklist or an array of tracks
     * @returns {Promise<{tracks: Array, songIds: number[], albumIds: number[],
     *   albumId: number, releaseIds: Object, releaseId: string,
     *   sharedRelease: boolean, multiAlbum: boolean}>}
     */
    async function resolveTagScope(source) {
        var tracks = await collectSelectionAsync(source);
        var albumIds = [];
        var songIds = [];

        tracks.forEach(function (track) {
            var albumId = parseInt(track && track.idalbum, 10);
            if (albumId > 0 && albumIds.indexOf(albumId) === -1) albumIds.push(albumId);

            var songId = parseInt(track && track.id, 10);
            if (songId > 0 && songIds.indexOf(songId) === -1) songIds.push(songId);
        });

        var releaseIds = {};
        var unique = [];

        for (var i = 0; i < albumIds.length; i++) {
            var releaseId = await albumReleaseIdAsync(albumIds[i]);
            releaseIds[albumIds[i]] = releaseId;
            if (releaseId && unique.indexOf(releaseId) === -1) unique.push(releaseId);
        }

        return {
            tracks: tracks,
            songIds: songIds,
            albumIds: albumIds,
            albumId: albumIds.length ? albumIds[0] : 0,
            releaseIds: releaseIds,
            releaseId: unique.length === 1 ? unique[0] : '',
            sharedRelease: unique.length === 1 && !!unique[0],
            multiAlbum: albumIds.length > 1
        };
    }

    /**
     * The values to write for one track, before anything is saved. Matched by
     * disc and track number; values that already match are left out, and each
     * field reports the library's current value beside the fetched one.
     *
     * @returns {Promise<{matched: boolean, releaseTitle: string,
     *   matchedByNumberOnly: boolean, release: Object, native: Object,
     *   tags: Array<{title: string, value: string}>, labels: string[],
     *   fields: Array}>}
     */
    async function buildPendingAsync(track, release, tagsText) {
        var described = describeRelease(release);
        var disc = leadingInt(track.discNumber);
        var number = leadingInt(track.trackNumber);

        function findTrack(wantedDisc, wantedNumber) {
            for (var i = 0; i < described.tracks.length; i++) {
                if (described.tracks[i].disc === wantedDisc &&
                    described.tracks[i].track === wantedNumber) {
                    return described.tracks[i];
                }
            }

            return null;
        }

        /**
         * Number-only matching, for files with no disc tag: MediaMonkey keeps
         * one album row per disc, and per-disc rips often carry no DISC tag. The
         * number has to belong to exactly one medium, so a 2-CD release cannot
         * silently match the wrong disc.
         */
        function findByNumber(wantedNumber) {
            var found = null;

            for (var i = 0; i < described.tracks.length; i++) {
                var candidate = described.tracks[i];
                if (candidate.track !== wantedNumber) continue;
                if (found && found.disc !== candidate.disc) return null;
                found = candidate;
            }

            return found;
        }

        var item = findTrack(disc, number);

        if (!item && !disc) item = findByNumber(number);
        if (!item && described.mediaCount === 1) item = findTrack(described.firstDisc, number);

        var result = {
            matched: !!item,
            releaseTitle: text(release && release.title),
            matchedByNumberOnly: !!item && !(item.disc > 0 && item.disc === disc),
            release: item ? {
                disc: item.disc,
                track: item.track,
                title: text(item.values.title),
                length: text(item.values.length),
                isrc: text(item.values.isrc),
                recordingId: text(item.trackTags.MUSICBRAINZ_TRACKID)
            } : null,
            native: {},
            tags: [],
            labels: [],
            fields: []
        };

        if (!item) return result;

        var tags = [];
        try {
            var currentTags = tagsText === undefined
                ? await track.getExtendedTagsAsync()
                : tagsText;
            tags = parseTags(currentTags) || [];
        } catch (e) {
            tags = [];
        }

        function addField(def, kind, value, current) {
            result.labels.push(def.label + ': ' + value);
            result.fields.push({
                key: def.key,
                label: def.label,
                kind: kind,
                native: def.native || '',
                tag: def.tag || '',
                value: value,
                display: value,
                current: current
            });
        }

        NATIVE_FIELDS.forEach(function (def) {
            var value = text(item.values[def.key]);
            if (!value) return;

            var current = currentValue(def, { track: track, tags: tags });
            if (normalizeText(value) === normalizeText(current)) return;

            result.native[def.native] = def.kind === 'date'
                ? mmDateFromIso(value)
                : (def.kind === 'year' || def.kind === 'int') ? parseInt(value, 10) : value;
            addField(def, 'native', value, current);
        });

        TAG_FIELDS.forEach(function (def) {
            var value = text(def.scope === 'album' ? item.albumTags[def.tag] : item.trackTags[def.tag]);
            if (!value) return;

            var current = tagValue(tags, def.tag);
            if (normalizeText(value) === normalizeText(current)) return;

            result.tags.push({ title: def.tag, value: value });
            addField(def, 'tag', value, current);
        });

        return result;
    }

    /**
     * The field rows for a whole selection: one row per field, with values that
     * differ per track collapsed instead of one row per value.
     *
     * @param {Array<{pending: Object}>} work
     * @returns {Array<{key: string, label: string, kind: string, value: string,
     *   perTrack: boolean, currentText: string, changes: number, total: number}>}
     */
    function aggregateFields(work) {
        var order = [];
        var byKey = {};

        (work || []).forEach(function (item) {
            var pending = item && item.pending;
            if (!pending) return;

            (pending.fields || []).forEach(function (field) {
                var entry = byKey[field.key];

                if (!entry) {
                    entry = byKey[field.key] = {
                        key: field.key,
                        label: field.label,
                        kind: field.kind,
                        native: field.native || '',
                        tag: field.tag || '',
                        values: [],
                        currents: [],
                        changes: 0,
                        total: (work || []).length
                    };
                    order.push(entry);
                }

                entry.changes++;
                if (entry.values.indexOf(field.display) === -1) entry.values.push(field.display);
                if (entry.currents.indexOf(field.current) === -1) entry.currents.push(field.current);
            });
        });

        order.forEach(function (entry) {
            entry.perTrack = entry.values.length > 1;
            entry.value = entry.perTrack ? '' : entry.values[0];
            entry.currentText = summarise(entry.currents);
        });

        return order;
    }

    /**
     * Builds the work for the selected tracks. Each track is matched against
     * the release by disc and track number; tracks without a library song or
     * without a match are counted, not written.
     *
     * @param {Array} tracks
     * @param {Object|null} release
     * @param {Map<number, string>|null} tagsById
     * @returns {Promise<Object>}
     */
    async function buildSelectionPlanAsync(tracks, release, tagsById) {
        var described = describeRelease(release);
        var list = (tracks || []).filter(function (track) { return !!track; });
        var entries = [];
        var work = [];
        var skipped = { noLibrary: 0, noAlbum: 0, unmatched: 0, same: 0 };

        for (var i = 0; i < list.length; i++) {
            var track = list[i];
            var songId = parseInt(track && track.id, 10) || 0;
            var albumId = parseInt(track && track.idalbum, 10) || 0;

            if (!(songId > 0)) {
                skipped.noLibrary++;
                continue;
            }

            if (!(albumId > 0)) skipped.noAlbum++;

            var tagsText;
            if (tagsById && typeof tagsById.has === 'function' && tagsById.has(songId)) {
                tagsText = tagsById.get(songId);
            }

            var pending = await buildPendingAsync(track, release, tagsText);
            var entry = {
                track: track,
                songId: songId,
                albumId: albumId,
                disc: leadingInt(track.discNumber),
                number: leadingInt(track.trackNumber),
                title: text(track.title),
                pending: pending,
                matched: !!pending.matched,
                changes: pending.matched ? (pending.fields || []).length : 0,
                changed: !!(pending.matched && pending.fields && pending.fields.length)
            };

            entries.push(entry);

            if (!pending.matched) {
                skipped.unmatched++;
                continue;
            }

            if (!entry.changed) skipped.same++;
            else work.push(entry);
        }

        return {
            release: {
                id: described.id,
                title: described.title,
                artist: described.artist,
                trackCount: described.tracks.length
            },
            entries: entries,
            work: work,
            fields: aggregateFields(work),
            skipped: skipped,
            total: entries.length
        };
    }

    /**
     * Merges canonical tags into an existing array. A tag already present under
     * any file-format name keeps that raw title, and duplicate aliases collapse
     * into the first entry; new tags are appended. Unrelated tags keep their
     * order.
     */
    function mergeTags(tags, writes) {
        var result = Array.isArray(tags) ? tags.slice() : [];

        (writes || []).forEach(function (write) {
            var value = text(write && write.value);
            var title = text(write && write.title);
            if (!title || !value) return;

            var matchIndex = -1;
            var matchTitle = '';

            for (var i = 0; i < result.length; i++) {
                if (!result[i]) continue;
                if (!tagMatches(result[i].title, title)) continue;

                if (matchIndex < 0) {
                    matchIndex = i;
                    matchTitle = String(result[i].title || title);
                } else {
                    result.splice(i, 1);
                    i--;
                }
            }

            if (matchIndex < 0) {
                result.push({ title: title, value: value });
            } else {
                result[matchIndex] = { title: matchTitle, value: value };
            }
        });

        return result;
    }

    /**
     * Applies the tag table's edits to one track's array: an edit addresses the
     * stored title and occurrence, an empty value removes that tag, and an add
     * appends the value only when the track does not already carry that tag.
     */
    function applyTagEdits(tags, edits) {
        var source = Array.isArray(tags) ? tags.slice() : [];
        var positions = {};
        var removed = {};
        var added = [];
        var applied = 0;

        source.forEach(function (tag, index) {
            var title = text(tag && tag.title);
            if (!positions[title]) positions[title] = [];
            positions[title].push(index);
        });

        function existingIndex(title) {
            var indexes = positions[title];
            if (!indexes) return -1;

            for (var i = 0; i < indexes.length; i++) {
                if (!removed[indexes[i]]) return indexes[i];
            }

            return -1;
        }

        (edits || []).forEach(function (edit) {
            var title = text(edit && edit.title);
            if (!title) return;

            var value = edit && edit.deleted ? '' : text(edit && edit.value);

            if (edit && edit.add) {
                // A cleared pending row is a cancelled add, not a deletion.
                if (!value) return;

                var index = existingIndex(title);
                if (index >= 0) {
                    if (text(source[index].value) === value) return;
                    source[index] = Object.assign({}, source[index], { value: value });
                    applied++;
                    return;
                }

                added.push({ title: title, value: value });
                applied++;
                return;
            }

            var occurrence = parseInt(edit && edit.occurrence, 10);
            if (!(occurrence >= 0)) return;

            var indexes = positions[title];
            var target = indexes ? indexes[occurrence] : undefined;
            if (target === undefined) return;

            if (!value) {
                removed[target] = true;
                applied++;
                return;
            }

            if (text(source[target].value) === value) return;
            source[target] = Object.assign({}, source[target], { value: value });
            applied++;
        });

        return {
            tags: source.filter(function (tag, index) { return !removed[index]; }).concat(added),
            applied: applied
        };
    }

    function refreshLibrary() {
        try {
            if (typeof app !== 'undefined' && app.db && app.db.clearCache) app.db.clearCache();
            if (typeof uitools !== 'undefined' && uitools.refreshView) uitools.refreshView();
        } catch (e) {
            // refreshing is best effort; the writes are already committed
        }
    }

    /**
     * The only write path. For every selected track: the ticked native fields,
     * then one read and one merged ExtendedTags write (fill tags and tag edits
     * together), then commitAsync(). A failing track is reported and the rest
     * still commit.
     *
     * @param {Object} plan buildSelectionPlanAsync result; may be the empty
     *   plan of an album without a release when only tags are edited
     * @param {string[]} keys field keys to fill
     * @param {Array<{title: string, occurrence?: number, value: string,
     *   add?: boolean, deleted?: boolean}>} tagEdits tag table edits
     * @returns {Promise<{total: number, updated: number, skipped: number,
     *   noMatch: number, unchanged: number, tagWrites: number,
     *   failed: Array<{title: string, error: string}>}>}
     */
    async function applySelectionAsync(plan, keys, tagEdits) {
        var wanted = {};
        (keys || []).forEach(function (key) { wanted[key] = true; });

        var edits = (tagEdits || []).filter(function (edit) { return !!(edit && edit.title); });
        var entries = (plan && (plan.entries || plan.work)) || [];
        var result = {
            total: entries.length,
            updated: 0,
            skipped: 0,
            noMatch: 0,
            unchanged: 0,
            tagWrites: 0,
            failed: []
        };

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var track = entry && entry.track;
            var pending = (entry && entry.pending) || { matched: false, fields: [], native: {} };
            var touched = false;
            var tagsWritten = false;

            try {
                if (!track) throw new Error(_('This track is not in the library.'));

                var nativeFields = (pending.fields || []).filter(function (field) {
                    return field.kind === 'native' && wanted[field.key];
                });

                if (nativeFields.length) {
                    if (track.beginUpdate) track.beginUpdate();

                    nativeFields.forEach(function (field) {
                        var value = pending.native ? pending.native[field.native] : undefined;
                        if (value === undefined || value === '') return;

                        track[field.native] = value;
                        touched = true;
                    });

                    if (track.endUpdate) track.endUpdate();
                }

                var writes = (pending.fields || []).filter(function (field) {
                    return field.kind === 'tag' && wanted[field.key] && !!text(field.value);
                }).map(function (field) {
                    return { title: field.tag, value: text(field.value) };
                });

                if (writes.length || edits.length) {
                    var current = parseTags(await track.getExtendedTagsAsync());
                    if (!Array.isArray(current)) {
                        throw new Error(_('The extended tags of this track could not be read as JSON.'));
                    }

                    // One array, one write: the fill tags and the tag table
                    // edits are merged together even when they touch the same
                    // track.
                    var merged = mergeTags(current, writes);
                    var applied = 0;

                    if (edits.length) {
                        var edited = applyTagEdits(merged, edits);
                        merged = edited.tags;
                        applied = edited.applied;
                    }

                    if (writes.length || applied) {
                        await track.setExtendedTagsAsync(merged.length ? JSON.stringify(merged) : '');
                        touched = true;
                        tagsWritten = true;
                    }
                }

                if (touched) {
                    if (track.commitAsync) await track.commitAsync();
                    result.updated++;
                    if (tagsWritten) result.tagWrites++;
                } else {
                    result.skipped++;
                    if (!pending.matched) result.noMatch++;
                    else result.unchanged++;
                }
            } catch (error) {
                result.failed.push({
                    title: text(track && track.title) || ('#' + ((entry && entry.songId) || 0)),
                    error: error && error.message ? error.message : String(error)
                });
            }
        }

        refreshLibrary();
        return result;
    }

    window.mbzApply = {
        describeRelease: describeRelease,
        collectTracks: collectTracks,
        collectSelectionAsync: collectSelectionAsync,
        resolveTagScope: resolveTagScope,
        buildPendingAsync: buildPendingAsync,
        buildSelectionPlanAsync: buildSelectionPlanAsync,
        aggregateFields: aggregateFields,
        applySelectionAsync: applySelectionAsync,
        mergeTags: mergeTags,
        applyTagEdits: applyTagEdits,
        parseTags: parseTags,
        tagNameMatches: tagMatches
    };
})();
