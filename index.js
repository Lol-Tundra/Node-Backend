const express = require('express');
const http = require('http');
const { Proxy, Session } = require('testcafe-hammerhead'); // Correct way to import the classes
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Hammerhead Setup ---
const proxy = new Proxy();
// We will store active session instances in a simple Map.
const sessions = new Map();

// --- Middleware to handle the raw request body ---
// Hammerhead needs the raw body buffer to correctly process POST requests.
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
    // Each session needs a directory for file uploads, even if we don't use it.
    const session = new Session('/uploads/'); 
    
    // These methods are required by Hammerhead's internal typings.
    session.getAuthCredentials = () => null;
    session.handleFileDownload = () => {};

    sessions.set(sessionId, session);
    
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// --- The Core Proxy Route ---
// This handles ALL methods (GET, POST, etc.) and all paths for a given session.
app.all('/proxy/:sessionId/*', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).send('Session not found or has expired. Please create a new tab.');
    }

    // Reconstruct the target URL from the wildcard part of the request path.
    const targetUrl = req.originalUrl.replace(`/proxy/${sessionId}/`, '');

    try {
        // This 'job' object tells Hammerhead everything it needs to process the request.
        const jobData = {
            req: req,
            res: res,
            session: session,
            isPage: !req.headers['x-requested-with'], // A simple heuristic to detect page loads vs API calls
            isAjax: !!req.headers['x-requested-with'],
        };
        
        // This is the primary method to process a request through the Hammerhead engine.
        proxy.request(jobData);

    } catch (error) {
        console.error(`[Hammerhead Error] for ${targetUrl}:`, error);
        if (!res.headersSent) {
            res.status(500).send('An internal proxy error occurred.');
        }
    }
});

// --- Server Setup ---
const server = http.createServer(app);

// Hammerhead needs to attach to the HTTP server to handle WebSockets correctly.
proxy.attach(server);

server.listen(PORT, () => {
    console.log(`Hammerhead-powered proxy server is running on port ${PORT}`);
});
