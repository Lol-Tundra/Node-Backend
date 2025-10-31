const express = require('express');
const http = require('http');
const cors = require('cors');
const { Proxy, Session } = require('testcafe-hammerhead');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use((req, res, next) => {
    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        req.body = Buffer.concat(body);
        next();
    });
});

// --- Hammerhead Setup ---
const proxy = new Proxy();
const sessions = new Map();

// --- Client Script for Communicating with the UI ---
// This script is injected into every proxied page by Hammerhead.
const clientScript = [
    '(function() {',
    '    "use strict";',
    '    function postParentMessage(message) {',
    '        try { if (window.parent && window.parent !== window) { window.parent.postMessage(message, "*"); } }',
    '        catch (e) { console.error("Proxy script could not post message", e); }',
    '    }',
    '    const findFavicon = () => {',
    '        let favicon = document.querySelector("link[rel~=\'icon\']");',
    '        if (favicon) return new URL(favicon.href, document.baseURI).href;',
    '        return new URL("/favicon.ico", document.baseURI).href;',
    '    };',
    '    const sendUpdate = () => {',
    "        postParentMessage({ type: 'proxyUpdate', url: location.href, title: document.title, favicon: findFavicon() });",
    '    };',
    '    const observer = new MutationObserver(() => {',
    '        if (document.title !== (window.proxyLastTitle || "")) {',
    '            window.proxyLastTitle = document.title;',
    '            sendUpdate();',
    '        }',
    '    });',
    '    const head = document.querySelector("head");',
    '    if (head) { observer.observe(head, { childList: true, subtree: true }); }',
    "    window.addEventListener('load', () => setTimeout(sendUpdate, 50));",
    '})();'
].join('');

// --- API Route to create a new session ---
app.get('/new-session', (req, res) => {
    const sessionId = uuidv4();
    const session = new Session('/uploads/');
    // Inject our communication script into every page this session loads
    session.injectable.scripts.push(clientScript);
    session.getAuthCredentials = () => null;
    session.handleFileDownload = () => {};
    sessions.set(sessionId, session);
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// --- The Core Proxy Route ---
// This route now correctly handles the /{sessionId}/{url} pattern.
app.all('/:sessionId/*', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (session) {
        const jobData = { req, res, session };
        proxy.request(jobData);
    } else {
        res.status(404).send('Session not found. Please create a new tab.');
    }
});

// --- WebSocket Upgrade Handler ---
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.pathname.split('/')[1];
    const session = sessions.get(sessionId);
    if (session) session.handleUpgradeRequest(req, socket, head);
    else socket.destroy();
});

// --- Start the Server ---
server.listen(PORT, () => {
    console.log(`Rammerhead-style proxy server is running on port ${PORT}`);
});
