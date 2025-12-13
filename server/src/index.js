import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import mongoose from "mongoose";

import { connectDb } from "./db.js";
import { requireAuth } from "./auth/middleware.js";
import { verifyToken } from "./auth/jwt.js";

import { TYPES, safeJsonParse, sendJson } from "./ws/protocol.js";
import { joinRoomSocket, leaveRoomSocket, broadcastToRoom } from "./ws/rooms.js";

import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { usersRouter } from "./routes/users.js";
import { roomsRouter } from "./routes/rooms.js";

import { RoomMember } from "./models/RoomMember.js";
import { Message } from "./models/Message.js";
import { Room } from "./models/Room.js";

function oid(id) {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const WS_PATH = process.env.WS_PATH || "/ws";
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 50);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/me", requireAuth, meRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/rooms", requireAuth, roomsRouter);

const server = http.createServer(app);

// --- WebSocket server ---
const wss = new WebSocketServer({ server, path: WS_PATH });

// Heartbeat
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", async (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  // Auth via token query param: ws://host/ws?token=...
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = String(url.searchParams.get("token") || "");

  let user = null;
  try {
    const payload = verifyToken(token);
    user = { id: String(payload.sub), name: payload.name, email: payload.email };
  } catch {
    sendJson(ws, { type: TYPES.ERROR, message: "Unauthorized (invalid token)" });
    ws.close();
    return;
  }

  ws._user = user;
  ws._roomId = null;

  sendJson(ws, { type: TYPES.READY, user });

  ws.on("message", async (raw) => {
    const msg = safeJsonParse(raw.toString());
    if (!msg || !msg.type) {
      return sendJson(ws, { type: TYPES.ERROR, message: "Invalid JSON" });
    }

    async function ensureMember(roomId) {
      const roomObjId = oid(roomId);
      const meObjId = oid(user.id);
      if (!roomObjId || !meObjId) return { ok: false, error: "Invalid room id" };

      const room = await Room.findById(roomObjId).select("type visibility").lean();
      if (!room) return { ok: false, error: "Room not found" };

      const exists = await RoomMember.exists({ roomId: roomObjId, userId: meObjId });
      if (exists) return { ok: true, room, roomId: String(roomObjId) };

      // UX: allow auto-joining public group rooms (discover list / direct join)
      const isPublicGroup =
        room.type === "group" && (room.visibility === "public" || room.visibility === undefined);
      if (!isPublicGroup) {
        return {
          ok: false,
          error:
            room.type === "group" && room.visibility === "private"
              ? "Room is private. Join with password first."
              : "Not a member of this room",
        };
      }

      await RoomMember.updateOne(
        { roomId: roomObjId, userId: meObjId },
        { $setOnInsert: { roomId: roomObjId, userId: meObjId, role: "member" } },
        { upsert: true }
      );
      return { ok: true, room, roomId: String(roomObjId) };
    }

    try {
      if (msg.type === TYPES.JOIN) {
        const roomId = String(msg.roomId || "").trim();
        if (!roomId) return sendJson(ws, { type: TYPES.ERROR, message: "roomId required" });

        const check = await ensureMember(roomId);
        if (!check.ok) return sendJson(ws, { type: TYPES.ERROR, message: check.error });

        joinRoomSocket(ws, check.roomId);
        return;
      }

      if (msg.type === TYPES.SEND) {
        const roomId = String(msg.roomId || ws._roomId || "").trim();
        if (!roomId) return sendJson(ws, { type: TYPES.ERROR, message: "Join a room first" });

        const text = String(msg.text || "").trim();
        if (!text) return;
        if (text.length > 2000) return sendJson(ws, { type: TYPES.ERROR, message: "Message too long" });

        const check = await ensureMember(roomId);
        if (!check.ok) return sendJson(ws, { type: TYPES.ERROR, message: check.error });

        // ensure ws is in the room for presence updates
        if (ws._roomId !== check.roomId) joinRoomSocket(ws, check.roomId);

        const created = await Message.create({
          roomId: oid(check.roomId),
          senderId: oid(user.id),
          senderName: user.name,
          text,
        });

        broadcastToRoom(check.roomId, {
          type: TYPES.MESSAGE,
          message: {
            id: String(created._id),
            roomId: check.roomId,
            senderId: String(created.senderId),
            senderName: created.senderName,
            text: created.text,
            createdAt: created.createdAt,
          },
        });
        return;
      }

      if (msg.type === TYPES.TYPING) {
        const roomId = String(msg.roomId || ws._roomId || "").trim();
        if (!roomId) return;
        const check = await ensureMember(roomId);
        if (!check.ok) return;
        if (ws._roomId !== check.roomId) joinRoomSocket(ws, check.roomId);
        broadcastToRoom(
          check.roomId,
          { type: TYPES.TYPING, roomId: check.roomId, name: user.name, isTyping: !!msg.isTyping },
          { excludeWs: ws }
        );
        return;
      }

      return sendJson(ws, { type: TYPES.ERROR, message: "Unknown type" });
    } catch (e) {
      console.error(e);
      return sendJson(ws, { type: TYPES.ERROR, message: "Server error" });
    }
  });

  ws.on("close", () => {
    leaveRoomSocket(ws);
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

// --- Message TTL (optional) ---
async function ensureMessageTTL() {
  const days = Number(process.env.MESSAGE_TTL_DAYS || "");
  if (!days || days <= 0) return;

  const seconds = Math.floor(days * 24 * 60 * 60);
  try {
    await Message.collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: seconds });
    console.log(`TTL enabled: messages expire after ${days} day(s)`);
  } catch (e) {
    console.warn("Failed to create TTL index:", e?.message || e);
  }
}

// Start server
await connectDb(process.env.MONGODB_URI);
await ensureMessageTTL();

server.listen(PORT,  () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WS: ws://localhost:${PORT}${WS_PATH}`);
  console.log(`CORS origin: ${CLIENT_ORIGIN}`);
});
