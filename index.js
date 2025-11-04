// server.js
// This file sets up a simple Node.js backend using Express.
// It is designed to be deployed on a service like Render.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables (not strictly necessary for this simple example, but good practice)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware Setup
// 1. CORS: Allows your GitHub Pages frontend to make requests to this server.
//    In a real application, you should restrict the origin to only your GitHub Pages URL.
app.use(cors({
    origin: '*', // Allowing all origins for easy testing. Replace '*' with your GitHub Pages URL later.
    methods: 'GET'
}));

// 2. Body Parser (for future POST requests)
app.use(express.json());

// --- API Endpoint ---
/**
 * GET /api/message
 * Responds with a greeting, optionally including a name query parameter.
 * Example: /api/message?name=Alice
 */
app.get('/api/message', (req, res) => {
    const name = req.query.name || 'Guest';

    // The backend logic: generate a personalized message
    const message = `Hello, ${name}! This message came directly from your Node.js backend hosted on Render.`;

    res.json({
        greeting: message,
        timestamp: new Date().toISOString()
    });
});

// Basic root route for verification
app.get('/', (req, res) => {
    res.send('Server is running! Access the API at /api/message');
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// Reminder: You will need to install 'express', 'cors', and 'dotenv'.
