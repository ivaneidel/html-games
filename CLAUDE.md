# html-games

A personal collection of single-file browser games (HTML + CSS + JS, occasionally Canvas). Most are **2-player multiplayer**. GitHub repo: `ivaneidel/html-games`, served statically via GitHub Pages at `https://ivaneidel.github.io/html-games/`.

Each game is a self-contained `.html` file at the repo root. There is no build step, no framework, no bundler. Versions are kept as separate files (`generala-v2.html`, `generala-v3.html`, …) rather than overwritten — older versions stay accessible.

## Layout

```
/                       individual game files (*.html)
/net/wssnet.js          shared WebSocket client (drop-in, zero-dep)
/ws-bridge/             Node ws-relay server (only needed at dev time)
multiplayer-syn-ack-pattern.md   the sync pattern used by WS games
```

## The multiplayer stack

Multiplayer games use a **3-piece architecture**:

1. **`ws-bridge/index.js`** — a dumb relay server. It assigns each client a 4-digit ID, pairs two IDs on request, and echoes `message` frames between paired peers. It holds NO game state. On startup it also spawns `cloudflared tunnel` to expose itself over a public `trycloudflare.com` URL.
2. **`net/wssnet.js`** — the `WSSNet` client class games import. It handles: server-URL prompt modal, pair-code modal, session resume on reload, ghost reconnect (60s TTL on the server), a floating ⋯ menu (new game / fullscreen / change server), and a tiny send/onMessage API. It auto-injects its own CSS, themeable via `--wssnet-*` custom properties.
3. **The game** — imports `wssnet.js` via the GitHub Pages URL (`https://ivaneidel.github.io/html-games/net/wssnet.js`) and implements game logic on top of `net.send(data)` / `onMessage(data)`.

### WSSNet API surface (the bits games actually use)

```js
const net = new WSSNet({
  onReady(myId)        {},   // server connected, ID assigned
  onPaired(myId, peer) {},   // paired with opponent — start the game
  onMessage(data)      {},   // peer sent something
  onReconnected(peer)  {},   // session resumed after a drop
  onPeerDisconnected() {},   // peer dropped (may rejoin within 60s)
});
net.mountServerModal();      // step 1: ask for server URL (auto-connects if cached)
net.mountPairModal();        // step 2: room-code pairing (call from onReady)
net.mountMenu();             // floating ⋯ menu, optional
net.send(anyJsonObject);     // delivered to peer's onMessage
net.myId; net.peer;
```

URL is persisted in `localStorage` (`wssnet_url`), session ID in `sessionStorage` (`wssnet_id`) so reloads resume the same identity.

### Wire protocol (client ↔ relay)

```
C→S: { type:"rejoin",  id }
C→S: { type:"connect", target }
C→S: { type:"message", text: <stringified json> }
S→C: { type:"id"|"connected"|"reconnected"|"peer_disconnected"|"message"|"error", ... }
```

### Running the relay locally

```
cd ws-bridge && npm install && node index.js
# Server on :8080, also prints a https://*.trycloudflare.com URL clients can paste
```

`cloudflared` must be installed on the host.

## The sync pattern (see `multiplayer-syn-ack-pattern.md`)

Turn-based WS games follow a deliberate, minimal pattern:

- **Turn ownership rotates** — whoever's turn it is runs all logic + randomness locally, then broadcasts the **complete** new state (never diffs).
- **Two message types only**: `state` (with monotonic `seq`) and `ack`.
- **Lower ID initialises** (`seq=0`); after that both sides are equal.
- Sender **retries unACKed state every 5s** (max 12 tries).
- Both clients `saveAll()` to **`sessionStorage`** after every action — reconnect just reloads storage and resends any pending message. No resync handshake.
- `localStorage` is reserved for cross-session prefs (the server URL); game state must use `sessionStorage` so two players on the same browser/device don't clobber each other.

Use a permanent host instead only when actions need validation against hidden state, simultaneous moves, or server-authoritative randomness.

## Games inventory

WS multiplayer (use WSSNet + the sync pattern):
- `generala-v2/v3/v4.html` — Generala (dice)
- `shattered-flux-v2.html`, `shuttered-flux-v3/v4.html`, `shattered-flux-v5.html` — note inconsistent "shattered" vs "shuttered" spelling across versions

Other multiplayer experiments:
- `pong-ws.html` — pong over a raw `new WebSocket(...)` (predates / bypasses WSSNet)
- `modem.html` ("Optical Link PRO") and `pong-v2.html` ("Pong Optical MAX") — **optical link**, two phones face each other and blink colored grids to transfer data (no network)
- `modem-sound.html` ("DTMF Sound Link") — audio/DTMF data channel
- `maze.html` — uses sessionStorage, possibly hot-seat

Single-player:
- `pong-v1.html`, `pong-claude.html` — local pong
- `aoe-light.html` — AoE-style RTS sketch
- `fps.html` — raycaster FPS

## Conventions to preserve when editing

- **One file per game.** No splitting into modules; copy-paste is the intended style.
- **Don't overwrite old versions** — create `*-v{n+1}.html` instead.
- **No build step, no dependencies** in game files. The only external script tag is `wssnet.js` from GitHub Pages.
- **`sessionStorage` for game state, `localStorage` for prefs.** Always.
- For new WS games, follow `multiplayer-syn-ack-pattern.md` literally — turn-owner-broadcasts-complete-state, seq+ack, retry on a timer, no resync requests.
- WSSNet auto-renders its own modals; don't build parallel server/pair UIs.
