// @ts-check

/*
<?php
$escapedChars = array();
for ($codepoint = 0; $codepoint <= 0x10FFFF; $codepoint++) {
    // Skip UTF-16 surrogates (invalid code points)
    if ($codepoint >= 0xD800 && $codepoint <= 0xDFFF) {
        continue;
    }
    $string = '';
    if ($codepoint <= 0x7F) {
        $string .= chr($codepoint);
    } elseif ($codepoint <= 0x7FF) {
        $string .= chr(0xC0 | ($codepoint >> 6));
        $string .= chr(0x80 | ($codepoint & 0x3F));
    } elseif ($codepoint <= 0xFFFF) {
        $string .= chr(0xE0 | ($codepoint >> 12));
        $string .= chr(0x80 | (($codepoint >> 6) & 0x3F));
        $string .= chr(0x80 | ($codepoint & 0x3F));
    } elseif ($codepoint <= 0x10FFFF) {
        $string .= chr(0xF0 | ($codepoint >> 18));
        $string .= chr(0x80 | (($codepoint >> 12) & 0x3F));
        $string .= chr(0x80 | (($codepoint >> 6) & 0x3F));
        $string .= chr(0x80 | ($codepoint & 0x3F));
    }

    $encoded = htmlentities($string, ENT_COMPAT, 'UTF-8', false);
    if ($encoded !== $string) {
        $escapedChars[] = array(
            'codepoint' => sprintf("U+%04X", $codepoint),
            'char' => $string,
            'encoded' => $encoded
        );
    }
}

foreach ($escapedChars as $entry) {
    echo $entry['codepoint'] . " => " . $entry['encoded'] . "\n";
}

echo "\nTotal escaped characters: " . count($escapedChars) . "\n";

On PHP 8:

U+0022 => &quot;
U+0026 => &amp;
U+003C => &lt;
U+003E => &gt;
U+00A0 => &nbsp;
U+00A1 => &iexcl;
U+00A2 => &cent;
U+00A3 => &pound;
U+00A4 => &curren;
U+00A5 => &yen;
U+00A6 => &brvbar;
U+00A7 => &sect;
U+00A8 => &uml;
U+00A9 => &copy;
U+00AA => &ordf;
U+00AB => &laquo;
U+00AC => &not;
U+00AD => &shy;
U+00AE => &reg;
U+00AF => &macr;
U+00B0 => &deg;
U+00B1 => &plusmn;
U+00B2 => &sup2;
U+00B3 => &sup3;
U+00B4 => &acute;
U+00B5 => &micro;
U+00B6 => &para;
U+00B7 => &middot;
U+00B8 => &cedil;
U+00B9 => &sup1;
U+00BA => &ordm;
U+00BB => &raquo;
U+00BC => &frac14;
U+00BD => &frac12;
U+00BE => &frac34;
U+00BF => &iquest;
U+00C0 => &Agrave;
U+00C1 => &Aacute;
U+00C2 => &Acirc;
U+00C3 => &Atilde;
U+00C4 => &Auml;
U+00C5 => &Aring;
U+00C6 => &AElig;
U+00C7 => &Ccedil;
U+00C8 => &Egrave;
U+00C9 => &Eacute;
U+00CA => &Ecirc;
U+00CB => &Euml;
U+00CC => &Igrave;
U+00CD => &Iacute;
U+00CE => &Icirc;
U+00CF => &Iuml;
U+00D0 => &ETH;
U+00D1 => &Ntilde;
U+00D2 => &Ograve;
U+00D3 => &Oacute;
U+00D4 => &Ocirc;
U+00D5 => &Otilde;
U+00D6 => &Ouml;
U+00D7 => &times;
U+00D8 => &Oslash;
U+00D9 => &Ugrave;
U+00DA => &Uacute;
U+00DB => &Ucirc;
U+00DC => &Uuml;
U+00DD => &Yacute;
U+00DE => &THORN;
U+00DF => &szlig;
U+00E0 => &agrave;
U+00E1 => &aacute;
U+00E2 => &acirc;
U+00E3 => &atilde;
U+00E4 => &auml;
U+00E5 => &aring;
U+00E6 => &aelig;
U+00E7 => &ccedil;
U+00E8 => &egrave;
U+00E9 => &eacute;
U+00EA => &ecirc;
U+00EB => &euml;
U+00EC => &igrave;
U+00ED => &iacute;
U+00EE => &icirc;
U+00EF => &iuml;
U+00F0 => &eth;
U+00F1 => &ntilde;
U+00F2 => &ograve;
U+00F3 => &oacute;
U+00F4 => &ocirc;
U+00F5 => &otilde;
U+00F6 => &ouml;
U+00F7 => &divide;
U+00F8 => &oslash;
U+00F9 => &ugrave;
U+00FA => &uacute;
U+00FB => &ucirc;
U+00FC => &uuml;
U+00FD => &yacute;
U+00FE => &thorn;
U+00FF => &yuml;
U+0152 => &OElig;
U+0153 => &oelig;
U+0160 => &Scaron;
U+0161 => &scaron;
U+0178 => &Yuml;
U+0192 => &fnof;
U+02C6 => &circ;
U+02DC => &tilde;
U+0391 => &Alpha;
U+0392 => &Beta;
U+0393 => &Gamma;
U+0394 => &Delta;
U+0395 => &Epsilon;
U+0396 => &Zeta;
U+0397 => &Eta;
U+0398 => &Theta;
U+0399 => &Iota;
U+039A => &Kappa;
U+039B => &Lambda;
U+039C => &Mu;
U+039D => &Nu;
U+039E => &Xi;
U+039F => &Omicron;
U+03A0 => &Pi;
U+03A1 => &Rho;
U+03A3 => &Sigma;
U+03A4 => &Tau;
U+03A5 => &Upsilon;
U+03A6 => &Phi;
U+03A7 => &Chi;
U+03A8 => &Psi;
U+03A9 => &Omega;
U+03B1 => &alpha;
U+03B2 => &beta;
U+03B3 => &gamma;
U+03B4 => &delta;
U+03B5 => &epsilon;
U+03B6 => &zeta;
U+03B7 => &eta;
U+03B8 => &theta;
U+03B9 => &iota;
U+03BA => &kappa;
U+03BB => &lambda;
U+03BC => &mu;
U+03BD => &nu;
U+03BE => &xi;
U+03BF => &omicron;
U+03C0 => &pi;
U+03C1 => &rho;
U+03C2 => &sigmaf;
U+03C3 => &sigma;
U+03C4 => &tau;
U+03C5 => &upsilon;
U+03C6 => &phi;
U+03C7 => &chi;
U+03C8 => &psi;
U+03C9 => &omega;
U+03D1 => &thetasym;
U+03D2 => &upsih;
U+03D6 => &piv;
U+2002 => &ensp;
U+2003 => &emsp;
U+2009 => &thinsp;
U+200C => &zwnj;
U+200D => &zwj;
U+200E => &lrm;
U+200F => &rlm;
U+2013 => &ndash;
U+2014 => &mdash;
U+2018 => &lsquo;
U+2019 => &rsquo;
U+201A => &sbquo;
U+201C => &ldquo;
U+201D => &rdquo;
U+201E => &bdquo;
U+2020 => &dagger;
U+2021 => &Dagger;
U+2022 => &bull;
U+2026 => &hellip;
U+2030 => &permil;
U+2032 => &prime;
U+2033 => &Prime;
U+2039 => &lsaquo;
U+203A => &rsaquo;
U+203E => &oline;
U+2044 => &frasl;
U+20AC => &euro;
U+2111 => &image;
U+2118 => &weierp;
U+211C => &real;
U+2122 => &trade;
U+2135 => &alefsym;
U+2190 => &larr;
U+2191 => &uarr;
U+2192 => &rarr;
U+2193 => &darr;
U+2194 => &harr;
U+21B5 => &crarr;
U+21D0 => &lArr;
U+21D1 => &uArr;
U+21D2 => &rArr;
U+21D3 => &dArr;
U+21D4 => &hArr;
U+2200 => &forall;
U+2202 => &part;
U+2203 => &exist;
U+2205 => &empty;
U+2207 => &nabla;
U+2208 => &isin;
U+2209 => &notin;
U+220B => &ni;
U+220F => &prod;
U+2211 => &sum;
U+2212 => &minus;
U+2217 => &lowast;
U+221A => &radic;
U+221D => &prop;
U+221E => &infin;
U+2220 => &ang;
U+2227 => &and;
U+2228 => &or;
U+2229 => &cap;
U+222A => &cup;
U+222B => &int;
U+2234 => &there4;
U+223C => &sim;
U+2245 => &cong;
U+2248 => &asymp;
U+2260 => &ne;
U+2261 => &equiv;
U+2264 => &le;
U+2265 => &ge;
U+2282 => &sub;
U+2283 => &sup;
U+2284 => &nsub;
U+2286 => &sube;
U+2287 => &supe;
U+2295 => &oplus;
U+2297 => &otimes;
U+22A5 => &perp;
U+22C5 => &sdot;
U+2308 => &lceil;
U+2309 => &rceil;
U+230A => &lfloor;
U+230B => &rfloor;
U+2329 => &lang;
U+232A => &rang;
U+25CA => &loz;
U+2660 => &spades;
U+2663 => &clubs;
U+2665 => &hearts;
U+2666 => &diams;

Total escaped characters: 252

*/

