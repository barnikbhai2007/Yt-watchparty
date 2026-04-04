import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Proxy API to bypass CORS
app.get('/api/proxy/search', async (req, res) => {
  const { q, type } = req.query;
  const searchUrl = type === 'music'
    ? `https://yt-search-nine.vercel.app/music?q=${encodeURIComponent(q as string)}`
    : `https://yt-search-nine.vercel.app/search?q=${encodeURIComponent(q as string)}`;

  try {
    const response = await axios.get(searchUrl);
    res.json(response.data);
  } catch (error: any) {
    console.error("Proxy search failed:", error.message);
    res.status(error.response?.status || 500).json({ error: "Proxy search failed" });
  }
});

app.get('/api/proxy/oembed', async (req, res) => {
  const { url } = req.query;
  try {
    const response = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url as string)}&format=json`);
    res.json(response.data);
  } catch (error: any) {
    console.error("Proxy oembed failed:", error.message);
    res.status(error.response?.status || 500).json({ error: "Proxy oembed failed" });
  }
});

app.get('/api/tidal/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const response = await axios({
      method: 'GET',
      url: url as string,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    // Forward relevant headers
    const headersToForward = ['content-type', 'content-length', 'accept-ranges'];
    headersToForward.forEach(h => {
      if (response.headers[h]) res.setHeader(h, response.headers[h]);
    });

    response.data.pipe(res);
  } catch (error: any) {
    console.error(`[Stream Proxy] Failed: ${error.message}`);
    res.status(500).json({ error: "Streaming failed" });
  }
});

app.use('/api/tidal', async (req, res) => {
  const targetUrl = `https://hifi-api-production.up.railway.app${req.url}`;
  console.log(`[Tidal Proxy] ${req.method} ${req.url} -> ${targetUrl}`);
  
  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      validateStatus: () => true // Handle all status codes
    });
    
    // If target returns HTML but we expect JSON, log it
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html') && !req.url.includes('stream')) {
      console.warn(`[Tidal Proxy] Warning: Target returned HTML for ${req.url}`);
    }
    
    res.status(response.status).send(response.data);
  } catch (error: any) {
    console.error(`[Tidal Proxy] Failed: ${error.message}`);
    res.status(500).json({ error: "Tidal proxy failed", message: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
