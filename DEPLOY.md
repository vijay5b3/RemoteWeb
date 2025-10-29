# Deploy signaling server (simple options)

This project requires the signaling server (`server.js`) to run on a host that supports WebSockets. Vercel cannot host long-lived WebSocket servers, so here are simple alternatives:

1) Railway.app (free tier)
   - Create an account, create a new project, and deploy from GitHub repository. Use `npm start` as the start command.

2) Fly.io
   - Good for small VPS-like deployments. Create an app, deploy the Node process.

3) DigitalOcean App Platform or small droplet
   - For production control, spin up a small droplet and run `node server.js` with PM2 or systemd.

4) Heroku (deprecated WebSocket limits)
   - Not recommended for production but possible for quick tests.

Remember:
- Update `web-capture.js` signalingUrl to use the public URL (wss:// or ws://) and port of the deployed server.
- Ensure CORS/host rules permit the frontend origin if necessary (server currently accepts WebSocket connections without origin checks).
