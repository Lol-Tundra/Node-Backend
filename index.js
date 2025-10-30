// The final, Rammerhead-inspired backend that handles all HTTP methods.
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// Use a raw body parser for all routes to handle any content type.
app.use(express.raw({
  inflate: true,
  limit: '50mb',
  type: () => true, // Apply to all content types
}));

// The client-side script remains the same. It's already robust.
const clientScript = [
    '(function() {',
    '    "use strict";',
    "    const PROXY_HOST = 'https://__PROXY_HOST__';",
    "    const urlParams = new URLSearchParams(window.location.search);",
    "    const targetUrlString = urlParams.get('url');",
    "    if (!targetUrlString) { return; }",
    '    function postParentMessage(message) {',
    '        try { if (window.parent && window.parent !== window) { window.parent.postMessage(message, "*"); } }',
    '        catch (e) { console.error("Proxy script could not post message", e); }',
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
    if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('blob:') || originalUrl.startsWith('javascript:')) return originalUrl;
    try {
        const absoluteUrl = new URL(originalUrl, base).href;
        return 'https://' + host + '/proxy?url=' + encodeURIComponent(absoluteUrl);
    } catch (e) {
        return originalUrl;
    }
}

// Use app.all to handle GET, POST, PUT, DELETE, etc.
app.all('/proxy', async (req, res) => {
    let targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    try {
        const requestHeaders = {};
        Object.keys(req.headers).forEach(key => {
          // Do not forward host header, it will be set by axios
          if (key.toLowerCase() !== 'host') {
            requestHeaders[key] = req.headers[key];
          }
        });

        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body, // Pass the raw body
            responseType: 'arraybuffer',
            validateStatus: () => true,
            headers: requestHeaders,
        });

        // Aggressively clean up headers
        const headersToForward = {};
        for (const header in response.headers) {
            const lowerHeader = header.toLowerCase();
            const headersToRemove = ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'content-security-policy-report-only', 'x-content-type-options', 'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];
            if (!headersToRemove.includes(lowerHeader)) {
                headersToForward[header] = response.headers[header];
            }
        }
        if (headersToForward['set-cookie']) {
            const cookies = Array.isArray(headersToForward['set-cookie']) ? headersToForward['set-cookie'] : [headersToForward['set-cookie']];
            headersToForward['set-cookie'] = cookies.map(cookie => cookie.replace(/domain=[^;]+;?/gi, '').replace(/SameSite=None/gi, 'SameSite=Lax'));
        }
        headersToForward['Access-Control-Allow-Origin'] = '*';
        
        if (response.status >= 300 && response.status < 400 && headersToForward.location) {
            const redirectUrl = new URL(headersToForward.location, targetUrl).href;
            headersToForward.location = 'https://' + req.get('host') + '/proxy?url=' + encodeURIComponent(redirectUrl);
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
                let srcset = $(this).attr(attr);
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
        res.status(500).send('Error in proxy request: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log('Full-method proxy server is running on port ' + PORT);
});
