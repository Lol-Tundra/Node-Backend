// A new, safer version of index.js using only single quotes for strings
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// This is the client-side "agent" script that will be injected into pages.
const clientScript = [
    '(function() {',
    '    "use strict";',
    "    const PROXY_HOST = 'https://__PROXY_HOST__';",
    "    const targetUrl = new URL(location.search.split('url=')[1]);",
    '    function rewriteUrl(url, base) {',
    "        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) { return url; }",
    '        try {',
    "            const absoluteUrl = new URL(url, base || targetUrl.href).href;",
    "            return PROXY_HOST + '/proxy?url=' + encodeURIComponent(absoluteUrl);",
    '        } catch(e) { return url; }',
    '    }',
    '    const originalFetch = window.fetch;',
    '    window.fetch = function(input, init) {',
    "        if (typeof input === 'string') { input = rewriteUrl(input); }",
    '        return originalFetch.apply(this, arguments);',
    '    };',
    '    const originalXhrOpen = window.XMLHttpRequest.prototype.open;',
    '    window.XMLHttpRequest.prototype.open = function(method, url) {',
    '        if (url) { arguments[1] = rewriteUrl(url, document.baseURI); }',
    '        return originalXhrOpen.apply(this, arguments);',
    '    };',
    '    const originalSetAttribute = Element.prototype.setAttribute;',
    '    Element.prototype.setAttribute = function(name, value) {',
    "        const attrs = ['src', 'href', 'action', 'data'];",
    '        if (attrs.includes(name)) { value = rewriteUrl(value, this.baseURI); }',
    '        return originalSetAttribute.call(this, name, value);',
    '    };',
    '})();'
].join('');


app.use(cors());

function rewriteUrlForServer(originalUrl, base, host) {
    if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('blob:') || originalUrl.startsWith('javascript:')) {
        return originalUrl;
    }
    try {
        const absoluteUrl = new URL(originalUrl, base).href;
        return 'https://' + host + '/proxy?url=' + encodeURIComponent(absoluteUrl);
    } catch (e) {
        return originalUrl;
    }
}

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            validateStatus: status => status < 500,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36' }
        });

        const contentType = response.headers['content-type'] || '';
        const host = req.get('host');

        if (contentType.includes('text/html')) {
            let html = Buffer.from(response.data).toString('utf-8');
            const $ = cheerio.load(html);

            const injectedScript = clientScript.replace('__PROXY_HOST__', host);
            $('head').prepend('<script>' + injectedScript + '</script>');
            $('head').prepend('<base href="' + targetUrl + '">');

            ['href', 'src', 'action', 'data'].forEach(attr => {
                $('[' + attr + ']').each(function() {
                    const originalUrl = $(this).attr(attr);
                    if (originalUrl) {
                        const newUrl = rewriteUrlForServer(originalUrl, targetUrl, host);
                        $(this).attr(attr, newUrl);
                    }
                });
            });

            $('img[srcset], source[srcset]').each(function() {
                let srcset = $(this).attr('srcset');
                if (srcset) {
                    const newSrcset = srcset.split(',').map(part => {
                        const [url, descriptor] = part.trim().split(/\s+/);
                        return rewriteUrlForServer(url, targetUrl, host) + ' ' + (descriptor || '');
                    }).join(', ');
                    $(this).attr('srcset', newSrcset);
                }
            });

            res.send($.html());
        } else if (contentType.includes('text/css')) {
            let css = Buffer.from(response.data).toString('utf-8');
            const rewrittenCss = css.replace(/url\((?!['"]?data:)([^)]+)\)/g, (match, url) => {
                 const cleanedUrl = url.replace(/['"]/g, '');
                 return 'url(' + rewriteUrlForServer(cleanedUrl, targetUrl, host) + ')';
            });
            res.type('text/css').send(rewrittenCss);
        } else {
            res.send(response.data);
        }
    } catch (error) {
        res.status(500).send('Error fetching the URL: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log('Advanced proxy server is running on port ' + PORT);
});
