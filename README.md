# Drive TV — personal media center starter

A React web app designed for a Fire TV browser, with a QR-paired mobile companion. Both clients communicate through the app backend; the phone never connects directly to the TV. The TV executes playback locally and reports progress to the backend.

## What's in this starter

- TV-first dark interface and mobile companion UI
- QR pairing and one-time pairing credential exchange
- WebSocket state updates between the backend and the TV/mobile web clients
- Google OAuth using read-only Drive scope
- Search/list folders in personal My Drive
- Backend media proxy with initial HTTP byte-range support
- Basic video/audio playback and mobile play/pause/seek/volume commands

This is a working **starter**, not a production-ready media server yet. In-memory session/OAuth token storage means sessions and Google sign-in are lost when the server restarts. Production deployment needs persistent encrypted token storage, expiring/revocable sessions, rate limits, CSRF/state protection for OAuth, HTTPS, robust range parsing/streaming tests, and a careful review of browser codec support. HLS transcoding, subtitles/audio-track selection, playlist navigation, and photo slideshow controls are not implemented yet.

## Requirements

- Node.js 20 or newer
- npm
- A Google account
- A Google Cloud project with the Google Drive API enabled

## 1. Configure Google OAuth

1. Open the Google Cloud Console: https://console.cloud.google.com/
2. Create/select a project and enable **Google Drive API**.
3. Configure the OAuth consent screen. For personal testing, add your Google account as a test user if the app is in testing mode.
4. Create an OAuth client ID of type **Web application**.
5. Add this authorized redirect URI exactly:
   `http://localhost:8787/auth/google/callback`
6. Copy `.env.example` to `.env` in the project root and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SIGNING_SECRET`.

The app requests `drive.readonly`; it does not need permission to edit or delete files.

## 2. Run locally

From the project root:

```bash
npm install
cp .env.example .env
# Edit .env with your OAuth client values
npm run dev
```

Open `http://localhost:5173`. Click **Connect Google Drive** and complete OAuth. Then browse files and play a supported video.

## 3. Pair your phone during local-network testing

For QR pairing to work, the phone must be able to reach the web app URL encoded in the QR code. `localhost` on your phone means the phone itself, not your development computer.

For LAN testing, set `APP_BASE_URL` in `.env` to the computer's reachable LAN URL, e.g. `http://192.168.1.20:5173`, and open the same URL on the Fire TV browser. Configure the Vite proxy and OAuth callback for your chosen access method as needed. The browser on the phone and TV must be able to reach the backend. For HTTPS or off-home access, deploy behind HTTPS and set `APP_BASE_URL` to the public origin.

Note: Google's OAuth redirect URI must match the redirect URI in `.env` exactly. OAuth over plain HTTP should only be used for local development. Use HTTPS for hosted use.

## 4. Build and run production client

```bash
npm run build
npm start
```

The server serves `client/dist` on port 8787. Set `APP_BASE_URL` to the actual origin serving the app before creating sessions. For a production deployment, terminate TLS at a trusted reverse proxy or hosting platform and use HTTPS.

## Project layout

```text
server/index.js         Express API, Google Drive OAuth/API proxy, sessions, WebSocket relay
client/src/main.jsx     TV and mobile interfaces
client/src/styles.css   Responsive TV-first styling
.env.example            Environment configuration template
```

## Known first-iteration limitations

- Google OAuth tokens and paired sessions are kept in server memory; restarting signs Drive out and invalidates sessions.
- Media format support depends on the Fire TV browser. The proxy is a simple initial implementation, not a fully tested streaming gateway.
- The current range handling is intentionally minimal; validate it thoroughly before large files or production use.
- The QR pairing URL carries a single-use pairing credential. Treat it as sensitive; the exchange is one-time, but production should also expire pending pairing credentials quickly and add session revocation.
- This starter assumes a single personal Drive connection shared by the app instance. It is not multi-user isolated.
