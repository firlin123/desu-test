// @ts-check
const CDP = require("chrome-remote-interface");
const { mkdtempSync, rmSync, existsSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");
const { spawn } = require("child_process");
const { extractUASync } = require("./extractUA");

/** @typedef {(request: Request) => Promise<Response>} CDPFetcher */

const INTERACTIVE = process.env.CDP_FETCHER_INTERACTIVE === "1";
let ADDITIONAL_CHROME_ARGS_RAW = [];
if (process.env.CDP_FETCHER_ADDITIONAL_CHROME_ARGS) {
    let args = [];
    try {
        args = JSON.parse(process.env.CDP_FETCHER_ADDITIONAL_CHROME_ARGS);
        if (typeof args === 'string') {
            args = [args];
        }
        if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
            console.warn("CDP_FETCHER_ADDITIONAL_CHROME_ARGS is not a valid JSON array of strings, ignoring.");
            args = [];
        }
    } catch (e) {
        console.warn("Failed to parse CDP_FETCHER_ADDITIONAL_CHROME_ARGS, ignoring.", e);
        args = [];
    }
    ADDITIONAL_CHROME_ARGS_RAW = args;
}
const ADDITIONAL_CHROME_ARGS = ADDITIONAL_CHROME_ARGS_RAW;


const TARGET_URL = "https://archived.moe/fetcher";
const CUSTOM_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Custom Response</title>
</head>
<body>
    <script>
        const INTERACTIVE = ${INTERACTIVE};
        ${pageScript.toString().slice(13 + pageScript.name.length, -1)}
    </script>
