const express = require('express');
const Hammerhead = require('testcafe-hammerhead');
const { v4: uuidv4 } = require('uuid'); // Hammerhead uses uuid

const app = express();
const PORT = process.env.PORT || 3001;
const hammerhead = new Hammerhead();

// Endpoint for the frontend to get a new session ID
app.get('/new-session', (req, res) => {
    const sessionId = hammerhead.openSession();
    console.log(`Created new session: ${sessionId}`);
    res.json({ sessionId });
});

// The core proxy route. It will handle all methods (GET, POST, etc.)
app.all('/proxy/:sessionId/*', async (req, res) => {
    const { sessionId } = req.params;
    const session = hammerhead.getSession(sessionId);

    if (!session) {
        return res.status(404).send('Session not found. Please refresh the page.');
    }

    // Reconstruct the target URL from the request path
    const targetUrl = req.path.replace(`/proxy/${sessionId}/`, '');

    try {
        const proxyRequestOptions = {
            url: targetUrl,
            method: req.method,
            headers: req.headers,
            body: req.body,
            rawRequest: true // Ensure we get raw response for streaming
        };

        const proxyResponse = await session.handleRequest(proxyRequestOptions);

        res.status(proxyResponse.statusCode);
        res.set(proxyResponse.headers);
        res.send(proxyResponse.body);

    } catch (error) {
        console.error('Proxying error:', error);
        res.status(500).send(error.message || 'An error occurred during proxying.');
    }
});

app.listen(PORT, () => {
    console.log(`Hammerhead-powered proxy server is running on port ${PORT}`);
});
