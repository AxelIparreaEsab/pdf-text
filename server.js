import http from 'http';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta del handler
const handlerPath = pathToFileURL(path.join(__dirname, 'api/process-pdf.js')).href;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/process-pdf') {
    // Dynamic import para ESM
    const { default: handler } = await import(handlerPath);
    handler(req, res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Backend running ✅');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
