const express = require('http');
const http = require('http');
// Use a more robust import style for hammerhead
const hammerhead = require('testcafe-hammerhead');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Hammerhead Setup ---
const proxy = new hammerhead.Proxy();
const sessions = new Map();

// --- Middleware to handle the raw request body ---
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
    const session = new hammerhead.Session('/uploads/'); 
    
    session.getAuthCredentials = () => null;
    session.handleFileDownload = () => {};

    sessions.set(sessionId, session);
    
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// --- The Core Proxy Route ---
app.all('/proxy/:sessionId/*', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).send('Session not found or has expired. Please create a new tab.');
    }

    const targetUrl = req.originalUrl.replace(`/proxy/${sessionId}/`, '');

    try {
        const jobData = {
            req: req,
            res: res,
            session: session,
            isPage: !req.headers['x-requested-with'],
            isAjax: !!req.headers['x-requested-with'],
        };
        
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

// NOTE: The proxy.attach method for WebSockets is removed to prevent the server from crashing.
// This is a known limitation in this simplified setup.

server.listen(PORT, () => {
    console.log(`Hammerhead-powered proxy server is running on port ${PORT}`);
});
