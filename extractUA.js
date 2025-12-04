// @ts-check
const { execSync } = require('child_process');

/**
 * Escapes a string for safe use in a shell command.
 * 
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeShell(str) {
    return `'${str.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolves the absolute path of a binary using the 'which' command.
 * 
 * @param {string} binary - The name of the binary to resolve.
 * @returns {string | null} The resolved binary path, or null if not found.
 */
function resolveBinaryPathSync(binary) {
    try {
        const result = execSync(`which ${escapeShell(binary)}`, { encoding: 'utf-8', shell: '/bin/bash' }).trim();
        return result.length > 0 ? result : null;
    } catch {
        return null;
    }
}

/** @type {Map<string, string>} */
const uaCache = new Map();

/**
 * Recursively attempts to extract the User-Agent string with retries.
 * 
 * @param {string} binaryPathEscaped - The escaped path to the browser binary.
 * @param {number} retryCount - The current retry count.
 * @returns {string | null} The extracted User-Agent string, or null if extraction failed.
 */
function extractUASyncRetry(binaryPathEscaped, retryCount) {
    try {
        const output = execSync(`
#!/usr/bin/env bash
set -euo pipefail
        
PORT=$(shuf -i 20000-65000 -n 1)
CHROME_FLAGS=(--headless --remote-debugging-port="$PORT" about:blank)
if [ "$(id -u)" -eq 0 ]; then
    CHROME_FLAGS+=(--no-sandbox)
fi
        
${binaryPathEscaped} "\${CHROME_FLAGS[@]}" >/dev/null 2>&1 &
CHROME_PID=$!
        
cleanup() {
    kill "$CHROME_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
        
END_TIME=$(( $(date +%s) + 10 ))
OUTPUT=""
        
while true; do
    if OUTPUT=$(curl -fsS "http://localhost:$PORT/json/version" 2>/dev/null); then
        echo "$OUTPUT"
        break
    fi
    if [ "$(date +%s)" -ge "$END_TIME" ]; then
        echo "Timed out waiting for Chrome to start" >&2
        exit 1
    fi
    sleep 0.1
done
        `, { encoding: 'utf-8', shell: '/bin/bash' });
        const json = JSON.parse(output);
        const ua = json['User-Agent'];
        if (typeof ua !== 'string' || ua.length === 0) {
            throw new Error('User-Agent not found in JSON output');
        }
        return ua.replace('Headless', '');
    } catch (error) {
        console.warn(`Failed to extract User-Agent (${retryCount}/5): ${error.message}`);
        console.log('Retrying in 1 second...');
        try { execSync('sleep 1', { shell: '/bin/bash' }); } catch { /* ignore */ }
        if (retryCount > 5) {
            return null;
        }
        return extractUASyncRetry(binaryPathEscaped, retryCount + 1);
    }
}

/**
 * Extracts the User-Agent string, using caching to avoid redundant extraction.
 * 
 * @param {string} [binary='google-chrome'] - The name or path of the browser binary.
 * @returns {string | null} The extracted User-Agent string, or null if extraction failed.
 */
function extractUASync(binary = 'google-chrome') {
    if (typeof binary !== 'string') {
        throw new TypeError('Binary must be a string');
    }
    if (binary == null) {
        binary = 'google-chrome';
    }
    const resolvedPath = resolveBinaryPathSync(binary);
    if (!resolvedPath) {
        console.warn(`Could not resolve binary path: ${binary}`);
        return null;
    }
    const binaryPathEscaped = escapeShell(resolvedPath);
    const cached = uaCache.get(binaryPathEscaped);
    if (cached) {
        return cached;
    }
    const ua = extractUASyncRetry(binaryPathEscaped, 0);
    if (ua != null) {
        uaCache.set(binaryPathEscaped, ua);
    }
    return ua;
}

module.exports = {
    extractUASync
};