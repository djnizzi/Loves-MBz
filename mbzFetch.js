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
 * One `release/{mbid}` lookup asks for everything the add-on may need:
 * artist credits, labels, recordings, release groups, media, disc IDs,
 * ISRCs, recording/work relationships and their artist credits. The parsed
 * release is cached by ID for the lifetime
 * of this window, so previewing the same album twice costs one request.
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

    /**
     * Discogs pages linked from a release. MusicBrainz stores these as URL
     * relationships; Picard's `discogs_url` extended tag holds the same value.
     * Returns [] when the release has no Discogs link.
     */
    function discogsUrls(release) {
        var relations = (release && release.relations) ? release.relations : [];
        var urls = [];

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

        return urls;
    }

    function errorText(error) {
        if (!error) return '';
        return error.message ? error.message : String(error);
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
                reject(new Error(_('MusicBrainz did not answer in time.')));
            }, REQUEST_TIMEOUT_MS + 2000);

            function stopTimer() {
                if (!timer) return;
                clearTimeout(timer);
                timer = null;
            }

            function fail(message) {
                if (finished) return;
                finished = true;
                stopTimer();
                reject(new Error(message));
            }

            xhr.open('GET', url, true);
            xhr.setRequestHeader('User-Agent', USER_AGENT);
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.timeout = REQUEST_TIMEOUT_MS;

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || finished) return;

                if (window._cleanUpCalled) {
                    fail(_('Cancelled.'));
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
                    fail(_('MusicBrainz has no release with that ID.'));
                } else if (!xhr.status) {
                    fail(_('Could not reach musicbrainz.org.'));
                } else {
                    var detail = apiErrorDetail(xhr.responseText);
                    fail(_('MusicBrainz returned HTTP ') + xhr.status +
                        (detail ? ': ' + detail : '.'));
                }
            };

            xhr.ontimeout = function () {
                fail(_('MusicBrainz did not answer in time.'));
            };
            xhr.onerror = function () {
                fail(_('Could not reach musicbrainz.org.'));
            };

            try {
                xhr.send();
            } catch (e) {
                fail(errorText(e));
            }
        });
    }

    /** Sends one request, keeping the API's one-per-second spacing. */
    async function sendAsync(url) {
        if (window._cleanUpCalled) throw new Error(_('Cancelled.'));

        var waitMs = MIN_INTERVAL_MS - (now() - lastRequestAt);
        if (waitMs > 0) await wait(waitMs);

        lastRequestAt = now();
        requestCount++;

        if (window._cleanUpCalled) throw new Error(_('Cancelled.'));

        var text = await requestOnce(url);
        if (text === null) return null;

        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(_('MusicBrainz returned a response that is not JSON.'));
        }
    }

    async function fetchReleaseAsync(releaseId) {
        var id = normalizeReleaseId(releaseId);
        if (!id) throw new Error(_('There is no MusicBrainz release ID to look up.'));

        if (cache.has(id)) return cache.get(id);

        return enqueueAsync(async function () {
            if (cache.has(id)) return cache.get(id);

            var url = API_ROOT + 'release/' + encodeURIComponent(id) +
                '?inc=' + INCLUDE + '&fmt=json';
            var delay = RETRY_DELAY_MS;

            for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                var release = await sendAsync(url);
                if (release) {
                    cache.set(id, release);
                    return release;
                }

                if (attempt < MAX_ATTEMPTS) {
                    await wait(delay);
                    delay *= 2;
                }
            }

            throw new Error(_('MusicBrainz is busy right now. Try again in a moment.'));
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
        releaseIdForAlbumAsync: releaseIdForAlbumAsync,
        normalizeReleaseId: normalizeReleaseId,
        discogsUrls: discogsUrls,
        clearCache: function () {
            cache.clear();
        },
        getState: function () {
            return {
                cached: cache.size,
                requests: requestCount,
                userAgent: USER_AGENT,
                include: INCLUDE
            };
        }
    };
})();
