const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send({ message: 'URL is required' });
    }

    try {
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer', // Use arraybuffer to handle all content types
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36',
                'Referer': new URL(targetUrl).origin // Set a referer header
            }
        });

        const contentType = response.headers['content-type'] || '';

        // If it's not HTML, just send the data directly
        if (!contentType.includes('text/html')) {
            res.set('Content-Type', contentType);
            return res.send(response.data);
        }

        // If it is HTML, we need to rewrite URLs
        const html = Buffer.from(response.data).toString('utf-8');
        const $ = cheerio.load(html);

        const resolveUrl = (relativeUrl) => new URL(relativeUrl, targetUrl).href;

        // Rewrite attributes for various tags
        const attributesToRewrite = {
            'a': 'href',
            'link': 'href',
            'img': 'src',
            'script': 'src',
            'source': 'src',
            'form': 'action'
        };

        for (const selector in attributesToRewrite) {
            const attr = attributesToRewrite[selector];
            $(selector).each((i, el) => {
                const value = $(el).attr(attr);
                if (value && !value.startsWith('data:') && !value.startsWith('http')) {
                     const absoluteUrl = resolveUrl(value);
                     // Use YOUR backend URL here. Render provides this as an env var.
                     const proxyUrl = `https://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                     $(el).attr(attr, proxyUrl);
                }
            });
        }
        
        res.set('Content-Type', contentType);
        res.send($.html());

    } catch (error) {
        console.error("Error fetching the URL:", error.message);
        const status = error.response ? error.response.status : 500;
        res.status(status).send({ message: `Failed to fetch URL: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`Advanced proxy server is running on port ${PORT}`);
});
