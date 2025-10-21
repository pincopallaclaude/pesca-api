// server.test.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    console.log(`[TEST SERVER] Received request on /`);
    res.send('Hello World from Test Server!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TEST SERVER] Minimal server listening on port ${PORT} at host 0.0.0.0`);
});