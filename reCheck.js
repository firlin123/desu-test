// @ts-check
const { createReadStream, createWriteStream } = require('fs');
const { stat, rename } = require('fs/promises');
const { resolve, basename } = require('path');
const { getSource, fetchPost, fetchThread, getPriority } = require('./ffUtils');
const { closeCDPFetchers } = require('./cdpFetch');

/** @typedef {import('./ffUtils').MinimalFFPost} MinimalFFPost */
/** @typedef {import('./ffUtils').MinimalFFThread} MinimalFFThread */

/**
 * @typedef ReadNDJSONOptions
 * @property {number} [highWaterMark] - The chunk size to read from the file (default 1MB).
 * @property {(position: number, size: number) => void} [onProgress] - Callback invoked with the current read position.
 */

/**
 * @template T
 * Filter all non numeric keys from a type.
 * 
 * @typedef {{ [K in keyof T as T[K] extends number ? K : never]: T[K]; }} OnlyNumbers
 */

/**
 * @template T
 * Make all properties in a type required.
 * 
 * @typedef {{ [K in keyof T]-?: T[K]; }} RequireAll
 */

/**
 * Numeric keys of ReadNDJSONOptions.
 * 
 * @typedef {keyof OnlyNumbers<RequireAll<ReadNDJSONOptions>>} ReadNDJSONOptionsNK
 */

/**
 * Verify that a property in an options object is a positive integer number.
 * 
 * @param {ReadNDJSONOptions} opts - The options object.
 * @param {ReadNDJSONOptionsNK} propName - The property name to verify.
 * @param {number} defaultValue - The default value to return if verification fails.
 * @returns {number} - The verified number or the default value.
 */
function verifyNumberProp(opts, propName, defaultValue) {
    if (!(propName in opts)) {
        return defaultValue;
    }
    let val = opts[propName];
    if (typeof val !== 'number') {
        return defaultValue;
    }
    val = Math.round(val);
    if (!Number.isSafeInteger(val) || val <= 0) {
        return defaultValue;
    }
    return val;
}

/**
 * Get the size of a file.
 * 
 * @param {string} path - The file path.
 * @returns {Promise<number>} - The size of the file in bytes.
 */
async function getSize(path) {
    const stats = await stat(path);
    if (!stats.isFile()) {
        throw new Error(`Path is not a file: ${path}`);
    }
    return stats.size;
}

/**
 * Transforms an NDJSON file by applying a transformation function to each entry and writing the results to a new NDJSON file.
 * 
 * @param {string} inputPath - The path to the input NDJSON file.
 * @param {string} outputPath - The path to the output NDJSON file.
 * @param {(entry: any) => (any | Promise<any>)} transform - The transformation function to apply to each entry.
 * @param {ReadNDJSONOptions} [opts={}] - Options for reading the file.
 */
