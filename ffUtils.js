// @ts-check
const { processComment } = require("./v1/commentProcessor");
const { deDBfy } = require("./v1/deDBfy");
const { cdpFetch: fetch } = require("./cdpFetch.js");

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
 * Minimal representation of the FoolFuuka chunk response.
 * @typedef {{ comments: Record<number, MinimalFFChunkThread> }} MinimalFFChunk
 */

/**
 * Minimal representation of the FoolFuuka search response.
 * @typedef {{ "0": { posts: Array<MinimalFFPost> }, meta: { total_found: number, max_results: string } }} MinimalFFSearch
*/

/**
 * Minimal representation of a FoolFuuka thread.
 * There are more fields, but these are the only ones we care about.
 * @typedef {Object} MinimalFFThreadEntry
 * @property {MinimalFFPost} [op] The original post of the thread.
 * @property {Record<string, MinimalFFPost>} [posts] The replies in the thread.
 */

/**
 * Minimal representation of the FoolFuuka thread response.
 * @typedef {Record<string, MinimalFFThreadEntry>} MinimalFFThread
 */

/**
 * Minimal representation of the FoolFuuka index response. 
 * @typedef {Record<number, MinimalFFIndexThread>} MinimalFFIndex 
 */

/**
 * Get the source of a post based on its extra_data.
 * 
 * @param {MinimalFFPost} post - The post object to extract the source from.
 * @returns {'desuarchive.org' | 'archived.moe' | 'arch.b4k.dev'} - The source of the post.
 */
function getSource(post) {
    /** @type {{ source: 'desuarchive.org' | 'archived.moe' | 'arch.b4k.dev' }} */
    const sourceObj = (Array.isArray(post.extra_data) ? post.extra_data : []).find(
        /** @param {{ source: string }} ed */
        (ed) => ed && (ed.source === 'archived.moe' || ed.source === 'arch.b4k.dev')
    ) || { source: 'desuarchive.org' };
    return sourceObj.source;
}

const PRIORITY = {
    'desuarchive.org': 3,
    'arch.b4k.dev': 2,
    'archived.moe': 1,
};

/**
 * Get the priority of a post or site.
 * 
 * @param {MinimalFFPost | 'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} postOrSite The post or site to get the priority for.
 * @returns {number} The priority of the post or site.
 */
function getPriority(postOrSite) {
    if (typeof postOrSite === 'string') {
        return PRIORITY[postOrSite] || 0;
    }
    const source = getSource(postOrSite);
    return PRIORITY[source] || 0;
}

// Maximum number of retries for fetch
let RETRY_CNT_MAX = 20;
// Minimum interval between fetches in ms
let MIN_FETCH_INTERVAL = 0;
// Maximum exponential backoff time in ms
const RETRY_EB_MAX = 30_000;

let lastFetchTime = {
    'desuarchive.org': 0,
    'arch.b4k.dev': 0,
    'archived.moe': 0,
};

/**
 * Fetch a URL with retries and exponential backoff.
 * 
 * @param {string} url The URL to fetch.
 * @param {number[]} [allowErrors=[]] Array of non-okay HTTP status codes to allow.
 * @param {number} [retryN=0] Number of retries on failure.
 * @returns {Promise<Response>} The fetch response.
 */
