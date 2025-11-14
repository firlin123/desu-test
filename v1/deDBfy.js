// @ts-check

/** @typedef {(str: string) => string} DeDBfyFunc */

/** @type {{ 'desuarchive.org'?: DeDBfyFunc, 'arch.b4k.dev'?: DeDBfyFunc, 'archived.moe'?: DeDBfyFunc }} */
const deDBfyCache = {};

/**
 * Since our parser doesn't have access to desuarchive's database, we cant look up what posts
 * belong to what threads. So we replace all thread backlinks with post backlinks for comparison.
 * 
 * @param {string} str The string to de-DBfy.
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to de-DBfy for.
 * @returns {string} The de-DBfied string.
 */
function deDBfy(str, site) {
    let siteDeDBfy = deDBfyCache[site];
    if (!siteDeDBfy) {
        deDBfyCache[site] = siteDeDBfy = getDeDBfy(site);
    }
    return siteDeDBfy(str);
}

/**
 * Create a function to de-DBfy backlinks in a string.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site The site to de-DBfy for.
 * @returns {DeDBfyFunc} The de-DBfy function.
 */
function getDeDBfy(site) {
    const DE_DBFY_REX = new RegExp(
        '<a href="https:\\/\\/'
        + (site === 'desuarchive.org' ? 'desuarchive\\.org' : (site === 'arch.b4k.dev' ? 'arch\\.b4k\\.dev' : 'archived\\.moe'))
        + '\\/([a-z\\d]+)\\/thread\\/\\d+\\/#(\\d+(?:_\\d+)?)" class="backlink(?: op)?" data-function="highlight" data-backlink="true" data-board="\\1" data-post="\\2">', 'g');

    const REPLACE_STR = '<a href="https://'
        + (site === 'desuarchive.org' ? 'desuarchive.org' : (site === 'arch.b4k.dev' ? 'arch.b4k.dev' : 'archived.moe'))
        + '/$1/post/$2/" class="backlink" data-function="highlight" data-backlink="true" data-board="$1" data-post="$2">';

    return function deDBfy(str) {
        return str.replace(DE_DBFY_REX, REPLACE_STR);
    }
}

module.exports = {
    deDBfy
};