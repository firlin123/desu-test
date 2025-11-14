// @ts-check
const { htmlentities } = require("./htmlentities");
const { parse } = require("./parser");

/*
public function processComment($process_backlinks_only = false)
    {
        $greentext = Hook::forge('Foolz\FoolFuuka\Model\Comment::processComment#var.greentext')
            ->setParam('html', '\\1<span class="greentext">\\2</span>\\3')
            ->execute()
            ->get('\\1<span class="greentext">\\2</span>\\3');

        $comment = Hook::forge('Foolz\FoolFuuka\Model\Comment::processComment#var.originalComment')
            ->setObject($this)
            ->setParam('comment', $this->comment->comment)
            ->execute()
            ->get($this->comment->comment);

        // sanitize comment
        $comment = htmlentities($comment, ENT_COMPAT, 'UTF-8', false);

        // process comment for greentext, bbcode, links
        $comment = $this->processCommentBBCode($comment);
        $comment = $this->processCommentLinks($comment);
        $comment = preg_replace('/(\r?\n|^)(&gt;.*?)(?=$|\r?\n)/i', $greentext, $comment);

        // process internal and external links
        $comment = preg_replace_callback('/(&gt;&gt;(\d+(?:,\d+)?))/i',
            [$this, 'processInternalLinks'], $comment);
        $comment = preg_replace_callback('/(&gt;&gt;&gt;(\/(\w+)\/([\w-]+(?:,\d+)?)?(\/?)))/i',
            [$this, 'processExternalLinks'], $comment);

        if ($process_backlinks_only) {
            return '';
        }

        $comment = nl2br(trim($comment));

        $comment = Hook::forge('Foolz\FoolFuuka\Model\Comment::processComment#var.processedComment')
            ->setObject($this)
            ->setParam('comment', $comment)
            ->execute()
            ->get($comment);

        return $this->comment->comment_processed = $comment;
    }
*/
/**
 * Process comment with error handling.
 * 
 * @param {string | null} comment
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site
 * @returns {string}
 */
function processComment(comment, site) {
    try {
        return processCommentReal(comment, site);
    } catch (e) {
        console.error('Error processing comment:', e, comment);
        // To trigger unmatched diff
        return Math.random().toString(36).substring(2, 15);
    }
}

/**
 * Process comment using the real processing function.
 * 
 * @param {string | null} comment
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site
 * @returns {string}
 */
function processCommentReal(comment, site) {
    if (comment == null) return '';

    // $comment = htmlentities($comment, ENT_COMPAT, 'UTF-8', false);
    comment = htmlentities(comment, false);

    // $comment = $this->processCommentBBCode($comment);
    comment = processCommentBBCode(comment);

    // $comment = $this->processCommentLinks($comment);
    comment = processCommentLinks(comment);

    // $comment = preg_replace('/(\r?\n|^)(&gt;.*?)(?=$|\r?\n)/i', $greentext, $comment);
    comment = comment.replace(/(\r?\n|^)(&gt;.*?)(?=$|\r?\n)/gi, (match, prefix, greentext) => {
        return `${prefix}<span class="greentext">${greentext}</span>`;
    });

    // $comment = preg_replace_callback('/(&gt;&gt;(\d+(?:,\d+)?))/i', [$this, 'processInternalLinks'], $comment);
    comment = comment.replace(/(&gt;&gt;(\d+(?:,\d+)?))/gi, getProcessInternalLinks(site));

    // $comment = preg_replace_callback('/(&gt;&gt;&gt;(\/(\w+)\/([\w-]+(?:,\d+)?)?(\/?)))/i', [$this, 'processExternalLinks'], $comment);
    comment = comment.replace(/(&gt;&gt;&gt;(\/(\w+)\/([\w-]+(?:,\d+)?)?(\/?)))/gi, getProcessExternalLinks(site));

    // $comment = nl2br(trim($comment));
    comment = trim(comment).replace(/\r?\n/g, '<br />$&');

    return comment;
}

