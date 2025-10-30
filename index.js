// The new, powerful index.js for your backend
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio =require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// This is the client-side "agent" script that will be injected into pages.
// It intercepts network requests and rewrites URLs.
const clientScript = `
(function() {
    'use strict';
    const PROXY_HOST = 'https://__PROXY_HOST__'; // This will be replaced by the server
    const targetUrl = new URL(location.search.split('url=')[1]);

    function rewriteUrl(url, base) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
            return url;
        }
        try {
            const absoluteUrl = new URL(url, base || targetUrl.href).href;
            return \`\${PROXY_HOST}/proxy?url=\${encodeURIComponent(absoluteUrl)}\`;
        } catch(e) {
            return url;
        }
    }

    // Hook Fetch API
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            input = rewriteUrl(input);
        }
        return originalFetch.apply(this, arguments);
    };

    // Hook XHR
    const originalXhrOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
        if (url) {
            arguments[1] = rewriteUrl(url, document.baseURI);
        }
        return originalXhrOpen.apply(this, arguments);
    };

    // Hook element attributes
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        const attrs = ['src', 'href', 'action', 'data'];
        if (attrs.includes(name)) {
            value = rewriteUrl(value, this.baseURI);
        }
        return originalSetAttribute.call(this, name, value);
    };
})();
`;

app.use(cors());

app.get('/proxy', async (req, res) => {
    let targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            validateStatus: status => status < 500, // Process redirects ourselves
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const contentType = response.headers['content-type'] || '';
        const host = req.get('host');

        if (contentType.includes('text/html')) {
            let html = Buffer.from(response.data).toString('utf-8');
            const $ = cheerio.load(html);

            // Inject the client-side agent
            const injectedScript = clientScript.replace('__PROXY_HOST__', host);
            $('head').prepend(\`<script>\${injectedScript}</script>\`);
            
            // Add a base tag to handle relative paths correctly
            $('head').prepend(\`<base href="\${targetUrl}">\`);

            // Rewrite static attributes
            ['href', 'src', 'action', 'data'].forEach(attr => {
                $(`[${attr}]`).each(function() {
                    const originalUrl = $(this).attr(attr);
                    if (originalUrl) {
                        const newUrl = rewriteUrl(originalUrl, targetUrl, host);
                        $(this).attr(attr, newUrl);
                    }
                });
            });

             // Rewrite srcset for images
            $('img[srcset], source[srcset]').each(function() {
                let srcset = $(this).attr('srcset');
                if (srcset) {
                    const newSrcset = srcset.split(',').map(part => {
                        const [url, descriptor] = part.trim().split(/\s+/);
                        return \`\${rewriteUrl(url, targetUrl, host)} \${descriptor || ''}\`;
                    }).join(', ');
                    $(this).attr('srcset', newSrcset);
                }
            });

            res.send($.html());
        } else if (contentType.includes('text/css')) {
            let css = Buffer.from(response.data).toString('utf-8');
            const rewrittenCss = css.replace(/url\\((?!['"]?data:)([^)]+)\\)/g, (match, url) => {
                 const cleanedUrl = url.replace(/['"]/g, '');
                 return \`url(\${rewriteUrl(cleanedUrl, targetUrl, host)})\`;
            });
            res.type('text/css').send(rewrittenCss);
        } else {
            res.send(response.data);
        }
    } catch (error) {
        res.status(500).send('Error fetching the URL.');
    }
});

function rewriteUrl(originalUrl, base, host) {
    if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('blob:') || originalUrl.startsWith('javascript:')) {
        return originalUrl;
    }
    try {
        const absoluteUrl = new URL(originalUrl, base).href;
        return \`https://\${host}/proxy?url=\${encodeURIComponent(absoluteUrl)}\`;
    } catch(e) {
        return originalUrl;
    }
}


app.listen(PORT, () => {
    console.log(\`Rammerhead-inspired proxy server is running on port \${PORT}\`);
});
