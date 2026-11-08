'use strict';

/*
 * Loves MBz — turn a MusicBrainz release into library writes.
 *
 * The dialog stays read-only until the user ticks fields and presses Apply.
 * This module owns the mapping and the writes:
 *
 *   - library tracks are matched to the release by disc and track number,
 *     never by title, because titles are exactly what is being changed
 *   - only fields whose fetched value differs from the library are offered
 *   - native fields go on the track; extended tags are merged into the track's
 *     existing ExtendedTags JSON so unrelated tags and the Custom tab survive
 *   - every touched track is committed with commitAsync, then MediaMonkey's DB
 *     cache and the current view are refreshed
 *
 * Albums.MBGID and the artist rows are never written here: the release ID is
 * the input, not an output, so a fetched ID cannot overwrite the library value
 * the lookup came from.
 */

(function () {
    var NATIVE_FIELDS = [
        { key: 'albumArtist', label: _('Album artist'), scope: 'album', native: 'albumArtist' },
        { key: 'date', label: _('Date'), scope: 'album', native: 'date', kind: 'date' },
        { key: 'year', label: _('Year'), scope: 'album', native: 'year', kind: 'year' },
        { key: 'origDate', label: _('Original date'), scope: 'album', native: 'origDate', kind: 'date' },
        { key: 'origYear', label: _('Original year'), scope: 'album', native: 'origYear', kind: 'year' },
        { key: 'publisher', label: _('Labels'), scope: 'album', native: 'publisher' },
        { key: 'title', label: _('Title'), scope: 'track', native: 'title' },
        { key: 'artist', label: _('Artist'), scope: 'track', native: 'artist' },
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
        { key: 'script', label: _('Script'), scope: 'album', tag: 'SCRIPT' },
        { key: 'discogs', label: _('Discogs URL'), scope: 'album', tag: 'discogs_url' },
        { key: 'originaldate', label: _('Original date (tag)'), scope: 'album', tag: 'originaldate' },
        { key: 'originalyear', label: _('Original year (tag)'), scope: 'album', tag: 'originalyear' },
        { key: 'recordingid', label: _('MusicBrainz recording ID'), scope: 'track', tag: 'MUSICBRAINZ_TRACKID' },
        { key: 'releasetrackid', label: _('MusicBrainz release track ID'), scope: 'track', tag: 'MUSICBRAINZ_RELEASETRACKID' },
        { key: 'artistid', label: _('MusicBrainz artist ID'), scope: 'track', tag: 'MUSICBRAINZ_ARTISTID' },
        { key: 'artists', label: _('Artists'), scope: 'track', tag: 'ARTISTS' }
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

    function releaseScript(release) {
        var representation = (release && release['text-representation']) || {};
        return text(representation.script);
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
            SCRIPT: releaseScript(release),
            discogs_url: discogsUrls(release).join(', '),
            originaldate: origDate,
            originalyear: yearOf(origDate)
        };

        var tracks = [];
        var media = release.media || [];

        media.forEach(function (medium) {
            var disc = leadingInt(medium.position);

            (medium.tracks || []).forEach(function (item) {
                var recording = item.recording || {};
                var trackCredit = item['artist-credit'] || credit;

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
                        artist: creditNames(trackCredit),
                        isrc: text((recording.isrcs || [])[0])
                    },
                    albumTags: albumTags,
                    trackTags: {
                        MUSICBRAINZ_TRACKID: text(recording.id),
                        MUSICBRAINZ_RELEASETRACKID: text(item.id),
                        MUSICBRAINZ_ARTISTID: creditIds(trackCredit).join('; '),
                        ARTISTS: creditText(trackCredit)
                    }
                });
            });
        });

        return {
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

        var wanted = normalizeTagName(name);
        for (var i = 0; i < tags.length; i++) {
            if (!tags[i]) continue;
            if (normalizeTagName(tags[i].title) === wanted) return text(tags[i].value);
        }

        return '';
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
            return def.kind === 'date' ? isoFromMmDate(raw) : raw;
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

    function loadAlbumTracksAsync(albumId) {
        var list = app.db.getTracklist(
            'SELECT * FROM Songs WHERE IDAlbum = ' + albumId +
            ' ORDER BY DiscNumber, TrackNumber, ID', -1);

        if (list && list.whenLoaded) {
            return list.whenLoaded().then(function () { return list; });
        }

        return Promise.resolve(list);
    }

    function collectTracks(list) {
        var tracks = [];
        var count = list ? (list.count || 0) : 0;

        for (var i = 0; i < count; i++) {
            var track = list.getValue(i);
            if (track) tracks.push(track);
        }

        return tracks;
    }

    /**
     * @returns {Promise<{albumId: number, matches: Array, fields: Array,
     *   libraryCount: number, unmatched: number}>}
     */
    async function buildPlanAsync(albumId, release) {
        var id = parseInt(albumId, 10);
        var described = describeRelease(release);

        if (!(id > 0)) {
            return { albumId: 0, matches: [], fields: [], libraryCount: 0, unmatched: 0 };
        }

        var list = await loadAlbumTracksAsync(id);
        var byKey = {};

        collectTracks(list).forEach(function (track) {
            var key = leadingInt(track.discNumber) + ':' + leadingInt(track.trackNumber);
            if (key !== '0:0' && !byKey[key]) byKey[key] = track;
        });

        var matches = [];

        described.tracks.forEach(function (item) {
            var track = byKey[item.disc + ':' + item.track];
            if (!track) return;

            matches.push({
                key: item.disc + ':' + item.track,
                track: track,
                values: item.values,
                albumTags: item.albumTags,
                trackTags: item.trackTags,
                tags: null
            });
        });

        for (var i = 0; i < matches.length; i++) {
            try {
                matches[i].tags = parseTags(await matches[i].track.getExtendedTagsAsync());
            } catch (e) {
                matches[i].tags = null;
            }
        }

        var fields = [];

        NATIVE_FIELDS.concat(TAG_FIELDS).forEach(function (def) {
            var fetched = matches.map(function (match) { return fetchValue(def, match); });
            if (!fetched.some(function (value) { return !!value; })) return;

            var currents = matches.map(function (match) { return currentValue(def, match); });
            var changes = 0;

            fetched.forEach(function (value, index) {
                if (normalizeText(value) !== normalizeText(currents[index])) changes++;
            });

            if (!changes) return;

            var same = fetched.every(function (value) { return value === fetched[0]; });

            fields.push({
                key: def.key,
                label: def.label,
                scope: def.scope,
                native: def.native || '',
                tag: def.tag || '',
                kind: def.kind || '',
                value: same ? fetched[0] : '',
                values: fetched,
                current: summarise(currents),
                changes: changes,
                total: matches.length
            });
        });

        return {
            albumId: id,
            matches: matches,
            fields: fields,
            libraryCount: collectTracks(list).length,
            unmatched: Math.max(0, described.tracks.length - matches.length)
        };
    }

    /**
     * Merges canonical tags into an existing array. A tag that is already
     * present (under any file-format name) is replaced in place; new tags are
     * appended. Unrelated tags keep their order.
     */
    function mergeTags(tags, writes) {
        var result = Array.isArray(tags) ? tags.slice() : [];

        (writes || []).forEach(function (write) {
            var value = text(write && write.value);
            var title = text(write && write.title);
            if (!title || !value) return;

            var wanted = normalizeTagName(title);
            var replaced = false;

            for (var i = 0; i < result.length; i++) {
                if (!result[i]) continue;
                if (normalizeTagName(result[i].title) !== wanted) continue;

                if (!replaced) {
                    result[i] = { title: title, value: value };
                    replaced = true;
                } else {
                    result.splice(i, 1);
                    i--;
                }
            }

            if (!replaced) result.push({ title: title, value: value });
        });

        return result;
    }

    /**
     * The values the Track Properties dialog should stage for one track, before
     * anything is saved. Matched by disc and track number like the album plan;
     * values that already match are left out.
     *
     * @returns {Promise<{matched: boolean, releaseTitle: string,
     *   native: Object, tags: Array<{title: string, value: string}>,
     *   labels: string[]}>}
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

        var item = findTrack(disc, number);

        // A file with no disc tag means the first disc. A single-medium
        // release cannot disagree about the disc, so match the number alone.
        if (!item && !disc) item = findTrack(described.firstDisc, number);
        if (!item && described.mediaCount === 1) item = findTrack(described.firstDisc, number);

        var result = {
            matched: !!item,
            releaseTitle: text(release && release.title),
            native: {},
            tags: [],
            labels: [],
            fields: []
        };

        if (!item) return result;

        var tags = [];
        try {
            // Group editing passes the tags it already read from the database;
            // the group proxy track has no per-track extended-tag array of its own.
            var currentTags = tagsText === undefined
                ? await track.getExtendedTagsAsync()
                : tagsText;
            tags = parseTags(currentTags) || [];
        } catch (e) {
            tags = [];
        }

        NATIVE_FIELDS.forEach(function (def) {
            var value = text(item.values[def.key]);
            if (!value) return;

            var current = def.kind === 'date'
                ? isoFromMmDate(track[def.native])
                : text(track[def.native]);

            if (normalizeText(value) === normalizeText(current)) return;

            result.native[def.native] = def.kind === 'date'
                ? mmDateFromIso(value)
                : def.kind === 'year' ? parseInt(value, 10) : value;
            result.labels.push(def.label + ': ' + value);
            result.fields.push({
                key: def.key,
                label: def.label,
                kind: 'native',
                native: def.native,
                value: value,
                display: value
            });
        });

        TAG_FIELDS.forEach(function (def) {
            var value = text(def.scope === 'album' ? item.albumTags[def.tag] : item.trackTags[def.tag]);
            if (!value) return;
            if (normalizeText(value) === normalizeText(tagValue(tags, def.tag))) return;

            result.tags.push({ title: def.tag, value: value });
            result.labels.push(def.label + ': ' + value);
            result.fields.push({
                key: def.key,
                label: def.label,
                kind: 'tag',
                tag: def.tag,
                value: value,
                display: value
            });
        });

        return result;
    }

    /**
     * Narrows a pending fill to the fields the user ticked. A key that is not
     * present on a track is simply ignored for that track.
     */
    function filterPending(pending, keys) {
        if (!pending || !Array.isArray(pending.fields) || !Array.isArray(keys)) return pending;

        var wanted = {};
        keys.forEach(function (key) { wanted[key] = true; });

        var selected = pending.fields.filter(function (field) {
            return !!wanted[field.key];
        });
        var native = {};
        var tags = [];

        selected.forEach(function (field) {
            if (field.kind === 'native') {
                native[field.native] = pending.native[field.native];
            } else if (field.kind === 'tag') {
                tags.push({ title: field.tag, value: field.value });
            }
        });

        return {
            matched: pending.matched,
            releaseTitle: pending.releaseTitle,
            native: native,
            tags: tags,
            labels: selected.map(function (field) { return field.label + ': ' + field.display; }),
            fields: selected
        };
    }

    /** Stages native fields on the track; Track Properties commits them on OK. */
    function applyNative(track, pending) {
        var props = Object.keys((pending && pending.native) || {});
        if (!props.length) return 0;

        if (track.beginUpdate) track.beginUpdate();
        props.forEach(function (prop) {
            track[prop] = pending.native[prop];
        });
        if (track.endUpdate) track.endUpdate();

        return props.length;
    }

    /**
     * Stages a track's values on the dialog's track without committing: native
     * properties plus a merge into its extended tags. The Track Properties OK
     * button performs the save.
     */
    async function applyPendingAsync(track, pending, tagsText) {
        if (!pending || !pending.matched) return 0;

        var writes = pending.tags || [];
        var written = 0;

        if (writes.length) {
            var tags = parseTags(tagsText === undefined
                ? await track.getExtendedTagsAsync()
                : tagsText);
            if (!Array.isArray(tags)) {
                throw new Error(_('The extended tags of this track could not be read as JSON.'));
            }

            await track.setExtendedTagsAsync(JSON.stringify(mergeTags(tags, writes)));
            written += writes.length;
        }

        written += applyNative(track, pending);
        return written;
    }

    /**
     * Writes the ticked fields to every matched track.
     *
     * @returns {Promise<{tracks: number, failed: Array<{title: string, error: string}>}>}
     */
    async function applyAsync(plan, keys) {
        var selected = (plan && plan.fields ? plan.fields : []).filter(function (field) {
            return (keys || []).indexOf(field.key) !== -1;
        });

        var result = { tracks: 0, failed: [] };
        if (!plan || !selected.length) return result;

        for (var i = 0; i < plan.matches.length; i++) {
            var match = plan.matches[i];
            var track = match.track;

            try {
                var nativeWrites = selected.filter(function (field) { return !!field.native; });
                var tagWrites = selected.filter(function (field) { return !!field.tag; });
                var touched = false;

                if (nativeWrites.length) {
                    if (track.beginUpdate) track.beginUpdate();

                    nativeWrites.forEach(function (field) {
                        var value = field.scope === 'track' ? field.values[i] : field.value;
                        if (!value) return;

                        track[field.native] = field.kind === 'date'
                            ? mmDateFromIso(value)
                            : field.kind === 'year' ? parseInt(value, 10) : value;
                        touched = true;
                    });

                    if (track.endUpdate) track.endUpdate();
                }

                if (tagWrites.length) {
                    var current = parseTags(await track.getExtendedTagsAsync());
                    if (!Array.isArray(current)) {
                        throw new Error(_('The extended tags of this track could not be read as JSON.'));
                    }

                    var writes = [];

                    tagWrites.forEach(function (field) {
                        var value = field.scope === 'track' ? field.values[i] : field.value;
                        if (value) writes.push({ title: field.tag, value: value });
                    });

                    if (writes.length) {
                        await track.setExtendedTagsAsync(JSON.stringify(mergeTags(current, writes)));
                        touched = true;
                    }
                }

                if (touched) {
                    if (track.commitAsync) await track.commitAsync();
                    result.tracks++;
                }
            } catch (error) {
                result.failed.push({
                    title: text(track.title),
                    error: error && error.message ? error.message : String(error)
                });
            }
        }

        try {
            if (app.db.clearCache) app.db.clearCache();
            if (typeof uitools !== 'undefined' && uitools.refreshView) uitools.refreshView();
        } catch (e) {
            // refreshing is best effort; the writes are already committed
        }

        return result;
    }

    window.mbzApply = {
        describeRelease: describeRelease,
        buildPlanAsync: buildPlanAsync,
        buildPendingAsync: buildPendingAsync,
        filterPending: filterPending,
        applyPendingAsync: applyPendingAsync,
        applyNative: applyNative,
        applyAsync: applyAsync,
        mergeTags: mergeTags,
        parseTags: parseTags
    };
})();
