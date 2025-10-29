# Web-to-Web Screen Capture — Minimal Implementation

This project is a minimal, client-side implementation of the Web-to-Web Screen Capture system described in `WEB_TO_WEB_IMPLEMENTATION_GUIDE.md`.

Features included:
- Screen capture via getDisplayMedia
- System audio detection with microphone fallback
- Live subtitles using the browser Web Speech API (when available)
- Clean fullscreen (capture) mode
- Share link generation (viewer detection via ?room=)

Files:
- `index.html` — main UI
- `styles.css` — styling (glass-morphism)
- `web-capture.js` — core logic (capture, speech recognition, UI wiring)

How to run locally
1. Start a simple HTTP server in the project folder. Example using Python:

```powershell
# from the project directory
python -m http.server 3000
```

2. Open your browser and navigate to:

```
http://localhost:3000
```

Notes and limitations
- This is a static, client-side demo. It does not implement WebRTC viewer streaming or any server-side components.
- Speech recognition depends on the browser's Web Speech API (Chrome/Edge have best support via webkitSpeechRecognition).
- System audio capture is limited by platform and browser. Some platforms may not allow system audio capture.

Next steps / Suggestions
- Add WebRTC server or peer connections for real-time viewer streaming.
- Add TypeScript and unit tests for better maintainability.
- Persist share links on a backend for multi-viewer management and access control.

## Deployment (GitHub + Vercel)

This repo contains a static frontend (index.html, styles.css, web-capture.js) and a lightweight signaling server (`server.js`) that uses WebSockets. You can host the frontend on Vercel and the signaling server on a separate host (recommended).

Quick steps to push to GitHub and deploy the frontend to Vercel:

1. Initialize git and push to GitHub (run locally):

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

2. Deploy frontend to Vercel:

- Sign up / log in to Vercel and connect your GitHub repository.
- In Vercel, create a new project and import the GitHub repo.
- Set the project to serve static files from the repository root. The included `vercel.json` config treats `index.html` as the static entry.

Important: Vercel (serverless) does NOT support long-lived WebSocket servers. The included `server.js` (signaling server) should be hosted separately on a VM/host that supports WebSockets (VPS, Railway, Fly.io, or a small cloud VM). Update the client `signalingUrl` in `web-capture.js` to point to the hosted signaling server URL.

3. CI (optional):

- A GitHub Actions workflow is included at `.github/workflows/ci.yml` that runs a simple Node restore and builds the WPF project (useful as a PR check).

Local validation before pushing

```powershell
# Install dependencies
npm install

# Start signaling server (required for full functionality)
npm start

# Open the frontend (or run the WPF host):
# - Browser: http://localhost:3001
# - Or run the native WPF wrapper:
cd dotnet-wpf
dotnet run
```

If you want, I can help you:
- Create a one-click Vercel deployment configuration, or
- Deploy the signaling server to a small cloud host (e.g., Railway/Fly.io) and update the client with the public URL.

