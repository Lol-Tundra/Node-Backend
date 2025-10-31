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

// --- API Route to create a new session ---
app.get('/new-session', (req, res) => {
    const sessionId = uuidv4();
    const session = new Session('/uploads/');
    session.getAuthCredentials = () => null;
    session.handleFileDownload = () => {};
    sessions.set(sessionId, session);
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// --- The Core Proxy Route ---
// This now correctly prefixes the target URL with the session ID for Hammerhead.
app.all(`/${proxy.options.prefix}*`, (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.pathname.split('/')[1];
    const session = sessions.get(sessionId);

    if (session) {
        const jobData = { req, res, session };
        proxy.request(jobData);
    } else {
        res.status(404).send('Session not found.');
    }
});


// --- WebSocket Upgrade Handler ---
server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.pathname.split('/')[1];
    const session = sessions.get(sessionId);

    if (session) {
        session.handleUpgradeRequest(req, socket, head);
    } else {
        socket.destroy();
    }
});

// --- Start the Server ---
server.listen(PORT, () => {
    console.log(`Rammerhead-style proxy server is running on port ${PORT}`);
});
