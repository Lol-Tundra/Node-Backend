// The definitive, video-capable version of index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// The client-side script now also sends the page title for the tab system.
const clientScript = [
    '(function() {',
    '    "use strict";',
    "    const PROXY_HOST = 'https://__PROXY_HOST__';",
    "    const urlParams = new URLSearchParams(window.location.search);",
    "    const targetUrlString = urlParams.get('url');",
    "    if (!targetUrlString) { return; }",

    '    function postParentMessage(message) {',
    '        try {',
    '            if (window.parent && window.parent !== window) {',
    "                window.parent.postMessage(message, '*');",
    '            }',
    '        } catch (e) { console.error("Proxy script could not post message", e); }',
    '    }',

    "    postParentMessage({ type: 'proxyUrlUpdate', url: targetUrlString });",
    
    '    const observer = new MutationObserver(() => {',
    '        if (document.title !== (window.proxyLastTitle || "")) {',
    '            window.proxyLastTitle = document.title;',
    "            postParentMessage({ type: 'proxyTitleUpdate', title: document.title });",
    '        }',
    '    });',
    '    const head = document.querySelector("head");',
    '    if (head) { observer.observe(head, { childList: true, subtree: true }); }',

    "    const targetUrl = new URL(targetUrlString);",
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
        const requestHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
            'Accept': req.headers['accept'] || '*/*',
            'Referer': new URL(targetUrl).origin,
        };
        if (req.headers.range) {
            requestHeaders.range = req.headers.range;
        }
        if (req.headers.cookie) {
            requestHeaders.cookie = req.headers.cookie;
        }

        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: requestHeaders,
        });

        // Aggressively strip security headers and manage cookies
        const headersToForward = {};
        for (const header in response.headers) {
            const lowerHeader = header.toLowerCase();
            const headersToRemove = ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'content-security-policy-report-only', 'x-content-type-options', 'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];
            if (!headersToRemove.includes(lowerHeader)) {
                headersToForward[header] = response.headers[header];
            }
        }

        // Rewrite Set-Cookie headers
        if (headersToForward['set-cookie']) {
            const cookies = Array.isArray(headersToForward['set-cookie']) ? headersToForward['set-cookie'] : [headersToForward['set-cookie']];
            headersToForward['set-cookie'] = cookies.map(cookie => cookie.replace(/domain=[^;]+;?/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax'));
        }
        
        headersToForward['Access-Control-Allow-Origin'] = '*';

        if (response.status >= 300 && response.status < 400 && headersToForward.location) {
            const redirectUrl = new URL(headersToForward.location, targetUrl).href;
            const proxiedRedirectUrl = 'https://' + req.get('host') + '/proxy?url=' + encodeURIComponent(redirectUrl);
            res.setHeader('Location', proxiedRedirectUrl);
            res.status(response.status).send();
            return;
        }
        
        res.status(response.status).set(headersToForward);

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
                    const val = $(this).attr(attr);
                    if (val) $(this).attr(attr, rewriteUrlForServer(val, targetUrl, host));
                });
            });
            $('img[srcset], source[srcset]').each(function() {
                let srcset = $(this).attr('srcset');
                if (srcset) {
                    const newSrcset = srcset.split(',').map(p => p.trim().split(/\s+/).map((v, i) => i === 0 ? rewriteUrlForServer(v, targetUrl, host) : v).join(' ')).join(', ');
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
            res.send(rewrittenCss);
        } else {
            res.send(response.data);
        }
    } catch (error) {
        res.status(500).send('Error fetching the URL: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log('Advanced proxy server with robust cookie/header handling is running on port ' + PORT);
});
