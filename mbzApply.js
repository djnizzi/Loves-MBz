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
        { key: 'origDate', label: _('Original date'), scope: 'album', native: 'origDate', kind: 'date' },
        { key: 'publisher', label: _('Label'), scope: 'album', native: 'publisher' },
        { key: 'title', label: _('Title'), scope: 'track', native: 'title' },
        { key: 'artist', label: _('Artist'), scope: 'track', native: 'artist' },
        { key: 'isrc', label: _('ISRC'), scope: 'track', native: 'isrc' }
    ];

    var TAG_FIELDS = [
        { key: 'albumid', label: _('MusicBrainz release ID'), scope: 'album', tag: 'MUSICBRAINZ_ALBUMID' },
        { key: 'releasegroupid', label: _('MusicBrainz release group ID'), scope: 'album', tag: 'MUSICBRAINZ_RELEASEGROUPID' },
        { key: 'albumartistid', label: _('MusicBrainz album artist ID'), scope: 'album', tag: 'MUSICBRAINZ_ALBUMARTISTID' },
        { key: 'albumartists', label: _('Album artists'), scope: 'album', tag: 'ALBUMARTISTS' },
        { key: 'barcode', label: _('Barcode'), scope: 'album', tag: 'BARCODE' },
        { key: 'status', label: _('Release status'), scope: 'album', tag: 'RELEASESTATUS' },
        { key: 'type', label: _('Release type'), scope: 'album', tag: 'RELEASETYPE' },
        { key: 'country', label: _('Release country'), scope: 'album', tag: 'RELEASECOUNTRY' },
        { key: 'catalognumber', label: _('Catalogue number'), scope: 'album', tag: 'CATALOGNUMBER' },
        { key: 'script', label: _('Script'), scope: 'album', tag: 'SCRIPT' },
        { key: 'discogs', label: _('Discogs URL'), scope: 'album', tag: 'discogs_url' },
        { key: 'originalyear', label: _('Original year'), scope: 'album', tag: 'originalyear' },
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

    function creditText(credit) {
        var result = '';

        (credit || []).forEach(function (item) {
            if (!item) return;
            result += text(item.name || (item.artist && item.artist.name));
            result += text(item.joinphrase);
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

    function firstLabel(release) {
        var info = (release && release['label-info']) || [];

        for (var i = 0; i < info.length; i++) {
            var name = text(info[i] && info[i].label && info[i].label.name);
            if (name) return name;
        }

        return '';
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
        var albumArtist = creditText(credit);
        var albumArtistIds = creditIds(credit).join('; ');
        var date = text(release.date);
        var origDate = text(group['first-release-date']);

        var albumTags = {
            MUSICBRAINZ_ALBUMID: text(release.id),
            MUSICBRAINZ_RELEASEGROUPID: text(group.id),
            MUSICBRAINZ_ALBUMARTISTID: albumArtistIds,
            ALBUMARTISTS: albumArtist,
            BARCODE: text(release.barcode),
            RELEASESTATUS: text(release.status),
            RELEASETYPE: releaseType(release),
            RELEASECOUNTRY: text(release.country),
            CATALOGNUMBER: catalogNumbers(release),
            SCRIPT: releaseScript(release),
            discogs_url: discogsUrls(release).join(', '),
            originalyear: yearOf(origDate || date)
        };

        var tracks = [];

        (release.media || []).forEach(function (medium) {
            var disc = leadingInt(medium.position);

            (medium.tracks || []).forEach(function (item) {
                var recording = item.recording || {};
                var trackCredit = item['artist-credit'] || credit;

                tracks.push({
                    disc: disc,
                    track: leadingInt(item.number),
                    values: {
                        albumArtist: albumArtist,
                        date: date,
                        origDate: origDate,
                        publisher: firstLabel(release),
                        title: text(item.title || recording.title),
                        artist: creditText(trackCredit),
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

        return { albumTags: albumTags, tracks: tracks };
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

                        track[field.native] = field.kind === 'date' ? mmDateFromIso(value) : value;
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
        applyAsync: applyAsync,
        mergeTags: mergeTags,
        parseTags: parseTags
    };
})();
