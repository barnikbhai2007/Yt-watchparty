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
