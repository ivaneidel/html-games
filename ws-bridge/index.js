const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

const clients = new Map();  // id -> ws
const pairs   = new Map();  // id -> paired id
const ghosts  = new Map();  // id -> setTimeout handle (disconnected but not yet purged)

const GHOST_TTL = 60_000;   // 30s to reconnect before pair is purged

function generateId() {
  let id;
  do { id = Math.floor(1000 + Math.random() * 9000).toString(); }
  while (clients.has(id) || ghosts.has(id));
  return id;
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function purge(id) {
  ghosts.delete(id);
  const paired = pairs.get(id);
  if (paired) {
    pairs.delete(paired);
    pairs.delete(id);
    // If the partner is also a ghost now, purge them too
    if (ghosts.has(paired)) {
      clearTimeout(ghosts.get(paired));
      purge(paired);
    }
  }
  console.log(`Purged ghost: ${id}`);
}

wss.on('connection', (ws) => {
  // Always assign a fresh ID immediately on connect
  const id = generateId();
  clients.set(id, ws);
  ws.id = id;
  console.log(`Client connected: ${id}`);
  send(ws, { type: 'id', id });

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    // ── REJOIN ──────────────────────────────────────────────
    if (data.type === 'rejoin') {
      const oldId = data.id;
      if (oldId === ws.id) return; // already on correct ID, nothing to do

      const isGhost  = ghosts.has(oldId);
      // On mobile/fast reloads the old WS may not have fired 'close' yet —
      // treat any non-OPEN connection as a valid rejoin target too
      const isStale  = clients.has(oldId) &&
                       clients.get(oldId).readyState !== WebSocket.OPEN;

      if (isGhost || isStale) {
        if (isGhost) {
          clearTimeout(ghosts.get(oldId));
          ghosts.delete(oldId);
        } else {
          // Force-close the stale socket and clean up
          try { clients.get(oldId).terminate(); } catch(_) {}
          clients.delete(oldId);
        }

        clients.delete(ws.id); // remove temp ID
        clients.set(oldId, ws);
        ws.id = oldId;
        console.log(`Client rejoined: ${oldId}`);

        send(ws, { type: 'id', id: oldId });

        const pairedId = pairs.get(oldId);
        if (pairedId && clients.has(pairedId)) {
          send(ws,                    { type: 'reconnected', with: pairedId });
          send(clients.get(pairedId), { type: 'reconnected', with: oldId });
        }
      }
      // If truly unknown ID, keep the fresh ID already assigned — no-op
      return;
    }

    // ── PAIR ────────────────────────────────────────────────
    if (data.type === 'connect') {
      const targetId = data.target;
      const target   = clients.get(targetId);
      if (!target) return send(ws, { type: 'error', message: 'User not found' });

      pairs.set(ws.id, targetId);
      pairs.set(targetId, ws.id);
      console.log(`Paired ${ws.id} <-> ${targetId}`);
      send(ws,     { type: 'connected', with: targetId });
      send(target, { type: 'connected', with: ws.id });
    }

    // ── RELAY ────────────────────────────────────────────────
    if (data.type === 'message') {
      const targetId = pairs.get(ws.id);
      const target   = clients.get(targetId);
      if (!target) return send(ws, { type: 'error', message: 'Not connected' });
      send(target, { type: 'message', from: ws.id, text: data.text });
    }
  });

  ws.on('close', () => {
    const id = ws.id;
    if (!id) return;
    clients.delete(id);
    console.log(`Client disconnected: ${id} — entering ghost state`);

    const paired = pairs.get(id);
    if (paired && clients.has(paired)) {
      send(clients.get(paired), { type: 'peer_disconnected' });
    }

    // Keep the pair alive for GHOST_TTL so the client can rejoin
    const timer = setTimeout(() => purge(id), GHOST_TTL);
    ghosts.set(id, timer);
  });
});

wss.on('listening', () => {
  console.log(`Server running on port ${PORT}`);

  const { spawn } = require('child_process');
  const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`]);

  cf.stderr.on('data', (data) => {
    const line = data.toString();
    // Cloudflare prints the public URL to stderr
    const match = line.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
    if (match) console.log(`\n🌐 Tunnel URL: ${match[0]}\n`);
  });

  cf.on('exit', (code) => console.log(`cloudflared exited with code ${code}`));
});
