// @ts-check

/**
 * @typedef {Object} Tag - A parsed tag.
 * @property {number} openStartI - The start index of the opening tag.
 * @property {number} openEndI - The end index of the opening tag.
 * @property {number} closeStartI - The start index of the closing tag.
 * @property {number} closeEndI - The end index of the closing tag.
 * @property {string} name - The name of the tag.
 * @property {{ [k: string]: string }} args - The named arguments of the tag.
 * @property {Array<Tag | string>} content - The content inside the tag.
 * @property {Tag | null} parent - The parent tag, or null if top-level.
 */

/**
 * @typedef {Object} PTag - A partially parsed tag.
 * @property {number} startI - The start index of the tag.
 * @property {number} endI - The end index of the tag.
 * @property {number} nameStartI - The start index of the tag name.
 * @property {number} nameEndI - The end index of the tag name.
 * @property {boolean} closing - Whether the tag is a closing tag.
 * @property {string} name - The name of the tag.
 * @property {Array<PArg>} args - The arguments of the tag.
 */

/**
 * @typedef {Object} PArg - A partially parsed argument.
 * @property {number} nameStartI - The start index of the argument name.
 * @property {number} nameEndI - The end index of the argument name.
 * @property {string} name - The name of the argument.
 * @property {number} valueStartI - The start index of the argument value.
 * @property {number} valueEndI - The end index of the argument value.
 * @property {string} value - The value of the argument.
 * @property {boolean} quoted - Whether the argument value is quoted.
 */

/**
 * Unescapes a quoted argument value.
 * 
 * @param {string} str - The string to unescape.
 * @returns {string} - The unescaped string.
 */
