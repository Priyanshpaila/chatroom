import { sendJson, TYPES } from "./protocol.js";

const roomMembers = new Map(); // roomId -> Set(ws)

export function joinRoom(ws, roomId) {
  leaveRoom(ws);

  ws._roomId = roomId;

  if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
  roomMembers.get(roomId).add(ws);

  broadcastPresence(roomId);
}

export function leaveRoom(ws) {
  const roomId = ws._roomId;
  if (!roomId) return;

  const set = roomMembers.get(roomId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) roomMembers.delete(roomId);
  }

  ws._roomId = null;

  broadcastPresence(roomId);
}

export function broadcastToRoom(roomId, payload) {
  const set = roomMembers.get(roomId);
  if (!set) return;

  for (const client of set) {
    sendJson(client, payload);
  }
}

export function broadcastPresence(roomId) {
  const set = roomMembers.get(roomId);
  const online = set
    ? Array.from(set)
        .filter((w) => w._user)
        .map((w) => ({ name: w._user.name }))
    : [];

  broadcastToRoom(roomId, { type: TYPES.PRESENCE, roomId, online });
}
