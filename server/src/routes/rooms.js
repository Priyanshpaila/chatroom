import express from "express";
import mongoose from "mongoose";
import { Room } from "../models/Room.js";
import { RoomMember } from "../models/RoomMember.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";

export const roomsRouter = express.Router();

function oid(id) {
  return new mongoose.Types.ObjectId(id);
}

// GET /api/rooms -> list rooms for user
roomsRouter.get("/", async (req, res) => {
  const userId = req.user.id;

  const memberships = await RoomMember.find({ userId: oid(userId) }).lean();
  const roomIds = memberships.map((m) => m.roomId);

  const rooms = await Room.find({ _id: { $in: roomIds } }).lean();

  // last message per room (simple approach)
  const lastMessages = await Message.aggregate([
    { $match: { roomId: { $in: roomIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$roomId",
        last: { $first: "$$ROOT" },
      },
    },
  ]);

  const lastByRoom = new Map(lastMessages.map((x) => [String(x._id), x.last]));

  // For DM rooms, compute display name (other user)
  const dmRooms = rooms.filter((r) => r.type === "dm" && Array.isArray(r.dmPair) && r.dmPair.length === 2);
  const dmUserIds = new Set();
  for (const r of dmRooms) {
    const a = String(r.dmPair[0]);
    const b = String(r.dmPair[1]);
    if (a !== userId) dmUserIds.add(a);
    if (b !== userId) dmUserIds.add(b);
  }
  const dmUsers = dmUserIds.size
    ? await User.find({ _id: { $in: Array.from(dmUserIds).map(oid) } }).select("_id name email").lean()
    : [];
  const dmUserMap = new Map(dmUsers.map((u) => [String(u._id), u]));

  const out = rooms.map((r) => {
    const roomId = String(r._id);
    const last = lastByRoom.get(roomId);
    const m = memberships.find((x) => String(x.roomId) === roomId);
    let title = r.name || "Room";

    if (r.type === "dm" && Array.isArray(r.dmPair)) {
      const otherId = String(r.dmPair[0]) === userId ? String(r.dmPair[1]) : String(r.dmPair[0]);
      const other = dmUserMap.get(otherId);
      title = other?.name || "DM";
    }

    return {
      id: roomId,
      type: r.type,
      title,
      lastClearedAt: m?.lastClearedAt || new Date(0),
      lastMessage: last
        ? {
            id: String(last._id),
            senderName: last.senderName,
            text: last.text,
            createdAt: last.createdAt,
          }
        : null,
    };
  });

  // sort by last message desc
  out.sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });

  return res.json({ rooms: out });
});

// POST /api/rooms -> create group room {name}
roomsRouter.post("/", async (req, res) => {
  const userId = req.user.id;
  const name = String(req.body?.name || "").trim();

  if (!name || name.length < 2) return res.status(400).json({ error: "Room name min 2 chars" });

  const room = await Room.create({ type: "group", name });
  await RoomMember.create({ roomId: room._id, userId: oid(userId), role: "owner" });

  return res.json({ room: { id: String(room._id), type: room.type, title: room.name } });
});

// POST /api/rooms/dm {userId} -> get or create DM room
roomsRouter.post("/dm", async (req, res) => {
  const me = req.user.id;
  const other = String(req.body?.userId || "").trim();
  if (!other) return res.status(400).json({ error: "userId required" });
  if (other === me) return res.status(400).json({ error: "Cannot DM yourself" });

  const a = oid(me);
  const b = oid(other);
  const pair = [a, b].sort((x, y) => String(x).localeCompare(String(y)));

  let room = await Room.findOne({ type: "dm", dmPair: pair });
  if (!room) {
    room = await Room.create({ type: "dm", dmPair: pair });
  }

  // ensure memberships
  await RoomMember.updateOne(
    { roomId: room._id, userId: a },
    { $setOnInsert: { roomId: room._id, userId: a, role: "member" } },
    { upsert: true }
  );
  await RoomMember.updateOne(
    { roomId: room._id, userId: b },
    { $setOnInsert: { roomId: room._id, userId: b, role: "member" } },
    { upsert: true }
  );

  return res.json({ room: { id: String(room._id), type: room.type } });
});

// GET /api/rooms/:roomId/messages?before=&limit=
roomsRouter.get("/:roomId/messages", async (req, res) => {
  const userId = req.user.id;
  const roomId = String(req.params.roomId);

  const member = await RoomMember.findOne({ roomId: oid(roomId), userId: oid(userId) }).lean();
  if (!member) return res.status(403).json({ error: "Not a member of this room" });

  const limit = Math.min(100, Number(req.query.limit || 50));
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  const filter = {
    roomId: oid(roomId),
    createdAt: { $gt: member.lastClearedAt },
  };

  if (before && !isNaN(before.getTime())) {
    filter.createdAt.$lt = before;
  }

  const docs = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  docs.reverse();

  return res.json({
    messages: docs.map((m) => ({
      id: String(m._id),
      roomId: String(m.roomId),
      senderId: String(m.senderId),
      senderName: m.senderName,
      text: m.text,
      createdAt: m.createdAt,
    })),
    nextBefore: docs.length ? docs[0].createdAt : null,
  });
});

// POST /api/rooms/:roomId/clear  (per-user clear)
roomsRouter.post("/:roomId/clear", async (req, res) => {
  const userId = req.user.id;
  const roomId = String(req.params.roomId);

  const member = await RoomMember.findOne({ roomId: oid(roomId), userId: oid(userId) });
  if (!member) return res.status(403).json({ error: "Not a member of this room" });

  member.lastClearedAt = new Date();
  await member.save();

  return res.json({ ok: true, lastClearedAt: member.lastClearedAt });
});
