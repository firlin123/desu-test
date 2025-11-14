// @ts-check
const { existsSync, statSync } = require("fs");
const { writeFile, appendFile } = require("fs/promises");
const { readNDJSON } = require("./ndjsonReader");
const { deDBfy } = require("./v1/deDBfy");

const USAGE = "Usage: node spliceMissing.js <input.ndjson> <output.ndjson> <splice.ndjson> <archived.moe|arch.b4k.dev>";
const INPUT_PATH = getArg(0, "Input file path is required.\n" + USAGE);
const OUTPUT_PATH = getArg(1, "Output file path is required.\n" + USAGE);
const SPLICE_PATH = getArg(2, "Splice file path is required.\n" + USAGE);
const ARCHIVE = getArg(3, "Archive identifier is required (either 'archived.moe' or 'arch.b4k.dev').\n" + USAGE);
if (!existsSync(INPUT_PATH) || !existsSync(SPLICE_PATH)) {
    console.error("Input or splice file does not exist.\n" + USAGE);
    process.exit(1);
}
if (ARCHIVE !== "archived.moe" && ARCHIVE !== "arch.b4k.dev") {
    console.error("Archive must be either 'archived.moe' or 'arch.b4k.dev'.\n" + USAGE);
    process.exit(1);
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
 * Get command line argument.
 * 
 * @param {number} index The argument index.
 * @param {string} err The error message if argument is missing.
 * @returns {string} The argument value.
 */
function getArg(index, err) {
    const argPos = 2 + index;
    const arg = process.argv[argPos];
    if (!arg) {
        console.error(err);
        process.exit(1);
    }
    return arg;
}

async function main() {
    /** @type {Map<string, object>} */
    const toSplice = new Map();

    console.log("Reading splice file...");
    await readNDJSON(SPLICE_PATH, (obj) => {
        if (!obj || 'exception' in obj) {
            return;
        }

        let extraData = obj.extra_data || [];
        const source = { source: ARCHIVE };
        if (!Array.isArray(extraData)) {
            console.warn('Unexpected extra_data format, overwriting:', extraData);
            source.extra_data = extraData;
            extraData = [];
        }
        extraData.push(source);
        obj.extra_data = extraData;
        toSplice.set(obj.num, obj);
    });
    console.log(`Loaded ${toSplice.size} entries to splice.`);

    const out = [];

    async function flushOut() {
        if (out.length === 0) {
            return;
        }
        const toApp = out.splice(0, out.length);
        const buf = Buffer.from(toApp.join(''), 'utf-8');
        await appendFile(OUTPUT_PATH, buf);
        console.log(`Flushed ${toApp.length} entries (${(buf.length / (1024 * 1024)).toFixed(2)} MB) to output file.`);
    }

    function addOut(obj) {
        out.push(JSON.stringify(obj) + '\n');
        if (out.length >= 200_000) {
            return flushOut();
        }
    }

    let deDBfied = 0;
    let changed = 0;
    let startTS = Date.now();
    let lastUpdateTS = startTS;
    let bytesRead = 0;
    let entryCount = 0;
    const bytesTotal = statSync(INPUT_PATH).size;

    if (existsSync(OUTPUT_PATH)) {
        console.log("Output file exists, truncating...");
        await writeFile(OUTPUT_PATH, '');
    }

    console.log("Processing input file...");
    await readNDJSON(INPUT_PATH, (obj) => {
        entryCount++;
        if (obj && 'exception' in obj) {
            const spl = toSplice.get(obj.num);
            if (spl) {
                obj = spl;
            }
        }
        if (obj && !('exception' in obj)) {
            /** @type {Array<any>} */
            let extraData = obj.extra_data || [];
            if (!Array.isArray(extraData)) {
                console.warn('Unexpected extra_data format: ', extraData);
                extraData = [];
            }
            /** @type {any} */
            const sourceObj = extraData.length > 0 ? extraData[extraData.length - 1] : { source: '' };
            let source = sourceObj?.source;
            if (source !== '' && source !== 'archived.moe' && source !== 'arch.b4k.dev') {
                source = '';
                console.warn('Unexpected source value: ', sourceObj);
            }
            const commentProcessed = obj.comment_processed;
            if (typeof commentProcessed === 'string' && source !== '') {
                obj.comment_processed = deDBfy(commentProcessed, source);
                deDBfied++;
                if (obj.comment_processed !== commentProcessed) {
                    changed++;
                }
            }
        }

        return addOut(obj);
    }, {
        onProgress: (pos) => {
            const now = Date.now();
            if (now - lastUpdateTS > 2_500) {
                bytesRead = pos;
                const elapsed = (now - startTS) / 1000;
                const speed = bytesRead / elapsed;
                const eta = (bytesTotal - bytesRead) / speed;
                const percent = ((bytesRead / bytesTotal) * 100).toFixed(2);
                const elapedH = toHumanTime(elapsed);
                const etaH = toHumanTime(eta);
                const posM = (bytesRead / (1024 * 1024)).toFixed(2);
                const totalM = (bytesTotal / (1024 * 1024)).toFixed(2);
                console.log(`Processed ${entryCount} entries (${percent}%, ${posM}MB/${totalM}MB) in ${elapedH} - Speed: ${(speed / (1024 * 1024)).toFixed(2)} MB/s - ETA: ${etaH}`);
                console.log(`DeDBfied comments: ${deDBfied}, Changed comments: ${changed}`);
                lastUpdateTS = now;
            }
        }
    });
    await flushOut();
    console.log("Processing complete.");
    console.log(`Total entries processed: ${entryCount}`);
    console.log(`Total DeDBfied comments: ${deDBfied}`);
    console.log(`Total Changed comments: ${changed}`);
    const totElapsed = (Date.now() - startTS) / 1000;
    console.log(`Total time: ${toHumanTime(totElapsed)} - Average speed: ${(bytesRead / totElapsed / (1024 * 1024)).toFixed(2)} MB/s`);
}

main().catch((err) => {
    console.error("Error during processing:", err);
    process.exit(1);
});