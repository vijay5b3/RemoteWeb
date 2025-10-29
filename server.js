const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Serve the static site if requested (optional)
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// rooms: { roomId: { host: ws, viewers: Map(clientId->ws) } }
const rooms = new Map();

function safeSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch (e) { }
}

wss.on('connection', (ws, req) => {
  ws.id = Math.random().toString(36).slice(2,9);
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    const { type, room, role, target, payload } = msg;

    console.log('[server] recv', { type, room, role, target });

    if (type === 'join') {
      ws.roomId = room;
      ws.role = role;
      if (!rooms.has(room)) rooms.set(room, { host: null, viewers: new Map() });
      const r = rooms.get(room);
      if (role === 'host') {
        r.host = ws;
        ws.isHost = true;
        console.log('[server] host joined', room, ws.id);
        safeSend(ws, { type: 'joined', id: ws.id });
      } else {
        // viewer
        r.viewers.set(ws.id, ws);
        console.log('[server] viewer joined', room, ws.id);
        safeSend(ws, { type: 'joined', id: ws.id });
        // notify host that a viewer joined
        if (r.host) {
          safeSend(r.host, { type: 'viewer-joined', viewerId: ws.id });
          console.log('[server] notified host', r.host.id, 'of viewer', ws.id);
        }
      }
      return;
    }

    // Relay signaling messages within the room
    if (!room || !rooms.has(room)) return;
    const r = rooms.get(room);

    switch (type) {
      case 'offer':
        // offer from host -> viewer
        if (r && r.viewers.has(target)) {
          console.log('[server] relaying offer from', ws.id, 'to', target);
          safeSend(r.viewers.get(target), { type: 'offer', from: ws.id, payload });
        }
        break;
      case 'answer':
        // answer from viewer -> host
        if (r && r.host) {
          console.log('[server] relaying answer from', ws.id, 'to host', r.host.id);
          safeSend(r.host, { type: 'answer', from: ws.id, payload });
        }
        break;
      case 'candidate':
        // forward ICE candidates to target. If target omitted, route:
        // - viewer -> host
        // - host -> all viewers
        if (target) {
          if (r.host && target === r.host.id) {
            console.log('[server] relaying candidate from', ws.id, 'to host');
            safeSend(r.host, { type: 'candidate', from: ws.id, payload });
          }
          else if (r.viewers.has(target)) {
            console.log('[server] relaying candidate from', ws.id, 'to viewer', target);
            safeSend(r.viewers.get(target), { type: 'candidate', from: ws.id, payload });
          }
        } else {
          if (ws.role === 'viewer' && r.host) {
            console.log('[server] forwarding candidate from viewer', ws.id, 'to host');
            safeSend(r.host, { type: 'candidate', from: ws.id, payload });
          } else if (ws.role === 'host') {
            // broadcast to all viewers
            console.log('[server] broadcasting candidate from host to viewers');
            for (const [id, v] of r.viewers) safeSend(v, { type: 'candidate', from: ws.id, payload });
          }
        }
        break;
    }
  });

  ws.on('close', () => {
    const room = ws.roomId;
    if (!room || !rooms.has(room)) return;
    const r = rooms.get(room);
    if (ws.role === 'host') {
      // notify viewers
      for (const [, v] of r.viewers) safeSend(v, { type: 'host-left' });
      rooms.delete(room);
    } else {
      if (r.viewers.has(ws.id)) r.viewers.delete(ws.id);
      if (r.host) safeSend(r.host, { type: 'viewer-left', viewerId: ws.id });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
});