function argUnescape(str) {
    return str.replace(/\\(["\\])/g, '$1');
}

/**
 * @typedef {Object} ArgDef
 * @property {string} name - The name of the argument.
 * @property {boolean} [required] - Whether the argument is required.
 */

/**
 * @typedef {Object} TagDef
 * @property {string} name - The name of the tag.
 * @property {Array<ArgDef | string>} [args] - The definitions of the tag's arguments.
 */

/**
 * @typedef {Object} ArgDefLC
 * @property {string} name - Original name of the argument.
 * @property {boolean} required - Whether the argument is required.
 */

/**
 * @typedef {Object} TagDefLC
 * @property {string} name - Original name of the tag.
 * @property {Map<string, ArgDefLC>} args - The definitions of the tag's arguments in lowercase.
 */

/** @type {WeakMap<Array<TagDef | string>, Map<string, TagDefLC>>} */
const lcCache = new WeakMap();

/**
 * Verifies and builds a lowercase map of tag definitions.
 * 
 * @param {Array<TagDef | string>} tagDefs - The array of tag definitions.
 * @param {boolean} [resetCache=false] - Whether to reset the cache.
 * @returns {Map<string, TagDefLC>} - The map of tag definitions in lowercase.
 */
function verifyAndBuildLC(tagDefs, resetCache = false) {
    if (!resetCache) {
        const cached = lcCache.get(tagDefs);
        if (cached) {
            return cached;
        }
    }

    if (!Array.isArray(tagDefs)) {
        throw new Error('tagDefs must be an array');
    }

    /** @type {Array<TagDef | string>} */
    const verifiedTagDefs = [];
    for (const tag of tagDefs) {
        if (typeof tag === 'string') {
            verifiedTagDefs.push(tag);
            continue;
        }
        if (tag == null || typeof tag !== 'object' || typeof tag.name !== 'string') {
            console.warn('Ignoring invalid tag definition:', tag);
            continue;
        }
        if (tag.args == null) {
            verifiedTagDefs.push(tag.name);
            continue;
        }
        if (!Array.isArray(tag.args)) {
            console.warn('Ignoring invalid arg definitions for tag:', tag.name);
            verifiedTagDefs.push(tag.name);
            continue;
        }
        /** @type {Array<ArgDef | string>} */
        const verifiedArgs = [];
        for (const arg of tag.args) {
            if (typeof arg === 'string') {
                verifiedArgs.push(arg);
                continue;
            }
            if (arg == null || typeof arg !== 'object' || typeof arg.name !== 'string') {
                console.warn('Ignoring invalid arg definition for tag', tag.name + ':', arg);
                continue;
            }
            verifiedArgs.push({
                name: arg.name,
                required: !!arg.required
            });
        }
        verifiedTagDefs.push({
            name: tag.name,
            args: verifiedArgs
        });
    }

    /** @type {Map<string, TagDefLC>} */
    const tdLC = new Map(verifiedTagDefs.map(tag => {
        if (typeof tag === 'string') {
            /** @type {Map<string, ArgDefLC>} */
            const args = new Map();
            return [tag.toLowerCase().trim(), {
                name: tag,
                args
            }];
        }
        return [tag.name.toLowerCase().trim(), {
            name: tag.name,
            args: new Map((tag.args || []).map(arg => {
                if (typeof arg === 'string') {
                    return [arg.toLowerCase().trim(), {
                        name: arg,
                        required: false,
                    }];
                }
                return [arg.name.toLowerCase().trim(), {
                    name: arg.name,
                    required: !!arg.required,
                }];
            }))
        }];
    }));

    lcCache.set(tagDefs, tdLC);
    return tdLC;
}

/**
 * Parses the input string based on the provided tag definitions.
 * 
 * @param {string} input - The input string to parse.
 * @param {Array<TagDef | string>} tagDefs - The array of tag definitions.
 * @param {boolean} [resetCache=false] - Whether to reset the cache of tag definitions.
 * @returns {Array<Tag | string>} - The parsed structure as an array of tags and strings.
 */
function parse(input, tagDefs, resetCache = false) {
    const tdLC = verifyAndBuildLC(tagDefs, resetCache);
    if (tdLC.size === 0) {
        console.warn('No valid tag definitions provided, only matching [code] tags.');
    }
    const codeTagDef = tdLC.get('code') || {
        name: 'code',
        args: new Map(),
    };

    /** @type {Array<Tag | string>} */
    const result = [];

    /** @type {(i: number) => number} */
    let state = inText;
    let textStartI = 0;
    /** @type {PTag | null} */
    let pTag = null;
    /** @type {Tag | null} */
    let tag = null;
    let content = result;

    let iterationLimit = 50000;
    let i = 0;
    while (i < input.length) {
        i = state(i);
        if (--iterationLimit <= 0) {
            throw new Error('Iteration limit reached while parsing input, possible infinite loop.');
        }
    }
    i = state(i);

    /** @type {(i: number) => number} */
    function inText(i) {
        if (i >= input.length) {
            // EOF
            if (i > textStartI) {
                content.push(input.slice(textStartI));
                textStartI = input.length;
            }
            return input.length;
        }
        while (i < input.length && input[i] !== '[') {
            i++;
        }
        if (i > textStartI) {
            content.push(input.slice(textStartI, i));
        }
        textStartI = i;
        state = inTag;
        return i;
    }

    /** @type {(i: number) => number} */
    function inTag(i) {
        if (i >= input.length) {
            // EOF
            textStartI = input.length;
            state = inText;
            return i;
        }
        pTag = {
            startI: i,
            endI: -1,
            nameStartI: -1,
            nameEndI: -1,
            closing: false,
            name: '',
            args: [],
        };
        // Skip '['
        ++i;
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) {
            i++;
        }
        if (i >= input.length) {
            // EOF
            content.push(input.slice(pTag.startI));
            textStartI = input.length;
            state = inText;
            return i;
        }
        // [ /...
        if (input[i] === '/') {
            pTag.closing = true;
            i++;
        }
        pTag.nameStartI = i;

        // Read until whitespace, [, or ]
        while (i < input.length) {
            if (/[^\s\[\]]/.test(input[i])) {
                i++;
                continue;
            }
            // \n is "allowed" in the name (later stripped out)
            if (input[i] === '\n') {
                i++;
                continue;
            }
            break;
        }
        pTag.nameEndI = i;
        pTag.name = input.slice(pTag.nameStartI, pTag.nameEndI).replace(/\n+/g, '').toLowerCase();

        if (pTag.name.length === 0) {
            // No tag name
            content.push(input.slice(pTag.startI, i));
            pTag = null;
            textStartI = i;
            state = inText;
            return i;
        }

        state = inTagArg;
        return i;
    }

    /** @type {(i: number) => number} */
    function inTagArg(i) {
        if (!pTag) {
            throw new Error('Invalid state: pTag is null in inTagArgs');
        }
        if (i >= input.length) {
            // EOF
            content.push(input.slice(pTag.startI));
            textStartI = input.length;
            state = inText;
            return i;
        }
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) {
            i++;
        }
        if (i >= input.length) {
            // EOF
            content.push(input.slice(pTag.startI));
            textStartI = input.length;
            state = inText;
            return i;
        }
        // [tag ]...
        if (input[i] === ']') {
            // End of tag
            pTag.endI = i;
            i++;
            state = afterTag;
            return i;
        }
        // [tag [...
        if (input[i] === '[') {
            // Push everything so far as text and start a new tag
            content.push(input.slice(pTag.startI, i));
            pTag = null;
            state = inTag;
            return i;
        }

        // Read arg name
        /** @type {PArg} */
        const pArg = {
            nameStartI: i,
            nameEndI: -1,
            name: '',
            valueStartI: -1,
            valueEndI: -1,
            value: '',
            quoted: false,
        };

        while (i < input.length) {
            // Read until whitespace, =, [, or ]
            if (/[^\s=\[\]]/.test(input[i])) {
                i++;
                continue;
            }
            // \n is "allowed" in the name (later stripped out)
            if (input[i] === '\n') {
                i++;
                continue;
            }
            break;
        }

        pArg.nameEndI = i;
        pArg.name = input.slice(pArg.nameStartI, pArg.nameEndI).replace(/\n+/g, '').toLowerCase();

        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) {
            i++;
        }
        if (i >= input.length) {
            // EOF
            content.push(input.slice(pTag.startI));
            textStartI = input.length;
            state = inText;
            return i;
        }
        // [tag arg[...
        if (input[i] === '[') {
            // Push everything so far as text and start a new tag
            content.push(input.slice(pTag.startI, i));
            pTag = null;
            state = inTag;
            return i;
        }
        // [tag arg]
        if (input[i] === ']') {
            // No value for arg
            pTag.args.push(pArg);
            // End of tag
            pTag.endI = i;
            i++;
            state = afterTag;
            return i;
        }
        // [tag arg !=...
        if (input[i] !== '=') {
            // No value for arg
            pTag.args.push(pArg);
            state = inTagArg;
            return i;
        }
        // Skip '='
        i++;
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) {
            i++;
        }
        if (i >= input.length) {
            // EOF
            content.push(input.slice(pTag.startI));
            textStartI = input.length;
            state = inText;
            return i;
        }
        // [tag arg= [...
        if (input[i] === '[') {
            // Push everything so far as text and start a new tag
            content.push(input.slice(pTag.startI, i));
            pTag = null;
            state = inTag;
            return i;
        }
        // [tag arg=]
        if (input[i] === ']') {
            // No value for arg
            pTag.args.push(pArg);
            // End of tag
            pTag.endI = i;
            i++;
            state = afterTag;
            return i;
        }

        // [tag arg="...
        if (input[i] === '"') {
            pArg.quoted = true;
            pArg.valueStartI = i + 1;
            // Skip opening '"'
            i++;
        }
        else {
            pArg.valueStartI = i;
        }

        // Read arg value
        let prevBS = false;
        while (i < input.length) {
            if (pArg.quoted) {
                let prevWasBS = prevBS;
                if (input[i] === '\\') {
                    if (prevBS) {
                        prevBS = false;
                    } else {
                        prevBS = true;
                    }
                    i++;
                    continue;
                }
                if (input[i] === '"' && !prevWasBS) {
                    break;
                }
                prevBS = false;
                i++;
                continue;
            }
            // For unquoted values, stop at whitespace, [, or ]
            if (/[^\s\[\]]/.test(input[i])) {
                i++;
                continue;
            }
            // \n is "allowed" in the value (later stripped out)
            if (input[i] === '\n') {
                i++;
                continue;
            }
            break;
        }
        pArg.valueEndI = i;
        pArg.value = input.slice(pArg.valueStartI, pArg.valueEndI).replace(/\n+/g, '');
        if (pArg.quoted) {
            pArg.value = argUnescape(pArg.value);
            // Skip closing '"'
            i++;
        }
        pTag.args.push(pArg);
        state = inTagArg;
        return i;
    }

    /** @type {(i: number) => number} */
    function afterTag(i) {
        /** @type {(si: number) => number} */
        function fail(si) {
            content.push(input.slice(si, i));
            pTag = null;
            textStartI = i;
            state = inText;
            return i;
        }

        if (!pTag) {
            throw new Error('Invalid state: pTag is null in afterTag');
        }

        if (tag && tag.name.toLowerCase() === 'code') {
            if (!pTag.closing || pTag.name !== 'code') {
                // Inside [code], everything that isn't [/code] is treated as text
                return fail(pTag.startI);
            }
        }

        if (pTag.closing) {
            // For some reason their parser allows '=' at the end of closing tags.
            // It makes me wanna die, but I have to match their behavior.
            if (pTag.name.endsWith('=')) {
                pTag.name = pTag.name.replace(/=+$/g, '');
            }
            let matchTag = tag;
            while (matchTag && matchTag.name.toLowerCase() !== pTag.name) {
                matchTag = matchTag.parent;
            }
            if (!matchTag) {
                // No matching opening tag found
                return fail(pTag.startI);
            }
            matchTag.closeStartI = pTag.startI;
            matchTag.closeEndI = pTag.endI;
            tag = matchTag.parent;
            content = tag ? tag.content : result;
            pTag = null;
            textStartI = i;
            state = inText;
            return i;
        }

        // Opening tag
        const tagDef = tdLC.get(pTag.name) || (pTag.name === 'code' ? codeTagDef : null);
        if (!tagDef) {
            // Unknown tag
            return fail(pTag.startI);
        }


        // Normalize args and verify required ones
        /** @type {{ [k: string]: string }} */
        const argsObj = {};
        const extraArgs = pTag.args.slice();
        for (const [argName, argDef] of tagDef.args) {
            const argNameLC = argName.toLowerCase();
            /** @type {PArg | null} */
            let found = null;
            let foundIdx = -1;
            for (let j = 0; j < extraArgs.length; j++) {
                const pArg = extraArgs[j];
                if (pArg.name === argNameLC) {
                    found = pArg;
                    foundIdx = j;
                    break;
                }
            }
            if (found) {
                argsObj[argDef.name] = found.value;
                extraArgs.splice(foundIdx, 1);
            } else if (argDef.required) {
                // Missing required arg
                return fail(pTag.startI);
            }
        }
        const extraNonEmptyArgs = extraArgs.filter(arg => arg.value.length > 0);
        if (extraNonEmptyArgs.length > 0) {
            // Unknown extra args with values
            return fail(pTag.startI);
        }

        tag = {
            openStartI: pTag.startI,
            openEndI: pTag.endI,
            closeStartI: -1,
            closeEndI: -1,
            name: tagDef.name,
            args: argsObj,
            content: [],
            parent: tag,
        };
        content.push(tag);
        content = tag.content;
        pTag = null;
        textStartI = i;
        state = inText;
        return i;
    }

    return result;
}

module.exports = {
    parse,
};