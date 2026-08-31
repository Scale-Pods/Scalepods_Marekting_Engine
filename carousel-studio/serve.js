// Minimal static file server for previewing/rendering slides — no framework, just
// Node's built-in http+fs. Serves the carousel-studio/ directory itself so slide HTML
// can reference ../base.css, ../vendor/gsap.min.js, ../assets/*.png etc with normal
// relative paths, exactly as they will when headless Chrome screenshots them later.
//
// Usable two ways:
//   - as a CLI: `node serve.js` (used by the Browser-pane preview via .claude/launch.json)
//   - as a module: `const { startServer } = require('./serve')` (used by render.js, which
//     needs to start/stop its own instance rather than depend on one already running)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json',
};

function startServer(port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  const port = process.env.PORT || 4173;
  startServer(port).then(() => console.log(`Carousel Studio preview server on http://localhost:${port}`));
}

module.exports = { startServer };