async function myFetch(url, allowErrors = [], retryN = 0) {
    let tooManyRequests = false;
    try {
        // console.log('Fetching:', url);
        const now = Date.now();
        const delay = Math.max(0, MIN_FETCH_INTERVAL - (now - lastFetchTime[fetchSite]));
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        lastFetchTime[fetchSite] = Date.now();
        const resp = await fetch(url);
        if (!resp.ok && !(allowErrors.includes(resp.status))) {
            if (resp.status === 429) {
                tooManyRequests = true;
            }
            throw new Error(`HTTP error: ${resp.status} ${resp.statusText}`);
        }
        return resp;
    } catch (err) {
        // Exponential backoff
        if (retryN >= RETRY_CNT_MAX) {
            throw new Error(`Failed to fetch ${url} after ${RETRY_CNT_MAX} retries: ${err}`);
        }
        const tmr = tooManyRequests ? 16_000 : 0;
        const backoff = Math.min(2 ** retryN * 500, RETRY_EB_MAX) + tmr;
        console.warn(`Fetch error for ${url}: ${err}. Retrying in ${backoff} ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        return myFetch(url, allowErrors, retryN + 1);
    }
}

/** @type {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} */
let fetchSite = 'desuarchive.org';

/**
 * Set the site parameters for fetching.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to set.
 */
function setFetchSite(site) {
    if (fetchSite === site) {
        return;
    }
    fetchSite = site;
    switch (site) {
        case 'desuarchive.org':
            RETRY_CNT_MAX = 20;
            MIN_FETCH_INTERVAL = 0;
            break;
        case 'arch.b4k.dev':
            RETRY_CNT_MAX = 10;
            MIN_FETCH_INTERVAL = 0;
            break;
        case 'archived.moe':
            RETRY_CNT_MAX = 10;
            MIN_FETCH_INTERVAL = 2600;
            break;
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
    setFetchSite(site);
    /** @type {MinimalFFIndex} */
    const res = await myFetch(`https://${site}/_/api/chan/index?board=mlp&page=1&_=${Date.now()}`, site === 'archived.moe' ? [403] : []).then(r => {
        if (r.status === 403) {
            throw new Error('Captcha required.');
        }
        return r.json();
    });
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

        console.log(`[Chunked] Fetching ${url}...`);
        /** @type {MinimalFFChunk | { error: string }} */
        const res = await myFetch(url, site === 'archived.moe' ? [403] : []).then(r => {
            if (r.status === 403) {
                return { error: 'Captcha required.' };
            }
            return r.json();
        });
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

let MIN_SEARCH_INTERVAL = 3000;
let lastSearchTime = {
    'desuarchive.org': 0,
    'arch.b4k.dev': 0,
    'archived.moe': 0,
};

/**
 * Fetch a thread by searching for it.
 * 
 * @param {string} threadNum The thread ID.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to process comments for.
 * @param {boolean} useChunkedFallback Whether to use chunked fetching as a fallback.
 * @returns {Promise<MinimalFFThread | { error: string }>} The thread data.
 */
async function fetchThreadSearch(threadNum, site, useChunkedFallback) {
    /** @type {Map<number, MinimalFFPost>} */
    const uniquePostsMap = new Map();
    let start = '';
    let page = 1;
    let postsThisRound = 0;
    let maxTS = 0;
    while (true) {
        const url = `https://${site}/_/api/chan/search/?boards=mlp&tnum=${threadNum}&ghost=none&&order=asc&page=${page}` +
            (start ? `&start=${start}` : '');

        const now = Date.now();
        const delay = Math.max(0, MIN_SEARCH_INTERVAL - (now - lastSearchTime[site]));
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        console.log(`[Search] Fetching ${url}...`);
        /** @type {MinimalFFSearch | { error: string }} */
        const res = await myFetch(url, site === 'archived.moe' ? [403] : []).then(r => {
            if (r.status === 403) {
                return { error: 'Captcha required.' };
            }
            return r.json();
        });
        if ('error' in res) {
            if (res.error === 'No results found.') {
                return { error: 'Thread not found.' };
            }
            if (
                res.error === 'The search backend is currently unavailable.' ||
                res.error === 'The search backend returned an error.'
            ) {
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
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to process comments for.
 * @returns {Promise<MinimalFFThread | { error: string }>} The thread data.
 */
async function fetchThreadInner(threadNum, site) {
    const allowResponses = [500];
    if (site === 'archived.moe') {
        allowResponses.push(403);
    }
    const resp = await myFetch(`https://${site}/_/api/chan/thread?board=mlp&num=${threadNum}`, allowResponses);
    // Capcha
    if (resp.status === 403) {
        return { error: 'Captcha required.' };
    }
    // Thread too big, use search (with chunked fallback) instead
    if (resp.status === 500) {
        return await fetchThreadSearch(threadNum, site, true);
    }
    /** @type {MinimalFFThread | { error: string }} */
    const result = await resp.json();
    if ('error' in result) {
        if (result.error === 'Thread not found.') {
            return await fetchThreadSearch(threadNum, site, false);
        }
        return result;
    }
    return result;
}

/**
 * Set the source and de-DBfy a post.
 * 
 * @param {MinimalFFPost} post The post to process.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to process comments for.
 * @returns {MinimalFFPost} The processed post.
 */
function setSourceAndDeDBfy(post, site) {
    if ('comment_processed' in post) {
        post.comment_processed = deDBfy(post.comment_processed, site);
    }
    if (site === 'desuarchive.org') {
        return post;
    }
    let extraData = post.extra_data;
    if (extraData === undefined && site === 'archived.moe') {
        // Missing extra_data is expected for archived.moe posts
        extraData = [];
    }
    const source = { source: site };
    if (!Array.isArray(extraData)) {
        console.warn('Unexpected extra_data format, overwriting:', extraData);
        source.extra_data = extraData;
        extraData = [];
    }
    extraData.push(source);
    post.extra_data = extraData;
    return post;
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
    setFetchSite(site);
    const result = await fetchThreadInner(threadNum, site);
    if ('error' in result) {
        return result;
    }
    // Process comments
    for (const threadId in result) {
        const thread = result[threadId];
        if (thread.op) {
            if (thread.op.subnum !== '0') {
                delete thread.op;
            } else {
                thread.op = setSourceAndDeDBfy(thread.op, site);
            }
        }
        const posts = thread.posts || {};
        for (const postId in posts) {
            const post = posts[postId];
            if (post.subnum !== '0') {
                delete posts[postId];
                continue;
            }
            posts[postId] = setSourceAndDeDBfy(post, site);
        }
    }
    return result;
}

/**
 * Fetch a post by its ID.
 * 
 * @param {string | number} postNum The post ID.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} [site='desuarchive.org'] The site to process comments for.
 * @returns {Promise<MinimalFFPost | { error: string }>} The post data.
 */
async function fetchPost(postNum, site = 'desuarchive.org') {
    site = site || 'desuarchive.org';
    setFetchSite(site);
    /** @type {MinimalFFPost | { error: string }} */
    const result = await myFetch(`https://${site}/_/api/chan/post?board=mlp&num=${postNum}`, site === 'archived.moe' ? [403] : []).then(r => {
        if (r.status === 403) {
            return { error: 'Captcha required.' };
        }
        return r.json();
    });
    if ('error' in result) {
        return result;
    }
    return setSourceAndDeDBfy(result, site);
}

module.exports = {
    getSource,
    getPriority,
    getLatestIndex,
    fetchPost,
    fetchThread,
};