/** @type {Record<string, string>} */
const HTML_ENTITIES = {
    '\u0022': '&quot;',
    '\u0026': '&amp;',
    '\u003C': '&lt;',
    '\u003E': '&gt;',
    '\u00A0': '&nbsp;',
    '\u00A1': '&iexcl;',
    '\u00A2': '&cent;',
    '\u00A3': '&pound;',
    '\u00A4': '&curren;',
    '\u00A5': '&yen;',
    '\u00A6': '&brvbar;',
    '\u00A7': '&sect;',
    '\u00A8': '&uml;',
    '\u00A9': '&copy;',
    '\u00AA': '&ordf;',
    '\u00AB': '&laquo;',
    '\u00AC': '&not;',
    '\u00AD': '&shy;',
    '\u00AE': '&reg;',
    '\u00AF': '&macr;',
    '\u00B0': '&deg;',
    '\u00B1': '&plusmn;',
    '\u00B2': '&sup2;',
    '\u00B3': '&sup3;',
    '\u00B4': '&acute;',
    '\u00B5': '&micro;',
    '\u00B6': '&para;',
    '\u00B7': '&middot;',
    '\u00B8': '&cedil;',
    '\u00B9': '&sup1;',
    '\u00BA': '&ordm;',
    '\u00BB': '&raquo;',
    '\u00BC': '&frac14;',
    '\u00BD': '&frac12;',
    '\u00BE': '&frac34;',
    '\u00BF': '&iquest;',
    '\u00C0': '&Agrave;',
    '\u00C1': '&Aacute;',
    '\u00C2': '&Acirc;',
    '\u00C3': '&Atilde;',
    '\u00C4': '&Auml;',
    '\u00C5': '&Aring;',
    '\u00C6': '&AElig;',
    '\u00C7': '&Ccedil;',
    '\u00C8': '&Egrave;',
    '\u00C9': '&Eacute;',
    '\u00CA': '&Ecirc;',
    '\u00CB': '&Euml;',
    '\u00CC': '&Igrave;',
    '\u00CD': '&Iacute;',
    '\u00CE': '&Icirc;',
    '\u00CF': '&Iuml;',
    '\u00D0': '&ETH;',
    '\u00D1': '&Ntilde;',
    '\u00D2': '&Ograve;',
    '\u00D3': '&Oacute;',
    '\u00D4': '&Ocirc;',
    '\u00D5': '&Otilde;',
    '\u00D6': '&Ouml;',
    '\u00D7': '&times;',
    '\u00D8': '&Oslash;',
    '\u00D9': '&Ugrave;',
    '\u00DA': '&Uacute;',
    '\u00DB': '&Ucirc;',
    '\u00DC': '&Uuml;',
    '\u00DD': '&Yacute;',
    '\u00DE': '&THORN;',
    '\u00DF': '&szlig;',
    '\u00E0': '&agrave;',
    '\u00E1': '&aacute;',
    '\u00E2': '&acirc;',
    '\u00E3': '&atilde;',
    '\u00E4': '&auml;',
    '\u00E5': '&aring;',
    '\u00E6': '&aelig;',
    '\u00E7': '&ccedil;',
    '\u00E8': '&egrave;',
    '\u00E9': '&eacute;',
    '\u00EA': '&ecirc;',
    '\u00EB': '&euml;',
    '\u00EC': '&igrave;',
    '\u00ED': '&iacute;',
    '\u00EE': '&icirc;',
    '\u00EF': '&iuml;',
    '\u00F0': '&eth;',
    '\u00F1': '&ntilde;',
    '\u00F2': '&ograve;',
    '\u00F3': '&oacute;',
    '\u00F4': '&ocirc;',
    '\u00F5': '&otilde;',
    '\u00F6': '&ouml;',
    '\u00F7': '&divide;',
    '\u00F8': '&oslash;',
    '\u00F9': '&ugrave;',
    '\u00FA': '&uacute;',
    '\u00FB': '&ucirc;',
    '\u00FC': '&uuml;',
    '\u00FD': '&yacute;',
    '\u00FE': '&thorn;',
    '\u00FF': '&yuml;',
    '\u0152': '&OElig;',
    '\u0153': '&oelig;',
    '\u0160': '&Scaron;',
    '\u0161': '&scaron;',
    '\u0178': '&Yuml;',
    '\u0192': '&fnof;',
    '\u02C6': '&circ;',
    '\u02DC': '&tilde;',
    '\u0391': '&Alpha;',
    '\u0392': '&Beta;',
    '\u0393': '&Gamma;',
    '\u0394': '&Delta;',
    '\u0395': '&Epsilon;',
    '\u0396': '&Zeta;',
    '\u0397': '&Eta;',
    '\u0398': '&Theta;',
    '\u0399': '&Iota;',
    '\u039A': '&Kappa;',
    '\u039B': '&Lambda;',
    '\u039C': '&Mu;',
    '\u039D': '&Nu;',
    '\u039E': '&Xi;',
    '\u039F': '&Omicron;',
    '\u03A0': '&Pi;',
    '\u03A1': '&Rho;',
    '\u03A3': '&Sigma;',
    '\u03A4': '&Tau;',
    '\u03A5': '&Upsilon;',
    '\u03A6': '&Phi;',
    '\u03A7': '&Chi;',
    '\u03A8': '&Psi;',
    '\u03A9': '&Omega;',
    '\u03B1': '&alpha;',
    '\u03B2': '&beta;',
    '\u03B3': '&gamma;',
    '\u03B4': '&delta;',
    '\u03B5': '&epsilon;',
    '\u03B6': '&zeta;',
    '\u03B7': '&eta;',
    '\u03B8': '&theta;',
    '\u03B9': '&iota;',
    '\u03BA': '&kappa;',
    '\u03BB': '&lambda;',
    '\u03BC': '&mu;',
    '\u03BD': '&nu;',
    '\u03BE': '&xi;',
    '\u03BF': '&omicron;',
    '\u03C0': '&pi;',
    '\u03C1': '&rho;',
    '\u03C2': '&sigmaf;',
    '\u03C3': '&sigma;',
    '\u03C4': '&tau;',
    '\u03C5': '&upsilon;',
    '\u03C6': '&phi;',
    '\u03C7': '&chi;',
    '\u03C8': '&psi;',
    '\u03C9': '&omega;',
    '\u03D1': '&thetasym;',
    '\u03D2': '&upsih;',
    '\u03D6': '&piv;',
    '\u2002': '&ensp;',
    '\u2003': '&emsp;',
    '\u2009': '&thinsp;',
    '\u200C': '&zwnj;',
    '\u200D': '&zwj;',
    '\u200E': '&lrm;',
    '\u200F': '&rlm;',
    '\u2013': '&ndash;',
    '\u2014': '&mdash;',
    '\u2018': '&lsquo;',
    '\u2019': '&rsquo;',
    '\u201A': '&sbquo;',
    '\u201C': '&ldquo;',
    '\u201D': '&rdquo;',
    '\u201E': '&bdquo;',
    '\u2020': '&dagger;',
    '\u2021': '&Dagger;',
    '\u2022': '&bull;',
    '\u2026': '&hellip;',
    '\u2030': '&permil;',
    '\u2032': '&prime;',
    '\u2033': '&Prime;',
    '\u2039': '&lsaquo;',
    '\u203A': '&rsaquo;',
    '\u203E': '&oline;',
    '\u2044': '&frasl;',
    '\u20AC': '&euro;',
    '\u2111': '&image;',
    '\u2118': '&weierp;',
    '\u211C': '&real;',
    '\u2122': '&trade;',
    '\u2135': '&alefsym;',
    '\u2190': '&larr;',
    '\u2191': '&uarr;',
    '\u2192': '&rarr;',
    '\u2193': '&darr;',
    '\u2194': '&harr;',
    '\u21B5': '&crarr;',
    '\u21D0': '&lArr;',
    '\u21D1': '&uArr;',
    '\u21D2': '&rArr;',
    '\u21D3': '&dArr;',
    '\u21D4': '&hArr;',
    '\u2200': '&forall;',
    '\u2202': '&part;',
    '\u2203': '&exist;',
    '\u2205': '&empty;',
    '\u2207': '&nabla;',
    '\u2208': '&isin;',
    '\u2209': '&notin;',
    '\u220B': '&ni;',
    '\u220F': '&prod;',
    '\u2211': '&sum;',
    '\u2212': '&minus;',
    '\u2217': '&lowast;',
    '\u221A': '&radic;',
    '\u221D': '&prop;',
    '\u221E': '&infin;',
    '\u2220': '&ang;',
    '\u2227': '&and;',
    '\u2228': '&or;',
    '\u2229': '&cap;',
    '\u222A': '&cup;',
    '\u222B': '&int;',
    '\u2234': '&there4;',
    '\u223C': '&sim;',
    '\u2245': '&cong;',
    '\u2248': '&asymp;',
    '\u2260': '&ne;',
    '\u2261': '&equiv;',
    '\u2264': '&le;',
    '\u2265': '&ge;',
    '\u2282': '&sub;',
    '\u2283': '&sup;',
    '\u2284': '&nsub;',
    '\u2286': '&sube;',
    '\u2287': '&supe;',
    '\u2295': '&oplus;',
    '\u2297': '&otimes;',
    '\u22A5': '&perp;',
    '\u22C5': '&sdot;',
    '\u2308': '&lceil;',
    '\u2309': '&rceil;',
    '\u230A': '&lfloor;',
    '\u230B': '&rfloor;',
    '\u2329': '&lang;',
    '\u232A': '&rang;',
    '\u25CA': '&loz;',
    '\u2660': '&spades;',
    '\u2663': '&clubs;',
    '\u2665': '&hearts;',
    '\u2666': '&diams;',
};

