const express = require('express');
const http = require('http');
const { Proxy, Session } = require('testcafe-hammerhead');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app); // Create the HTTP server upfront
const PORT = process.env.PORT || 3001;

// --- Hammerhead Setup ---
const proxy = new Proxy();
const sessions = new Map();

// --- Middleware for Raw Body ---
// Hammerhead needs the raw request body to correctly handle POST requests.
app.use((req, res, next) => {
    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        req.body = Buffer.concat(body);
        next();
    });
});

// --- API Route to create a new session ---
app.get('/new-session', (req, res) => {
    const sessionId = uuidv4();
    // Modern Hammerhead requires an options object for the Session constructor.
    const session = new Session('/uploads/', {
        disablePageCaching: true,
        allowMultipleWindows: false // Set to false for a simpler tab-based model
    });

    // These methods are required by Hammerhead's internal typings.
    session.getAuthCredentials = () => null;
    session.handleFileDownload = () => {};

    sessions.set(sessionId, session);
    
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// --- The Core HTTP Proxy Route ---
app.all('/proxy/:sessionId/*', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).send('Session not found. Please create a new tab.');
    }

    const jobData = {
        req: req,
        res: res,
        session: session,
        isPage: !req.headers['x-requested-with'],
        isAjax: !!req.headers['x-requested-with'],
    };
    
    // The main method to process a standard HTTP request
    proxy.request(jobData);
});

// --- THE KEY FIX: WebSocket Upgrade Handler ---
// This is what allows video players and live-chat sites to work.
server.on('upgrade', (req, socket, head) => {
    // Hammerhead identifies the session from the URL.
    const url = new URL(req.url, `http://${req.headers.host}`);
    const parts = url.pathname.split('/');
    
    // Expecting URL structure like: /proxy/SESSION_ID/ws...
    if (parts[1] === 'proxy' && parts[2]) {
        const sessionId = parts[2];
        const session = sessions.get(sessionId);

        if (session) {
            console.log(`Handling WebSocket upgrade for session: ${sessionId}`);
            // This is the correct modern method to handle WebSockets.
            session.handleUpgradeRequest(req, socket, head);
        } else {
            console.log('WebSocket upgrade for unknown session, destroying socket.');
            socket.destroy();
        }
    } else {
        socket.destroy();
    }
});


// --- Start the Server ---
server.listen(PORT, () => {
    console.log(`Modern Hammerhead-powered proxy server is running on port ${PORT}`);
});
