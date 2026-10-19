import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { google } from 'googleapis';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = Number(process.env.PORT || 8787);
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));

const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const oauth = oauthConfigured ? new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`
) : null;
let googleTokens = null; // Development starter only: memory storage. Use encrypted persistent storage in production.
const sessions = new Map();
const sockets = new Map();
const id = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function sessionFor(req, role) {
  const s = sessions.get(req.params.sessionId);
  if (!s) return null;
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const expected = role === 'tv' ? s.tvToken : s.mobileToken;
  return safeEqual(token, expected) ? s : null;
}
function publicState(s) {
  return { sessionId: s.sessionId, createdAt: s.createdAt, state: s.state };
}
function broadcast(s, message) {
  for (const role of ['tv', 'mobile']) {
    const ws = sockets.get(`${s.sessionId}:${role}`);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
}
function driveClient() {
  if (!oauth || !googleTokens) return null;
  oauth.setCredentials(googleTokens);
  return google.drive({ version: 'v3', auth: oauth });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, googleOAuthConfigured: oauthConfigured }));
app.get('/auth/google', (_req, res) => {
  if (!oauth) return res.status(503).send('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  const url = oauth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive.readonly'] });
  res.redirect(url);
});
app.get('/auth/google/callback', async (req, res) => {
  if (!oauth) return res.status(503).send('Google OAuth is not configured.');
  try {
    const { tokens } = await oauth.getToken(String(req.query.code || ''));
    googleTokens = tokens;
    res.redirect(`${APP_BASE_URL}/?drive=connected`);
  } catch (e) { console.error('OAuth callback failed:', e.message); res.status(400).send('Google sign-in failed. Check OAuth redirect URI and server logs.'); }
});
app.get('/api/drive/status', (_req, res) => res.json({ connected: Boolean(googleTokens), configured: oauthConfigured }));
app.get('/api/drive/files', async (req, res) => {
  const drive = driveClient();
  if (!drive) return res.status(401).json({ error: 'Connect Google Drive first.' });
  try {
    const qParts = ['trashed = false'];
    if (req.query.parent) qParts.push(`'${String(req.query.parent).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents`);
    const q = String(req.query.q || '').trim();
    if (q) qParts.push(`name contains '${q.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    const r = await drive.files.list({
      q: qParts.join(' and '), pageSize: Math.min(Number(req.query.limit || 100), 100),
      pageToken: req.query.pageToken || undefined,
      orderBy: 'folder,name',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,parents,videoMediaMetadata,imageMediaMetadata)',
      supportsAllDrives: false
    });
    res.json({ files: r.data.files || [], nextPageToken: r.data.nextPageToken || null });
  } catch (e) { console.error('Drive list failed:', e.message); res.status(502).json({ error: 'Could not list Drive files. Check OAuth permissions and server logs.' }); }
});
app.get('/api/drive/stream/:fileId', async (req, res) => {
  const drive = driveClient();
  if (!drive) return res.status(401).send('Connect Google Drive first.');
  try {
    const metadata = await drive.files.get({ fileId: req.params.fileId, fields: 'id,name,mimeType,size' });
    res.setHeader('Content-Type', metadata.data.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    if (metadata.data.size) res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    const options = { fileId: req.params.fileId, alt: 'media' };
    const requestOptions = { responseType: 'stream' };
    if (range && metadata.data.size) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), Number(metadata.data.size) - 1) : Number(metadata.data.size) - 1;
        if (start <= end && start < Number(metadata.data.size)) {
          requestOptions.headers = { Range: `bytes=${start}-${end}` };
          res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${metadata.data.size}`);
          res.setHeader('Content-Length', String(end - start + 1));
        } else return res.status(416).end();
      }
    }
    const upstream = await drive.files.get(options, requestOptions);
    upstream.data.on('error', () => { if (!res.headersSent) res.status(502); res.end(); });
    upstream.data.pipe(res);
  } catch (e) { console.error('Drive stream failed:', e.message); if (!res.headersSent) res.status(502).send('Unable to stream this Drive file.'); }
});