const REV_HTML_ENTITIES = Object.fromEntries(Object.entries(HTML_ENTITIES).map(([_, v]) => [v, 1]));

const REX_HTML_ENTITIES = new RegExp('[' + Object.keys(HTML_ENTITIES).map(e =>
    `\\u${(e.codePointAt(0) || 0).toString(16).padStart(4, '0')}`
).join('') + ']', 'g');

/**
 * Emulates PHP's htmlentities function
 * 
 * @param {string} str Input string
 * @param {boolean} [doubleEncode=true] Whether to double encode existing HTML entities
 * @returns {string} Escaped string
 */
function htmlentities(str, doubleEncode = true) {
    return str.replace(REX_HTML_ENTITIES, doubleEncode ? replaceFn : replaceFnNoDouble);
}

/**
 * Replace function for htmlentities with double encoding
 * 
 * @param {string} match Matched character
 * @returns {string} Replaced string
 */
function replaceFn(match) {
    return HTML_ENTITIES[match] || match;
}

/**
 * Replace function for htmlentities without double encoding
 * 
 * @param {string} match Matched character
 * @param {number} i Index of the match
 * @param {string} str Original string
 * @returns {string} Replaced string
 */
function replaceFnNoDouble(match, i, str) {
    if (match !== '&') {
        return HTML_ENTITIES[match] || match;
    }
    if (str[i + 1] === '#') {
        if (str[i + 2].toLowerCase() === 'x') {
            let hexEnd = i + 3;
            while (hexEnd < str.length && ((str[hexEnd] >= '0' && str[hexEnd] <= '9') || (str[hexEnd].toLowerCase() >= 'a' && str[hexEnd].toLowerCase() <= 'f'))) {
                hexEnd++;
            }
            if (hexEnd === i + 3) {
                return HTML_ENTITIES[match] || match;
            }
            if (str[hexEnd] === ';') {
                return match;
            }
            return HTML_ENTITIES[match] || match;
        }
        let decEnd = i + 2;
        while (decEnd < str.length && (str[decEnd] >= '0' && str[decEnd] <= '9')) {
            decEnd++;
        }
        if (decEnd === i + 2) {
            return HTML_ENTITIES[match] || match;
        }
        if (str[decEnd] === ';') {
            return match;
        }
        return HTML_ENTITIES[match] || match;
    }
    let semiColonIndex = str.indexOf(';', i);
    if (semiColonIndex === -1 || semiColonIndex - i > 16) {
        return HTML_ENTITIES[match] || match;
    }
    const entity = str.slice(i, semiColonIndex + 1);
    if (REV_HTML_ENTITIES[entity]) {
        return match;
    }
    return HTML_ENTITIES[match] || match;
}

module.exports = {
    htmlentities
};