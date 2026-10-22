const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'dist');
const configuredUrl = (process.env.VITE_API_BASE_URL || '').trim();

if (!configuredUrl) {
  throw new Error('Set VITE_API_BASE_URL in the Vercel project settings to your Render service URL.');
}

const parsedUrl = new URL(configuredUrl);
if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
  throw new Error('VITE_API_BASE_URL must be a public HTTP(S) URL without credentials.');
}

const backendBase = parsedUrl.toString().replace(/\/+$/, '').replace(/\/api$/i, '');
const apiUrl = `${backendBase}/api`;

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const entry of ['index.html', 'css', 'img', 'js', 'templates']) {
  const source = path.join(root, entry);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(output, entry), { recursive: true });
}

fs.writeFileSync(path.join(output, 'js', 'config.js'), `window.API_BASE_URL = ${JSON.stringify(apiUrl)};\n`, 'utf8');
console.log(`Built frontend for ${backendBase}`);
