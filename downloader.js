// @ts-check
const { existsSync } = require("fs");
const { writeFile, readFile } = require("fs/promises");
const { join } = require("path");
const { processComment } = require("./v1/commentProcessor");
const { deDBfy } = require("./v1/deDBfy");
if (!globalThis.fetch) {
    const gAny = /** @type {any} */ (globalThis);
    gAny.fetch = require('node-fetch');
}

/**
 * Minimal representation of a FoolFuuka post.
 * There are more fields, but these are the only ones we care about.
 * @typedef {Object} MinimalFFPost
 * @property {string} num The post ID.
 * @property {string} subnum The sub-post ID (for ghost replies).
 * @property {string} thread_num The thread ID this post belongs to.
 * @property {number} timestamp The post timestamp.
 * @property {string | null} comment The raw comment content.
 * @property {string} comment_sanitized The sanitized comment content.
 * @property {string} comment_processed The processed comment content.
 * @property {Array<any>} [extra_data] Extra data associated with the post.
 */

/**
 * Minimal representation of a FoolFuuka thread.
 * There are more fields, but these are the only ones we care about.
 * @typedef {Object} MinimalFFThreadEntry
 * @property {MinimalFFPost} [op] The original post of the thread.
 * @property {Record<string, MinimalFFPost>} [posts] The replies in the thread.
 */

/**
 * Minimal representation of a FoolFuuka thread in the index.
 * There are more fields, but these are the only ones we care about.
 * @typedef {Object} MinimalFFIndexThread
 * @property {MinimalFFPost} op The original post of the thread.
 * @property {Array<MinimalFFPost>} [posts] The replies in the thread.
 */

/**
 * Minimal representation of a FoolFuuka thread in the chunk response.
 * There are more fields, but these are the only ones we care about.
 * @typedef {Object} MinimalFFChunkThread
 * @property {MinimalFFPost} [op] The original post of the thread.
 * @property {Record<string, MinimalFFPost>} [posts] The replies in the thread.
 */

/**
 * Minimal representation of the FoolFuuka thread response.
 * @typedef {Record<string, MinimalFFThreadEntry>} MinimalFFThread
 */

/**
 * Minimal representation of the FoolFuuka search response.
 * @typedef {{ "0": { posts: Array<MinimalFFPost> }, meta: { total_found: number, max_results: string } }} MinimalFFSearch
*/

/**
 * Minimal representation of the FoolFuuka chunk response.
 * @typedef {{ comments: Record<number, MinimalFFChunkThread> }} MinimalFFChunk
 */

/**
 * Minimal representation of the FoolFuuka index response. 
 * @typedef {Record<number, MinimalFFIndexThread>} MinimalFFIndex 
 */

// Maximum number of retries for fetch
let RETRY_CNT_MAX = 20;
// Maximum exponential backoff time in ms
const RETRY_EB_MAX = 30_000;

/**
 * Fetch a URL with retries and exponential backoff.
 * 
 * @param {string} url The URL to fetch.
 * @param {boolean} [allow500=false] Whether to allow HTTP 500 responses.
 * @param {number} [retryN=0] Number of retries on failure.
 * @returns {Promise<Response>} The fetch response.
 */