async function transformNDJSON(inputPath, outputPath, transform, opts = {}) {
    opts = opts || {};
    if (opts == null || typeof opts !== 'object' || Array.isArray(opts)) {
        opts = {};
    }
    const highWaterMark = verifyNumberProp(opts, 'highWaterMark', 0x100000);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const size = await getSize(inputPath);

    /** @type {{ [Symbol.asyncIterator](): AsyncIterator<Buffer> } & import("fs").ReadStream} */
    const inputStream = createReadStream(inputPath, { flags: 'r', highWaterMark, encoding: undefined });
    const outputStream = createWriteStream(outputPath, { flags: 'w', highWaterMark, encoding: undefined });
    let position = 0;

    try {
        let leftover = Buffer.alloc(0);

        for await (const buf of inputStream) {
            position += buf.length;
            if (onProgress) {
                onProgress(position, size);
            }
            const data = leftover.length > 0 ? Buffer.concat([leftover, buf]) : buf;

            let lastNL = -1;
            let prevWasNL = false;

            for (let i = 0; i < data.length; i++) {
                if (data[i] === 0x0A) { // '\n'
                    // If not immediately after another NL
                    if (!prevWasNL) {
                        data[i] = 0x2C; // replace with ','
                        prevWasNL = true;
                    }
                    lastNL = i;
                    continue;
                }

                // If white space, skip
                if (data[i] === 0x20 || data[i] === 0x09 || data[i] === 0x0D) {
                    continue;
                }

                prevWasNL = false;
            }

            if (lastNL === -1) {
                leftover = data;
                continue;
            }

            const json = `[${data.subarray(0, lastNL).toString('utf-8')}]`;
            const entries = JSON.parse(json);
            const newEntries = [];
            for (const entry of entries) {
                let r = transform(entry);
                if (r instanceof Promise) {
                    r = await r;
                }
                newEntries.push(JSON.stringify(r));
            }
            if (!outputStream.write(newEntries.join('\n') + '\n')) {
                await new Promise((resolve) => outputStream.once('drain', () => resolve(void 0)));
            }

            leftover = data.subarray(lastNL + 1);
        }

        if (leftover.length === 0) {
            return;
        }

        let lastNL = -1;
        let prevWasNL = false;
        for (let i = 0; i < leftover.length; i++) {
            if (leftover[i] === 0x0A) { // '\n'
                // If not immediately after another NL
                if (!prevWasNL) {
                    leftover[i] = 0x2C; // replace with ','
                    prevWasNL = true;
                }
                lastNL = i;
                continue;
            }

            // If white space, skip
            if (leftover[i] === 0x20 || leftover[i] === 0x09 || leftover[i] === 0x0D) {
                continue;
            }

            prevWasNL = false;
        }

        let json;
        if (lastNL === -1) {
            json = `[${leftover.toString('utf-8')}]`;
        } else {
            json = `[${leftover.subarray(0, lastNL).toString('utf-8')}]`;
        }
        const entries = JSON.parse(json);
        const newEntries = [];
        for (const entry of entries) {
            let r = transform(entry);
            if (r instanceof Promise) {
                r = await r;
            }
            newEntries.push(JSON.stringify(r));
        }
        if (newEntries.length > 0) {
            if (!outputStream.write(newEntries.join('\n') + '\n')) {
                await new Promise((resolve) => outputStream.once('drain', () => resolve(void 0)));
            }
        }
    } finally {
        inputStream.destroy();
        await new Promise((resolve) => outputStream.end(() => resolve(void 0)));
    }
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
 * @template T
 * @typedef {T | Promise<T>} MaybePromise
 */

async function main() {
    const inputPathRaw = process.argv[2];
    if (!inputPathRaw) {
        console.error('Please provide the path to the NDJSON file as the first argument.');
        process.exit(1);
    }
    const inputPath = resolve(inputPathRaw);
    let lowPriorityCount = 0;
    let upgradedCount = 0;
    let entryCount = 0;
    const startTS = Date.now();
    let lastUpdateTS = startTS;
    const size = await getSize(inputPath);

    function printProgress(now, pos, size) {
        const elapsed = (now - startTS) / 1000;
        const speed = pos / elapsed;
        const eta = (size - pos) / speed;
        const percent = ((pos / size) * 100).toFixed(2);
        const elapedH = toHumanTime(elapsed);
        const etaH = toHumanTime(eta);
        const posM = (pos / (1024 * 1024)).toFixed(2);
        const totalM = (size / (1024 * 1024)).toFixed(2);
        console.log(`Processed ${entryCount} entries (${percent}%, ${posM}MB/${totalM}MB) in ${elapedH} - Speed: ${(speed / (1024 * 1024)).toFixed(2)} MB/s - ETA: ${etaH}`);
        console.log(`Low priority entries: ${lowPriorityCount}, Upgraded entries: ${upgradedCount}`);
    }

    const base = basename(inputPath);
    const lastDot = base.lastIndexOf('.');
    const outputPath = resolve(
        inputPathRaw, '..',
        `${lastDot === -1 ? base : base.substring(0, lastDot)}.ndjson.${Math.random().toString(36).substring(2, 15)}.tmp`
    );

    /** @type {Record<'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe', Map<string, MinimalFFThread | { error: string }>>} */
    const fetchedThreads = {
        'desuarchive.org': new Map(),
        'arch.b4k.dev': new Map(),
        'archived.moe': new Map()
    }

    /** @type {Map<number, MinimalFFPost>} */
    const downloaded = new Map();

    /**
     * Add a post to the downloaded map, handling duplicates and source priority.
     * 
     * @param {MinimalFFPost} post The post to add.
     * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} [site='desuarchive.org'] The site the post is from.
     */
    function addPost(post, site) {
        site = site || 'desuarchive.org';
        const num = parseInt(post.num, 10);

        const existing = downloaded.get(num);
        if (!existing) {
            downloaded.set(num, post);
            return;
        }

        if (getPriority(site) >= getPriority(existing)) {
            downloaded.set(num, post);
        }
    }

    /**
     * Fetch a post or thread from the specified archive site.
     * 
     * @param {MinimalFFPost | { num: string, exception: string, timestamp: number }} existing The original entry.
     * @param {MinimalFFPost | { num: string, exception: string, timestamp: number } | null} cached The cached entry, if any.
     * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The archive site to fetch from.
     * @returns {Promise<MinimalFFPost | { error: string, details?: string }>} The fetched post or an error object.
     */
    async function fetchPostAndThread(existing, cached, site) {
        let threadNum = ('thread_num' in existing)
            ? existing.thread_num
            : cached && ('thread_num' in cached)
                ? cached.thread_num
                : null;
        /** @type {MinimalFFPost | { error: string, details?: string }} */
        let post = { error: "Post not found." };
        if (!threadNum) {
            console.log(`Fetching post #${existing.num} from ${site}...`)
            const fPost = await fetchPost(existing.num, site).catch((err) => {
                console.warn(`Fetch error for post #${existing.num} from ${site}:`, err);
                return { error: "Fetch error" };
            });
            if ('error' in fPost) {
                return fPost;
            }
            threadNum = fPost.thread_num;
            post = fPost;
            addPost(fPost, site);
        }
        if (!threadNum) {
            return post;
        }
        const alreadyFetched = fetchedThreads[site].get(threadNum);
        if (!alreadyFetched) {
            console.log(`Fetching thread #${threadNum} from ${site}...`);
        }
        const fThread = (!alreadyFetched) ? await fetchThread(threadNum, site).then(r => {
            fetchedThreads[site].set(threadNum, r);
            return r;
        }).catch((err) => {
            console.warn(`Fetch error for thread #${threadNum} from ${site}:`, err);
            return { error: "Fetch error" };
        }) : alreadyFetched;
        if ('error' in fThread) {
            if ('error' in post) {
                console.log(`Fetching post #${existing.num} from ${site}...`)
                const fPost = await fetchPost(existing.num, site).catch((err) => {
                    console.warn(`Fetch error for post #${existing.num} from ${site}:`, err);
                    return { error: "Fetch error" };
                });
                if (!('error' in fPost)) {
                    addPost(fPost, site);
                }
                return fPost;
            }
            return post;
        }
        for (const threadId in fThread) {
            const thread = fThread[threadId];
            if (thread.op) {
                addPost(thread.op, site);
            }
            const posts = thread.posts || {};
            for (const postId in posts) {
                addPost(posts[postId], site);
            }
        }
        const newCached = downloaded.get(parseInt(existing.num, 10));
        if (newCached && !('exception' in newCached)) {
            const newCachedSource = getSource(newCached);
            if (newCachedSource === site) {
                return newCached;
            }
        }
        return post;
    }

    /**
     * Check archives for a post and return the best available version.
     * 
     * @param {number} num The post number.
     * @param {MinimalFFPost | { num: string, exception: string, timestamp: number }} exising The original entry.
     * @param {'arch.b4k.dev' | 'archived.moe' | null} exisingSource The source of the original entry.
     * @param {MinimalFFPost | { num: string, exception: string, timestamp: number } | null} cached The cached entry, if any.
     * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe' | null} cachedSource The source of the cached entry, if any.
     * @returns {Promise<MinimalFFPost | { num: string, exception: string, timestamp: number }>} The best available post.
     */
    async function checkArchives(num, exising, exisingSource, cached, cachedSource) {
        const desuPost = await fetchPostAndThread(exising, cached, 'desuarchive.org');
        if (!('error' in desuPost)) {
            upgradedCount++;
            return desuPost;
        }
        // Not found in desu, if exising is from b4k, return it
        if (exisingSource === 'arch.b4k.dev') {
            return exising;
        }
        // Update cached and its source
        cached = downloaded.get(num) || null;
        cachedSource = (cached && !('exception' in cached)) ? getSource(cached) : null;
        // If desu or b4k appeared/were in cache, use it
        if (cached && (cachedSource === 'desuarchive.org' || cachedSource === 'arch.b4k.dev')) {
            upgradedCount++;
            return cached;
        }
        // Otherwise, try fetching from b4k
        const b4kPost = await fetchPostAndThread(exising, cached, 'arch.b4k.dev');
        if (!('error' in b4kPost)) {
            upgradedCount++;
            return b4kPost;
        }
        // Not found in b4k, if exising is from archived.moe, return it
        if (exisingSource === 'archived.moe') {
            return exising;
        }
        // Update cached and its source
        cached = downloaded.get(num) || null;
        cachedSource = (cached && !('exception' in cached)) ? getSource(cached) : null;
        // If desu, b4k, or archived.moe appeared/were in cache, use it
        if (cached && (cachedSource != null)) {
            upgradedCount++;
            return cached;
        }
        // Otherwise, try fetching from archived.moe
        const archMoePost = await fetchPostAndThread(exising, cached, 'archived.moe');
        if (!('error' in archMoePost)) {
            upgradedCount++;
            return archMoePost;
        }
        // Update cached and its source
        cached = downloaded.get(num) || null;
        cachedSource = (cached && !('exception' in cached)) ? getSource(cached) : null;
        // Last chance: if desu, b4k, or archived.moe appeared/were in cache, use it
        if (cached && (cachedSource != null)) {
            upgradedCount++;
            return cached;
        }
        // All attempts failed, return original
        return exising;
    }

    // Dont upgrade posts older than 2 months
    const upgradeCutoff = Math.round((Date.now() - 5_184_000_000) / 1000);

    await transformNDJSON(
        inputPath, outputPath,
        /** @type {(entry: MinimalFFPost | { num: string, exception: string, timestamp: number }) => MaybePromise<MinimalFFPost | { num: string, exception: string, timestamp: number }>} */
        (existing) => {
            entryCount++;
            /** @type {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe' | null} */
            let existingSource = existing && !('exception' in existing) ? getSource(existing) : null;
            // If already from desuarchive, return as is
            if (existingSource === 'desuarchive.org') {
                return existing;
            }
            lowPriorityCount++;
            const num = parseInt(existing.num, 10);
            // Check cache
            const cached = downloaded.get(num) || null;
            const cachedSource = (cached && !('exception' in cached)) ? getSource(cached) : null;
            // If cached is from desuarchive, return it
            if (cached && cachedSource === 'desuarchive.org') {
                upgradedCount++;
                return cached;
            }
            // If existing post is older than cutoff, skip upgrade
            if (existing.timestamp < upgradeCutoff) {
                return existing;
            }
            // Otherwise, check archives
            return checkArchives(num, existing, existingSource, cached, cachedSource);
        },
        {
            highWaterMark: 0x200000, // 2MB
            onProgress: (pos, size) => {
                const now = Date.now();
                if (now - lastUpdateTS > 2_500) {
                    printProgress(now, pos, size);
                    lastUpdateTS = now;
                }
            }
        }
    );
    printProgress(Date.now(), size, size);
    await rename(outputPath, inputPath);
    console.log("Processing complete.");
}

main().catch((err) => {
    console.error("Error during processing:", err);
    process.exit(1);
}).finally(async () => {
    console.log('Closing CDP fetchers...');
    await closeCDPFetchers();
    console.log('Done.');
});
