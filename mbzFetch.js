'use strict';

/*
 * Loves MBz — MusicBrainz release lookup.
 *
 * MediaMonkey already stores the release ID of every matched album
 * (Albums.MBGID), so nothing here searches MusicBrainz or guesses a release:
 * an album without that ID is skipped without a single HTTP request.
 *
 * MusicBrainz needs no key for reads, but it does require a descriptive
 * User-Agent and no more than one request per second per client. Both live
 * here, behind a serialized queue, so no caller can bypass them.
 *
 * A `release/{mbid}` lookup asks for the release and its artist credits,
 * labels, recordings, release groups, media, disc IDs, ISRCs and
 * recording/work relationships. When that release has no Discogs URL, one
 * `release-group/{id}` URL lookup follows, because MusicBrainz keeps the
 * Discogs master page on the release group. The parsed release is cached by
 * ID for the lifetime of this window, so previewing the same album twice
 * costs one release request and at most one group lookup.
 *
 * 0.6.1 adds the group's other releases: `release?release-group={id}` with
 * `inc=media` lists every release of the group, with the media that carries
 * each one's track count, so the window can offer the exact pressing when
 * MediaMonkey matched the group's best-known release instead. A release-group
 * lookup with `inc=releases` does return the same `releases` array, but with no
 * media, so it cannot show how long a pressing is. The parsed list is cached
 * by group ID, like the release itself.
 */

