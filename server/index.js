const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("treasure-game WebSocket room server\n");
});

const wss = new WebSocketServer({ server });

/** @type {Map<string, Map<import('ws'), { id: string, name: string }>>} */
const rooms = new Map();

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function broadcastToRoom(roomId, payload, excludeWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const client of room.keys()) {
    if (client === excludeWs) continue;
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastToRoomAll(roomId, payload) {
  broadcastToRoom(roomId, payload, null);
}

wss.on("connection", (ws) => {
  /** @type {string | null} */
  let roomId = null;
  const clientId = randomId();

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === "join" && typeof msg.roomId === "string" && msg.roomId.trim()) {
      const playerNameRaw = typeof msg.playerName === "string" ? msg.playerName : "Player";
      const playerName = playerNameRaw.trim().slice(0, 24) || "Player";
      roomId = msg.roomId.trim().slice(0, 64);
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      const room = rooms.get(roomId);
      const isHost = room.size === 0;
      room.set(ws, { id: clientId, name: playerName });
      const peers = [...room.values()].map((p) => ({ id: p.id, name: p.name }));

      ws.send(
        JSON.stringify({
          type: "joined",
          roomId,
          clientId,
          isHost,
          peerCount: room.size,
          peers
        })
      );

      broadcastToRoom(
        roomId,
        {
          type: "peer_joined",
          roomId,
          peerCount: room.size,
          player: { id: clientId, name: playerName }
        },
        ws
      );
      return;
    }

    if (!roomId || !rooms.has(roomId) || !rooms.get(roomId).has(ws)) {
      return;
    }

    if (msg.type === "room_msg") {
      const forward = {
        type: "room_msg",
        roomId,
        from: clientId,
        data: msg.data
      };
      const room = rooms.get(roomId);
      const hostWs = room ? room.keys().next().value : null;

      if (msg.toHostOnly) {
        if (hostWs && hostWs !== ws && hostWs.readyState === 1) {
          hostWs.send(JSON.stringify(forward));
        }
        return;
      }
      if (msg.excludeSelf) {
        broadcastToRoom(roomId, forward, ws);
      } else {
        broadcastToRoomAll(roomId, forward);
      }
    }
  });

  ws.on("close", () => {
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    const left = room.get(ws);
    room.delete(ws);
    const count = room.size;
    if (count === 0) {
      rooms.delete(roomId);
    } else {
      broadcastToRoomAll(roomId, {
        type: "peer_left",
        roomId,
        peerCount: count,
        playerId: left ? left.id : null
      });
      const newHost = [...room.keys()][0];
      if (newHost && newHost.readyState === 1) {
        newHost.send(JSON.stringify({ type: "promoted_host", roomId }));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket room server listening on http://localhost:${PORT}`);
});
