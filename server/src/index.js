import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { connectDb } from "./db.js";
import { Message } from "./models/Message.js";
import { TYPES, safeJsonParse, sendJson } from "./ws/protocol.js";
import { joinRoom, leaveRoom, broadcastToRoom } from "./ws/rooms.js";

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const WS_PATH = process.env.WS_PATH || "/ws";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 50);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: WS_PATH });

// Heartbeat
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  // MVP identity: `name` from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const name = (url.searchParams.get("name") || "guest").slice(0, 32);

  ws._user = { name };
  ws._roomId = null;

  sendJson(ws, { type: TYPES.JOINED, user: { name } });

  ws.on("message", async (raw) => {
    const msg = safeJsonParse(raw.toString());
    if (!msg || !msg.type) {
      return sendJson(ws, { type: TYPES.ERROR, message: "Invalid JSON message" });
    }

    try {
      if (msg.type === TYPES.JOIN) {
        const roomId = String(msg.roomId || "").trim();
        if (!roomId) {
          return sendJson(ws, { type: TYPES.ERROR, message: "roomId required" });
        }

        joinRoom(ws, roomId);

        // Send history (oldest -> newest)
        const history = await Message.find({ roomId })
          .sort({ createdAt: -1 })
          .limit(HISTORY_LIMIT)
          .lean();

        history.reverse();

        return sendJson(ws, {
          type: TYPES.HISTORY,
          roomId,
          messages: history.map((m) => ({
            id: String(m._id),
            roomId: m.roomId,
            sender: m.sender,
            text: m.text,
            createdAt: m.createdAt
          }))
        });
      }

      if (msg.type === TYPES.SEND) {
        const roomId = ws._roomId;
        if (!roomId) {
          return sendJson(ws, { type: TYPES.ERROR, message: "Join a room first" });
        }

        const text = String(msg.text || "").trim();
        if (!text) return;

        if (text.length > 2000) {
          return sendJson(ws, { type: TYPES.ERROR, message: "Message too long" });
        }

        const created = await Message.create({
          roomId,
          sender: ws._user.name,
          text
        });

        const payload = {
          type: TYPES.MESSAGE,
          message: {
            id: String(created._id),
            roomId,
            sender: created.sender,
            text: created.text,
            createdAt: created.createdAt
          }
        };

        broadcastToRoom(roomId, payload);
        return;
      }

      if (msg.type === TYPES.TYPING) {
        const roomId = ws._roomId;
        if (!roomId) return;

        const isTyping = !!msg.isTyping;
        broadcastToRoom(roomId, {
          type: TYPES.TYPING,
          roomId,
          name: ws._user.name,
          isTyping
        });
        return;
      }

      return sendJson(ws, { type: TYPES.ERROR, message: "Unknown message type" });
    } catch (e) {
      console.error(e);
      return sendJson(ws, { type: TYPES.ERROR, message: "Server error" });
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });
});

// Ping clients to detect dead connections
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) ws.terminate();
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on("close", () => clearInterval(interval));

await connectDb(process.env.MONGODB_URI);

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WS: ws://localhost:${PORT}${WS_PATH}`);
});