/*
protected function processCommentBBCode($comment)
    {
        if ($this->_bbcode_processor === null) {
            $parser = new \JBBCode\Parser();
            $definitions = array();

            $builder = new \Foolz\FoolFuuka\Model\BBCode\Code();
            array_push($definitions, $builder);

            $builder = new \JBBCode\CodeDefinitionBuilder('spoiler', '<span class="spoiler">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('sub', '<sub>{param}</sub>');
            $builder->setNestLimit(1);
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('sup', '<sup>{param}</sup>');
            $builder->setNestLimit(1);
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('eqn', '<script type="math/tex; mode=display">{param}</script>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('math', '<script type="math/tex">{param}</script>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('b', '<strong>{param}</strong>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('i', '<em>{param}</em>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('o', '<span class="overline">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('s', '<span class="strikethrough">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('u', '<span class="underline">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('banned', '<span class="banned">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('info', '<span class="alert alert-info">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('fortune', '<strong><span class="fortune" style="color: {color}">{param}</span></strong>');
            $builder->setUseOption(true);
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('shiftjis', '<span class="shift-jis">{param}</span>');
            array_push($definitions, $builder->build());

            $builder = new \JBBCode\CodeDefinitionBuilder('qstcolor', '<span class="qst-color {option}">{param}</span>');
            $builder->setUseOption(true);
            array_push($definitions, $builder->build());

            $definitions = Hook::forge('Foolz\FoolFuuka\Model\Comment::processCommentBBCode#var.definitions')
                ->setObject($this)
                ->setParam('definitions', $definitions)
                ->execute()
                ->get($definitions);

            foreach ($definitions as $definition) {
                $parser->addCodeDefinition($definition);
            }

            $this->_bbcode_processor = $parser;
        }

        // work around for dealing with quotes in BBCode tags
        $comment = str_replace('&quot;', '"', $comment);
        $comment = $this->_bbcode_processor->parse($comment)->getAsBBCode();
        $comment = str_replace('"', '&quot;', $comment);

        return $this->_bbcode_processor->parse($comment)->getAsHTML();
    }
*/
/**
 * Process comment BBCode to HTML.
 * 
 * @param {string} comment
 * @returns {string}
 */
function processCommentBBCode(comment) {
    // $comment = str_replace('&quot;', '"', $comment);
    comment = comment.replace(/&quot;/g, '"');

    // $comment = $this->_bbcode_processor->parse($comment)->getAsBBCode();
    const ast = parse(comment, TAG_DEFS);

    // return $this->_bbcode_processor->parse($comment)->getAsHTML();
    const result = [];
    astToHTML(comment, ast, result);
    return result.join('');
}

/** @type {Array<import('./parser').TagDef | string>} */
const TAG_DEFS = [
    'spoiler', 'sub', 'sup', 'eqn', 'math', 'b',
    'i', 'o', 's', 'u', 'banned', 'info',
    {
        name: 'fortune',
        args: [{
            name: 'color',
            required: true
        }]
    },
    'shiftjis',
    {
        name: 'qstcolor',
        args: [{
            name: 'option',
            required: true
        }]
    }
];

/**
 * Convert AST to HTML.
 * 
 * @param {string} origComment
 * @param {(import('./parser').Tag | string)[]} ast
 * @param {string[]} result
 * @param {import('./parser').Tag | null} parent
 */