async function myFetch(url, allow500, retryN = 0) {
    try {
        // console.log('Fetching:', url);
        const resp = await fetch(url);
        if (!resp.ok && !(allow500 && resp.status === 500)) {
            throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
        }
        return resp;
    } catch (err) {
        // Exponential backoff
        if (retryN >= RETRY_CNT_MAX) {
            throw new Error(`Failed to fetch ${url} after ${RETRY_CNT_MAX} retries: ${err}`);
        }
        const backoff = Math.min(2 ** retryN * 500, RETRY_EB_MAX);
        console.warn(`Fetch error for ${url}: ${err}. Retrying in ${backoff} ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return myFetch(url, allow500, retryN + 1);
    }
}

/**
 * Get the lastest post ID in the archive.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} [site='desuarchive.org'] The site to get the latest index from.
 * @returns {Promise<number>} The latest post ID.
 */
async function getLatestIndex(site = 'desuarchive.org') {
    if (process.env.OVERRIDE_LATEST_POST) {
        const overrideNum = parseInt(process.env.OVERRIDE_LATEST_POST, 10);
        if (!isNaN(overrideNum) && overrideNum > 0) {
            console.log(`Using overridden latest post number from environment: ${overrideNum}`);
            return overrideNum;
        }
    }
    site = site || 'desuarchive.org';
    /** @type {MinimalFFIndex} */
    const res = await myFetch(`https://${site}/_/api/chan/index?board=mlp&page=1&_=${Date.now()}`).then(r => r.json());
    let maxPostNum = -1;
    for (const threadId in res) {
        const thread = res[threadId];
        if (thread.op) {
            const opNum = parseInt(thread.op.num, 10);
            if (opNum > maxPostNum) {
                maxPostNum = opNum;
            }
        }
        if (thread.posts) {
            for (const post of thread.posts) {
                const postNum = parseInt(post.num, 10);
                if (postNum > maxPostNum) {
                    maxPostNum = postNum;
                }
            }
        }
    }
    return maxPostNum;
}

/**
 * @typedef {Object} Manifest
 * @property {number} lastDownLoaded The last downloaded post ID.
 * @property {Array<string>} daily The list of daily chunk names.
 * @property {Array<string>} monthly The list of monthly chunk names.
 * @property {Array<{name: string, url: string}>} yearly The list of yearly chunk names and URLs.
 */

// Last downloaded post file
const MANIFEST_FILE = join(__dirname, 'manifest.json');
/** @type {Manifest} */
const DEFAULT_MANIFEST = { lastDownLoaded: 0, daily: [], monthly: [], yearly: [] };

/**
 * Get the manifest data.
 * 
 * @returns {Promise<Manifest>} The manifest data.
 */
async function getManifest() {
    if (!existsSync(MANIFEST_FILE)) {
        console.warn(`${MANIFEST_FILE} does not exist. Using default manifest.`);
        return structuredClone(DEFAULT_MANIFEST);
    }
    /** @type {Manifest | null} */
    let data = null;
    try {
        data = await readFile(MANIFEST_FILE, 'utf-8').then(d => JSON.parse(d));
    } catch (err) {
        console.error(`Error reading ${MANIFEST_FILE}. Using default manifest. Error:`, err);
    }
    if (data == null || typeof data !== 'object' || Array.isArray(data)) {
        data = structuredClone(DEFAULT_MANIFEST);
    }
    if (typeof data.lastDownLoaded !== 'number') {
        data.lastDownLoaded = 0;
    }
    if (!Array.isArray(data.daily)) {
        data.daily = [];
    }
    if (!Array.isArray(data.monthly)) {
        data.monthly = [];
    }
    if (!Array.isArray(data.yearly)) {
        data.yearly = [];
    }
    return data;
}

/**
 * Save the manifest data.
 * 
 * @param {Manifest} manifest The manifest to save.
 */
async function saveManifest(manifest) {
    await writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Fetch a thread in chunks by its ID.
 * 
 * @param {string} threadNum The thread ID.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to process comments for.
 * @returns {Promise<MinimalFFThread | { error: string }>} The thread data.
 */
async function fetchThreadChunked(threadNum, site) {
    /** @type {Map<number, MinimalFFPost>} */
    const uniquePostsMap = new Map();
    let start = 1;
    while (true) {
        const url = `https://${site}/_/api/chan/chunk/?board=mlp&num=${threadNum}&posts=5000&start=${start}`;

        /** @type {MinimalFFChunk | { error: string }} */
        const res = await myFetch(url).then(r => r.json());
        if ('error' in res) {
            // No more chunks
            if (res.error === '') {
                break;
            }
            return { error: res.error };
        }
        const comments = res.comments;
        for (const threadId in comments) {
            const thread = comments[threadId];
            if (thread.op) {
                if (thread.op.subnum === '0') {
                    const num = parseInt(thread.op.num, 10);
                    uniquePostsMap.set(num, thread.op);
                }
            }
            if (thread.posts) {
                for (const postId in thread.posts) {
                    if (thread.posts[postId].subnum !== '0') {
                        continue;
                    }
                    const num = parseInt(thread.posts[postId].num, 10);
                    uniquePostsMap.set(num, thread.posts[postId]);
                }
            }
        }
        ++start;
    }
    const uniquePosts = Array.from(uniquePostsMap.entries()).sort((a, b) => a[0] - b[0]);
    const tnum = parseInt(threadNum, 10);
    /** @type {MinimalFFPost | null} */
    let resOP = null;
    /** @type {Record<string, MinimalFFPost>} */
    const resPosts = {};
    let hasPosts = false;
    for (const [num, post] of uniquePosts) {
        // Chunked returns a false in these fields. I dont wanna add it to type defs cause its only here.
        const comSanAny = /** @type {any} */ (post.comment_sanitized);
        if (comSanAny === false) {
            post.comment_sanitized = post.comment == null ? '' : post.comment;
        }
        const comProcAny = /** @type {any} */ (post.comment_processed);
        if (comProcAny === false) {
            post.comment_processed = processComment(post.comment, site);
        }
        if (num === tnum) {
            resOP = post;
        }
        else {
            resPosts[post.num] = post;
            hasPosts = true;
        }
    }

    /** @type {MinimalFFThreadEntry} */
    const result = {};
    if (resOP) {
        result.op = resOP;
    }
    if (hasPosts) {
        result.posts = resPosts;
    }
    return Object.fromEntries([[threadNum, result]]);
}

/**
 * Format a date for FoolFuuka search.
 * 
 * @param {Date} d The date to format.
 * @returns {string} The formatted date.
 */
function ffDate(d) {
    return encodeURIComponent(d.toLocaleString('SV', { timeZone: 'America/New_York' }));
}

/**
 * Fetch a thread by searching for it.
 * 
 * @param {string} threadNum The thread ID.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to process comments for.
 * @param {boolean} [useChunkedFallback=false] Whether to use chunked fetching as a fallback.
 * @returns {Promise<MinimalFFThread | { error: string }>} The thread data.
 */
async function fetchThreadSearch(threadNum, site, useChunkedFallback = false) {
    /** @type {Map<number, MinimalFFPost>} */
    const uniquePostsMap = new Map();
    let start = '';
    let page = 1;
    let postsThisRound = 0;
    let maxTS = 0;
    while (true) {
        const url = `https://${site}/_/api/chan/search/?boards=mlp&tnum=${threadNum}&ghost=none&&order=asc&page=${page}` +
            (start ? `&start=${start}` : '');

        console.log(`[Search] Fetching ${url}...`);
        /** @type {MinimalFFSearch | { error: string }} */
        const res = await myFetch(url).then(r => r.json());
        if ('error' in res) {
            if (res.error === 'No results found.') {
                return { error: 'Thread not found.' };
            }
            const errorLC = res.error.toLowerCase();
            if (errorLC.includes('search') && errorLC.includes('backend') && (errorLC.includes('unavailable') || errorLC.includes('down'))) {
                console.log('[DEBUG] The correct message is:', res);
                if (useChunkedFallback) {
                    return await fetchThreadChunked(threadNum, site);
                }
                return { error: 'Thread not found.' };
            }
            return { error: res.error };
        }
        const meta = res.meta;
        const results = res["0"];
        postsThisRound += results.posts.length;
        for (const post of results.posts) {
            if (post.subnum !== '0') {
                continue;
            }
            uniquePostsMap.set(parseInt(post.num, 10), post);
            if (post.timestamp > maxTS) {
                maxTS = post.timestamp;
            }
        }
        if (postsThisRound >= meta.total_found) {
            break;
        }
        const maxResults = parseInt(meta.max_results, 10);
        if (postsThisRound >= maxResults) {
            start = ffDate(new Date(maxTS * 1000));
            postsThisRound = 0;
            page = 1;
        } else {
            ++page;
        }
        // Wait 2 seconds between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2500));
    }
    const uniquePosts = Array.from(uniquePostsMap.entries()).sort((a, b) => a[0] - b[0]);
    const tnum = parseInt(threadNum, 10);
    /** @type {MinimalFFPost | null} */
    let resOP = null;
    /** @type {Record<string, MinimalFFPost>} */
    const resPosts = {};
    let hasPosts = false;
    for (const [num, post] of uniquePosts) {
        if (num === tnum) {
            resOP = post;
        }
        else {
            resPosts[post.num] = post;
            hasPosts = true;
        }
    }
    /** @type {MinimalFFThreadEntry} */
    const result = {};
    if (resOP) {
        result.op = resOP;
    }
    if (hasPosts) {
        result.posts = resPosts;
    }
    return Object.fromEntries([[threadNum, result]]);
}

/**
 * Fetch a thread by its ID.
 * 
 * @param {string} threadNum The thread ID.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} [site='desuarchive.org'] The site to process comments for.
 * @returns {Promise<MinimalFFThread | { error: string }>} The thread data.
 */
async function fetchThread(threadNum, site = 'desuarchive.org') {
    site = site || 'desuarchive.org';
    const resp = await myFetch(`https://${site}/_/api/chan/thread?board=mlp&num=${threadNum}`, true);
    // Thread too big, use search (with chunked fallback) instead
    if (resp.status === 500) {
        return await fetchThreadSearch(threadNum, site, true);
    }
    /** @type {MinimalFFThread | { error: string }} */
    const result = await resp.json();
    if ('error' in result) {
        if (result.error === 'Thread not found.') {
            return await fetchThreadSearch(threadNum, site);
        }
        return result;
    }
    return result;
}

/**
 * Convert seconds to human-readable time.
 * 
 * @param {number} sec The time in seconds.
 * @returns {string} The human-readable time.
 */
function toHumanTime(sec) {
    const mSec = (sec - Math.floor(sec)) * 1000;
    sec = Math.floor(sec);
    let min = Math.floor(sec / 60);
    sec -= min * 60;
    let hr = Math.floor(min / 60);
    min -= hr * 60;

    const hrs = hr.toString().padStart(2, '0');
    const mins = min.toString().padStart(2, '0');
    const secs = sec.toString().padStart(2, '0');
    const msecs = mSec.toFixed(0).padStart(3, '0');

    if (hr > 0) {
        return `${hrs}:${mins}:${secs}`;
    } else if (min > 0) {
        return `${mins}:${secs}`;
    } else {
        return `00:${secs}.${msecs}`;
    }
}

// Maximum number of posts to download in one chunk
const CHUNK_POSTS_MAX = 100_000;
// Post lookup cache file
const POST_LOOKUP_FILE = join(__dirname, 'post_lookup_cache.json');

async function downloadChunk() {
    const manifest = await getManifest();
    const lastDesuPost = await getLatestIndex();
    const newPosts = lastDesuPost - manifest.lastDownLoaded;
    const toDownload = Math.min(Math.max(newPosts, 0), CHUNK_POSTS_MAX);
    if (toDownload === 0) {
        console.log('No new posts to download. Exiting.');
        return false;
    }
    const start = manifest.lastDownLoaded + 1;
    const end = start + toDownload - 1;
    /** @type {Map<number, MinimalFFPost>} */
    const postLookup = new Map();
    if (existsSync(POST_LOOKUP_FILE)) {
        console.log('Loading post lookup cache from', POST_LOOKUP_FILE);
        const plRaw = await readFile(POST_LOOKUP_FILE, 'utf-8');
        const plJson = JSON.parse(plRaw);
        for (const post of plJson) {
            const num = parseInt(post.num, 10);
            if (num < start) {
                continue;
            }
            postLookup.set(num, post);
        }
    }
    /** @type {Map<number, MinimalFFPost | { num: string, exception: string, timestamp: number }>} */
    const downloaded = new Map();
    for (let i = start; i <= end; ++i) {
        const post = postLookup.get(i);
        if (post) {
            downloaded.set(i, post);
        }
    }

    /**
     * Helper to filter out ghost and out-of-bounds posts before adding.
     * 
     * @param {MinimalFFPost | { num: string, exception: string, timestamp: number }} post The post to add.
     * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} [site='desuarchive.org'] The site the post is from.
     */
    function addPost(post, site = 'desuarchive.org') {
        site = site || 'desuarchive.org';
        // Skip ghost replies
        if ('subnum' in post && post.subnum !== '0') {
            return;
        }
        const num = parseInt(post.num, 10);
        // Skip before start
        if (num < start) {
            return;
        }
        // Disallow after-end posts and overriding existing from non-desuarchive sources
        if (site !== 'desuarchive.org') {
            if (num > end) {
                return;
            }
            const existing = downloaded.get(num);
            if (existing && !('exception' in existing)) {
                return;
            }
        }
        if ('comment_processed' in post) {
            post.comment_processed = deDBfy(post.comment_processed, site);
        }
        const existing = downloaded.get(num);
        if (!existing) {
            downloaded.set(num, post);
            return;
        }
        if ('exception' in post) {
            if (!('exception' in existing) || existing.exception === post.exception) {
                return;
            }
        } else if (site !== 'desuarchive.org') {
            let extraData = post.extra_data || [];
            const source = { source: site };
            if (!Array.isArray(extraData)) {
                console.warn('Unexpected extra_data format, overwriting:', extraData);
                source.extra_data = extraData;
                extraData = [];
            }
            extraData.push(source);
            post.extra_data = extraData;
        }
        downloaded.set(num, post);
    }

    console.log('Downloading', toDownload, 'new posts out of', newPosts, 'available...');

    let currPostI = 0;
    let startTS = Date.now();
    let lastUpdateTS = startTS;
    for (let pNum = start; pNum <= end; ++pNum) {
        currPostI++;
        const now = Date.now();
        if (now - lastUpdateTS >= 2_000) {
            const elapsedS = (now - startTS) / 1000;
            const pps = currPostI / elapsedS;
            const prog = ((currPostI / toDownload) * 100).toFixed(2);
            const elapsed = toHumanTime(elapsedS);
            const eta = toHumanTime((toDownload - currPostI) / pps);
            const gEta = toHumanTime((newPosts - currPostI) / pps);
            console.log(`Progress: ${prog}% | Current: ${pNum} | PPS: ${pps.toFixed(2)} | Elapsed: ${elapsed} | ETA (chunk): ${eta} | ETA (total): ${gEta}`);
            lastUpdateTS = now;
        }
        // Skip already downloaded posts
        if (downloaded.has(pNum)) {
            continue;
        }
        /** @type {MinimalFFPost | { error: string } } */
        const fPost = await myFetch(`https://desuarchive.org/_/api/chan/post?board=mlp&num=${pNum}`).then(r => r.json());
        if ('error' in fPost) {
            if (fPost.error === 'Post not found.') {
                addPost({ num: pNum.toString(), exception: 'Post: not found', timestamp: Math.floor(Date.now() / 1000) });
                continue;
            }
            throw new Error(`Error fetching post ${pNum}: ${fPost.error}`);
        }
        addPost(fPost);
        const fThread = await fetchThread(fPost.thread_num);
        if ('error' in fThread) {
            // All methods have been tried, skip and rely on the post fetch only
            if (fThread.error === 'Thread not found.') {
                addPost({ num: fPost.thread_num, exception: 'Post: not found', timestamp: Math.floor(Date.now() / 1000) });
                continue;
            }
            // Some other error
            throw new Error(`Error fetching thread ${fPost.thread_num}: ${fThread.error}`);
        }
        for (const threadId in fThread) {
            const thread = fThread[threadId];
            if (thread.op) {
                addPost(thread.op);
            }
            if (thread.posts) {
                for (const postId in thread.posts) {
                    const post = thread.posts[postId];
                    addPost(post);
                }
            }
        }
    }

    console.log(`Desuarchive chunk download complete. Downloading missing posts (if any) from arch.b4k.dev...`);

    try {
        RETRY_CNT_MAX = 6;
        for (let pNum = start; pNum <= end; ++pNum) {
            // Skip non-missing posts
            const downloadedPost = downloaded.get(pNum);
            if (downloadedPost && !('exception' in downloadedPost)) {
                continue;
            }
            console.log(`Fetching missing post ${pNum} from arch.b4k.dev...`);
            /** @type {MinimalFFPost | { error: string } } */
            const fPost = await myFetch(`https://arch.b4k.dev/_/api/chan/post?board=mlp&num=${pNum}`).then(r => r.json());
            if ('error' in fPost) {
                if (fPost.error === 'Post not found.') {
                    continue;
                }
                throw new Error(`Error fetching post ${pNum} from arch.b4k.dev: ${fPost.error}`);
            }
            addPost(fPost, 'arch.b4k.dev');
            console.log(`Fetching thread ${fPost.thread_num} from arch.b4k.dev...`);
            const fThread = await fetchThread(fPost.thread_num, 'arch.b4k.dev');
            if ('error' in fThread) {
                if (fThread.error === 'Thread not found.') {
                    continue;
                }
                throw new Error(`Error fetching thread ${fPost.thread_num} from arch.b4k.dev: ${fThread.error}`);
            }
            for (const threadId in fThread) {
                const thread = fThread[threadId];
                if (thread.op) {
                    addPost(thread.op, 'arch.b4k.dev');
                }
                if (thread.posts) {
                    for (const postId in thread.posts) {
                        const post = thread.posts[postId];
                        addPost(post, 'arch.b4k.dev');
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error during arch.b4k.dev fetches:', err);
    }

    console.log('Download complete. Writing to file...');

    const posts = Array.from(downloaded.entries()).sort((a, b) => a[0] - b[0]);
    /** @type {Array<MinimalFFPost | { num: string, exception: string, timestamp: number }>} */
    const consPost = [];
    /** @type {Array<MinimalFFPost>} */
    const nextLookup = [];
    let prevNum = null;
    for (const [num, post] of posts) {
        if (prevNum === null || num === prevNum + 1) {
            consPost.push(post);
            prevNum = num;
        } else if (!('exception' in post)) {
            nextLookup.push(post);
        }
    }

    console.log('Saving post lookup cache for next run...');

    await writeFile(POST_LOOKUP_FILE, JSON.stringify(nextLookup), 'utf-8');

    const chunkName = `${consPost[0].num}_${consPost[consPost.length - 1].num}`;
    const fileName = `daily_${chunkName}.ndjson`;
    await writeFile(join(__dirname, fileName), consPost.map(v => JSON.stringify(v)).join('\n') + '\n', 'utf-8');

    console.log('File written:', fileName);
    console.log('Updating manifest...');

    manifest.daily.push(chunkName);
    manifest.lastDownLoaded = parseInt(consPost[consPost.length - 1].num, 10);
    await saveManifest(manifest);
    return toDownload !== newPosts;
}

async function main() {
    // If --full is not provided, only download one chunk
    if (process.argv[2] !== '--full') {
        await downloadChunk();
        return;
    }
    // If --full is provided, download until no more new posts
    while (true) {
        const hasMore = await downloadChunk();
        if (!hasMore) {
            break;
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});