</body>
</html>
`;

/**
 * @typedef {Object} ResultObject
 * @property {number} status - The HTTP status code.
 * @property {string} data - The response data as a Base64 encoded string.
 */

/**
 * @typedef {Object} ResultMessage
 * @property {number} id - The message ID.
 * @property {ResultObject} result - The result object.
 */

/**
 * @typedef {Object} ErrorMessage
 * @property {number} id - The message ID.
 * @property {string} error - The error message.
 */

/**
 * @typedef {Object} LogMessage
 * @property {{ level: 'info' | 'warn' | 'error', args: any[] }} log - The log object.
 */

/** @typedef {ResultMessage | ErrorMessage | LogMessage} PageMessage */

/**
 * @typedef {Object} NodeMessage
 * @property {number} id - The message ID.
 * @property {string} input - The input URL.
 * @property {RequestInit} init - The fetch request initialization options.
 */

function pageScript() {
    /**
     * @typedef {Object} FetchResult
     * @property {number} status - The HTTP status code.
     * @property {ArrayBuffer} data - The response data as an ArrayBuffer.
     */

    /** @type {typeof window & { nodeBridgeSend: (msg: string) => void }} */
    const bridgeWindow = /** @type {any} */ (window);
    const nodeBridge = {
        /**
         * Sends a message to the Node.js.
         * 
         * @param {PageMessage} msg - The message to send.
         */
        send: (msg) => {
            bridgeWindow.nodeBridgeSend(JSON.stringify(msg));
        },
        /**
         * Receives a message from the Node.js.
         * 
         * @param {NodeMessage} msg - The received message.
         */
        receive: (msg) => {
            if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number' || typeof msg.input !== 'string' || typeof msg.init !== 'object') {
                bridgeLog("warn", "Invalid message received:", msg);
                return;
            }
            performFetch(msg.input, msg.init).then((result) => {
                const dataBase64 = toBase64(result.data);
                nodeBridge.send({ id: msg.id, result: { status: result.status, data: dataBase64 } });
            }).catch((error) => {
                let msgStr = "Unknown error";
                if (error && typeof error.message === 'string') {
                    msgStr = error.message;
                } else {
                    try {
                        msgStr = String(error);
                    } catch (_) { }
                }
                nodeBridge.send({ id: msg.id, error: msgStr });
            });
        }
    };

    /**
     * Converts an ArrayBuffer to a Base64 string.
     * 
     * @param {ArrayBuffer} arrayBuffer - The input ArrayBuffer.
     * @returns {string} The Base64 encoded string.
     */
    function toBase64(arrayBuffer) {
        let binary = [];
        const bytes = new Uint8Array(arrayBuffer);
        for (let i = 0; i < bytes.byteLength; i += 0x1000) {
            binary.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x1000, bytes.byteLength))));
        }
        return btoa(binary.join(''));
    }

    /**
     * Sends a log message to the Node.js.
     * 
     * @param {'info' | 'warn' | 'error'} level - The log level.
     * @param {...any} args - The log arguments.
     */
    function bridgeLog(level, ...args) {
        nodeBridge.send({ log: { level, args } });
    }

    window.onerror = (event) => {
        if (!event) {
            event = "Unknown error";
        }
        event = event.toString();
        bridgeLog("error", "Error on page:", event);
    }

    /**
     * Performs a fetch request and handles CAPTCHA challenges if necessary.
     * 
     * @param {string} input - The input URL.
     * @param {RequestInit} init - The fetch request initialization options.
     * @returns {Promise<FetchResult>} The fetch result.
     */
    async function performFetch(input, init) {
        const response = await fetch(input, init);
        const result = { status: response.status, data: await response.arrayBuffer() };
        if (response.ok || response.status !== 403) {
            return result;
        }
        if (!INTERACTIVE) {
            bridgeLog("warn", "Fetch failed with status", response.status, "and INTERACTIVE mode is off, not attempting CAPTCHA solving.");
            return result;
        }
        bridgeLog("info", "Fetch failed with status", response.status, "attempting CAPTCHA solving...");
        return await trySolveCaptcha(input);
    }

    /** @type {((value: FetchResult) => void)[]} */
    const captchaResolves = [];

    /**
     * Attempts to solve a CAPTCHA challenge by displaying an iframe for user interaction.
     * 
     * @param {string} url - The URL to load for CAPTCHA solving.
     * @returns {Promise<FetchResult>} The fetch result after CAPTCHA solving.
     */
    async function trySolveCaptcha(url) {
        /** @type {((value: { status: number, data: ArrayBuffer }) => void) | null} */
        let res = null;
        return new Promise((resolve) => {
            captchaResolves.push(resolve);
            res = resolve;
            trySolveCaptchaReal(url, resolve);
        }).then((result) => {
            const idx = res ? captchaResolves.indexOf(res) : -1;
            if (idx !== -1) {
                captchaResolves.splice(idx, 1);
            }
            return result;
        });
    }

    /**
     * Converts a string to an ArrayBuffer.
     * 
     * @param {string} str - The input string.
     * @returns {ArrayBuffer} The resulting ArrayBuffer.
     */
    function stringToArrayBuffer(str) {
        const encoder = new TextEncoder();
        return encoder.encode(str).buffer;
    }

    /**
     * Real implementation of CAPTCHA solving using an iframe.
     * 
     * @param {string} url - The URL to load for CAPTCHA solving.
     * @param {(value: FetchResult) => void} resolve - The resolve function for the fetch result.
     */
    function trySolveCaptchaReal(url, resolve) {
        const captchaDiv = document.createElement("div");
        captchaDiv.style.position = "fixed";
        captchaDiv.style.inset = "0";
        captchaDiv.style.display = "flex";
        captchaDiv.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        captchaDiv.style.zIndex = "10000";
        const captchaGiveUpButton = document.createElement("button");
        captchaGiveUpButton.textContent = "Give Up";
        captchaDiv.appendChild(captchaGiveUpButton);
        const captchaFrame = document.createElement("iframe");
        captchaFrame.src = url;
        captchaFrame.style.flex = "1";
        captchaDiv.appendChild(captchaFrame);
        captchaGiveUpButton.onclick = () => {
            captchaDiv.remove();
            clearInterval(checkInterval);
            bridgeLog("info", "User gave up on CAPTCHA solving.");
            const txt = getIframeText().trim();
            resolve({ status: 403, data: stringToArrayBuffer(txt ? txt : "CAPTCHA not solved") });
        };

        /**
         * Retrieves the inner text of the iframe document.
         * 
         * @returns {string} The inner text of the iframe document.
         */
        function getIframeText() {
            try {
                const iframeDoc = captchaFrame.contentDocument || captchaFrame.contentWindow?.document;
                return iframeDoc?.body.innerText || "";
            } catch {
                return '';
            }
        }

        const checkInterval = setInterval(() => {
            const txt = getIframeText().trim();
            if (!txt) {
                return;
            }
            if (txt.startsWith("{") && txt.endsWith("}")) {
                try {
                    JSON.parse(txt);
                    captchaDiv.remove();
                    clearInterval(checkInterval);
                    resolve({ status: 200, data: stringToArrayBuffer(txt) });
                } catch {
                    // Not valid JSON yet, continue waiting
                }
                return;
            }
            if (txt.match(/^Access denied \| ((?:\w+\.)+\w+) used Cloudflare to restrict access \| \1 \| Cloudflare/)) {
                // Rate limited, wait 10 seconds and reload
                console.warn("Rate limited by Cloudflare, waiting 10 seconds before retrying...");
                clearInterval(checkInterval);
                setTimeout(() => {
                    captchaDiv.remove();
                    trySolveCaptchaReal(url, resolve);
                }, 10000);
                return;
            }
            if (txt.match(/^(?:(?:\w+\.)+\w+) \| 504: Gateway time-out/)) {
                // Overloaded, wait 5 seconds and reload
                console.warn("Gateway timeout, waiting 5 seconds before retrying...");
                clearInterval(checkInterval);
                setTimeout(() => {
                    captchaDiv.remove();
                    trySolveCaptchaReal(url, resolve);
                }, 5000);
            }
        }, 100);

        document.body.innerHTML = "";
        document.body.appendChild(captchaDiv);
    }
}

/**
 * Waits for the Chrome DevTools Protocol debugger to be available.
 * 
 * @param {number} port - The debugging port.
 * @param {number} timeout - The timeout in milliseconds.
 * @returns {Promise<void>} A promise that resolves when the debugger is available.
 */
async function waitForDebugger(port, timeout) {
    const expiry = Date.now() + timeout;
    while (Date.now() < expiry) {
        try {
            await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => {
                if (r.ok) return r.json();
                throw new Error("Port not open yet");
            }).then((r) => {
                if (r && r.length) {
                    return true;
                }
                throw new Error("No targets available yet");
            });
            return;
        } catch (e) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("Timed out waiting for debugger to be available");
}

let dontReinit = false;
/** @type {Promise<CDPFetcher | null> | null} */
let cdpInitPromise = null;
/** @type {CDPFetcher | null} */
let currentCDPFetcher = null;
/** @type {Promise<void>[]} */
const cleanupPromises = [];
/** @type {Array<(doReinit?: boolean) => null>} */
const cleanups = [];

/**
 * Ensures that a process is killed.
 * 
 * @param {import("child_process").ChildProcess | null} proc - The process to kill.
 * @param {() => void} onDone - Callback when done.
 */
function sureKillProcess(proc, onDone) {
    if (!proc || !proc.pid || proc.killed || proc.exitCode !== null) {
        onDone();
        return;
    }
    const p = proc;
    p.kill("SIGTERM");
    const timeout = setTimeout(() => {
        p.kill("SIGKILL");
    }, 5000);
    p.once("exit", () => {
        clearTimeout(timeout);
        onDone();
    });
    p.on("error", () => {
        console.error("Error while killing process:", p.pid);
    });
}

/**
 * Handles promise errors by logging and returning a boolean.
 * 
 * @param {Promise<any>} promise - The promise to handle.
 * @param {string} msg - The error message to log.
 * @returns {Promise<boolean>} A promise that resolves to true if there was an error, false otherwise.
 */
function promiseErr(promise, msg) {
    return promise.then(() => false).catch(err => {
        console.error(msg, err);
        return true;
    });
}

/**
 * Initializes the CDP fetcher by launching Chrome and setting up request interception.
 * 
 * @returns {Promise<CDPFetcher | null>} A promise that resolves to the CDP fetcher or null on failure.
 */
async function initCDPFetcher() {
    // Wait for any ongoing cleanup to finish
    while (cleanupPromises.length > 0) {
        await Promise.all(cleanupPromises.slice());
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const DATA_DIR = mkdtempSync(join(tmpdir(), "cdp-fetcher-chrome-"));
    const DEBUG_PORT = 9224;
    /** @type {import("child_process").ChildProcess | null} */
    let chromeProc = null;
    /** @type {import("chrome-remote-interface").Client | null} */
    let clientObj = null;
    let cleanedUp = false;
    cleanups.push(cleanup);

    /**
     * Cleans up resources on exit.
     * 
     * @returns {null}
     */
    function cleanup(doReinit = false) {
        if (!doReinit) {
            dontReinit = true;
        }

        if (cleanedUp) {
            return null;
        }
        cleanedUp = true;
        const cleanupIdx = cleanups.indexOf(cleanup);
        if (cleanupIdx !== -1) {
            cleanups.splice(cleanupIdx, 1);
        }
        // Clear current fetcher if it's this one
        if (currentCDPFetcher === cdpFetcher) {
            currentCDPFetcher = null;
        }

        const cleanupPromise = Promise.all([
            new Promise((resolve) => sureKillProcess(chromeProc, () => resolve(void 0))),
            new Promise(async (resolve) => {
                if (!clientObj) { return resolve(void 0); }
                try {
                    await clientObj.close();
                }
                catch (_) { }
                resolve(void 0);
            })
        ]).then(() => {
            if (existsSync(DATA_DIR)) {
                console.log("Cleaning up temporary Chrome data directory:", DATA_DIR);
                try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {
                    console.warn("Failed to remove temporary Chrome data directory:", e);
                }
            }
        });

        cleanupPromises.push(cleanupPromise);
        cleanupPromise.then(() => {
            const idx = cleanupPromises.indexOf(cleanupPromise);
            if (idx !== -1) {
                cleanupPromises.splice(idx, 1);
            }
        });

        currentCDPFetcher = null;
        cdpInitPromise = null;

        return null;
    }

    console.log("Extracting User-Agent string...");
    const chromeBinary = process.env.CHROME_BINARY || "google-chrome";
    const ua = extractUASync(chromeBinary);
    const chromeArgs = [
        ...(INTERACTIVE ? [] : ["--headless"]),
        ...(ua ? ["--user-agent=" + ua] : []),
        ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : []),
        "--remote-debugging-port=" + DEBUG_PORT,
        "--user-data-dir=" + DATA_DIR,
        "--no-first-run",
        "--no-default-browser-check",
        ...ADDITIONAL_CHROME_ARGS,
        "about:blank",
    ];
    console.log("Launching Chrome with args:", chromeArgs.join(" "));
    const chrome = spawn(chromeBinary, chromeArgs, { stdio: "ignore" });
    chromeProc = chrome;

    chrome.on("exit", (code) => {
        console.log("Chrome exited with code:", code);
        if (code === 0) {
            // User closed Chrome normally, allow re-initialization
            cleanup(true);
        }
        cleanup();
    });
    chrome.on("error", (err) => {
        console.error("Failed to launch Chrome:", err);
        cleanup();
    });

    if (!chrome || !chrome.pid || cleanedUp) {
        return cleanup();
    }
    console.log(`Launched Chrome with PID: ${chrome.pid}`);
    console.log("Waiting for Chrome debugger to be available...");
    if (await promiseErr(waitForDebugger(DEBUG_PORT, 10_000), "Timed out waiting for Chrome debugger to be available:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }
    console.log("Connecting to Chrome DevTools Protocol...");
    const clientRaw = await CDP({
        port: DEBUG_PORT, host: "127.0.0.1", target: (targets) => {
            // Find about:blank target
            const aboutBlank = targets.find((target) => target.url === "about:blank");
            if (!aboutBlank) {
                // Find any page target
                const pageTarget = targets.find((target) => target.type === "page");
                if (pageTarget) {
                    return pageTarget;
                }
                throw new Error("No suitable target found in Chrome DevTools Protocol");
            }
            return aboutBlank;
        }
    }).catch((err) => {
        console.error("Failed to connect to Chrome DevTools Protocol:", err);
        return null;
    });
    if (!clientRaw) {
        return cleanup();
    }
    const client = clientRaw;
    clientObj = client;
    if (cleanedUp) {
        return null;
    }

    const { Fetch, Page, Runtime } = client;
    console.log("Enabling Fetch domain for request interception...");
    if (await promiseErr(Fetch.enable({
        patterns: [
            {
                urlPattern: TARGET_URL,
                requestStage: "Request",
            },
        ],
    }), "Failed to enable Fetch domain:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }

    Fetch.requestPaused(async ({ requestId, request }) => {
        console.log("Intercepted request to:", request.url);
        if (request.url !== TARGET_URL) {
            await Fetch.continueRequest({ requestId }).catch((err) => {
                console.error("Failed to continue request:", err);
            });
            return;
        }
        await Fetch.fulfillRequest({
            requestId,
            responseCode: 200,
            responseHeaders: [
                { name: "Content-Type", value: "text/html; charset=utf-8" },
            ],
            body: Buffer.from(CUSTOM_BODY).toString("base64"),
        }).catch((err) => {
            console.error("Failed to fulfill request:", err);
        });
    });

    console.log("Enabling Page domain...");
    if (await promiseErr(Page.enable(), "Failed to enable Page domain:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }
    console.log("Enabling Runtime domain...");
    if (await promiseErr(Runtime.enable(), "Failed to enable Runtime domain:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }
    console.log("Adding Runtime binding for nodeBridgeSend...");
    if (await promiseErr(Runtime.addBinding({ name: "nodeBridgeSend" }), "Failed to add Runtime binding:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }

    /**
     * Sends a message to the page context.
     * 
     * @param {NodeMessage} msg - The message to send.
     */
    function sendMessage(msg) {
        Runtime.evaluate({
            expression: `nodeBridge.receive(${JSON.stringify(msg)});`,
        }).then(() => { }).catch((error) => {
            console.error("Failed to send message to page context:", error);
        });
    }

    /**
     * @typedef {Object} FetchResult
     * @property {number} status - The HTTP status code.
     * @property {Buffer} data - The response data as a Buffer.
     */

    let nextId = 1;
    /** @type {Map<number, { resolve: (value: FetchResult) => void; reject: (reason?: any) => void }>} */
    const pendingRequests = new Map();

    /**
     * CDP fetcher function that sends fetch requests via the page context.
     * 
     * @param {Request} request - The Request object to fetch.
     * @returns {Promise<Response>} A promise that resolves to the fetch Response.
     */
    async function cdpFetcher(request) {
        if (cleanedUp) {
            console.warn("[DEBUG] CDP fetcher called after cleanup. This should not happen. Falling back to direct fetch.");
            return fetch(request);
        }
        const input = request.url;
        /** @type { RequestInit } */
        const init = {
            method: request.method,
            headers: Object.fromEntries(request.headers),
            body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : undefined,
            redirect: request.redirect,
            credentials: request.credentials,
        };
        /** @type {FetchResult} */
        const resultRaw = await new Promise((resolve, reject) => {
            if (cleanedUp) {
                reject(new Error("CDP Fetcher has been cleaned up"));
                return;
            }
            const id = nextId++;
            pendingRequests.set(id, { resolve, reject });
            sendMessage({ id, input, init });
        });
        return new Response(resultRaw.data, { status: resultRaw.status });
    }

    Runtime.bindingCalled(({ name, payload, executionContextId }) => {
        if (name !== "nodeBridgeSend") {
            console.warn("Unknown binding called:", name);
            return;
        }
        /** @type {PageMessage} */
        const msg = JSON.parse(payload);
        if ('log' in msg) {
            if (!msg.log || typeof msg.log !== 'object' || typeof msg.log.level !== 'string' || !Array.isArray(msg.log.args)) {
                console.warn("Invalid log message received:", msg);
                return;
            }
            const { level, args } = msg.log;
            const log = typeof console[level] === 'function' ? console[level] : console.log;
            log.apply(console, args);
            return;
        }
        const pending = pendingRequests.get(msg.id);
        if (!pending) {
            console.warn("No pending request for message ID:", msg.id);
            return;
        }
        if ('error' in msg) {
            pendingRequests.delete(msg.id);
            pending.reject(new Error(msg.error));
        } else {
            if (!msg.result || typeof msg.result.status !== 'number' || typeof msg.result.data !== 'string') {
                console.warn("Invalid result message received:", msg);
                return;
            }
            /** @type {Buffer | null} */
            let dataBuffer = null;
            try {
                dataBuffer = Buffer.from(msg.result.data, 'base64');
            } catch (e) {
                console.warn("Failed to decode Base64 data:", e);
                return;
            }
            pendingRequests.delete(msg.id);
            pending.resolve({ status: msg.result.status, data: dataBuffer });
        }
    });

    console.log("Navigating to target URL:", TARGET_URL);
    if (await promiseErr(Page.navigate({ url: TARGET_URL }), "Failed to navigate to target URL:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }
    console.log("Waiting for page load event...");
    if (await promiseErr(Page.loadEventFired(), "Failed to wait for page load event:")) {
        return cleanup();
    }
    if (cleanedUp) {
        return null;
    }

    return cdpFetcher;
}

/**
 * Gets the CDP fetcher, initializing it if necessary.
 * 
 * @returns {Promise<CDPFetcher | null>} A promise that resolves to the CDP fetcher or null.
 */
async function getCDPFetcher() {
    if (currentCDPFetcher) {
        return currentCDPFetcher;
    }
    if (cdpInitPromise) {
        return cdpInitPromise;
    }
    if (dontReinit) {
        return null;
    }
    const initPromise = initCDPFetcher().then((fetcher) => {
        currentCDPFetcher = fetcher;
        cdpInitPromise = null;
        return fetcher;
    });
    cdpInitPromise = initPromise;
    return initPromise;
}

let prevDirect403 = false;

/**
 * Fetch function that uses CDP to bypass restrictions on archived.moe.
 * 
 * @overload
 * @param {string | URL | Request} input - The input URL or Request object.
 * @param {RequestInit} [init] - The fetch request initialization options.
 * @returns {Promise<Response>} A promise that resolves to the fetch Response.
 */
/**
 * Fetch function that uses CDP to bypass restrictions on archived.moe.
 * 
 * @overload
 * @param {URL | Request} input - The input URL or Request object.
 * @param {RequestInit} [init] - The fetch request initialization options.
 * @returns {Promise<Response>} A promise that resolves to the fetch Response.
 */
/**
 * Fetch function that uses CDP to bypass restrictions on archived.moe.
 * 
 * @param {string | URL | Request} input - The input URL or Request object.
 * @param {RequestInit} [init] - The fetch request initialization options.
 * @returns {Promise<Response>} A promise that resolves to the fetch Response.
 */
async function cdpFetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "archived.moe") {
        return fetch(request);
    }
    // If the previous direct fetch resulted in a 403 and we have a CDP fetcher, use it right away
    if (prevDirect403 && currentCDPFetcher) {
        return currentCDPFetcher(request);
    }
    const response = await fetch(request);
    if (response.ok || response.status !== 403) {
        prevDirect403 = false;
        return response;
    }
    let initMessages = false;
    if (!prevDirect403) {
        prevDirect403 = true;
        initMessages = true;
        console.log("Initial fetch failed with status", response.status, "using CDP fetcher...");
    }
    const cdpFetcher = await getCDPFetcher();
    if (!cdpFetcher) {
        if (initMessages) {
            console.warn("CDP fetcher not available, returning original response.");
        }
        return response;
    }
    return cdpFetcher(request);
}

/**
 * Closes all CDP fetchers and cleans up resources.
 * 
 * @returns {Promise<void>} A promise that resolves when all fetchers are closed.
 */
async function closeCDPFetchers() {
    while (cleanupPromises.length > 0) {
        await Promise.all(cleanupPromises);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (cleanups.length === 0) {
        return;
    }
    for (const cleanup of cleanups.slice()) {
        cleanup(true);
    }
    // Repeat until all cleanups and their promises are done
    return closeCDPFetchers();
}

module.exports = {
    cdpFetch,
    closeCDPFetchers,
};