function astToHTML(origComment, ast, result, parent = null) {
    for (const tag of ast) {
        if (typeof tag === 'string') {
            // Restore quotes that we removed earlier
            let nodeWQ = tag.replace(/"/g, '&quot;');
            result.push(nodeWQ);
            continue;
        }
        switch (tag.name.toLowerCase()) {
            case 'code': {
                let codeContent = [];
                const hadNLs = codeAstToHTML(origComment, tag.content, codeContent);
                if (hadNLs) {
                    result.push('<pre>');
                    result.push(codeContent.join(''));
                    result.push('</pre>');
                } else {
                    result.push('<code>');
                    result.push(codeContent.join(''));
                    result.push('</code>');
                }
                break;
            }
            case 'spoiler':
                result.push('<span class="spoiler">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'sub':
                // Nest limit of 1, check if we are already inside a sub tag
                let subParent = parent;
                let subFound = false;
                while (subParent) {
                    if (subParent.name.toLowerCase() === 'sub') {
                        subFound = true;
                        break;
                    }
                    subParent = subParent.parent;
                }
                if (subFound) {
                    continue;
                }
                result.push('<sub>');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</sub>');
                break;
            case 'sup':
                // Nest limit of 1, check if we are already inside a sup tag
                let supParent = parent;
                let supFound = false;
                while (supParent) {
                    if (supParent.name.toLowerCase() === 'sup') {
                        supFound = true;
                        break;
                    }
                    supParent = supParent.parent;
                }
                if (supFound) {
                    continue;
                }
                result.push('<sup>');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</sup>');
                break;
            case 'eqn':
                result.push('<script type="math/tex; mode=display">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</script>');
                break;
            case 'math':
                result.push('<script type="math/tex">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</script>');
                break;
            case 'b':
                result.push('<strong>');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</strong>');
                break;
            case 'i':
                result.push('<em>');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</em>');
                break;
            case 'o':
                result.push('<span class="overline">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 's':
                result.push('<span class="strikethrough">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'u':
                result.push('<span class="underline">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'banned':
                result.push('<span class="banned">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'info':
                result.push('<span class="alert alert-info">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'fortune':
                {
                    const color = tag.args.color || '';
                    const colorWQ = color.replace(/"/g, '&quot;');
                    result.push(`<strong><span class="fortune" style="color: ${colorWQ}">`);
                    astToHTML(origComment, tag.content, result, tag);
                    result.push('</span></strong>');
                }
                break;
            case 'shiftjis':
                result.push('<span class="shift-jis">');
                astToHTML(origComment, tag.content, result, tag);
                result.push('</span>');
                break;
            case 'qstcolor':
                {
                    const option = tag.args.option || '';
                    const optionWQ = option.replace(/"/g, '&quot;');
                    result.push(`<span class="qst-color ${optionWQ}">`);
                    astToHTML(origComment, tag.content, result, tag);
                    result.push('</span>');
                }
                break;
            default:
                // If we have start, emit is as original bbcode text
                if (tag.openStartI !== -1 && tag.openEndI !== -1) {
                    let orig = origComment.substring(tag.openStartI, tag.openEndI);
                    // Restore quotes that we removed earlier
                    orig = orig.replace(/"/g, '&quot;');
                    result.push(orig);
                }
                astToHTML(origComment, tag.content, result, tag);
                // If we have end, emit is as original bbcode text
                if (tag.closeStartI !== -1 && tag.closeEndI !== -1) {
                    let orig = origComment.substring(tag.closeStartI, tag.closeEndI);
                    // Restore quotes that we removed earlier
                    orig = orig.replace(/"/g, '&quot;');
                    result.push(orig);
                }
                break;
        }
    }
}

/**
 * Convert [code] AST to HTML.
 * 
 * @param {string} origComment
 * @param {(import('./parser').Tag | string)[]} ast
 * @param {string[]} result
 * @returns {boolean} - Whether there were new lines inside code
 */
function codeAstToHTML(origComment, ast, result = []) {
    let hadNLs = false;
    for (const tag of ast) {
        if (typeof tag === 'string') {
            // Restore quotes that we removed earlier
            let nodeWQ = tag.replace(/"/g, '&quot;').split('\n');
            if (nodeWQ.length > 1) {
                hadNLs = true;
            }
            result.push(nodeWQ.join('<br>'));
            continue;
        }
        // For nested tags, just output as original bbcode text
        let openChunk = '';
        if (tag.openStartI !== -1 && tag.openEndI !== -1) {
            openChunk = origComment.substring(tag.openStartI, tag.openEndI);
        }
        const openChunkWQ = openChunk.replace(/"/g, '&quot;').split('\n');
        if (openChunkWQ.length > 1) {
            hadNLs = true;
        }
        result.push(openChunkWQ.join('<br>'));
        const hadNestedNLs = codeAstToHTML(origComment, tag.content, result);
        if (hadNestedNLs) {
            hadNLs = true;
        }
        let closeChunk = '';
        if (tag.closeStartI !== -1 && tag.closeEndI !== -1) {
            closeChunk = origComment.substring(tag.closeStartI, tag.closeEndI);
        }
        const closeChunkWQ = closeChunk.replace(/"/g, '&quot;').split('\n');
        if (closeChunkWQ.length > 1) {
            hadNLs = true;
        }
        result.push(closeChunkWQ.join('<br>'));
    }
    return hadNLs;
}

/*
public function processCommentLinks($comment)
    {
        return preg_replace_callback('/(?i)\b((?:((?:ht|f)tps?:(?:\/{1,3}|[a-z0-9%]))|[a-z0-9.\-]+[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\/)(?:[^\s()<>{}\[\]]+|\([^\s()]*?\([^\s()]+\)[^\s()]*?\)|\([^\s]+?\))+(?:\([^\s()]*?\([^\s()]+\)[^\s()]*?\)|\([^\s]+?\)|[^\s`!()\[\]{};:\'".,<>?«»“”‘’])|(?:(?<!@)[a-z0-9]+(?:[.\-][a-z0-9]+)*[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\b\/?(?!@)))/i', 'self::processLinkify', $comment);
    }
*/
/**
 * Process comment links to be clickable.
 * 
 * @param {string} comment
 * @returns {string}
 */
function processCommentLinks(comment) {
    return comment.replace(/\b((?:((?:ht|f)tps?:(?:\/{1,3}|[a-z0-9%]))|[a-z0-9.\-]+[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\/)(?:[^\r\n\t\f\v ()<>{}\[\]]+|\([^\r\n\t\f\v ()]*?\([^\r\n\t\f\v ()]+\)[^\r\n\t\f\v ()]*?\)|\([^\r\n\t\f\v ]+?\))+(?:\([^\r\n\t\f\v ()]*?\([^\r\n\t\f\v ()]+\)[^\r\n\t\f\v ()]*?\)|\([^\r\n\t\f\v ]+?\)|[^\r\n\t\f\v `!()\[\]{};:\'".,<>?«»“”‘’])|(?:(?<!@)[a-z0-9]+(?:[.\-][a-z0-9]+)*[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\b\/?(?!@)))/gi, processLinkify);
}

/*
public function processLinkify($matches)
    {
        // if protocol is not set, use http by default
        if (!isset($matches[2])) {
            return '<a href="http://'.$matches[1].'" target="_blank" rel="nofollow">'.$matches[1].'</a>';
        }

        return '<a href="'.$matches[1].'" target="_blank" rel="nofollow">'.$matches[1].'</a>';
    }
*/
/**
 * Process linkify match to clickable link.
 * 
 * @param {string} match
 * @param {string} fullUrl
 * @param {string} proto
 */
function processLinkify(match, fullUrl, proto) {
    // IDK why but their regex sometimes removes these characters at the end.
    // And not that it doesn't match them, it does, but they are not included
    // in the match substring. Its seen in only in 6 posts so far, so I can't
    // determine any pattern to it and just special cased those specific chars.
    fullUrl = fullUrl.replace(/[\u0159\u043b\u301c\u30eb\uf000]$/, '');
    const href = proto ? fullUrl : `http://${fullUrl}`;
    return `<a href="${href}" target="_blank" rel="nofollow">${fullUrl}</a>`;
}

/*
public function processInternalLinks($matches)
    {
        // don't process when $this->num is 0
        if ($this->comment->num == 0) {
            return $matches[0];
        }

        $num = $matches[2];

        // create link object with all relevant information
        $data = new \stdClass();
        $data->num = str_replace(',', '_', $matches[2]);
        $data->board = $this->radix;
        $data->post = $this;

        $current_p_num_c = $this->comment->getPostNum(',');
        $current_p_num_u = $this->comment->getPostNum('_');

        $build_url = [
            'tags' => ['', ''],
            'hash' => '',
            'attr' => 'class="backlink" data-function="highlight" data-backlink="true" data-board="' . $data->board->shortname . '" data-post="' . $data->num . '"',
            'attr_op' => 'class="backlink op" data-function="highlight" data-backlink="true" data-board="' . $data->board->shortname . '" data-post="' . $data->num . '"',
            'attr_backlink' => 'class="backlink" data-function="highlight" data-backlink="true" data-board="' . $data->board->shortname . '" data-post="' . $current_p_num_u . '"',
        ];

        $build_url = Hook::forge('Foolz\FoolFuuka\Model\Comment::processInternalLinks#var.link')
            ->setObject($this)
            ->setParam('data', $data)
            ->setParam('build_url', $build_url)
            ->execute()
            ->get($build_url);

        $this->comment_factory->backlinks_arr[$data->num][$current_p_num_u] = ['build_url' => $build_url, 'data' => $data, 'current_p_num_c' => $current_p_num_c];

        if (isset($this->comment_factory->posts[$this->comment->thread_num]) && in_array($num, $this->comment_factory->posts[$this->comment->thread_num])) {
            return implode('<a href="'.$this->uri->create([$data->board->shortname, $this->controller_method, $this->comment->thread_num]).'#'.$data->num.'" '
                .(array_key_exists($num, $this->comment_factory->posts) ? $build_url['attr_op'] : $build_url['attr'])
                .'>&gt;&gt;'.$num.'</a>', $build_url['tags']);
        }

        return implode('<a href="'.$this->uri->create([$data->board->shortname, 'post', $data->num]).'" '
            .$build_url['attr'].'>&gt;&gt;'.$num.'</a>', $build_url['tags']);
    }
*/

/** @typedef {(match: string, fullMatch: string, num: string) => string} ProcessInternalLinksFunc */

/** @type {{ 'desuarchive.org'?: ProcessInternalLinksFunc, 'arch.b4k.dev'?: ProcessInternalLinksFunc, 'archived.moe'?: ProcessInternalLinksFunc }} */
const processInternalLinksCache = {};

/**
 * Process internal link match to clickable link.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site - The site to process links for
 * @returns {ProcessInternalLinksFunc}
 */
function getProcessInternalLinks(site) {
    let cached = processInternalLinksCache[site];
    if (!cached) {
        processInternalLinksCache[site] = cached = getProcessInternalLinksReal(site);
    }
    return cached;
}

/**
 * Process internal link match to clickable link.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site - The site to process links for
 * @returns {(match: string, fullMatch: string, num: string) => string}
 */
function getProcessInternalLinksReal(site) {

    /**
     * Process internal link match to clickable link.
     * 
     * @param {string} match
     * @param {string} fullMatch
     * @param {string} num
     * @returns {string}
     */
    return function processInternalLinks(match, fullMatch, num) {
        num = num.replace(/,/g, '_');
        return '<a' +
            ` href="https://${site}/mlp/post/${num}/"` +
            ' class="backlink"' +
            ' data-function="highlight"' +
            ' data-backlink="true"' +
            ' data-board="mlp"' +
            ` data-post="${num}">` +
            match +
            '</a>';
    };
}

/*
public function processExternalLinks($matches)
    {
        // create $data object with all results from $matches
        $data = new \stdClass();
        $data->link = $matches[2];
        $data->shortname = $matches[3];
        $data->board = $this->radix_coll->getByShortname($data->shortname);
        $data->query = $matches[4];

        $build_href = [
            // this will wrap the <a> element with a container element [open, close]
            'tags' => ['open' => '', 'close' => ''],

            // external links; defaults to 4chan
            'short_link' => '//boards.4chan.org/'.$data->shortname.'/',
            'query_link' => '//boards.4chan.org/'.$data->shortname.'/thread/'.$data->query,

            // additional attributes + backlinking attributes
            'attributes' => '',
            'backlink_attr' => ' class="backlink" data-function="highlight" data-backlink="true" data-board="'
                .(($data->board)?$data->board->shortname:$data->shortname).'" data-post="'.$data->query.'"'
        ];

        $build_href = Hook::forge('Foolz\FoolFuuka\Model\Comment::processExternalLinks#var.link')
            ->setObject($this)
            ->setParam('data', $data)
            ->setParam('build_href', $build_href)
            ->execute()
            ->get($build_href);

        if (!$data->board) {
            if ($data->query) {
                return implode('<a href="'.$build_href['query_link'].'"'.$build_href['attributes'].'>&gt;&gt;&gt;'.$data->link.'</a>', $build_href['tags']);
            }

            return implode('<a href="'.$build_href['short_link'].'">&gt;&gt;&gt;'.$data->link.'</a>', $build_href['tags']);
        }

        if ($data->query) {
            return implode('<a href="'.$this->uri->create([$data->board->shortname, 'post', $data->query]).'"'
                .$build_href['attributes'].$build_href['backlink_attr'].'>&gt;&gt;&gt;'.$data->link.'</a>', $build_href['tags']);
        }

        return implode('<a href="' . $this->uri->create($data->board->shortname) . '">&gt;&gt;&gt;' . $data->link . '</a>', $build_href['tags']);
    }
*/

/** @typedef {(match: string, fullMatch: string, link: string, shortname: string, query: string) => string} ProcessExternalLinksFunc */

/** @type {{ 'desuarchive.org'?: ProcessExternalLinksFunc, 'arch.b4k.dev'?: ProcessExternalLinksFunc, 'archived.moe'?: ProcessExternalLinksFunc }} */
const processExternalLinksCache = {};

/**
 * Process external link match to clickable link.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site - The site to process links for
 * @returns {ProcessExternalLinksFunc}
 */
function getProcessExternalLinks(site) {
    let cached = processExternalLinksCache[site];
    if (!cached) {
        processExternalLinksCache[site] = cached = getProcessExternalLinksReal(site);
    }
    return cached;
}

/**
 * Process external link match to clickable link.
 * 
 * @param {'desuarchive.org' | 'arch.b4k.dev' | 'archived.moe'} site - The site to process links for
 * @returns {(match: string, fullMatch: string, link: string, shortname: string, query: string) => string}
 */
function getProcessExternalLinksReal(site) {
    const BOARDS = site === 'desuarchive.org'
        ? new Set([
            'a', 'aco', 'an', 'c', 'cgl', 'co', 'd', 'fit', 'g', 'his', 'int', 'k', 'm', 'mlp', 'mu',
            'q', 'qa', 'r9k', 'tg', 'trash', 'vr', 'wsg', 'desu', 'meta'
        ])
        : site === 'arch.b4k.dev'
            ? new Set([
                'g', 'mlp', 'qb', 'v', 'vg', 'vm', 'vmg', 'vp', 'vrpg', 'vst', 'meta',
            ])
            : new Set([
                '3', 'a', 'aco', 'adv', 'an', 'asp', 'b', 'bant', 'biz', 'c', 'can', 'cgl', 'ck', 'cm',
                'co', 'cock', 'con', 'd', 'diy', 'e', 'f', 'fa', 'fap', 'fit', 'fitlit', 'g', 'gd', 'gif',
                'h', 'hc', 'his', 'hm', 'hr', 'i', 'ic', 'int', 'jp', 'k', 'lgbt', 'lit', 'm', 'mlp', 'mlpol',
                'mo', 'mtv', 'mu', 'n', 'news', 'o', 'out', 'outsoc', 'p', 'po', 'pol', 'pw', 'q', 'qa', 'qb',
                'qst', 'r', 'r9k', 's', 's4s', 'sci', 'soc', 'sp', 'spa', 't', 'tg', 'toy', 'trash', 'trv', 'tv',
                'u', 'v', 'vg', 'vint', 'vip', 'vm', 'vmg', 'vp', 'vr', 'vrpg', 'vst', 'vt', 'w', 'wg', 'wsg',
                'wsr', 'x', 'xs', 'y', 'de', 'rp', 'talk'
            ]);

    /**
     * Process external link match to clickable link.
     * 
     * @param {string} match
     * @param {string} fullMatch
     * @param {string} link
     * @param {string} shortname
     * @param {string} query
     * @returns {string}
     */
    return function processExternalLinks(match, fullMatch, link, shortname, query) {
        if (!BOARDS.has(shortname)) {
            if (query) {
                return '<a' +
                    ` href="//boards.4chan.org/${shortname}/thread/${query}">` +
                    match +
                    '</a>';
            }
            return '<a' +
                ` href="//boards.4chan.org/${shortname}/">` +
                match +
                '</a>';
        }

        if (query === '0') {
            query = '';
        }

        if (query) {
            return '<a' +
                ` href="https://${site}/${shortname}/post/${query}/"` +
                ' class="backlink"' +
                ' data-function="highlight"' +
                ' data-backlink="true"' +
                ` data-board="${shortname}"` +
                ` data-post="${query}">` +
                match +
                '</a>';
        }

        return '<a' +
            ` href="https://${site}/${shortname}/">` +
            match +
            '</a>';
    }
}

/**
 * Matches the PHP trim function behavior
 * 
 * @param {string} str
 * @returns {string}
 */
function trim(str) {
    const mb = str.match(/^[\r\n\t\f\v ]*/);
    if (mb && mb[0].length > 0) {
        str = str.substring(mb[0].length);
    }
    const me = str.match(/[\r\n\t\f\v ]*$/);
    if (me && me[0].length > 0) {
        str = str.substring(0, str.length - me[0].length);
    }
    return str;
}

module.exports = {
    processComment,
};