app.post('/api/sessions', (_req, res) => {
  const sessionId = id(12);
  const s = { sessionId, tvToken: id(), mobileToken: id(), pairToken: id(18), createdAt: Date.now(), state: { currentFile: null, playing: false, currentTime: 0, duration: 0, volume: 1, updatedAt: Date.now() } };
  sessions.set(sessionId, s);
  // Starter QR URL: mobile obtains a short-lived control token by exchanging the pairing token.
  res.json({ sessionId, tvToken: s.tvToken, pairUrl: `${APP_BASE_URL}/remote?session=${encodeURIComponent(sessionId)}&pair=${encodeURIComponent(s.pairToken)}` });
});
app.post('/api/sessions/:sessionId/pair', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s || Date.now() - s.createdAt > 12 * 60 * 60 * 1000) return res.status(404).json({ error: 'TV session expired. Refresh the TV page to create a new QR code.' });
  if (!safeEqual(String(req.body.pairToken || ''), s.pairToken)) return res.status(403).json({ error: 'Invalid pairing link.' });
  s.pairToken = id(18); // single-use pairing credential
  res.json({ mobileToken: s.mobileToken, state: s.state });
});
app.get('/api/sessions/:sessionId/state', (req, res) => {
  const role = req.query.role === 'tv' ? 'tv' : 'mobile';
  const s = sessionFor(req, role);
  if (!s) return res.status(401).json({ error: 'Invalid session token.' });
  res.json(publicState(s));
});
app.post('/api/sessions/:sessionId/command', (req, res) => {
  const s = sessionFor(req, 'mobile');
  if (!s) return res.status(401).json({ error: 'Invalid mobile session token.' });
  const { type, file, value } = req.body || {};
  const allowed = new Set(['play', 'pause', 'toggle', 'seek', 'volume', 'select', 'stop', 'next', 'previous']);
  if (!allowed.has(type)) return res.status(400).json({ error: 'Unsupported command.' });
  if (type === 'select' && (!file || typeof file.id !== 'string' || typeof file.mimeType !== 'string')) return res.status(400).json({ error: 'A valid file is required.' });
  if (type === 'select') { s.state.currentFile = { id: file.id, name: String(file.name || 'Untitled'), mimeType: file.mimeType }; s.state.currentTime = 0; s.state.playing = true; }
  if (type === 'play') s.state.playing = true;
  if (type === 'pause' || type === 'stop') s.state.playing = false;
  if (type === 'stop') s.state.currentTime = 0;
  if (type === 'seek' && Number.isFinite(Number(value))) s.state.currentTime = Math.max(0, Number(value));
  if (type === 'volume' && Number.isFinite(Number(value))) s.state.volume = Math.max(0, Math.min(1, Number(value)));
  s.state.updatedAt = Date.now();
  const message = { type: 'state', state: s.state, command: { type, value, file } };
  broadcast(s, message);
  res.json({ ok: true, state: s.state });
});
app.post('/api/sessions/:sessionId/progress', (req, res) => {
  const s = sessionFor(req, 'tv');
  if (!s) return res.status(401).json({ error: 'Invalid TV token.' });
  const { currentTime, duration, playing } = req.body || {};
  if (Number.isFinite(Number(currentTime))) s.state.currentTime = Math.max(0, Number(currentTime));
  if (Number.isFinite(Number(duration))) s.state.duration = Math.max(0, Number(duration));
  if (typeof playing === 'boolean') s.state.playing = playing;
  s.state.updatedAt = Date.now();
  broadcast(s, { type: 'state', state: s.state });
  res.json({ ok: true });
});

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = u.searchParams.get('session'); const role = u.searchParams.get('role'); const token = u.searchParams.get('token');
  const s = sessions.get(sessionId);
  if (!s || !['tv', 'mobile'].includes(role) || !safeEqual(token || '', role === 'tv' ? s.tvToken : s.mobileToken)) { ws.close(1008, 'Unauthorized'); return; }
  const key = `${sessionId}:${role}`;
  sockets.get(key)?.close(4000, 'Reconnected'); sockets.set(key, ws);
  ws.send(JSON.stringify({ type: 'state', state: s.state }));
  ws.on('close', () => { if (sockets.get(key) === ws) sockets.delete(key); });
});

// Serve the built web client in production. In development, Vite runs separately.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(__dirname, '../client/dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
  res.sendFile(path.resolve(__dirname, '../client/dist/index.html'), err => { if (err) res.status(404).send('Build the client first: npm run build'); });
});

server.listen(PORT, () => console.log(`Media center backend listening on http://localhost:${PORT}`));
