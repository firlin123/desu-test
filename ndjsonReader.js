// @ts-check
const { createReadStream } = require('fs');

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
 * @typedef ReadNDJSONOptions
 * @property {number} [highWaterMark] - The chunk size to read from the file (default 1MB).
 * @property {number} [start] - The starting byte position to read from.
 * @property {number} [end] - The ending byte position to read to.
 * @property {(position: number) => void} [onProgress] - Callback invoked with the current read position.
 */

/**
 * Reads an NDJSON (Newline Delimited JSON) file, invoking a callback for each entry.
 * 
 * @param {string} filePath - The path to the NDJSON file.
 * @param {(entry: any) => (void | boolean | Promise<void | boolean>)} onEntry - Callback invoked for each JSON entry. If it returns true, reading stops.
 * @param {ReadNDJSONOptions} [opts={}] - Options for reading the file.
 */
async function readNDJSON(filePath, onEntry, opts = {}) {
    opts = opts || {};
    if (opts == null || typeof opts !== 'object' || Array.isArray(opts)) {
        opts = {};
    }
    const highWaterMark = verifyNumberProp(opts, 'highWaterMark', 0x100000);
    const start = verifyNumberProp(opts, 'start', 0);
    const endRaw = verifyNumberProp(opts, 'end', -1);
    const end = endRaw === -1 ? undefined : endRaw;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    let position = start;
    /** @type {{ [Symbol.asyncIterator](): AsyncIterator<Buffer> } & import("fs").ReadStream} */
    const stream = createReadStream(filePath, { flags: 'r', highWaterMark, start, end, encoding: undefined });
    try {
        let leftover = Buffer.alloc(0);
        let stop = false;

        for await (const buf of stream) {
            position += buf.length;
            if (onProgress) {
                onProgress(position);
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
            for (const entry of entries) {
                let r = onEntry(entry);
                if (r instanceof Promise) {
                    r = await r;
                }
                if (r) {
                    stop = true;
                    break;
                }
            }

            if (stop) {
                // Will trigger `finally` block
                return;
            }

            leftover = data.subarray(lastNL + 1);
        }

        if (stop || leftover.length === 0) {
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

        for (const entry of entries) {
            let r = onEntry(entry);
            if (r instanceof Promise) {
                r = await r;
            }
            if (r) {
                break;
            }
        }
    } finally {
        stream.destroy();
    }
}

module.exports = {
    readNDJSON
};