const express = require('express');
const axios = require('axios');
const cors = require('cors');

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
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36' }
    });
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 500;
    res.status(status).send({ message: `Failed to fetch URL: ${error.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
