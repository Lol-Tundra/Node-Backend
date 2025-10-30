// A new, more powerful version of index.js that can handle video streaming
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// The client-side script remains the same, it's already doing its job.
const clientScript = [
    '(function() {',
    '    "use strict";',
    "    const PROXY_HOST = 'https://__PROXY_HOST__';",
    "    const urlParams = new URLSearchParams(window.location.search);",
    "    const targetUrlString = urlParams.get('url');",
    "    if (!targetUrlString) { return; }",
    '    try {',
    '        if (window.parent && window.parent !== window) {',
    "            window.parent.postMessage({ type: 'proxyUrlUpdate', url: targetUrlString }, '*');",
    '        }',
    '    } catch (e) { console.error("Proxy script could not post message", e); }',
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
        // Forward range headers for video streaming
        if (req.headers.range) {
            requestHeaders.range = req.headers.range;
        }

        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            validateStatus: () => true, // Handle all status codes ourselves
            headers: requestHeaders,
        });

        // Clean up and forward response headers
        const headersToForward = {};
        const allowedHeaders = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'date', 'last-modified'];
        for (const header in response.headers) {
            if (allowedHeaders.includes(header.toLowerCase())) {
                headersToForward[header] = response.headers[header];
            }
        }
        
        // Add our own permissive CORS headers
        headersToForward['Access-Control-Allow-Origin'] = '*';

        // Handle redirects
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const redirectUrl = new URL(response.headers.location, targetUrl).href;
            const proxiedRedirectUrl = 'https://' + req.get('host') + '/proxy?url=' + encodeURIComponent(redirectUrl);
            res.setHeader('Location', proxiedRedirectUrl);
            res.status(response.status).send();
            return;
        }
        
        res.set(headersToForward);
        res.status(response.status);

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
    console.log('Video-capable proxy server is running on port ' + PORT);
});
