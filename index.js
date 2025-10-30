const express = require('express');
const http = require('http');
const cors = require('cors'); // Import the CORS library
const { Proxy, Session } = require('testcafe-hammerhead');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// --- Middleware ---
// CRITICAL FIX: Enable CORS for all routes. This allows the frontend to communicate with this backend.
app.use(cors());

// Hammerhead needs the raw request body to correctly process POST requests.
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
    };
    
    proxy.request(jobData);
});

// --- WebSocket Upgrade Handler ---
server.on('upgrade', (req, socket, head) => {
    // Reconstruct a full URL to make it parseable
    const fullUrl = `http://${req.headers.host}${req.url}`;
    const url = new URL(fullUrl);
    const parts = url.pathname.split('/');
    
    // Expecting URL structure: /proxy/SESSION_ID/...
    if (parts[1] === 'proxy' && parts[2]) {
        const sessionId = parts[2];
        const session = sessions.get(sessionId);

        if (session) {
            console.log(`WebSocket: Upgrading for session ${sessionId}`);
            session.handleUpgradeRequest(req, socket, head);
        } else {
            console.log('WebSocket: Unknown session, destroying socket.');
            socket.destroy();
        }
    } else {
        socket.destroy();
    }
});

// --- Start the Server ---
server.listen(PORT, () => {
    console.log(`Hammerhead-powered proxy server is running on port ${PORT}`);
});
