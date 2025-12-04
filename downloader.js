// @ts-check
const { existsSync } = require("fs");
const { writeFile, readFile } = require("fs/promises");
const { join } = require("path");
const { fetchPost, getLatestIndex, fetchThread, getPriority } = require("./ffUtils");
const { closeCDPFetchers } = require("./cdpFetch");

/** @typedef {import('./ffUtils').MinimalFFPost} MinimalFFPost */

/**
 * @typedef {Object} Manifest
 * @property {number} lastDownloaded The last downloaded post ID.
 * @property {Array<string>} daily The list of daily chunk names.
 * @property {Array<string>} monthly The list of monthly chunk names.
 * @property {Array<{name: string, url: string}>} yearly The list of yearly chunk names and URLs.
 */

// Last downloaded post file
const MANIFEST_FILE = join(__dirname, 'manifest.json');
/** @type {Manifest} */
const DEFAULT_MANIFEST = { lastDownloaded: 0, daily: [], monthly: [], yearly: [] };

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
    if (typeof data.lastDownloaded !== 'number') {
        data.lastDownloaded = 0;
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

/**
 * Get a UTC timestamp string in the format YYYYMMDDHHMMSS.
 * 
 * @param {Date} d The date to format.
 * @returns {string} The formatted timestamp string.
 */
function getTimestampStr(d) {
    const year = d.getUTCFullYear().toString().padStart(4, '0');
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    const hour = d.getUTCHours().toString().padStart(2, '0');
    const minute = d.getUTCMinutes().toString().padStart(2, '0');
    const second = d.getUTCSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}${hour}${minute}${second}`;
}

// Maximum number of posts to download in one chunk
const CHUNK_POSTS_MAX = 100_000;
// Post lookup cache file
const POST_LOOKUP_FILE = join(__dirname, 'post_lookup_cache.json');

async function downloadChunk() {
    const manifest = await getManifest();
    const lastDesuPost = await getLatestIndex();
    const newPosts = lastDesuPost - manifest.lastDownloaded;
    const toDownload = Math.min(Math.max(newPosts, 0), CHUNK_POSTS_MAX);
    if (toDownload === 0) {
        console.log('No new posts to download. Exiting.');
        return false;
    }
    const start = manifest.lastDownloaded + 1;
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
        // Disallow after-end posts for non-desuarchive sources
        if (site !== 'desuarchive.org' && num > end) {
            return;
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
            downloaded.set(num, post);
            return;
        }

        if ('exception' in existing) {
            downloaded.set(num, post);
            return;
        }

        if (getPriority(site) >= getPriority(existing)) {
            downloaded.set(num, post);
        }
    }

    console.log('Downloading', toDownload, 'new posts out of', newPosts, 'available...');

    let currPostI = 0;
    let startTS = Date.now();
    let lastUpdateTS = startTS;
    const desuPriority = getPriority('desuarchive.org');
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
        const existing = downloaded.get(pNum);
        if (existing) {
            // Skip already known exceptions
            if ('exception' in existing) {
                continue;
            }
            // Skip already downloaded posts with equal or higher priority
            if (getPriority(existing) >= desuPriority) {
                continue;
            }
            console.log(`Refetching post ${pNum} from desuarchive.org for higher priority...`);
        }
        /** @type {MinimalFFPost | { error: string } } */
        const fPost = await fetchPost(pNum);
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
            const posts = thread.posts || {};
            for (const postId in posts) {
                addPost(posts[postId]);
            }

        }
    }

    let missing = 0;
    for (let pNum = start; pNum <= end; ++pNum) {
        const downloadedPost = downloaded.get(pNum);
        if (!downloadedPost || ('exception' in downloadedPost)) {
            missing++;
        }
    }

    if (missing !== 0) {
        console.log(`Desuarchive chunk download complete. Downloading ${missing} missing posts from arch.b4k.dev...`);

        try {
            const b4kPriority = getPriority('arch.b4k.dev');
            for (let pNum = start; pNum <= end; ++pNum) {
                const existing = downloaded.get(pNum);
                // Skip already downloaded posts with equal or higher priority 
                if (existing && !('exception' in existing) && getPriority(existing) >= b4kPriority) {
                    continue;
                }
                console.log(`Fetching missing post ${pNum} from arch.b4k.dev...`);
                /** @type {MinimalFFPost | { error: string } } */
                const fPost = await fetchPost(pNum, 'arch.b4k.dev');
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
                    const posts = thread.posts || {};
                    for (const postId in posts) {
                        addPost(posts[postId], 'arch.b4k.dev');
                    }
                }
            }
        } catch (err) {
            console.error('Error during arch.b4k.dev fetches:', err);
        }

        let stillMissing = 0;
        for (let pNum = start; pNum <= end; ++pNum) {
            const downloadedPost = downloaded.get(pNum);
            if (!downloadedPost || ('exception' in downloadedPost)) {
                stillMissing++;
            }
        }
        const foundInB4K = missing - stillMissing;
        console.log(`arch.b4k.dev fetch complete. Found ${foundInB4K} out of ${missing} missing posts. ${stillMissing} posts still missing.`);
        missing = stillMissing;
        if (missing !== 0) {
            console.log(`arch.b4k.dev download complete. Downloading ${missing} missing posts from archived.moe...`);
        } else {
            console.log('Writing files...');
        }
    } else {
        console.log('Desuarchive chunk download complete. Writing files...');
    }
    if (missing !== 0) {
        try {
            const archivedMoePriority = getPriority('archived.moe');
            for (let pNum = start; pNum <= end; ++pNum) {
                const existing = downloaded.get(pNum);
                // Skip already downloaded posts with equal or higher priority
                if (existing && !('exception' in existing) && getPriority(existing) >= archivedMoePriority) {
                    continue;
                }
                console.log(`Fetching missing post ${pNum} from archived.moe...`);
                /** @type {MinimalFFPost | { error: string } } */
                const fPost = await fetchPost(pNum, 'archived.moe');
                if ('error' in fPost) {
                    if (fPost.error === 'Post not found.') {
                        continue;
                    }
                    if (fPost.error === 'Captcha required.') {
                        console.warn('Captcha required on archived.moe, skipping further fetches from this source.');
                        break;
                    }
                    throw new Error(`Error fetching post ${pNum} from archived.moe: ${fPost.error}`);
                }
                addPost(fPost, 'archived.moe');
                console.log(`Fetching thread ${fPost.thread_num} from archived.moe...`);
                const fThread = await fetchThread(fPost.thread_num, 'archived.moe');
                if ('error' in fThread) {
                    if (fThread.error === 'Thread not found.') {
                        continue;
                    }
                    if (fThread.error === 'Captcha required.') {
                        console.warn('Captcha required on archived.moe, skipping further fetches from this source.');
                        break;
                    }
                    throw new Error(`Error fetching thread ${fPost.thread_num} from archived.moe: ${fThread.error}`);
                }
                for (const threadId in fThread) {
                    const thread = fThread[threadId];
                    if (thread.op) {
                        addPost(thread.op, 'archived.moe');
                    }
                    if (thread.posts) {
                        for (const postId in thread.posts) {
                            const post = thread.posts[postId];
                            addPost(post, 'archived.moe');
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Error during archived.moe fetches:', err);
        }

        let stillMissing = 0;
        for (let pNum = start; pNum <= end; ++pNum) {
            const downloadedPost = downloaded.get(pNum);
            if (!downloadedPost || ('exception' in downloadedPost)) {
                stillMissing++;
            }
        }
        const foundInArchivedMoe = missing - stillMissing;
        console.log(`archived.moe fetch complete. Found ${foundInArchivedMoe} out of ${missing} missing posts. ${stillMissing} posts still missing.`);
        console.log('Writing files...');
    }

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

    const chunkName = `${getTimestampStr(new Date())}_daily_${consPost[0].num}_${consPost[consPost.length - 1].num}`;
    const fileName = `${chunkName}.ndjson`;
    await writeFile(join(__dirname, fileName), consPost.map(v => JSON.stringify(v)).join('\n') + '\n', 'utf-8');

    console.log('File written:', fileName);
    console.log('Updating manifest...');

    manifest.daily.push(chunkName);
    manifest.lastDownloaded = parseInt(consPost[consPost.length - 1].num, 10);
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
}).finally(async () => {
    console.log('Closing CDP fetchers...');
    await closeCDPFetchers();
    console.log('Done.');
});