(function () {
    var API_ROOT = 'https://musicbrainz.org/ws/2/';
    var USER_AGENT = 'LovesMBz ( https://github.com/djnizzi/Loves-MBz )';
    var INCLUDE = 'artist-credits+labels+recordings+release-groups+media+discids' +
        '+isrcs+url-rels+recording-level-rels+work-rels+work-level-rels+artist-rels';
    var MIN_INTERVAL_MS = 1100;     // the API allows one request per second
    var REQUEST_TIMEOUT_MS = 20000;
    var MAX_ATTEMPTS = 3;
    var RETRY_DELAY_MS = 2000;

    var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    var cache = new Map();          // release MBID -> parsed release
    var groupCache = new Map();     // release group MBID -> parsed release list
    var queue = Promise.resolve();
    var lastRequestAt = 0;
    var requestCount = 0;

    function now() {
        return Date.now();
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    /** '' for "not set" and the canonical dashed lower-case form otherwise. */
    function normalizeReleaseId(value) {
        var id = String(value === undefined || value === null ? '' : value)
            .replace(/\s+/g, '')
            .toLowerCase();

        if (!id || id === '0') return '';

        if (/^[0-9a-f]{32}$/.test(id)) {
            id = id.slice(0, 8) + '-' + id.slice(8, 12) + '-' + id.slice(12, 16) +
                '-' + id.slice(16, 20) + '-' + id.slice(20);
        }

        return GUID_RE.test(id) ? id : '';
    }

    /** The same check for any MusicBrainz ID: a release group, an artist. */
    function normalizeGuid(value) {
        return normalizeReleaseId(value);
    }

    function collectDiscogsUrls(relations, urls) {
        for (var i = 0; i < relations.length; i++) {
            var relation = relations[i] || {};
            var resource = (relation.url && relation.url.resource)
                ? String(relation.url.resource).trim()
                : '';

            if (!resource) continue;

            var isDiscogs = relation.type === 'discogs' ||
                /^https?:\/\/(www\.)?discogs\.com\//i.test(resource);

            if (isDiscogs && urls.indexOf(resource) === -1) urls.push(resource);
        }
    }

    /**
     * Discogs pages linked from a release or its release group. MusicBrainz
     * stores these as URL relationships; a master Discogs page usually lives on
     * the release group. Picard's `discogs_url` extended tag holds the same
     * value. Returns [] when neither has a Discogs link.
     */
    function discogsUrls(release) {
        var urls = [];

        collectDiscogsUrls((release && release.relations) || [], urls);

        var group = release && release['release-group'];
        collectDiscogsUrls((group && group.relations) || [], urls);

        return urls;
    }

    function errorText(error) {
        if (!error) return '';
        return error.message ? error.message : String(error);
    }

    /**
     * An error with a stable code. The window reads `mbzCode` to decide whether
     * Retry can help: a busy server or a timeout can, a missing release cannot.
     */
    function makeError(message, code) {
        var error = new Error(message);
        error.mbzCode = code || '';
        return error;
    }

    /** The JSON error MusicBrainz sends with a 4xx, or a short plain-text body. */
    function apiErrorDetail(body) {
        var raw = String(body === undefined || body === null ? '' : body).trim();
        if (!raw) return '';

        try {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.error) return String(parsed.error).trim();
        } catch (e) {
            // not JSON: fall through to the text form
        }

        return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    }

    /**
     * The release ID MediaMonkey holds for an album, or '' when it has none.
     * This is the gate: an empty result must never lead to a request.
     */
    async function releaseIdForAlbumAsync(albumId) {
        var id = parseInt(albumId, 10);
        if (!(id > 0)) return '';

        var res = await app.db.getQueryResultAsync('SELECT MBGID FROM Albums WHERE ID = ' + id);
        if (res.eof) return '';

        return normalizeReleaseId(res.fields.getValue(0));
    }

    function requestOnce(url) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            var finished = false;
            var timer = setTimeout(function () {
                if (finished) return;
                finished = true;
                try { xhr.abort(); } catch (e) {}
                reject(makeError(_('MusicBrainz did not answer in time.'), 'timeout'));
            }, REQUEST_TIMEOUT_MS + 2000);

            function stopTimer() {
                if (!timer) return;
                clearTimeout(timer);
                timer = null;
            }

            function fail(message, code) {
                if (finished) return;
                finished = true;
                stopTimer();
                reject(makeError(message, code));
            }

            xhr.open('GET', url, true);
            xhr.setRequestHeader('User-Agent', USER_AGENT);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = REQUEST_TIMEOUT_MS;

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || finished) return;

                if (window._cleanUpCalled) {
                    fail(_('Cancelled.'), 'cancelled');
                    return;
                }

                if (xhr.status === 200) {
                    finished = true;
                    stopTimer();
                    resolve(xhr.responseText);
                } else if (xhr.status === 503 || xhr.status === 429) {
                    finished = true;
                    stopTimer();
                    resolve(null);     // busy: the caller retries
                } else if (xhr.status === 404) {
                    fail(_('MusicBrainz has no release with that ID.'), 'not-found');
                } else if (!xhr.status) {
                    fail(_('Could not reach musicbrainz.org.'), 'network');
                } else {
                    var detail = apiErrorDetail(xhr.responseText);
                    fail(_('MusicBrainz returned HTTP ') + xhr.status +
                        (detail ? ': ' + detail : '.'), 'http');
                }
            };

            xhr.ontimeout = function () {
                fail(_('MusicBrainz did not answer in time.'), 'timeout');
            };
            xhr.onerror = function () {
                fail(_('Could not reach musicbrainz.org.'), 'network');
            };

            try {
                xhr.send();
            } catch (e) {
                fail(errorText(e), 'network');
            }
        });
    }

    /** Sends one request, keeping the API's one-per-second spacing. */
    async function sendAsync(url) {
        if (window._cleanUpCalled) throw makeError(_('Cancelled.'), 'cancelled');

        var waitMs = MIN_INTERVAL_MS - (now() - lastRequestAt);
        if (waitMs > 0) await wait(waitMs);

        lastRequestAt = now();
        requestCount++;

        if (window._cleanUpCalled) throw makeError(_('Cancelled.'), 'cancelled');

        var text = await requestOnce(url);
        if (text === null) return null;

        try {
            return JSON.parse(text);
        } catch (e) {
            throw makeError(_('MusicBrainz returned a response that is not JSON.'), 'bad-response');
        }
    }

    /** One JSON request, retrying only the API's busy responses. */
    async function fetchJsonWithRetriesAsync(url) {
        var delay = RETRY_DELAY_MS;

        for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            var data = await sendAsync(url);
            if (data) return data;

            if (attempt < MAX_ATTEMPTS) {
                await wait(delay);
                delay *= 2;
            }
        }

        return null;
    }

    /**
     * A release lookup does not include the release group's URL relationships.
     * Fetch them only when the release itself has no Discogs link; a failed
     * optional request leaves the rest of the release usable.
     */
    async function attachReleaseGroupUrlRelationsAsync(release) {
        var group = release && release['release-group'];
        if (!group || !group.id) return;

        // Some responses already carry URL relations on the group. Do not spend
        // another request when those relations are present.
        if (Array.isArray(group.relations) && group.relations.some(function (relation) {
            return relation && relation.url;
        })) return;

        // A release-level Discogs page is already enough.
        if (discogsUrls(release).length) return;

        var url = API_ROOT + 'release-group/' + encodeURIComponent(group.id) +
            '?inc=url-rels&fmt=json';

        try {
            var data = await fetchJsonWithRetriesAsync(url);
            if (data && Array.isArray(data.relations)) group.relations = data.relations;
        } catch (e) {
            // Discogs is optional metadata. A failed group lookup must not hide
            // the release metadata that did load.
        }
    }

    async function fetchReleaseAsync(releaseId) {
        var id = normalizeReleaseId(releaseId);
        if (!id) throw makeError(_('There is no MusicBrainz release ID to look up.'), 'missing-id');

        if (cache.has(id)) return cache.get(id);

        return enqueueAsync(async function () {
            if (cache.has(id)) return cache.get(id);

            var url = API_ROOT + 'release/' + encodeURIComponent(id) +
                '?inc=' + INCLUDE + '&fmt=json';
            var release = await fetchJsonWithRetriesAsync(url);

            if (!release) {
                throw makeError(_('MusicBrainz is busy right now. Try again in a moment.'), 'busy');
            }

            await attachReleaseGroupUrlRelationsAsync(release);
            cache.set(id, release);
            return release;
        });
    }

    /**
     * Tracks on a release, from the media the listing carries. A group listing
     * gives each medium a `track-count`; the full medium is used when it does.
     */
    function releaseTrackCount(release) {
        var media = (release && release.media) || [];
        var total = 0;
        var counted = false;

        for (var i = 0; i < media.length; i++) {
            var medium = media[i] || {};
            var count = parseInt(medium['track-count'], 10);

            if (!(count >= 0) && Array.isArray(medium.tracks)) count = medium.tracks.length;
            if (!(count >= 0)) continue;

            total += count;
            counted = true;
        }

        if (!counted) {
            var own = parseInt(release && release['track-count'], 10);
            if (own >= 0) return own;
        }

        return counted ? total : 0;
    }

    /**
     * The formats a release's media carry ("CD", "Digital Media", "12\" Vinyl").
     * A release can mix them (a CD and a DVD in one box), so each distinct
     * format is named once, in the order the media list them.
     */
    function releaseFormats(release) {
        var media = (release && release.media) || [];
        var formats = [];

        for (var i = 0; i < media.length; i++) {
            var medium = media[i] || {};
            var format = String(medium.format === undefined || medium.format === null
                ? ''
                : medium.format).trim();

            if (!format || formats.indexOf(format) >= 0) continue;
            formats.push(format);
        }

        return formats;
    }

    /**
     * The rows the window offers for one release group: the pressing's own
     * title, date, country, format, status and track count. Oldest first, because a
     * group's dates read as a history; an undated release goes last instead of
     * sorting as year zero, and a duplicated row is dropped.
     *
     * @param {Object} group a `release?release-group={id}&inc=media` response
     * @returns {{id: string, title: string, releases: Array}}
     */
    function releaseGroupReleases(group) {
        var rows = [];
        var seen = {};
        var list = (group && group.releases) || [];

        for (var i = 0; i < list.length; i++) {
            var release = list[i] || {};
            var id = normalizeGuid(release.id);

            if (!id || seen[id]) continue;
            seen[id] = true;

            rows.push({
                id: id,
                title: String(release.title === undefined || release.title === null ? '' : release.title).trim(),
                date: String(release.date === undefined || release.date === null ? '' : release.date).trim(),
                country: String(release.country === undefined || release.country === null ? '' : release.country).trim(),
                format: releaseFormats(release).join(', '),
                status: String(release.status === undefined || release.status === null ? '' : release.status).trim(),
                disambiguation: String(release.disambiguation === undefined || release.disambiguation === null ? '' : release.disambiguation).trim(),
                trackCount: releaseTrackCount(release)
            });
        }

        rows.sort(function (a, b) {
            if (!a.date && !b.date) return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
            if (!a.date) return 1;
            if (!b.date) return -1;
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return a.trackCount - b.trackCount;
        });

        return {
            id: normalizeGuid(group && group.id),
            title: String((group && group.title) || '').trim(),
            releases: rows
        };
    }

    /**
     * Every release of one release group, cached by group ID. This is what
     * turns "MediaMonkey matched the group" into "this pressing, not that
     * one": one request lists them, and the window loads the chosen release
     * through fetchReleaseAsync like any other release.
     *
     * The browse endpoint answers in pages; 100 is its maximum and is far more
     * pressings than a group realistically has, so one request covers it.
     */
    async function fetchReleaseGroupReleasesAsync(groupId) {
        var id = normalizeGuid(groupId);
        if (!id) throw makeError(_('There is no MusicBrainz release group ID to look up.'), 'missing-id');

        if (groupCache.has(id)) return groupCache.get(id);

        return enqueueAsync(async function () {
            if (groupCache.has(id)) return groupCache.get(id);

            // Browse the group's releases rather than looking the group up:
            // only these rows carry the media that holds each pressing's
            // track count.
            var url = API_ROOT + 'release?release-group=' + encodeURIComponent(id) +
                '&inc=media&fmt=json&limit=100';
            var group = await fetchJsonWithRetriesAsync(url);

            if (!group) {
                throw makeError(_('MusicBrainz is busy right now. Try again in a moment.'), 'busy');
            }

            var parsed = releaseGroupReleases(group);
            if (!parsed.id) parsed.id = id;

            groupCache.set(id, parsed);
            return parsed;
        });
    }

    /** Runs one job at a time and keeps a failed job from blocking the queue. */
    function enqueueAsync(job) {
        var run = queue.then(job, job);
        queue = run.then(function () {}, function () {});
        return run;
    }

    /**
     * Everything the preview needs for one album.
     *
     * @param {number} albumId
     * @returns {Promise<{albumId: number, releaseId: string, skipped: boolean,
     *   reason: string, release: object|null}>}
     */
    async function previewAsync(albumId) {
        var id = parseInt(albumId, 10);
        var result = {
            albumId: id > 0 ? id : 0,
            releaseId: '',
            skipped: false,
            reason: '',
            release: null
        };

        if (!result.albumId) {
            result.skipped = true;
            result.reason = 'no-album';
            return result;
        }

        result.releaseId = await releaseIdForAlbumAsync(result.albumId);

        if (!result.releaseId) {
            // No ID, no request: the add-on never searches by title or artist.
            result.skipped = true;
            result.reason = 'no-release-id';
            return result;
        }

        result.release = await fetchReleaseAsync(result.releaseId);
        return result;
    }

    window.mbzFetch = {
        previewAsync: previewAsync,
        fetchReleaseAsync: fetchReleaseAsync,
        fetchReleaseGroupReleasesAsync: fetchReleaseGroupReleasesAsync,
        releaseGroupReleases: releaseGroupReleases,
        releaseIdForAlbumAsync: releaseIdForAlbumAsync,
        normalizeReleaseId: normalizeReleaseId,
        normalizeGuid: normalizeGuid,
        discogsUrls: discogsUrls,
        clearCache: function () {
            cache.clear();
            groupCache.clear();
        },
        getState: function () {
            return {
                cached: cache.size,
                groupsCached: groupCache.size,
                requests: requestCount,
                userAgent: USER_AGENT,
                include: INCLUDE
            };
        }
    };
})();
